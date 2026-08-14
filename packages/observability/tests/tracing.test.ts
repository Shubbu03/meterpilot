import { describe, expect, test } from "bun:test";
import { SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

import { runInSpan } from "../src/tracing";

type RecordedStatus = Readonly<{ code: SpanStatusCode; message?: string }>;

type SpanRecord = {
  attributes: Record<string, unknown>;
  ended: boolean;
  status?: RecordedStatus;
};

function recordingTracer(record: SpanRecord): Tracer {
  const span = {
    end() {
      record.ended = true;
    },
    setAttribute(key: string, value: unknown) {
      record.attributes[key] = value;
      return span;
    },
    setStatus(status: RecordedStatus) {
      record.status = status;
      return span;
    },
  } as unknown as Span;

  return {
    startActiveSpan(
      _name: string,
      options: { attributes?: Record<string, unknown> },
      operation: (span: Span) => unknown,
    ) {
      Object.assign(record.attributes, options.attributes);
      return operation(span);
    },
  } as unknown as Tracer;
}

describe("span helper", () => {
  test("ends successful spans and removes sensitive attributes", async () => {
    const record: SpanRecord = { attributes: {}, ended: false };
    const result = await runInSpan(recordingTracer(record), "events.ingest", () => "ok", {
      apiKey: "must-not-be-recorded",
      requestId: "request_01",
    });

    expect(result).toBe("ok");
    expect(record).toMatchObject({
      attributes: { requestId: "request_01" },
      ended: true,
      status: { code: SpanStatusCode.OK },
    });
    expect(record.attributes.apiKey).toBeUndefined();
  });

  test("records a generic failure without exception details and rethrows", async () => {
    const record: SpanRecord = { attributes: {}, ended: false };
    const privateError = new Error("private database detail");

    try {
      await runInSpan(recordingTracer(record), "events.ingest", () => {
        throw privateError;
      });
      throw new Error("expected span operation to fail");
    } catch (error) {
      expect(error).toBe(privateError);
    }

    expect(record).toMatchObject({
      attributes: { "error.type": "Error" },
      ended: true,
      status: { code: SpanStatusCode.ERROR, message: "Operation failed." },
    });
    expect(JSON.stringify(record)).not.toContain("private database detail");
  });
});
