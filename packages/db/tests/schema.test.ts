import { describe, expect, test } from "bun:test";
import { API_KEY_SCOPES } from "@meterpilot/domain/identity";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import {
  accounts,
  apiKeys,
  auditActorType,
  auditLog,
  billingExports,
  billingInterval,
  customers,
  dataRetentionPolicies,
  entitlements,
  entitlementMode,
  features,
  jobStatus,
  jobs,
  invoicePreviewLines,
  invoicePreviews,
  invoicePreviewStatus,
  membershipRole,
  memberships,
  meterAggregation,
  meterStatus,
  meters,
  meterVersions,
  operationRunStatus,
  organizations,
  planComponents,
  planComponentType,
  plans,
  planVersions,
  planVersionStatus,
  quotaGrants,
  quotaReservations,
  quotaReservationStatus,
  rateLimitWindows,
  reconciliationFindingKind,
  reconciliationFindings,
  reconciliationRunKind,
  reconciliationRuns,
  sessions,
  simulationResults,
  simulationResultStatus,
  simulationRuns,
  simulationStatus,
  subjects,
  subscriptions,
  subscriptionStatus,
  usageBuckets,
  usageEventCorrectionKind,
  usageEvents,
  users,
  verifications,
} from "../src/schema";

function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("database schema", () => {
  test("defines the Better Auth core schema with UUID identifiers", () => {
    expect(columnNames(users)).toEqual([
      "id",
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
    ]);
    expect(columnNames(sessions)).toEqual([
      "id",
      "user_id",
      "token",
      "expires_at",
      "ip_address",
      "user_agent",
      "created_at",
      "updated_at",
    ]);
    const accountColumns = columnNames(accounts);
    for (const column of ["account_id", "provider_id", "password", "user_id"]) {
      expect(accountColumns).toContain(column);
    }
    expect(columnNames(verifications)).toEqual([
      "id",
      "identifier",
      "value",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
    expect(users.id.getSQLType()).toBe("uuid");
    expect(sessions.id.getSQLType()).toBe("uuid");
    expect(accounts.id.getSQLType()).toBe("uuid");
    expect(verifications.id.getSQLType()).toBe("uuid");
  });

  test("enforces organization membership roles and tenant membership identity", () => {
    const membershipConfig = getTableConfig(memberships);

    expect(membershipRole.enumValues).toEqual([
      "owner",
      "admin",
      "developer",
      "analyst",
      "support",
    ]);
    expect(membershipConfig.primaryKeys.map((key) => key.getName())).toEqual([
      "memberships_organization_id_user_id_pk",
    ]);
    expect(membershipConfig.foreignKeys.map((key) => key.getName())).toContainAllValues([
      "memberships_organization_id_organizations_id_fk",
      "memberships_user_id_users_id_fk",
    ]);
    expect(organizations.slug.isUnique).toBe(true);
  });

  test("stores API key hashes instead of plaintext secrets", () => {
    const apiKeyConfig = getTableConfig(apiKeys);
    const names = columnNames(apiKeys);

    expect(names).toContain("secret_hash");
    expect(names).not.toContain("secret");
    expect(apiKeys.prefix.isUnique).toBe(true);
    expect(apiKeyConfig.checks.map((constraint) => constraint.name)).toContainAllValues([
      "api_keys_prefix_format_check",
      "api_keys_secret_hash_length_check",
      "api_keys_scopes_not_empty_check",
      "api_keys_scopes_allowed_check",
      "api_keys_last_used_at_check",
      "api_keys_expires_at_check",
      "api_keys_revoked_at_check",
    ]);
    expect(API_KEY_SCOPES).toEqual([
      "events:write",
      "events:read",
      "usage:read",
      "reservations:write",
    ]);
  });

  test("binds audit actors to the correct organization-owned credential", () => {
    const auditConfig = getTableConfig(auditLog);

    expect(auditActorType.enumValues).toEqual(["system", "user", "api_key"]);
    expect(auditConfig.checks.map((constraint) => constraint.name)).toContain(
      "audit_log_actor_shape_check",
    );
    expect(auditConfig.foreignKeys.map((key) => key.getName())).toContain(
      "audit_log_organization_actor_api_key_fk",
    );
  });

  test("defines an immutable tenant-owned usage ledger", () => {
    const eventConfig = getTableConfig(usageEvents);

    expect(columnNames(usageEvents)).toEqual([
      "id",
      "organization_id",
      "event_key",
      "payload_hash",
      "event_type",
      "subject_key",
      "customer_id",
      "occurred_at",
      "received_at",
      "properties",
      "properties_redacted_at",
      "source",
      "source_api_key_id",
      "correction_of_event_id",
      "correction_kind",
    ]);
    expect(usageEventCorrectionKind.enumValues).toEqual(["reverse", "replace"]);
    expect(eventConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "usage_events_organization_id_event_key_unique",
    );
    expect(eventConfig.indexes.map((index) => index.config.name)).toContain(
      "usage_events_direct_correction_unique",
    );
    const eventForeignKeys = eventConfig.foreignKeys.map((key) => key.getName());
    for (const foreignKey of [
      "usage_events_organization_customer_fk",
      "usage_events_organization_source_api_key_fk",
      "usage_events_organization_correction_event_fk",
    ]) {
      expect(eventForeignKeys).toContain(foreignKey);
    }
    const eventChecks = eventConfig.checks.map((constraint) => constraint.name);
    for (const constraint of [
      "usage_events_event_key_format_check",
      "usage_events_event_type_format_check",
      "usage_events_subject_key_format_check",
      "usage_events_payload_hash_format_check",
      "usage_events_source_check",
      "usage_events_correction_shape_check",
      "usage_events_properties_redaction_check",
    ]) {
      expect(eventChecks).toContain(constraint);
    }
  });

  test("maps tenant-owned subjects to explicit customers", () => {
    const customerConfig = getTableConfig(customers);
    const subjectConfig = getTableConfig(subjects);

    const customerColumns = columnNames(customers);
    for (const column of [
      "organization_id",
      "external_key",
      "billing_timezone",
      "metadata",
      "archived_at",
    ]) {
      expect(customerColumns).toContain(column);
    }
    expect(customerConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "customers_organization_external_key_unique",
    );
    const subjectColumns = columnNames(subjects);
    for (const column of ["organization_id", "external_key", "customer_id"]) {
      expect(subjectColumns).toContain(column);
    }
    expect(subjectConfig.foreignKeys.map((key) => key.getName())).toContain(
      "subjects_organization_customer_fk",
    );
  });

  test("defines durable lease-based event processing jobs", () => {
    const jobConfig = getTableConfig(jobs);

    expect(jobStatus.enumValues).toEqual(["pending", "processing", "completed", "failed"]);
    const jobColumns = columnNames(jobs);
    for (const column of [
      "event_id",
      "resource_type",
      "resource_id",
      "attempt_count",
      "manual_retry_count",
      "lease_owner",
      "lease_expires_at",
      "next_attempt_at",
      "last_error",
      "failure_retryable",
    ]) {
      expect(jobColumns).toContain(column);
    }
    expect(jobConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "jobs_organization_type_resource_unique",
    );
    expect(jobConfig.foreignKeys.map((key) => key.getName())).toContain(
      "jobs_organization_event_fk",
    );
    const jobChecks = jobConfig.checks.map((constraint) => constraint.name);
    for (const constraint of [
      "jobs_type_not_empty_check",
      "jobs_resource_not_empty_check",
      "jobs_event_reference_shape_check",
      "jobs_attempt_count_check",
      "jobs_manual_retry_count_check",
      "jobs_failure_shape_check",
      "jobs_lease_shape_check",
    ]) {
      expect(jobChecks).toContain(constraint);
    }
  });

  test("stores atomic expiring credential rate-limit windows", () => {
    const config = getTableConfig(rateLimitWindows);
    expect(config.primaryKeys.map((key) => key.getName())).toEqual([
      "rate_limit_windows_key_window_pk",
    ]);
    expect(config.checks.map((item) => item.name)).toContainAllValues([
      "rate_limit_windows_key_hash_check",
      "rate_limit_windows_request_count_check",
      "rate_limit_windows_expiry_check",
    ]);
    expect(config.indexes.map((item) => item.config.name)).toContain(
      "rate_limit_windows_expires_at_idx",
    );
  });

  test("stores versioned tenant retention policy and one-way redaction state", () => {
    const policyConfig = getTableConfig(dataRetentionPolicies);
    expect(columnNames(dataRetentionPolicies)).toEqual([
      "organization_id",
      "event_properties_retention_days",
      "version",
      "updated_by",
      "updated_at",
    ]);
    expect(policyConfig.primaryKeys.map((key) => key.getName())).toEqual([
      "data_retention_policies_pk",
    ]);
    expect(policyConfig.checks.map((item) => item.name)).toContainAllValues([
      "data_retention_policies_days_check",
      "data_retention_policies_version_check",
    ]);
    expect(getTableConfig(usageEvents).indexes.map((item) => item.config.name)).toContain(
      "usage_events_retention_eligible_idx",
    );
  });

  test("defines tenant-owned entitlement balances, grants, and reservations", () => {
    expect(entitlementMode.enumValues).toEqual(["boolean", "advisory", "hard"]);

    const featureConfig = getTableConfig(features);
    expect(featureConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "features_organization_key_unique",
    );
    expect(featureConfig.foreignKeys.map((key) => key.getName())).toContain(
      "features_organization_meter_fk",
    );

    const entitlementConfig = getTableConfig(entitlements);
    const entitlementColumns = columnNames(entitlements);
    for (const column of [
      "customer_id",
      "feature_id",
      "subscription_id",
      "granted_quantity",
      "committed_quantity",
      "reserved_quantity",
      "version",
    ]) {
      expect(entitlementColumns).toContain(column);
    }
    for (const constraint of [
      "entitlements_period_check",
      "entitlements_quantities_non_negative_check",
      "entitlements_boolean_shape_check",
      "entitlements_hard_limit_check",
      "entitlements_version_check",
    ]) {
      expect(entitlementConfig.checks.map((check) => check.name)).toContain(constraint);
    }
    for (const foreignKey of [
      "entitlements_organization_customer_fk",
      "entitlements_organization_feature_fk",
      "entitlements_organization_subscription_fk",
    ]) {
      expect(entitlementConfig.foreignKeys.map((key) => key.getName())).toContain(foreignKey);
    }

    const grantConfig = getTableConfig(quotaGrants);
    expect(grantConfig.foreignKeys.map((key) => key.getName())).toContain(
      "quota_grants_organization_entitlement_fk",
    );
    expect(grantConfig.checks.map((check) => check.name)).toContain(
      "quota_grants_quantity_positive_check",
    );

    expect(quotaReservationStatus.enumValues).toEqual([
      "pending",
      "committed",
      "released",
      "expired",
    ]);
    const reservationConfig = getTableConfig(quotaReservations);
    expect(reservationConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "quota_reservations_organization_entitlement_key_unique",
    );
    expect(reservationConfig.foreignKeys.map((key) => key.getName())).toContain(
      "quota_reservations_organization_entitlement_fk",
    );
    for (const constraint of [
      "quota_reservations_idempotency_key_format_check",
      "quota_reservations_quantity_check",
      "quota_reservations_expiry_check",
      "quota_reservations_state_check",
    ]) {
      expect(reservationConfig.checks.map((check) => check.name)).toContain(constraint);
    }
  });

  test("defines immutable versioned plans and explicit customer subscriptions", () => {
    expect(planVersionStatus.enumValues).toEqual(["draft", "published", "archived"]);
    expect(planComponentType.enumValues).toEqual([
      "flat",
      "per_unit",
      "included_overage",
      "graduated",
    ]);
    expect(billingInterval.enumValues).toEqual(["month"]);
    expect(subscriptionStatus.enumValues).toEqual(["active", "canceled"]);

    expect(getTableConfig(plans).uniqueConstraints.map((item) => item.getName())).toContain(
      "plans_organization_key_unique",
    );
    const versionConfig = getTableConfig(planVersions);
    expect(versionConfig.uniqueConstraints.map((item) => item.getName())).toContain(
      "plan_versions_organization_plan_version_unique",
    );
    expect(versionConfig.foreignKeys.map((item) => item.getName())).toContain(
      "plan_versions_organization_plan_fk",
    );

    const componentConfig = getTableConfig(planComponents);
    const componentForeignKeys = componentConfig.foreignKeys.map((item) => item.getName());
    for (const foreignKey of [
      "plan_components_organization_plan_version_fk",
      "plan_components_organization_feature_fk",
    ]) {
      expect(componentForeignKeys).toContain(foreignKey);
    }
    const componentChecks = componentConfig.checks.map((item) => item.name);
    for (const constraint of [
      "plan_components_pricing_model_check",
      "plan_components_feature_shape_check",
      "plan_components_entitlement_shape_check",
    ]) {
      expect(componentChecks).toContain(constraint);
    }

    const subscriptionConfig = getTableConfig(subscriptions);
    const subscriptionForeignKeys = subscriptionConfig.foreignKeys.map((item) => item.getName());
    for (const foreignKey of [
      "subscriptions_organization_customer_fk",
      "subscriptions_organization_plan_version_fk",
    ]) {
      expect(subscriptionForeignKeys).toContain(foreignKey);
    }
    const subscriptionChecks = subscriptionConfig.checks.map((item) => item.name);
    for (const constraint of [
      "subscriptions_period_check",
      "subscriptions_anchor_check",
      "subscriptions_status_check",
    ]) {
      expect(subscriptionChecks).toContain(constraint);
    }
  });

  test("stores immutable invoice preview revisions and calculation traces", () => {
    expect(invoicePreviewStatus.enumValues).toEqual(["pending", "completed", "failed"]);
    const previewConfig = getTableConfig(invoicePreviews);
    expect(previewConfig.uniqueConstraints.map((item) => item.getName())).toContain(
      "invoice_previews_organization_series_revision_unique",
    );
    for (const foreignKey of [
      "invoice_previews_organization_adjustment_preview_fk",
      "invoice_previews_organization_customer_fk",
      "invoice_previews_organization_subscription_fk",
      "invoice_previews_organization_plan_version_fk",
    ]) {
      expect(previewConfig.foreignKeys.map((item) => item.getName())).toContain(foreignKey);
    }
    expect(previewConfig.checks.map((item) => item.name)).toContain(
      "invoice_previews_result_shape_check",
    );

    const lineConfig = getTableConfig(invoicePreviewLines);
    expect(lineConfig.foreignKeys.map((item) => item.getName())).toContain(
      "invoice_preview_lines_organization_preview_fk",
    );
    const lineColumns = columnNames(invoicePreviewLines);
    for (const column of [
      "meter_version_ids",
      "pricing_trace",
      "source_buckets",
      "calculation_hash",
    ]) {
      expect(lineColumns).toContain(column);
    }
  });

  test("defines immutable reconciliation findings and revision-bound billing exports", () => {
    expect(operationRunStatus.enumValues).toEqual(["pending", "completed", "failed"]);
    expect(reconciliationRunKind.enumValues).toEqual(["reconciliation", "replay"]);
    expect(reconciliationFindingKind.enumValues).toEqual(["missing", "unexpected", "mismatch"]);

    const runConfig = getTableConfig(reconciliationRuns);
    expect(runConfig.checks.map((item) => item.name)).toContainAllValues([
      "reconciliation_runs_period_check",
      "reconciliation_runs_result_shape_check",
    ]);
    for (const foreignKey of [
      "reconciliation_runs_organization_customer_fk",
      "reconciliation_runs_organization_meter_fk",
    ]) {
      expect(runConfig.foreignKeys.map((item) => item.getName())).toContain(foreignKey);
    }

    const findingConfig = getTableConfig(reconciliationFindings);
    expect(findingConfig.checks.map((item) => item.name)).toContainAllValues([
      "reconciliation_findings_hash_check",
      "reconciliation_findings_shape_check",
    ]);
    for (const foreignKey of [
      "reconciliation_findings_organization_run_fk",
      "reconciliation_findings_organization_meter_version_fk",
    ]) {
      expect(findingConfig.foreignKeys.map((item) => item.getName())).toContain(foreignKey);
    }

    const exportConfig = getTableConfig(billingExports);
    for (const column of [
      "source_preview_id",
      "source_preview_revision_id",
      "source_preview_hash",
      "source_preview_revision",
      "payload",
      "content_hash",
    ]) {
      expect(columnNames(billingExports)).toContain(column);
    }
    expect(exportConfig.foreignKeys.map((item) => item.getName())).toContain(
      "billing_exports_organization_preview_revision_fk",
    );
    expect(exportConfig.checks.map((item) => item.name)).toContain(
      "billing_exports_result_shape_check",
    );
  });

  test("pins immutable simulation inputs and exact customer deltas", () => {
    expect(simulationStatus.enumValues).toEqual(["pending", "completed", "failed"]);
    expect(simulationResultStatus.enumValues).toEqual(["included", "excluded"]);
    const runConfig = getTableConfig(simulationRuns);
    for (const constraint of [
      "simulation_runs_period_check",
      "simulation_runs_customer_count_check",
      "simulation_runs_increase_threshold_check",
      "simulation_runs_result_shape_check",
    ]) {
      expect(runConfig.checks.map((item) => item.name)).toContain(constraint);
    }
    for (const foreignKey of [
      "simulation_runs_organization_baseline_plan_version_fk",
      "simulation_runs_organization_candidate_plan_version_fk",
    ]) {
      expect(runConfig.foreignKeys.map((item) => item.getName())).toContain(foreignKey);
    }

    const resultConfig = getTableConfig(simulationResults);
    expect(resultConfig.checks.map((item) => item.name)).toContain(
      "simulation_results_shape_check",
    );
    expect(resultConfig.uniqueConstraints.map((item) => item.getName())).toContain(
      "simulation_results_organization_run_customer_unique",
    );
    for (const foreignKey of [
      "simulation_results_organization_run_fk",
      "simulation_results_organization_customer_fk",
    ]) {
      expect(resultConfig.foreignKeys.map((item) => item.getName())).toContain(foreignKey);
    }
  });

  test("defines published meter versions and deterministic hourly usage buckets", () => {
    expect(meterStatus.enumValues).toEqual(["draft", "active", "archived"]);
    expect(meterAggregation.enumValues).toEqual(["count", "sum"]);

    const meterVersionConfig = getTableConfig(meterVersions);
    const meterVersionColumns = columnNames(meterVersions);
    for (const column of [
      "aggregation",
      "effective_from",
      "effective_to",
      "event_type",
      "filter_definition",
      "group_by_keys",
      "published_at",
      "value_property",
    ]) {
      expect(meterVersionColumns).toContain(column);
    }
    expect(meterVersionConfig.foreignKeys.map((key) => key.getName())).toContain(
      "meter_versions_organization_meter_fk",
    );

    const bucketConfig = getTableConfig(usageBuckets);
    const bucketColumns = columnNames(usageBuckets);
    for (const column of [
      "bucket_start",
      "dimensions_hash",
      "event_count",
      "max_received_at",
      "quantity",
      "revision",
      "customer_id",
    ]) {
      expect(bucketColumns).toContain(column);
    }
    expect(bucketConfig.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      "usage_buckets_identity_unique",
    );
    const bucketForeignKeys = bucketConfig.foreignKeys.map((key) => key.getName());
    for (const foreignKey of [
      "usage_buckets_organization_customer_fk",
      "usage_buckets_organization_meter_version_fk",
    ]) {
      expect(bucketForeignKeys).toContain(foreignKey);
    }
    expect(
      getTableConfig(meters).uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain("meters_organization_id_key_unique");
  });

  test("keeps the generated migration aligned with the declared schema", async () => {
    const migration = await Bun.file(
      new URL("../migrations/20260819090002_oval_purifiers/migration.sql", import.meta.url),
    ).text();

    for (const table of [
      "users",
      "sessions",
      "accounts",
      "verifications",
      "organizations",
      "memberships",
      "api_keys",
      "audit_log",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }

    expect(migration).toContain('"secret_hash" text NOT NULL');
    expect(migration).toContain(
      'CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")',
    );
    expect(migration).toContain('CONSTRAINT "audit_log_actor_shape_check"');

    const apiKeyScopeMigration = await Bun.file(
      new URL("../migrations/20260820071304_closed_zarek/migration.sql", import.meta.url),
    ).text();

    expect(apiKeyScopeMigration).toContain('CONSTRAINT "api_keys_scopes_allowed_check"');
    for (const scope of API_KEY_SCOPES) {
      expect(apiKeyScopeMigration).toContain(`'${scope}'`);
    }

    const eventLedgerMigration = await Bun.file(
      new URL("../migrations/20260820042817_lethal_tiger_shark/migration.sql", import.meta.url),
    ).text();

    for (const table of ["usage_events", "jobs"]) {
      expect(eventLedgerMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(eventLedgerMigration).toContain(
      'CONSTRAINT "usage_events_organization_id_event_key_unique"',
    );
    expect(eventLedgerMigration).toContain('CONSTRAINT "jobs_organization_type_resource_unique"');
    expect(eventLedgerMigration).toContain('CONSTRAINT "jobs_organization_event_fk"');

    const meteringMigration = await Bun.file(
      new URL("../migrations/20260820045246_bouncy_lionheart/migration.sql", import.meta.url),
    ).text();
    for (const table of ["meters", "meter_versions", "usage_buckets"]) {
      expect(meteringMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(meteringMigration).toContain('CONSTRAINT "usage_buckets_identity_unique"');
    expect(meteringMigration).toContain('CONSTRAINT "usage_buckets_organization_meter_version_fk"');

    const customerAttributionMigration = await Bun.file(
      new URL("../migrations/20260820052613_cloudy_killmonger/migration.sql", import.meta.url),
    ).text();
    for (const table of ["customers", "subjects"]) {
      expect(customerAttributionMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(customerAttributionMigration).toContain(
      'CONSTRAINT "usage_events_organization_customer_fk"',
    );
    expect(customerAttributionMigration).toContain(
      'CONSTRAINT "usage_buckets_organization_customer_fk"',
    );
    expect(customerAttributionMigration.indexOf('DROP CONSTRAINT "usage_buckets_identity_unique"')).toBeLessThan(
      customerAttributionMigration.indexOf('DROP COLUMN "subject_key"'),
    );

    const entitlementMigration = await Bun.file(
      new URL("../migrations/20260820065049_complex_loa/migration.sql", import.meta.url),
    ).text();
    for (const table of ["features", "entitlements", "quota_grants"]) {
      expect(entitlementMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(entitlementMigration).toContain(
      'CONSTRAINT "entitlements_organization_customer_feature_period_unique"',
    );
    expect(entitlementMigration).toContain('CONSTRAINT "quota_grants_organization_entitlement_fk"');

    const catalogMigration = await Bun.file(
      new URL("../migrations/20260820074730_groovy_mephisto/migration.sql", import.meta.url),
    ).text();
    for (const table of ["plans", "plan_versions", "plan_components", "subscriptions"]) {
      expect(catalogMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(catalogMigration).toContain('CONSTRAINT "subscriptions_commercial_slot_no_overlap"');
    expect(catalogMigration).toContain('TRIGGER "plan_versions_published_immutable"');
    expect(catalogMigration).toContain('TRIGGER "plan_components_published_immutable"');

    const previewMigration = await Bun.file(
      new URL("../migrations/20260820080047_ambitious_clea/migration.sql", import.meta.url),
    ).text();
    for (const table of ["invoice_previews", "invoice_preview_lines"]) {
      expect(previewMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(previewMigration).toContain('TRIGGER "invoice_previews_immutable"');
    expect(previewMigration).toContain('TRIGGER "invoice_preview_lines_immutable"');

    const simulationMigration = await Bun.file(
      new URL("../migrations/20260820081102_chief_katie_power/migration.sql", import.meta.url),
    ).text();
    for (const table of ["simulation_runs", "simulation_results"]) {
      expect(simulationMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(simulationMigration).toContain('TRIGGER "simulation_runs_immutable"');
    expect(simulationMigration).toContain('TRIGGER "simulation_results_immutable"');

    const simulationConstraintMigration = await Bun.file(
      new URL("../migrations/20260820082410_breezy_slyde/migration.sql", import.meta.url),
    ).text();
    expect(simulationConstraintMigration).toContain(
      'CONSTRAINT "simulation_results_amounts_check"',
    );
    expect(simulationConstraintMigration).toContain(
      'CONSTRAINT "simulation_runs_increase_threshold_check"',
    );

    const simulationExclusionMigration = await Bun.file(
      new URL("../migrations/20260820083221_round_odin/migration.sql", import.meta.url),
    ).text();
    expect(simulationExclusionMigration).toContain(
      "CREATE TYPE \"simulation_result_status\" AS ENUM('included', 'excluded')",
    );
    expect(simulationExclusionMigration).toContain('CONSTRAINT "simulation_results_shape_check"');

    const correctionMigration = await Bun.file(
      new URL("../migrations/20260820084919_stiff_warbound/migration.sql", import.meta.url),
    ).text();
    expect(correctionMigration).toContain(
      'CREATE UNIQUE INDEX "usage_events_direct_correction_unique"',
    );
    expect(correctionMigration).toContain('TRIGGER "usage_events_immutable"');

    const operationsMigration = await Bun.file(
      new URL("../migrations/20260820092740_square_legion/migration.sql", import.meta.url),
    ).text();
    for (const table of ["reconciliation_runs", "reconciliation_findings", "billing_exports"]) {
      expect(operationsMigration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(operationsMigration).toContain('"source_preview_revision_id" uuid NOT NULL');

    const operationsProtectionMigration = await Bun.file(
      new URL("../migrations/20260820092820_conscious_inhumans/migration.sql", import.meta.url),
    ).text();
    for (const trigger of [
      "reconciliation_runs_immutable",
      "reconciliation_findings_immutable",
      "billing_exports_immutable",
      "audit_log_immutable",
    ]) {
      expect(operationsProtectionMigration).toContain(`TRIGGER "${trigger}"`);
    }
    expect(operationsProtectionMigration).toContain('NEW."adjustment_of_preview_id"');

    const rateLimitMigration = await Bun.file(
      new URL("../migrations/20260820093951_yielding_lucky_pierre/migration.sql", import.meta.url),
    ).text();
    expect(rateLimitMigration).toContain('CREATE TABLE "rate_limit_windows"');
    expect(rateLimitMigration).toContain(
      'CONSTRAINT "rate_limit_windows_key_window_pk" PRIMARY KEY',
    );

    const retentionMigration = await Bun.file(
      new URL("../migrations/20260820101506_bent_valeria_richards/migration.sql", import.meta.url),
    ).text();
    expect(retentionMigration).toContain('CREATE TABLE "data_retention_policies"');
    expect(retentionMigration).toContain('ADD COLUMN "properties_redacted_at"');
    expect(retentionMigration).toContain('CREATE OR REPLACE FUNCTION "protect_usage_events"');
    expect(retentionMigration).toContain("only one-way property redaction");
  });
});
