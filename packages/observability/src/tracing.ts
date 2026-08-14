import { SpanStatusCode, type Attributes, type Span, type Tracer } from "@opentelemetry/api";

import { isSensitiveLogKey } from "./logger";

export type SpanOperation<T> = (span: Span) => Promise<T> | T;

function safeSpanAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key, value]) => {
      return !isSensitiveLogKey(key) && value !== undefined;
    }),
  );
}

function errorType(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.slice(0, 128);
  }
  return "UnknownError";
}

export async function runInSpan<T>(
  tracer: Tracer,
  name: string,
  operation: SpanOperation<T>,
  attributes: Attributes = {},
): Promise<T> {
  if (name.trim().length === 0 || name.length > 128) {
    throw new TypeError("Span name must be between 1 and 128 characters.");
  }

  return tracer.startActiveSpan(
    name,
    { attributes: safeSpanAttributes(attributes) },
    async (span) => {
      try {
        const result = await operation(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute("error.type", errorType(error));
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Operation failed." });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
