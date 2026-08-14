import { describe, expect, test } from "bun:test";

import { createLogger } from "../src/logger";

describe("structured logger", () => {
  test("writes stable JSON with trace correlation and reserved fields", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "test",
      getTraceCorrelation: () => ({ spanId: "span_01", traceId: "trace_01" }),
      level: "debug",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
      service: "meterpilot-test",
      write: (line) => lines.push(line),
    });

    logger.info("request_completed", {
      event: "must_not_override",
      requestId: "request_01",
      service: "must_not_override",
    });

    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      environment: "test",
      event: "request_completed",
      level: "info",
      requestId: "request_01",
      service: "meterpilot-test",
      spanId: "span_01",
      timestamp: "2026-08-13T12:00:00.000Z",
      traceId: "trace_01",
    });
  });

  test("redacts credentials and raw event properties recursively", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "test",
      level: "info",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
      service: "meterpilot-test",
      write: (line) => lines.push(line),
    });

    logger.error("ingestion_failed", {
      apiKey: "secret-key",
      error: new Error("private database detail"),
      nested: {
        authorization: "Bearer secret-token",
        properties: { prompt: "private prompt" },
        safe: "visible",
      },
      sessionCookie: "private-cookie",
    });

    const line = lines[0] ?? "";
    expect(line).not.toContain("secret-key");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("private prompt");
    expect(line).not.toContain("private database detail");
    expect(line).not.toContain("private-cookie");
    expect(JSON.parse(line)).toMatchObject({
      apiKey: "[REDACTED]",
      error: { name: "Error" },
      nested: {
        authorization: "[REDACTED]",
        properties: "[REDACTED]",
        safe: "visible",
      },
      sessionCookie: "[REDACTED]",
    });
  });

  test("filters lower-severity logs and handles circular context", () => {
    const lines: string[] = [];
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const logger = createLogger({
      environment: "test",
      level: "warn",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
      service: "meterpilot-test",
      write: (line) => lines.push(line),
    });

    logger.info("ignored");
    logger.warn("included", circular);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").self).toBe("[CIRCULAR]");
  });
});
