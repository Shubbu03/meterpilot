import {
  simulationResultSchema,
  simulationSchema,
  type Simulation,
  type SimulationListQuery,
  type SimulationResult,
} from "@meterpilot/contracts/simulations";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  customers,
  jobs,
  planVersions,
  simulationResults,
  simulationRunJob,
  simulationRuns,
} from "@meterpilot/db/schema";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { canManageCatalog } from "../organizations/authorization";
import {
  InvalidSimulationCursorError,
  SimulationNotReadyError,
  type SimulationRepository,
} from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeCursor(id: string): string {
  return Buffer.from(id).toString("base64url");
}

function encodeRunCursor(row: Readonly<{ createdAt: Date; id: string }>): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeRunCursor(cursor?: string): Readonly<{ createdAt: Date; id: string }> | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== cursor) {
      throw new InvalidSimulationCursorError();
    }
    const value = JSON.parse(decoded) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("createdAt" in value) ||
      !("id" in value) ||
      typeof value.createdAt !== "string" ||
      typeof value.id !== "string" ||
      !UUID_PATTERN.test(value.id)
    ) {
      throw new InvalidSimulationCursorError();
    }
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) {
      throw new InvalidSimulationCursorError();
    }
    return { createdAt, id: value.id };
  } catch (error) {
    if (error instanceof InvalidSimulationCursorError) throw error;
    throw new InvalidSimulationCursorError();
  }
}

function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_PATTERN.test(id)) throw new InvalidSimulationCursorError();
  return id;
}

function toSimulation(row: typeof simulationRuns.$inferSelect): Simulation {
  return simulationSchema.parse({
    baselinePlanVersionId: row.baselinePlanVersionId,
    calculationHash: row.calculationHash,
    candidatePlanVersionId: row.candidatePlanVersionId,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    customerCount: row.customerIds.length,
    failureCode: row.failureCode,
    id: row.id,
    increaseThresholdPercent: row.increaseThresholdPercent,
    inputWatermark: row.inputWatermark.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    periodStart: row.periodStart.toISOString(),
    status: row.status,
    summary: row.summary,
  });
}

function toResult(
  row: typeof simulationResults.$inferSelect,
  customerKey: string,
): SimulationResult {
  return simulationResultSchema.parse({
    baselineAmountMinor: row.baselineAmountMinor,
    candidateAmountMinor: row.candidateAmountMinor,
    customerKey,
    deltaMinor: row.deltaMinor,
    deltaPercent: row.deltaPercent,
    explanation: row.explanation,
    failureCode: row.failureCode,
    id: row.id,
    status: row.status,
    warningFlags: row.warningFlags,
  });
}

export function createDrizzleSimulationRepository(
  database: Database["db"],
  now: () => Date = () => new Date(),
): SimulationRepository {
  async function findSimulation(organizationId: string, simulationId: string) {
    const [row] = await database
      .select()
      .from(simulationRuns)
      .where(
        and(eq(simulationRuns.organizationId, organizationId), eq(simulationRuns.id, simulationId)),
      )
      .limit(1);
    return row ? toSimulation(row) : null;
  }

  return Object.freeze({
    async create(tenant, input, requestId) {
      if (!canManageCatalog(tenant.membership.role)) return { status: "forbidden" };
      return database.transaction(async (transaction) => {
        const versions = await transaction
          .select({
            currency: planVersions.currency,
            id: planVersions.id,
            status: planVersions.status,
          })
          .from(planVersions)
          .where(
            and(
              eq(planVersions.organizationId, tenant.organization.id),
              inArray(planVersions.id, [input.baselinePlanVersionId, input.candidatePlanVersionId]),
            ),
          );
        const baseline = versions.find((version) => version.id === input.baselinePlanVersionId);
        const candidate = versions.find((version) => version.id === input.candidatePlanVersionId);
        if (!baseline || !candidate) return { status: "not_found" } as const;
        if (
          baseline.status !== "published" ||
          candidate.status === "archived" ||
          baseline.currency !== candidate.currency
        ) {
          return { status: "conflict" } as const;
        }

        const customerRows = await transaction
          .select({ externalKey: customers.externalKey, id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.organizationId, tenant.organization.id),
              isNull(customers.archivedAt),
              input.customerKeys ? inArray(customers.externalKey, input.customerKeys) : undefined,
            ),
          )
          .orderBy(asc(customers.id))
          .limit(501);
        if (
          customerRows.length === 0 ||
          customerRows.length > 500 ||
          (input.customerKeys && customerRows.length !== input.customerKeys.length)
        ) {
          return { status: input.customerKeys ? "not_found" : "conflict" } as const;
        }

        const createdAt = now();
        const [created] = await transaction
          .insert(simulationRuns)
          .values({
            baselinePlanVersionId: baseline.id,
            candidatePlanVersionId: candidate.id,
            createdAt,
            customerIds: customerRows.map((customer) => customer.id),
            increaseThresholdPercent: input.increaseThresholdPercent,
            inputWatermark: createdAt,
            organizationId: tenant.organization.id,
            periodEnd: new Date(input.periodEnd),
            periodStart: new Date(input.periodStart),
            requestedBy: tenant.actorUserId,
          })
          .returning();
        if (!created) throw new Error("Simulation insertion returned no row.");
        const [job] = await transaction
          .insert(jobs)
          .values(
            simulationRunJob({
              createdAt,
              organizationId: tenant.organization.id,
              requestId,
              simulationId: created.id,
            }),
          )
          .returning({ id: jobs.id });
        if (!job) throw new Error("Simulation job insertion returned no row.");
        await transaction.insert(auditLog).values({
          action: "simulation.requested",
          actorType: "user",
          actorUserId: tenant.actorUserId,
          metadata: { customerCount: customerRows.length },
          organizationId: tenant.organization.id,
          requestId,
          resourceId: created.id,
          resourceType: "simulation",
        });
        return { jobId: job.id, simulation: toSimulation(created), status: "ok" } as const;
      });
    },

    async find(tenant, simulationId) {
      return findSimulation(tenant.organization.id, simulationId);
    },

    async list(tenant, query: SimulationListQuery) {
      const cursor = decodeRunCursor(query.cursor);
      const rows = await database
        .select()
        .from(simulationRuns)
        .where(
          and(
            eq(simulationRuns.organizationId, tenant.organization.id),
            query.baselinePlanVersionId
              ? eq(simulationRuns.baselinePlanVersionId, query.baselinePlanVersionId)
              : undefined,
            query.candidatePlanVersionId
              ? eq(simulationRuns.candidatePlanVersionId, query.candidatePlanVersionId)
              : undefined,
            query.status ? eq(simulationRuns.status, query.status) : undefined,
            cursor
              ? or(
                  lt(simulationRuns.createdAt, cursor.createdAt),
                  and(
                    eq(simulationRuns.createdAt, cursor.createdAt),
                    lt(simulationRuns.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(simulationRuns.createdAt), desc(simulationRuns.id))
        .limit(query.limit + 1);
      const hasNext = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(toSimulation),
        nextCursor: hasNext && last ? encodeRunCursor(last) : null,
      };
    },

    async listResults(tenant, simulationId, page) {
      const simulation = await findSimulation(tenant.organization.id, simulationId);
      if (!simulation) return null;
      if (simulation.status !== "completed") throw new SimulationNotReadyError();
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select({ customerKey: customers.externalKey, row: simulationResults })
        .from(simulationResults)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, simulationResults.organizationId),
            eq(customers.id, simulationResults.customerId),
          ),
        )
        .where(
          and(
            eq(simulationResults.organizationId, tenant.organization.id),
            eq(simulationResults.simulationRunId, simulationId),
            page.outcome === "increased" ? gt(simulationResults.deltaMinor, "0") : undefined,
            page.outcome === "decreased" ? lt(simulationResults.deltaMinor, "0") : undefined,
            page.outcome === "unchanged" ? eq(simulationResults.deltaMinor, "0") : undefined,
            page.warningFlag
              ? sql`${page.warningFlag} = any(${simulationResults.warningFlags})`
              : undefined,
            cursor ? gt(simulationResults.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(simulationResults.id))
        .limit(page.limit + 1);
      const visible = rows.slice(0, page.limit);
      const last = visible.at(-1);
      return {
        items: visible.map((item) => toResult(item.row, item.customerKey)),
        nextCursor: rows.length > page.limit && last ? encodeCursor(last.row.id) : null,
      };
    },

    async report(tenant, simulationId) {
      const simulation = await findSimulation(tenant.organization.id, simulationId);
      if (!simulation) return null;
      if (simulation.status !== "completed") throw new SimulationNotReadyError();
      const rows = await database
        .select({ customerKey: customers.externalKey, row: simulationResults })
        .from(simulationResults)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, simulationResults.organizationId),
            eq(customers.id, simulationResults.customerId),
          ),
        )
        .where(
          and(
            eq(simulationResults.organizationId, tenant.organization.id),
            eq(simulationResults.simulationRunId, simulationId),
          ),
        )
        .orderBy(asc(customers.externalKey));
      return { results: rows.map((item) => toResult(item.row, item.customerKey)), simulation };
    },
  });
}
