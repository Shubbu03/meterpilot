import { describe, expect, test } from "bun:test";

import { parseServerConfig } from "../src/server";

const DATABASE_URL = "postgresql://user:password@localhost:5432/meterpilot";

describe("server configuration", () => {
  test("applies safe development defaults", () => {
    expect(parseServerConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      host: "0.0.0.0",
      logLevel: "info",
      nodeEnvironment: "development",
      port: 3000,
    });
  });

  test("parses an explicit port", () => {
    expect(parseServerConfig({ DATABASE_URL, PORT: "4100" }).port).toBe(4100);
  });

  test("rejects an invalid port", () => {
    expect(() => parseServerConfig({ DATABASE_URL, PORT: "70000" })).toThrow(
      "Invalid server configuration",
    );
  });
});
