import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { customers } from "./customers";
import type { jobs } from "./events";
import { planVersions } from "./catalog";
import { organizations } from "./tenancy";

const timestampColumn = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export type SimulationSummary = Readonly<{
  baselineTotalMinor?: string;
  candidateTotalMinor?: string;
  customerCount?: number;
  decreasedCount?: number;
  deltaMinor?: string;
  excludedCount?: number;
  increaseThresholdCount?: number;
  increasedCount?: number;
  medianDeltaMinor?: string;
  p95DeltaMinor?: string;
  unchangedCount?: number;
}>;

export const simulationStatus = pgEnum("simulation_status", ["pending", "completed", "failed"]);
export const simulationResultStatus = pgEnum("simulation_result_status", ["included", "excluded"]);

export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    baselinePlanVersionId: uuid("baseline_plan_version_id").notNull(),
    candidatePlanVersionId: uuid("candidate_plan_version_id").notNull(),
    periodStart: timestampColumn("period_start").notNull(),
    periodEnd: timestampColumn("period_end").notNull(),
    status: simulationStatus("status").default("pending").notNull(),
    inputWatermark: timestampColumn("input_watermark").notNull(),
    customerIds: jsonb("customer_ids").$type<readonly string[]>().notNull(),
    increaseThresholdPercent: numeric("increase_threshold_percent").default("20").notNull(),
    summary: jsonb("summary").$type<SimulationSummary>().default({}).notNull(),
    calculationHash: varchar("calculation_hash", { length: 64 }),
    failureCode: varchar("failure_code", { length: 64 }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    unique("simulation_runs_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.baselinePlanVersionId],
      foreignColumns: [planVersions.organizationId, planVersions.id],
      name: "simulation_runs_organization_baseline_plan_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.candidatePlanVersionId],
      foreignColumns: [planVersions.organizationId, planVersions.id],
      name: "simulation_runs_organization_candidate_plan_version_fk",
    }).onDelete("restrict"),
    index("simulation_runs_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check("simulation_runs_period_check", sql`${table.periodEnd} > ${table.periodStart}`),
    check(
      "simulation_runs_customer_count_check",
      sql`jsonb_typeof(${table.customerIds}) = 'array'
        and jsonb_array_length(${table.customerIds}) between 1 and 500`,
    ),
    check("simulation_runs_increase_threshold_check", sql`${table.increaseThresholdPercent} >= 0`),
    check(
      "simulation_runs_result_shape_check",
      sql`(
        ${table.status} = 'pending' and ${table.calculationHash} is null and ${table.failureCode} is null and ${table.completedAt} is null
      ) or (
        ${table.status} = 'completed' and ${table.calculationHash} ~ '^[a-f0-9]{64}$' and ${table.failureCode} is null and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'failed' and ${table.calculationHash} is null and length(trim(${table.failureCode})) > 0 and ${table.completedAt} is not null
      )`,
    ),
  ],
);

export const simulationResults = pgTable(
  "simulation_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    simulationRunId: uuid("simulation_run_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    status: simulationResultStatus("status").default("included").notNull(),
    baselineAmountMinor: numeric("baseline_amount_minor", { scale: 0 }),
    candidateAmountMinor: numeric("candidate_amount_minor", { scale: 0 }),
    deltaMinor: numeric("delta_minor", { scale: 0 }),
    deltaPercent: numeric("delta_percent"),
    explanation: jsonb("explanation").$type<Record<string, unknown> | null>(),
    failureCode: varchar("failure_code", { length: 64 }),
    warningFlags: varchar("warning_flags", { length: 64 }).array().default([]).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("simulation_results_organization_run_customer_unique").on(
      table.organizationId,
      table.simulationRunId,
      table.customerId,
    ),
    foreignKey({
      columns: [table.organizationId, table.simulationRunId],
      foreignColumns: [simulationRuns.organizationId, simulationRuns.id],
      name: "simulation_results_organization_run_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.customerId],
      foreignColumns: [customers.organizationId, customers.id],
      name: "simulation_results_organization_customer_fk",
    }).onDelete("restrict"),
    index("simulation_results_delta_idx").on(
      table.organizationId,
      table.simulationRunId,
      table.deltaMinor,
    ),
    check(
      "simulation_results_shape_check",
      sql`(
        ${table.status} = 'included'
        and ${table.baselineAmountMinor} >= 0
        and ${table.candidateAmountMinor} >= 0
        and ${table.deltaMinor} = ${table.candidateAmountMinor} - ${table.baselineAmountMinor}
        and ${table.explanation} is not null
        and ${table.failureCode} is null
      ) or (
        ${table.status} = 'excluded'
        and ${table.baselineAmountMinor} is null
        and ${table.candidateAmountMinor} is null
        and ${table.deltaMinor} is null
        and ${table.deltaPercent} is null
        and ${table.explanation} is null
        and ${table.failureCode} = 'invalid_usage_value'
        and cardinality(${table.warningFlags}) = 0
      )`,
    ),
  ],
);

export const SIMULATION_RUN_JOB_TYPE = "simulation.run";

export function simulationRunJob(
  input: Readonly<{
    createdAt: Date;
    organizationId: string;
    requestId: string;
    simulationId: string;
  }>,
): typeof jobs.$inferInsert {
  return {
    createdAt: input.createdAt,
    nextAttemptAt: input.createdAt,
    organizationId: input.organizationId,
    payload: { requestId: input.requestId, simulationId: input.simulationId },
    resourceId: input.simulationId,
    resourceType: "simulation",
    type: SIMULATION_RUN_JOB_TYPE,
    updatedAt: input.createdAt,
  };
}
