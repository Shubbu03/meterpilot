import { createHash } from "node:crypto";

import { effectiveUsageEventPredicate, type Database } from "@meterpilot/db";
import {
  auditLog,
  features,
  invoicePreviewLines,
  invoicePreviews,
  meterVersions,
  planComponents,
  usageBuckets,
  usageEvents,
} from "@meterpilot/db/schema";
import {
  halfOpenInterval,
  instant,
  meterVersionId as domainMeterVersionId,
  planVersionId as domainPlanVersionId,
} from "@meterpilot/domain";
import { price, PRICING_ENGINE_VERSION } from "@meterpilot/pricing-engine";
import Decimal from "decimal.js";
import { and, asc, eq, gt, gte, isNotNull, isNull, lt, lte, max, or } from "drizzle-orm";

import { permanentJobError, retryableJobError } from "./errors";
import type { InvoicePreviewGenerator } from "./invoice-preview-generator";
import { matchesMeterFilters, meterFilterDefinitionSchema } from "./usage-event-aggregation";

function hourFloor(value: Date): Date {
  const result = new Date(value);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createDrizzleInvoicePreviewGenerator(
  database: Database["db"],
  now: () => Date = () => new Date(),
): InvoicePreviewGenerator {
  return Object.freeze({
    async fail(organizationId, previewId, failureCode, requestId) {
      const completedAt = now();
      await database.transaction(async (transaction) => {
        const [failed] = await transaction
          .update(invoicePreviews)
          .set({ completedAt, failureCode, status: "failed" })
          .where(
            and(
              eq(invoicePreviews.organizationId, organizationId),
              eq(invoicePreviews.id, previewId),
              eq(invoicePreviews.status, "pending"),
            ),
          )
          .returning({ seriesId: invoicePreviews.seriesId });
        if (failed) {
          await transaction.insert(auditLog).values({
            action: "invoice_preview.failed",
            actorType: "system",
            metadata: { failureCode },
            organizationId,
            requestId,
            resourceId: failed.seriesId,
            resourceType: "invoice_preview",
          });
        }
      });
    },
    async generate(organizationId, previewId, requestId, signal) {
      if (signal.aborted) {
        throw retryableJobError(
          "worker_shutdown",
          "Worker shutdown interrupted preview generation.",
        );
      }

      return database.transaction(async (transaction) => {
        const [preview] = await transaction
          .select()
          .from(invoicePreviews)
          .where(
            and(
              eq(invoicePreviews.organizationId, organizationId),
              eq(invoicePreviews.id, previewId),
            ),
          )
          .for("update")
          .limit(1);
        if (!preview) {
          return { status: "not_found" } as const;
        }
        if (preview.status !== "pending") {
          return { status: "terminal" } as const;
        }

        const components = await transaction
          .select({ featureMeterId: features.meterId, row: planComponents })
          .from(planComponents)
          .leftJoin(
            features,
            and(
              eq(features.organizationId, planComponents.organizationId),
              eq(features.id, planComponents.featureId),
            ),
          )
          .where(
            and(
              eq(planComponents.organizationId, organizationId),
              eq(planComponents.planVersionId, preview.planVersionId),
            ),
          )
          .orderBy(asc(planComponents.componentKey));
        if (components.length === 0) {
          throw permanentJobError(
            "invalid_plan_version",
            "The preview plan version has no price components.",
          );
        }
        const [watermarkRow] = await transaction
          .select({ value: max(usageEvents.receivedAt) })
          .from(usageEvents)
          .where(eq(usageEvents.organizationId, organizationId));
        const inputWatermark = watermarkRow?.value ?? preview.createdAt;
        const calculatedLines: Array<{
          amountMinor: string;
          calculationHash: string;
          componentId: string;
          componentKey: string;
          eventCount: number;
          meterVersionIds: string[];
          preRoundAmount: string;
          pricingTrace: Record<string, unknown>;
          quantity: string;
          roundedAmount: string;
          sourceBuckets: Array<Record<string, unknown>>;
        }> = [];

        for (const component of components) {
          if (signal.aborted) {
            throw retryableJobError(
              "worker_shutdown",
              "Worker shutdown interrupted preview generation.",
            );
          }
          let quantity = new Decimal(0);
          let eventCount = 0;
          const selectedMeterVersionIds: string[] = [];
          const sourceBuckets: Array<Record<string, unknown>> = [];

          if (component.featureMeterId) {
            const versions = await transaction
              .select()
              .from(meterVersions)
              .where(
                and(
                  eq(meterVersions.organizationId, organizationId),
                  eq(meterVersions.meterId, component.featureMeterId),
                  isNotNull(meterVersions.publishedAt),
                  lt(meterVersions.effectiveFrom, preview.periodEnd),
                  or(
                    isNull(meterVersions.effectiveTo),
                    gt(meterVersions.effectiveTo, preview.periodStart),
                  ),
                ),
              )
              .orderBy(asc(meterVersions.effectiveFrom));

            for (const version of versions) {
              const filters = meterFilterDefinitionSchema.safeParse(version.filterDefinition);
              if (!filters.success) {
                throw permanentJobError(
                  "invalid_meter_definition",
                  "A published meter definition is invalid.",
                );
              }
              const rangeStart =
                version.effectiveFrom > preview.periodStart
                  ? version.effectiveFrom
                  : preview.periodStart;
              const rangeEnd =
                version.effectiveTo && version.effectiveTo < preview.periodEnd
                  ? version.effectiveTo
                  : preview.periodEnd;
              const events = await transaction
                .select({
                  properties: usageEvents.properties,
                  propertiesRedactedAt: usageEvents.propertiesRedactedAt,
                })
                .from(usageEvents)
                .where(
                  and(
                    eq(usageEvents.organizationId, organizationId),
                    eq(usageEvents.customerId, preview.customerId),
                    eq(usageEvents.eventType, version.eventType),
                    gte(usageEvents.occurredAt, rangeStart),
                    lt(usageEvents.occurredAt, rangeEnd),
                    lte(usageEvents.receivedAt, inputWatermark),
                    effectiveUsageEventPredicate(inputWatermark),
                  ),
                );
              for (const event of events) {
                if (event.propertiesRedactedAt) {
                  throw permanentJobError(
                    "source_properties_redacted",
                    "Preview source properties were removed by retention policy.",
                  );
                }
                if (!matchesMeterFilters(event.properties, filters.data)) {
                  continue;
                }
                eventCount++;
                if (version.aggregation === "count") {
                  quantity = quantity.plus(1);
                } else {
                  const raw = version.valueProperty
                    ? event.properties[version.valueProperty]
                    : undefined;
                  let parsed: Decimal;
                  try {
                    parsed = typeof raw === "string" ? new Decimal(raw) : new Decimal(Number.NaN);
                  } catch {
                    parsed = new Decimal(Number.NaN);
                  }
                  if (!parsed.isFinite() || parsed.isNegative()) {
                    throw permanentJobError(
                      "invalid_usage_value",
                      "A usage value required by a published meter is invalid.",
                    );
                  }
                  quantity = quantity.plus(parsed);
                }
              }
              selectedMeterVersionIds.push(version.id);
              const buckets = await transaction
                .select({
                  bucketStart: usageBuckets.bucketStart,
                  dimensionsHash: usageBuckets.dimensionsHash,
                  meterVersionId: usageBuckets.meterVersionId,
                  revision: usageBuckets.revision,
                })
                .from(usageBuckets)
                .where(
                  and(
                    eq(usageBuckets.organizationId, organizationId),
                    eq(usageBuckets.customerId, preview.customerId),
                    eq(usageBuckets.meterVersionId, version.id),
                    gte(usageBuckets.bucketStart, hourFloor(rangeStart)),
                    lt(usageBuckets.bucketStart, rangeEnd),
                  ),
                )
                .orderBy(asc(usageBuckets.bucketStart), asc(usageBuckets.dimensionsHash));
              sourceBuckets.push(
                ...buckets.map((bucket) => ({
                  ...bucket,
                  bucketStart: bucket.bucketStart.toISOString(),
                })),
              );
            }
          }

          const singleMeterVersionId =
            selectedMeterVersionIds.length === 1 ? selectedMeterVersionIds[0] : undefined;
          const priced = price({
            components: [
              {
                componentKey: component.row.componentKey,
                ...(singleMeterVersionId
                  ? { meterVersionId: domainMeterVersionId(singleMeterVersionId) }
                  : {}),
                price: component.row.pricingDefinition,
                quantity: quantity.toString(),
              },
            ],
            currency: preview.currency,
            period: halfOpenInterval(
              instant(preview.periodStart.toISOString()),
              instant(preview.periodEnd.toISOString()),
            ),
            planVersionId: domainPlanVersionId(preview.planVersionId),
            rounding: component.row.roundingDefinition,
          });
          const line = priced.lines[0];
          if (!line) {
            throw new Error("Pricing returned no invoice preview line.");
          }
          calculatedLines.push({
            amountMinor: line.amountMinor,
            calculationHash: line.calculationHash,
            componentId: component.row.id,
            componentKey: component.row.componentKey,
            eventCount,
            meterVersionIds: selectedMeterVersionIds,
            preRoundAmount: line.preRoundAmount,
            pricingTrace: line.trace as unknown as Record<string, unknown>,
            quantity: line.quantity,
            roundedAmount: line.roundedAmount,
            sourceBuckets,
          });
        }

        const subtotalMinor = calculatedLines
          .reduce((total, line) => total.plus(line.amountMinor), new Decimal(0))
          .toFixed(0);
        const inputSnapshot = {
          engineVersion: PRICING_ENGINE_VERSION,
          inputWatermark: inputWatermark.toISOString(),
          lines: calculatedLines.map((line) => ({
            componentId: line.componentId,
            eventCount: line.eventCount,
            meterVersionIds: line.meterVersionIds,
            quantity: line.quantity,
            sourceBuckets: line.sourceBuckets as Array<{
              bucketStart: string;
              dimensionsHash: string;
              meterVersionId: string;
              revision: number;
            }>,
          })),
        };
        const calculationHash = hash({
          currency: preview.currency,
          engineVersion: PRICING_ENGINE_VERSION,
          lines: calculatedLines.map(
            ({ eventCount: _eventCount, sourceBuckets: _buckets, ...line }) => line,
          ),
          periodEnd: preview.periodEnd.toISOString(),
          periodStart: preview.periodStart.toISOString(),
          planVersionId: preview.planVersionId,
          subtotalMinor,
        });
        await transaction.insert(invoicePreviewLines).values(
          calculatedLines.map((line) => ({
            amountMinor: line.amountMinor,
            calculationHash: line.calculationHash,
            componentKey: line.componentKey,
            meterVersionIds: line.meterVersionIds,
            organizationId,
            planComponentId: line.componentId,
            preRoundAmount: line.preRoundAmount,
            previewId,
            pricingTrace: line.pricingTrace,
            quantity: line.quantity,
            roundedAmount: line.roundedAmount,
            sourceBuckets: line.sourceBuckets,
          })),
        );
        const completedAt = now();
        await transaction
          .update(invoicePreviews)
          .set({ calculationHash, completedAt, inputSnapshot, status: "completed", subtotalMinor })
          .where(
            and(
              eq(invoicePreviews.organizationId, organizationId),
              eq(invoicePreviews.id, previewId),
              eq(invoicePreviews.status, "pending"),
            ),
          );
        await transaction.insert(auditLog).values({
          action: "invoice_preview.completed",
          actorType: "system",
          metadata: { calculationHash, revision: preview.revision, subtotalMinor },
          organizationId,
          requestId,
          resourceId: preview.seriesId,
          resourceType: "invoice_preview",
        });
        return { status: "completed" } as const;
      });
    },
  });
}
