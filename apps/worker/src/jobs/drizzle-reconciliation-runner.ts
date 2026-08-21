import { createHash } from "node:crypto";

import { effectiveUsageEventPredicate, type Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  invoicePreviewGenerationJob,
  invoicePreviews,
  jobs,
  meters,
  meterVersions,
  reconciliationFindings,
  reconciliationRuns,
  usageBuckets,
  usageEvents,
  type MeterDimensions,
} from "@meterpilot/db/schema";
import Decimal from "decimal.js";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { permanentJobError, retryableJobError } from "./errors";
import type { ReconciliationRunner } from "./reconciliation-runner";
import {
  aggregateBucket,
  dimensionsHash,
  matchesMeterFilters,
  meterDimensions,
  meterFilterDefinitionSchema,
  meterGroupByKeysSchema,
  startOfUtcHour,
} from "./usage-event-aggregation";

const ExactDecimal = Decimal.clone({ precision: 256, rounding: Decimal.ROUND_HALF_UP });

type ExpectedBucket = Readonly<{
  bucketStart: Date;
  dimensions: MeterDimensions;
  dimensionsHash: string;
  eventCount: number;
  maxReceivedAt: Date;
  meterVersionId: string;
  quantity: string;
}>;

type ActualBucket = Readonly<{
  bucketStart: Date;
  dimensions: MeterDimensions;
  dimensionsHash: string;
  eventCount: number;
  meterVersionId: string;
  quantity: string;
}>;

function later(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function bucketKey(bucket: {
  bucketStart: Date;
  dimensionsHash: string;
  meterVersionId: string;
}): string {
  return `${bucket.meterVersionId}:${bucket.bucketStart.toISOString()}:${bucket.dimensionsHash}`;
}

function canonicalDimensions(dimensions: MeterDimensions) {
  return Object.fromEntries(
    Object.entries(dimensions).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stateHash(buckets: readonly ActualBucket[]): string {
  const canonical = [...buckets]
    .sort((left, right) => bucketKey(left).localeCompare(bucketKey(right)))
    .map((bucket) => ({
      bucketStart: bucket.bucketStart.toISOString(),
      dimensions: canonicalDimensions(bucket.dimensions),
      dimensionsHash: bucket.dimensionsHash,
      eventCount: bucket.eventCount,
      meterVersionId: bucket.meterVersionId,
      quantity: new ExactDecimal(bucket.quantity).toFixed(),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sameAggregate(expected: ExpectedBucket, actual: ActualBucket): boolean {
  return (
    expected.eventCount === actual.eventCount &&
    new ExactDecimal(expected.quantity).eq(new ExactDecimal(actual.quantity))
  );
}

export function createDrizzleReconciliationRunner(
  database: Database["db"],
  now: () => Date = () => new Date(),
): ReconciliationRunner {
  return Object.freeze({
    async fail(organizationId, runId, failureCode, requestId) {
      const completedAt = now();
      await database.transaction(async (transaction) => {
        const [failed] = await transaction
          .update(reconciliationRuns)
          .set({ completedAt, failureCode, status: "failed" })
          .where(
            and(
              eq(reconciliationRuns.organizationId, organizationId),
              eq(reconciliationRuns.id, runId),
              eq(reconciliationRuns.status, "pending"),
            ),
          )
          .returning({ id: reconciliationRuns.id });
        if (failed) {
          await transaction.insert(auditLog).values({
            action: "reconciliation.failed",
            actorType: "system",
            metadata: { failureCode },
            occurredAt: completedAt,
            organizationId,
            requestId,
            resourceId: failed.id,
            resourceType: "reconciliation_run",
          });
        }
      });
    },

    async run(organizationId, runId, requestId, signal) {
      if (signal.aborted) {
        throw retryableJobError("worker_shutdown", "Worker shutdown interrupted reconciliation.");
      }

      return database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(reconciliationRuns)
          .where(
            and(
              eq(reconciliationRuns.organizationId, organizationId),
              eq(reconciliationRuns.id, runId),
            ),
          )
          .for("update")
          .limit(1);
        if (!run) return { status: "not_found" } as const;
        if (run.status !== "pending") return { status: "terminal" } as const;

        const versions = await transaction
          .select({ row: meterVersions })
          .from(meterVersions)
          .innerJoin(
            meters,
            and(
              eq(meters.organizationId, meterVersions.organizationId),
              eq(meters.id, meterVersions.meterId),
            ),
          )
          .where(
            and(
              eq(meterVersions.organizationId, organizationId),
              eq(meterVersions.meterId, run.meterId),
              eq(meters.status, "active"),
              isNotNull(meterVersions.publishedAt),
              lt(meterVersions.effectiveFrom, run.periodEnd),
              or(isNull(meterVersions.effectiveTo), gt(meterVersions.effectiveTo, run.periodStart)),
            ),
          )
          .orderBy(asc(meterVersions.effectiveFrom));
        if (versions.length === 0) {
          throw permanentJobError(
            "no_published_meter_versions",
            "The reconciliation period has no published meter definition.",
          );
        }

        const expected = new Map<string, ExpectedBucket>();
        for (const { row: version } of versions) {
          if (signal.aborted) {
            throw retryableJobError(
              "worker_shutdown",
              "Worker shutdown interrupted reconciliation.",
            );
          }
          const filters = meterFilterDefinitionSchema.safeParse(version.filterDefinition);
          const groupByKeys = meterGroupByKeysSchema.safeParse(version.groupByKeys);
          if (!filters.success || !groupByKeys.success) {
            throw permanentJobError(
              "invalid_meter_definition",
              "A published meter definition is invalid.",
            );
          }

          const rangeStart = later(run.periodStart, version.effectiveFrom);
          const rangeEnd = version.effectiveTo
            ? earlier(run.periodEnd, version.effectiveTo)
            : run.periodEnd;
          const events = await transaction
            .select({
              occurredAt: usageEvents.occurredAt,
              properties: usageEvents.properties,
              propertiesRedactedAt: usageEvents.propertiesRedactedAt,
              receivedAt: usageEvents.receivedAt,
            })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                eq(usageEvents.customerId, run.customerId),
                eq(usageEvents.eventType, version.eventType),
                gte(usageEvents.occurredAt, rangeStart),
                lt(usageEvents.occurredAt, rangeEnd),
                lte(usageEvents.receivedAt, run.inputWatermark),
                effectiveUsageEventPredicate(run.inputWatermark),
              ),
            );
          if (events.some((event) => event.propertiesRedactedAt !== null)) {
            throw permanentJobError(
              "source_properties_redacted",
              "Reconciliation source properties were removed by retention policy.",
            );
          }
          const groups = new Map<
            string,
            {
              bucketStart: Date;
              dimensions: MeterDimensions;
              events: Array<{ properties: Record<string, unknown>; receivedAt: Date }>;
            }
          >();
          for (const event of events) {
            if (!matchesMeterFilters(event.properties, filters.data)) continue;
            const dimensions = meterDimensions(event.properties, groupByKeys.data);
            const bucketStart = startOfUtcHour(event.occurredAt);
            const key = `${bucketStart.toISOString()}:${dimensionsHash(dimensions)}`;
            const group = groups.get(key) ?? { bucketStart, dimensions, events: [] };
            group.events.push({ properties: event.properties, receivedAt: event.receivedAt });
            groups.set(key, group);
          }

          for (const group of groups.values()) {
            const aggregated = aggregateBucket(version, group.events, group.dimensions);
            if (!aggregated) continue;
            const bucket: ExpectedBucket = {
              bucketStart: group.bucketStart,
              dimensions: aggregated.dimensions,
              dimensionsHash: aggregated.dimensionsHash,
              eventCount: aggregated.eventCount,
              maxReceivedAt: aggregated.maxReceivedAt,
              meterVersionId: version.id,
              quantity: aggregated.quantity,
            };
            expected.set(bucketKey(bucket), bucket);
          }
        }

        const actualRows = await transaction
          .select({
            bucketStart: usageBuckets.bucketStart,
            dimensions: usageBuckets.dimensions,
            dimensionsHash: usageBuckets.dimensionsHash,
            eventCount: usageBuckets.eventCount,
            meterVersionId: usageBuckets.meterVersionId,
            quantity: usageBuckets.quantity,
          })
          .from(usageBuckets)
          .where(
            and(
              eq(usageBuckets.organizationId, organizationId),
              eq(usageBuckets.customerId, run.customerId),
              inArray(
                usageBuckets.meterVersionId,
                versions.map(({ row }) => row.id),
              ),
              gte(usageBuckets.bucketStart, run.periodStart),
              lt(usageBuckets.bucketStart, run.periodEnd),
            ),
          );
        const actual = new Map(actualRows.map((bucket) => [bucketKey(bucket), bucket]));
        const findings: Array<{
          actualEventCount: number | null;
          actualQuantity: string | null;
          bucketStart: Date;
          dimensions: MeterDimensions;
          dimensionsHash: string;
          expectedEventCount: number | null;
          expectedQuantity: string | null;
          kind: "missing" | "mismatch" | "unexpected";
          meterVersionId: string;
          repaired: boolean;
        }> = [];
        let totalMagnitude = new ExactDecimal(0);

        for (const [key, expectedBucket] of expected) {
          const actualBucket = actual.get(key);
          if (!actualBucket) {
            findings.push({
              actualEventCount: null,
              actualQuantity: null,
              bucketStart: expectedBucket.bucketStart,
              dimensions: expectedBucket.dimensions,
              dimensionsHash: expectedBucket.dimensionsHash,
              expectedEventCount: expectedBucket.eventCount,
              expectedQuantity: expectedBucket.quantity,
              kind: "missing",
              meterVersionId: expectedBucket.meterVersionId,
              repaired: run.repairRequested,
            });
            totalMagnitude = totalMagnitude.plus(new ExactDecimal(expectedBucket.quantity).abs());
          } else if (!sameAggregate(expectedBucket, actualBucket)) {
            findings.push({
              actualEventCount: actualBucket.eventCount,
              actualQuantity: actualBucket.quantity,
              bucketStart: expectedBucket.bucketStart,
              dimensions: expectedBucket.dimensions,
              dimensionsHash: expectedBucket.dimensionsHash,
              expectedEventCount: expectedBucket.eventCount,
              expectedQuantity: expectedBucket.quantity,
              kind: "mismatch",
              meterVersionId: expectedBucket.meterVersionId,
              repaired: run.repairRequested,
            });
            totalMagnitude = totalMagnitude.plus(
              new ExactDecimal(expectedBucket.quantity).minus(actualBucket.quantity).abs(),
            );
          }
        }
        for (const [key, actualBucket] of actual) {
          if (expected.has(key)) continue;
          findings.push({
            actualEventCount: actualBucket.eventCount,
            actualQuantity: actualBucket.quantity,
            bucketStart: actualBucket.bucketStart,
            dimensions: actualBucket.dimensions,
            dimensionsHash: actualBucket.dimensionsHash,
            expectedEventCount: null,
            expectedQuantity: null,
            kind: "unexpected",
            meterVersionId: actualBucket.meterVersionId,
            repaired: run.repairRequested,
          });
          totalMagnitude = totalMagnitude.plus(new ExactDecimal(actualBucket.quantity).abs());
        }

        const beforeHash = stateHash(actualRows);
        const completedAt = now();
        if (run.repairRequested && findings.length > 0) {
          for (const finding of findings) {
            if (signal.aborted) {
              throw retryableJobError(
                "worker_shutdown",
                "Worker shutdown interrupted reconciliation repair.",
              );
            }
            const key = bucketKey(finding);
            const expectedBucket = expected.get(key);
            if (!expectedBucket) {
              await transaction
                .delete(usageBuckets)
                .where(
                  and(
                    eq(usageBuckets.organizationId, organizationId),
                    eq(usageBuckets.customerId, run.customerId),
                    eq(usageBuckets.meterVersionId, finding.meterVersionId),
                    eq(usageBuckets.bucketStart, finding.bucketStart),
                    eq(usageBuckets.bucketSize, "hour"),
                    eq(usageBuckets.dimensionsHash, finding.dimensionsHash),
                  ),
                );
              continue;
            }
            await transaction
              .insert(usageBuckets)
              .values({
                bucketSize: "hour",
                bucketStart: expectedBucket.bucketStart,
                customerId: run.customerId,
                dimensions: expectedBucket.dimensions,
                dimensionsHash: expectedBucket.dimensionsHash,
                eventCount: expectedBucket.eventCount,
                maxReceivedAt: expectedBucket.maxReceivedAt,
                meterVersionId: expectedBucket.meterVersionId,
                organizationId,
                quantity: expectedBucket.quantity,
                updatedAt: completedAt,
              })
              .onConflictDoUpdate({
                set: {
                  dimensions: expectedBucket.dimensions,
                  eventCount: expectedBucket.eventCount,
                  maxReceivedAt: expectedBucket.maxReceivedAt,
                  quantity: expectedBucket.quantity,
                  revision: sql`${usageBuckets.revision} + 1`,
                  updatedAt: completedAt,
                },
                target: [
                  usageBuckets.organizationId,
                  usageBuckets.meterVersionId,
                  usageBuckets.customerId,
                  usageBuckets.bucketStart,
                  usageBuckets.bucketSize,
                  usageBuckets.dimensionsHash,
                ],
              });
          }
        }

        if (findings.length > 0) {
          await transaction.insert(reconciliationFindings).values(
            findings.map((finding) => ({
              ...finding,
              createdAt: completedAt,
              organizationId,
              runId,
            })),
          );
        }

        let previewRevisionCount = 0;
        if (run.repairRequested && findings.length > 0) {
          const series = await transaction
            .selectDistinct({ seriesId: invoicePreviews.seriesId })
            .from(invoicePreviews)
            .where(
              and(
                eq(invoicePreviews.organizationId, organizationId),
                eq(invoicePreviews.customerId, run.customerId),
                lt(invoicePreviews.periodStart, run.periodEnd),
                gt(invoicePreviews.periodEnd, run.periodStart),
              ),
            );
          for (const item of series) {
            await transaction.execute(
              sql`select pg_advisory_xact_lock(hashtext(${item.seriesId}))`,
            );
            const [latest] = await transaction
              .select()
              .from(invoicePreviews)
              .where(
                and(
                  eq(invoicePreviews.organizationId, organizationId),
                  eq(invoicePreviews.seriesId, item.seriesId),
                ),
              )
              .orderBy(desc(invoicePreviews.revision))
              .for("update")
              .limit(1);
            if (!latest || latest.status === "pending") continue;
            const [completedExport] = await transaction
              .select({ id: billingExports.id })
              .from(billingExports)
              .where(
                and(
                  eq(billingExports.organizationId, organizationId),
                  eq(billingExports.sourcePreviewRevisionId, latest.id),
                  eq(billingExports.status, "completed"),
                ),
              )
              .limit(1);
            const revisionId = crypto.randomUUID();
            await transaction.insert(invoicePreviews).values({
              adjustmentOfPreviewId: completedExport ? latest.id : null,
              createdAt: completedAt,
              currency: latest.currency,
              customerId: latest.customerId,
              id: revisionId,
              organizationId,
              periodEnd: latest.periodEnd,
              periodStart: latest.periodStart,
              planVersionId: latest.planVersionId,
              requestedBy: latest.requestedBy,
              revision: latest.revision + 1,
              seriesId: latest.seriesId,
              subscriptionId: latest.subscriptionId,
            });
            await transaction.insert(jobs).values(
              invoicePreviewGenerationJob({
                createdAt: completedAt,
                organizationId,
                previewId: revisionId,
                requestId: `reconciliation:${runId}`,
              }),
            );
            await transaction.insert(auditLog).values({
              action: "invoice_preview.revision_requested",
              actorType: "system",
              metadata: { reconciliationRunId: runId, revision: latest.revision + 1 },
              occurredAt: completedAt,
              organizationId,
              requestId: `reconciliation:${runId}`,
              resourceId: latest.seriesId,
              resourceType: "invoice_preview",
            });
            previewRevisionCount++;
          }
        }

        const afterHash = run.repairRequested ? stateHash([...expected.values()]) : beforeHash;
        const summary = {
          driftCount: findings.length,
          repairedCount: run.repairRequested ? findings.length : 0,
          totalMagnitude: totalMagnitude.toFixed(),
        };
        await transaction
          .update(reconciliationRuns)
          .set({ afterHash, beforeHash, completedAt, status: "completed", summary })
          .where(
            and(
              eq(reconciliationRuns.organizationId, organizationId),
              eq(reconciliationRuns.id, runId),
              eq(reconciliationRuns.status, "pending"),
            ),
          );
        await transaction.insert(auditLog).values({
          action: run.kind === "replay" ? "replay.completed" : "reconciliation.completed",
          actorType: "system",
          metadata: { afterHash, beforeHash, previewRevisionCount, ...summary },
          occurredAt: completedAt,
          organizationId,
          requestId,
          resourceId: runId,
          resourceType: "reconciliation_run",
        });
        return {
          driftCount: summary.driftCount,
          status: "completed",
          totalMagnitude: summary.totalMagnitude,
        } as const;
      });
    },
  });
}
