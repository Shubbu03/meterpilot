import { describe, expect, test } from "bun:test";
import { API_KEY_SCOPES } from "@meterpilot/domain/identity";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import {
  accounts,
  apiKeys,
  auditActorType,
  auditLog,
  membershipRole,
  memberships,
  organizations,
  sessions,
  users,
  verifications,
} from "../src/schema";

function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("Phase 1 database schema", () => {
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
    expect(API_KEY_SCOPES).toEqual(["events:write", "events:read", "usage:read"]);
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
      new URL("../migrations/20260819142834_easy_stone_men/migration.sql", import.meta.url),
    ).text();

    expect(apiKeyScopeMigration).toContain('CONSTRAINT "api_keys_scopes_allowed_check"');
    for (const scope of API_KEY_SCOPES) {
      expect(apiKeyScopeMigration).toContain(`'${scope}'`);
    }
  });
});
