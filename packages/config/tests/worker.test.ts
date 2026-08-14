import { describe, expect, test } from "bun:test";

import { parseWorkerConfig } from "../src/worker";

const DATABASE_URL = "postgresql://user:password@localhost:5432/meterpilot";

describe("worker configuration", () => {
  test("parses private worker settings", () => {
    expect(
      parseWorkerConfig({
        DATABASE_URL,
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
      }),
    ).toEqual({
      databaseUrl: DATABASE_URL,
      logLevel: "debug",
      nodeEnvironment: "test",
    });
  });
});
