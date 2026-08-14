import { describe, expect, test } from "bun:test";

import { ConfigurationError, parseDatabaseUrl, readDatabaseUrl } from "../src";

describe("database configuration", () => {
  test("accepts PostgreSQL connection URLs", () => {
    expect(parseDatabaseUrl("postgresql://user:password@localhost:5432/meterpilot")).toBe(
      "postgresql://user:password@localhost:5432/meterpilot",
    );
    expect(parseDatabaseUrl("postgres://user:password@localhost/meterpilot")).toBe(
      "postgres://user:password@localhost/meterpilot",
    );
  });

  test("rejects a missing URL", () => {
    expect(() => readDatabaseUrl({})).toThrow(ConfigurationError);
    expect(() => readDatabaseUrl({})).toThrow("Invalid database configuration");
  });

  test("rejects non-PostgreSQL URLs without exposing credentials", () => {
    const invalidUrl = "mysql://user:do-not-log-this@localhost/meterpilot";

    expect(() => parseDatabaseUrl(invalidUrl)).toThrow("must use postgres:// or postgresql://");
    expect(() => parseDatabaseUrl(invalidUrl)).not.toThrow("do-not-log-this");
  });

  test("rejects URLs without a database name", () => {
    expect(() => parseDatabaseUrl("postgresql://user:password@localhost")).toThrow(
      "must include a host and database name",
    );
  });
});
