import { createHash } from "node:crypto";

import { effectiveUsageEventPredicate, type Database } from "@meterpilot/db";
import {
  auditLog,
  features,
  meterVersions,
  planComponents,
  planVersions,
  simulationResults,
  simulationRuns,
  usageEvents,
} from "@meterpilot/db/schema";
import { halfOpenInterval, instant, planVersionId } from "@meterpilot/domain";
import { price } from "@meterpilot/pricing-engine";
import Decimal from "decimal.js";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";

import { JobHandlerError, permanentJobError, retryableJobError } from "./errors";
import type { SimulationRunner } from "./simulation-runner";
import { matchesMeterFilters, meterFilterDefinitionSchema } from "./usage-event-aggregation";

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
type PlanComponentRow = Readonly<{
  meterId: string | null;
  row: typeof planComponents.$inferSelect;
}>;
type SimulationEvent = Readonly<{
  customerId: string;
  eventType: string;
  occurredAt: Date;
  properties: Record<string, unknown>;
  propertiesRedactedAt: Date | null;
}>;
type SimulationMeterVersion = Readonly<{
  filters: ReturnType<typeof meterFilterDefinitionSchema.parse>;
  row: typeof meterVersions.$inferSelect;
}>;

const CUSTOMER_QUERY_BATCH_SIZE = 25;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function loadPricingDefinitions(
  transaction: Transaction,
  input: Readonly<{
    organizationId: string;
    periodEnd: Date;
    periodStart: Date;
    planVersionIds: readonly string[];
  }>,
) {
  const components = await transaction
    .select({ meterId: features.meterId, row: planComponents })
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
        eq(planComponents.organizationId, input.organizationId),
        inArray(planComponents.planVersionId, [...new Set(input.planVersionIds)]),
      ),
    )
    .orderBy(asc(planComponents.planVersionId), asc(planComponents.componentKey));
  const componentsByPlan = new Map<string, PlanComponentRow[]>();
  for (const component of components) {
    const current = componentsByPlan.get(component.row.planVersionId) ?? [];
    current.push(component);
    componentsByPlan.set(component.row.planVersionId, current);
  }
  for (const planVersion of input.planVersionIds) {
    if (!componentsByPlan.has(planVersion)) {
      throw permanentJobError("invalid_plan_version", "A simulation plan has no components.");
    }
  }

  const meterIds = [...new Set(components.flatMap((component) => component.meterId ?? []))];
  const versions =
    meterIds.length === 0
      ? []
      : await transaction
          .select()
          .from(meterVersions)
          .where(
            and(
              eq(meterVersions.organizationId, input.organizationId),
              inArray(meterVersions.meterId, meterIds),
              isNotNull(meterVersions.publishedAt),
              lt(meterVersions.effectiveFrom, input.periodEnd),
              or(
                isNull(meterVersions.effectiveTo),
                gt(meterVersions.effectiveTo, input.periodStart),
              ),
            ),
          )
          .orderBy(asc(meterVersions.meterId), asc(meterVersions.effectiveFrom));
  const versionsByMeter = new Map<string, SimulationMeterVersion[]>();
  for (const version of versions) {
    const parsed = meterFilterDefinitionSchema.safeParse(version.filterDefinition);
    if (!parsed.success) {
      throw permanentJobError("invalid_meter_definition", "A meter definition is invalid.");
    }
    const current = versionsByMeter.get(version.meterId) ?? [];
    current.push({ filters: parsed.data, row: version });
    versionsByMeter.set(version.meterId, current);
  }

  return {
    componentsByPlan,
    eventTypes: [...new Set(versions.map((version) => version.eventType))],
    versionsByMeter,
  };
}

function pricePlan(
  input: Readonly<{
    components: readonly PlanComponentRow[];
    currency: string;
    events: readonly SimulationEvent[];
    periodEnd: Date;
    periodStart: Date;
    planVersion: string;
    signal: AbortSignal;
    versionsByMeter: ReadonlyMap<string, readonly SimulationMeterVersion[]>;
  }>,
) {
  const lines: Record<string, unknown>[] = [];
  let total = new Decimal(0);
  for (const component of input.components) {
    if (input.signal.aborted) {
      throw retryableJobError("worker_shutdown", "Worker shutdown interrupted simulation.");
    }
    let quantity = new Decimal(0);
    const versionIds: string[] = [];
    if (component.meterId) {
      for (const definition of input.versionsByMeter.get(component.meterId) ?? []) {
        const version = definition.row;
        const start =
          version.effectiveFrom > input.periodStart ? version.effectiveFrom : input.periodStart;
        const end =
          version.effectiveTo && version.effectiveTo < input.periodEnd
            ? version.effectiveTo
            : input.periodEnd;
        for (const event of input.events) {
          if (
            event.eventType !== version.eventType ||
            event.occurredAt < start ||
            event.occurredAt >= end ||
            !matchesMeterFilters(event.properties, definition.filters)
          ) {
            continue;
          }
          if (version.aggregation === "count") {
            quantity = quantity.plus(1);
            continue;
          }
          const raw = version.valueProperty ? event.properties[version.valueProperty] : undefined;
          let parsed: Decimal;
          try {
            parsed = typeof raw === "string" ? new Decimal(raw) : new Decimal(Number.NaN);
          } catch {
            parsed = new Decimal(Number.NaN);
          }
          if (!parsed.isFinite() || parsed.isNegative()) {
            throw permanentJobError("invalid_usage_value", "A required usage value is invalid.");
          }
          quantity = quantity.plus(parsed);
        }
        versionIds.push(version.id);
      }
    }
    const result = price({
      components: [
        {
          componentKey: component.row.componentKey,
          price: component.row.pricingDefinition,
          quantity: quantity.toString(),
        },
      ],
      currency: input.currency,
      period: halfOpenInterval(
        instant(input.periodStart.toISOString()),
        instant(input.periodEnd.toISOString()),
      ),
      planVersionId: planVersionId(input.planVersion),
      rounding: component.row.roundingDefinition,
    });
    const line = result.lines[0];
    if (!line) throw new Error("Simulation pricing returned no line.");
    total = total.plus(line.amountMinor);
    lines.push({ ...line, meterVersionIds: versionIds });
  }
  return { lines, totalMinor: total.toFixed(0) };
}

export function compareSimulationAmounts(
  baseline: Readonly<{ totalMinor: string }>,
  candidate: Readonly<{ totalMinor: string }>,
  increaseThresholdPercent: string,
) {
  const delta = new Decimal(candidate.totalMinor).minus(baseline.totalMinor);
  const deltaPercent = new Decimal(baseline.totalMinor).isZero()
    ? null
    : delta.div(baseline.totalMinor).times(100).toDecimalPlaces(6).toString();
  const warnings: string[] = [];
  if (deltaPercent && new Decimal(deltaPercent).gte(increaseThresholdPercent)) {
    warnings.push("increase_threshold");
  }
  if (candidate.totalMinor === "0" && baseline.totalMinor !== "0") {
    warnings.push("candidate_zero");
  }
  if (baseline.totalMinor === "0" && candidate.totalMinor !== "0") {
    warnings.push("baseline_zero_candidate_positive");
  }
  return { delta, deltaPercent, warnings };
}

type PricedPlan = ReturnType<typeof pricePlan>;
type IncludedSimulationResult = Readonly<{
  baseline: PricedPlan;
  candidate: PricedPlan;
  customerId: string;
  delta: Decimal;
  deltaPercent: string | null;
  status: "included";
  warnings: string[];
}>;
type ExcludedSimulationResult = Readonly<{
  customerId: string;
  failureCode: "invalid_usage_value";
  status: "excluded";
}>;
type CalculatedSimulationResult = IncludedSimulationResult | ExcludedSimulationResult;

function includedResult(result: CalculatedSimulationResult): result is IncludedSimulationResult {
  return result.status === "included";
}

export function createDrizzleSimulationRunner(
  database: Database["db"],
  now: () => Date = () => new Date(),
): SimulationRunner {
  return Object.freeze({
    async fail(organizationId, simulationId, failureCode, requestId) {
      const [failed] = await database
        .update(simulationRuns)
        .set({ completedAt: now(), failureCode, status: "failed" })
        .where(
          and(
            eq(simulationRuns.organizationId, organizationId),
            eq(simulationRuns.id, simulationId),
            eq(simulationRuns.status, "pending"),
          ),
        )
        .returning({ id: simulationRuns.id });
      if (failed) {
        await database.insert(auditLog).values({
          action: "simulation.failed",
          actorType: "system",
          metadata: { failureCode },
          organizationId,
          requestId,
          resourceId: simulationId,
          resourceType: "simulation",
        });
      }
    },

    async run(organizationId, simulationId, requestId, signal) {
      return database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(simulationRuns)
          .where(
            and(
              eq(simulationRuns.organizationId, organizationId),
              eq(simulationRuns.id, simulationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!run) return { status: "not_found" } as const;
        if (run.status !== "pending") return { status: "terminal" } as const;

        const versions = await transaction
          .select({ currency: planVersions.currency, id: planVersions.id })
          .from(planVersions)
          .where(
            and(
              eq(planVersions.organizationId, organizationId),
              inArray(planVersions.id, [run.baselinePlanVersionId, run.candidatePlanVersionId]),
            ),
          );
        const versionsById = new Map(versions.map((version) => [version.id, version]));
        const baselineVersion = versionsById.get(run.baselinePlanVersionId);
        const candidateVersion = versionsById.get(run.candidatePlanVersionId);
        if (
          !baselineVersion ||
          !candidateVersion ||
          baselineVersion.currency !== candidateVersion.currency
        ) {
          throw permanentJobError(
            "invalid_plan_version",
            "Simulation plan components are missing.",
          );
        }
        const currency = baselineVersion.currency;
        const definitions = await loadPricingDefinitions(transaction, {
          organizationId,
          periodEnd: run.periodEnd,
          periodStart: run.periodStart,
          planVersionIds: [run.baselinePlanVersionId, run.candidatePlanVersionId],
        });
        const baselineComponents = definitions.componentsByPlan.get(run.baselinePlanVersionId);
        const candidateComponents = definitions.componentsByPlan.get(run.candidatePlanVersionId);
        if (!baselineComponents || !candidateComponents) {
          throw permanentJobError(
            "invalid_plan_version",
            "Simulation plan components are missing.",
          );
        }

        const results: CalculatedSimulationResult[] = [];
        for (const customerIds of chunk(run.customerIds, CUSTOMER_QUERY_BATCH_SIZE)) {
          if (signal.aborted) {
            throw retryableJobError("worker_shutdown", "Worker shutdown interrupted simulation.");
          }
          const eventRows: SimulationEvent[] =
            definitions.eventTypes.length === 0
              ? []
              : await transaction
                  .select({
                    customerId: usageEvents.customerId,
                    eventType: usageEvents.eventType,
                    occurredAt: usageEvents.occurredAt,
                    properties: usageEvents.properties,
                    propertiesRedactedAt: usageEvents.propertiesRedactedAt,
                  })
                  .from(usageEvents)
                  .where(
                    and(
                      eq(usageEvents.organizationId, organizationId),
                      inArray(usageEvents.customerId, [...customerIds]),
                      inArray(usageEvents.eventType, definitions.eventTypes),
                      gte(usageEvents.occurredAt, run.periodStart),
                      lt(usageEvents.occurredAt, run.periodEnd),
                      lte(usageEvents.receivedAt, run.inputWatermark),
                      effectiveUsageEventPredicate(run.inputWatermark),
                    ),
                  )
                  .orderBy(
                    asc(usageEvents.customerId),
                    asc(usageEvents.occurredAt),
                    asc(usageEvents.id),
                  );
          if (eventRows.some((event) => event.propertiesRedactedAt !== null)) {
            throw permanentJobError(
              "source_properties_redacted",
              "Simulation source properties were removed by retention policy.",
            );
          }
          const eventsByCustomer = new Map<string, SimulationEvent[]>();
          for (const event of eventRows) {
            const current = eventsByCustomer.get(event.customerId) ?? [];
            current.push(event);
            eventsByCustomer.set(event.customerId, current);
          }

          for (const customerId of customerIds) {
            const common = {
              currency,
              events: eventsByCustomer.get(customerId) ?? [],
              periodEnd: run.periodEnd,
              periodStart: run.periodStart,
              signal,
              versionsByMeter: definitions.versionsByMeter,
            };
            let baseline: PricedPlan;
            let candidate: PricedPlan;
            try {
              baseline = pricePlan({
                ...common,
                components: baselineComponents,
                planVersion: run.baselinePlanVersionId,
              });
              candidate =
                run.baselinePlanVersionId === run.candidatePlanVersionId
                  ? baseline
                  : pricePlan({
                      ...common,
                      components: candidateComponents,
                      planVersion: run.candidatePlanVersionId,
                    });
            } catch (error) {
              if (
                error instanceof JobHandlerError &&
                !error.retryable &&
                error.code === "invalid_usage_value"
              ) {
                results.push({
                  customerId,
                  failureCode: "invalid_usage_value",
                  status: "excluded",
                });
                continue;
              }
              throw error;
            }
            const comparison = compareSimulationAmounts(
              baseline,
              candidate,
              run.increaseThresholdPercent,
            );
            results.push({ baseline, candidate, customerId, status: "included", ...comparison });
          }
        }

        await transaction.insert(simulationResults).values(
          results.map((result) =>
            result.status === "included"
              ? {
                  baselineAmountMinor: result.baseline.totalMinor,
                  candidateAmountMinor: result.candidate.totalMinor,
                  customerId: result.customerId,
                  deltaMinor: result.delta.toFixed(0),
                  deltaPercent: result.deltaPercent,
                  explanation: {
                    baseline: result.baseline.lines,
                    candidate: result.candidate.lines,
                  },
                  failureCode: null,
                  organizationId,
                  simulationRunId: simulationId,
                  status: "included" as const,
                  warningFlags: result.warnings,
                }
              : {
                  baselineAmountMinor: null,
                  candidateAmountMinor: null,
                  customerId: result.customerId,
                  deltaMinor: null,
                  deltaPercent: null,
                  explanation: null,
                  failureCode: result.failureCode,
                  organizationId,
                  simulationRunId: simulationId,
                  status: "excluded" as const,
                  warningFlags: [],
                },
          ),
        );
        const included = results.filter(includedResult);
        const deltas = included.map((result) => result.delta).sort((a, b) => a.comparedTo(b));
        const percentile = (ratio: number) =>
          deltas[Math.min(deltas.length - 1, Math.floor((deltas.length - 1) * ratio))]?.toFixed(
            0,
          ) ?? "0";
        const baselineTotal = included.reduce(
          (sum, item) => sum.plus(item.baseline.totalMinor),
          new Decimal(0),
        );
        const candidateTotal = included.reduce(
          (sum, item) => sum.plus(item.candidate.totalMinor),
          new Decimal(0),
        );
        const summary = {
          baselineTotalMinor: baselineTotal.toFixed(0),
          candidateTotalMinor: candidateTotal.toFixed(0),
          customerCount: results.length,
          decreasedCount: included.filter((item) => item.delta.isNegative()).length,
          deltaMinor: candidateTotal.minus(baselineTotal).toFixed(0),
          excludedCount: results.length - included.length,
          increaseThresholdCount: included.filter((item) =>
            item.warnings.includes("increase_threshold"),
          ).length,
          increasedCount: included.filter((item) => item.delta.isPositive()).length,
          medianDeltaMinor: percentile(0.5),
          p95DeltaMinor: percentile(0.95),
          unchangedCount: included.filter((item) => item.delta.isZero()).length,
        };
        const calculationHash = hash({
          results: results.map((item) =>
            item.status === "included"
              ? {
                  baseline: item.baseline,
                  candidate: item.candidate,
                  customerId: item.customerId,
                  status: item.status,
                }
              : item,
          ),
          run: {
            baseline: run.baselinePlanVersionId,
            candidate: run.candidatePlanVersionId,
            periodEnd: run.periodEnd.toISOString(),
            periodStart: run.periodStart.toISOString(),
            watermark: run.inputWatermark.toISOString(),
          },
          summary,
        });
        await transaction
          .update(simulationRuns)
          .set({ calculationHash, completedAt: now(), status: "completed", summary })
          .where(eq(simulationRuns.id, simulationId));
        await transaction.insert(auditLog).values({
          action: "simulation.completed",
          actorType: "system",
          metadata: { calculationHash, customerCount: results.length },
          organizationId,
          requestId,
          resourceId: simulationId,
          resourceType: "simulation",
        });
        return { status: "completed" } as const;
      });
    },
  });
}
