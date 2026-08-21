import { effectiveUsageEventPredicate, type Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  invoicePreviewGenerationJob,
  invoicePreviews,
  jobs,
  meters,
  meterVersions,
  usageBuckets,
  usageEvents,
} from "@meterpilot/db/schema";
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { permanentJobError, retryableJobError } from "./errors";
import {
  aggregateBucket,
  dimensionsHash,
  matchesMeterFilters,
  meterDimensions,
  meterFilterDefinitionSchema,
  meterGroupByKeysSchema,
  startOfUtcHour,
} from "./usage-event-aggregation";
import type { UsageEventProcessor } from "./usage-event-processor";

const HOUR_MS = 60 * 60 * 1000;

function laterDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

export function createDrizzleUsageEventProcessor(
  database: Database["db"],
  now: () => Date = () => new Date(),
): UsageEventProcessor {
  return Object.freeze({
    async process(organizationId, eventId, signal) {
      if (signal.aborted) {
        throw retryableJobError("worker_shutdown", "Worker shutdown interrupted job processing.");
      }

      return database.transaction(async (transaction) => {
        const [event] = await transaction
          .select({
            correctionOfEventId: usageEvents.correctionOfEventId,
            customerId: usageEvents.customerId,
            eventType: usageEvents.eventType,
            occurredAt: usageEvents.occurredAt,
            properties: usageEvents.properties,
            propertiesRedactedAt: usageEvents.propertiesRedactedAt,
            receivedAt: usageEvents.receivedAt,
          })
          .from(usageEvents)
          .where(and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.id, eventId)))
          .limit(1);

        if (!event) {
          return { status: "not_found" } as const;
        }
        if (event.propertiesRedactedAt) {
          throw permanentJobError(
            "source_properties_redacted",
            "Usage-event properties were removed before processing completed.",
          );
        }

        const affectedEvents = [event];
        if (event.correctionOfEventId) {
          const [corrected] = await transaction
            .select({
              correctionOfEventId: usageEvents.correctionOfEventId,
              customerId: usageEvents.customerId,
              eventType: usageEvents.eventType,
              occurredAt: usageEvents.occurredAt,
              properties: usageEvents.properties,
              propertiesRedactedAt: usageEvents.propertiesRedactedAt,
              receivedAt: usageEvents.receivedAt,
            })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                eq(usageEvents.id, event.correctionOfEventId),
              ),
            )
            .limit(1);
          if (!corrected) {
            throw permanentJobError(
              "invalid_correction",
              "A usage correction references a missing event.",
            );
          }
          if (corrected.propertiesRedactedAt) {
            throw permanentJobError(
              "source_properties_redacted",
              "Corrected usage-event properties were removed by retention policy.",
            );
          }
          affectedEvents.push(corrected);
        }

        let adjustmentPreviewRevisionCount = 0;
        let bucketCount = 0;
        let previewRevisionCount = 0;
        const processedAt = now();
        const rebuilds = new Map<
          string,
          Readonly<{
            bucketStart: Date;
            customerId: string;
            dimensions: ReturnType<typeof meterDimensions>;
            dimensionsHash: string;
            meter: Readonly<{
              aggregation: "count" | "sum";
              effectiveFrom: Date;
              effectiveTo: Date | null;
              eventType: string;
              filterDefinition: unknown;
              groupByKeys: string[];
              id: string;
              valueProperty: string | null;
            }>;
            rangeEnd: Date;
            rangeStart: Date;
          }>
        >();

        for (const affectedEvent of affectedEvents) {
          if (signal.aborted) {
            throw retryableJobError(
              "worker_shutdown",
              "Worker shutdown interrupted job processing.",
            );
          }
          const publishedMeters = await transaction
            .select({
              aggregation: meterVersions.aggregation,
              effectiveFrom: meterVersions.effectiveFrom,
              effectiveTo: meterVersions.effectiveTo,
              eventType: meterVersions.eventType,
              filterDefinition: meterVersions.filterDefinition,
              groupByKeys: meterVersions.groupByKeys,
              id: meterVersions.id,
              valueProperty: meterVersions.valueProperty,
            })
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
                eq(meterVersions.eventType, affectedEvent.eventType),
                eq(meters.status, "active"),
                isNotNull(meterVersions.publishedAt),
                lte(meterVersions.effectiveFrom, affectedEvent.occurredAt),
                or(
                  isNull(meterVersions.effectiveTo),
                  gt(meterVersions.effectiveTo, affectedEvent.occurredAt),
                ),
              ),
            );

          for (const meter of publishedMeters) {
            const filters = meterFilterDefinitionSchema.safeParse(meter.filterDefinition);
            const groupByKeys = meterGroupByKeysSchema.safeParse(meter.groupByKeys);
            if (!filters.success || !groupByKeys.success) {
              throw permanentJobError(
                "invalid_meter_definition",
                "The published meter definition is invalid.",
              );
            }
            if (!matchesMeterFilters(affectedEvent.properties, filters.data)) {
              continue;
            }

            const dimensions = meterDimensions(affectedEvent.properties, groupByKeys.data);
            const bucketStart = startOfUtcHour(affectedEvent.occurredAt);
            const bucketEnd = new Date(bucketStart.getTime() + HOUR_MS);
            const rangeStart = laterDate(bucketStart, meter.effectiveFrom);
            const rangeEnd = meter.effectiveTo
              ? earlierDate(bucketEnd, meter.effectiveTo)
              : bucketEnd;
            const currentDimensionsHash = dimensionsHash(dimensions);
            rebuilds.set(
              [
                meter.id,
                affectedEvent.customerId,
                bucketStart.toISOString(),
                currentDimensionsHash,
              ].join(":"),
              {
                bucketStart,
                customerId: affectedEvent.customerId,
                dimensions,
                dimensionsHash: currentDimensionsHash,
                meter,
                rangeEnd,
                rangeStart,
              },
            );
          }
        }

        for (const rebuild of rebuilds.values()) {
          const events = await transaction
            .select({ properties: usageEvents.properties, receivedAt: usageEvents.receivedAt })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.organizationId, organizationId),
                eq(usageEvents.eventType, rebuild.meter.eventType),
                eq(usageEvents.customerId, rebuild.customerId),
                gte(usageEvents.occurredAt, rebuild.rangeStart),
                lt(usageEvents.occurredAt, rebuild.rangeEnd),
                effectiveUsageEventPredicate(),
              ),
            );
          const aggregated = aggregateBucket(rebuild.meter, events, rebuild.dimensions);
          if (!aggregated) {
            await transaction
              .delete(usageBuckets)
              .where(
                and(
                  eq(usageBuckets.organizationId, organizationId),
                  eq(usageBuckets.meterVersionId, rebuild.meter.id),
                  eq(usageBuckets.customerId, rebuild.customerId),
                  eq(usageBuckets.bucketStart, rebuild.bucketStart),
                  eq(usageBuckets.bucketSize, "hour"),
                  eq(usageBuckets.dimensionsHash, rebuild.dimensionsHash),
                ),
              );
            bucketCount++;
            continue;
          }

          await transaction
            .insert(usageBuckets)
            .values({
              bucketSize: "hour",
              bucketStart: rebuild.bucketStart,
              dimensions: aggregated.dimensions,
              dimensionsHash: aggregated.dimensionsHash,
              eventCount: aggregated.eventCount,
              maxReceivedAt: aggregated.maxReceivedAt,
              meterVersionId: rebuild.meter.id,
              organizationId,
              quantity: aggregated.quantity,
              customerId: rebuild.customerId,
              updatedAt: processedAt,
            })
            .onConflictDoUpdate({
              set: {
                eventCount: aggregated.eventCount,
                maxReceivedAt: aggregated.maxReceivedAt,
                quantity: aggregated.quantity,
                revision: sql`${usageBuckets.revision} + 1`,
                updatedAt: processedAt,
              },
              setWhere: sql`
                ${usageBuckets.quantity} is distinct from excluded.quantity
                or ${usageBuckets.eventCount} is distinct from excluded.event_count
                or ${usageBuckets.maxReceivedAt} is distinct from excluded.max_received_at
              `,
              target: [
                usageBuckets.organizationId,
                usageBuckets.meterVersionId,
                usageBuckets.customerId,
                usageBuckets.bucketStart,
                usageBuckets.bucketSize,
                usageBuckets.dimensionsHash,
              ],
            });
          bucketCount++;
        }

        if (bucketCount > 0) {
          const previewSeriesById = new Map<string, { seriesId: string }>();
          for (const affectedEvent of affectedEvents) {
            const previewSeries = await transaction
              .selectDistinct({ seriesId: invoicePreviews.seriesId })
              .from(invoicePreviews)
              .where(
                and(
                  eq(invoicePreviews.organizationId, organizationId),
                  eq(invoicePreviews.customerId, affectedEvent.customerId),
                  lte(invoicePreviews.periodStart, affectedEvent.occurredAt),
                  gt(invoicePreviews.periodEnd, affectedEvent.occurredAt),
                ),
              );
            for (const series of previewSeries) {
              previewSeriesById.set(series.seriesId, series);
            }
          }

          for (const { seriesId } of previewSeriesById.values()) {
            await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${seriesId}))`);
            const [latest] = await transaction
              .select()
              .from(invoicePreviews)
              .where(
                and(
                  eq(invoicePreviews.organizationId, organizationId),
                  eq(invoicePreviews.seriesId, seriesId),
                ),
              )
              .orderBy(desc(invoicePreviews.revision))
              .for("update")
              .limit(1);
            if (!latest || latest.status === "pending") {
              continue;
            }
            const priorWatermark = latest.inputSnapshot.inputWatermark
              ? new Date(latest.inputSnapshot.inputWatermark)
              : latest.createdAt;
            if (priorWatermark >= event.receivedAt) {
              continue;
            }

            const revisionId = crypto.randomUUID();
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
            await transaction.insert(invoicePreviews).values({
              adjustmentOfPreviewId: completedExport ? latest.id : null,
              createdAt: processedAt,
              currency: latest.currency,
              customerId: latest.customerId,
              id: revisionId,
              organizationId,
              periodEnd: latest.periodEnd,
              periodStart: latest.periodStart,
              planVersionId: latest.planVersionId,
              requestedBy: latest.requestedBy,
              revision: latest.revision + 1,
              seriesId,
              subscriptionId: latest.subscriptionId,
            });
            await transaction.insert(jobs).values(
              invoicePreviewGenerationJob({
                createdAt: processedAt,
                organizationId,
                previewId: revisionId,
                requestId: `late-event:${eventId}`,
              }),
            );
            await transaction.insert(auditLog).values({
              action: "invoice_preview.revision_requested",
              actorType: "system",
              metadata: { eventId, revision: latest.revision + 1 },
              organizationId,
              requestId: `late-event:${eventId}`,
              resourceId: seriesId,
              resourceType: "invoice_preview",
            });
            previewRevisionCount++;
            if (completedExport) adjustmentPreviewRevisionCount++;
          }
        }

        return {
          adjustmentPreviewRevisionCount,
          bucketCount,
          occurredAt: event.occurredAt,
          previewRevisionCount,
          receivedAt: event.receivedAt,
          status: "processed",
        } as const;
      });
    },
  });
}
