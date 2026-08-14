import { isSpanContextValid, trace } from "@opentelemetry/api";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogAttributes = Readonly<Record<string, unknown>>;
export type LogWriter = (line: string) => void;
export type TraceCorrelation = Readonly<{ spanId: string; traceId: string }>;

export type LoggerOptions = Readonly<{
  environment: string;
  getTraceCorrelation?: () => TraceCorrelation | null;
  level: LogLevel;
  now?: () => Date;
  service: string;
  write?: LogWriter;
}>;

export type Logger = Readonly<{
  debug: (event: string, attributes?: LogAttributes) => void;
  error: (event: string, attributes?: LogAttributes) => void;
  info: (event: string, attributes?: LogAttributes) => void;
  warn: (event: string, attributes?: LogAttributes) => void;
}>;

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 4096;
const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const TRUNCATED = "[TRUNCATED]";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

const sensitiveKeyFragments = [
  "apikey",
  "authorization",
  "cookie",
  "eventproperties",
  "headers",
  "password",
  "properties",
  "rawpayload",
  "secret",
  "session",
  "token",
];

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value) || typeof value !== "number" ? value : String(value);
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "Invalid Date";
  }

  if (value instanceof Error) {
    return { name: value.name };
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const sanitized: Record<string, unknown> = {};

  for (const [key, item] of entries) {
    const result = isSensitiveLogKey(key) ? REDACTED : sanitizeValue(item, depth + 1, seen);
    if (result !== undefined) {
      sanitized[key] = result;
    }
  }

  return sanitized;
}

export function sanitizeLogAttributes(attributes: LogAttributes = {}): Record<string, unknown> {
  return sanitizeValue(attributes, 0, new WeakSet()) as Record<string, unknown>;
}

function activeTraceCorrelation(): TraceCorrelation | null {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return null;
  }
  return { spanId: spanContext.spanId, traceId: spanContext.traceId };
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0 || value.length > 128) {
    throw new TypeError(`${field} must be between 1 and 128 characters.`);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  assertNonEmpty(options.service, "Logger service");
  assertNonEmpty(options.environment, "Logger environment");

  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => console.info(line));
  const getTraceCorrelation = options.getTraceCorrelation ?? activeTraceCorrelation;

  function log(level: LogLevel, event: string, attributes: LogAttributes = {}): void {
    if (levelPriority[level] < levelPriority[options.level]) {
      return;
    }
    assertNonEmpty(event, "Log event");

    const timestamp = now();
    if (!Number.isFinite(timestamp.getTime())) {
      throw new TypeError("Logger clock returned an invalid date.");
    }

    const correlation = getTraceCorrelation();
    const entry = {
      ...sanitizeLogAttributes(attributes),
      environment: options.environment,
      event,
      level,
      service: options.service,
      timestamp: timestamp.toISOString(),
      ...(correlation ? correlation : {}),
    };

    write(JSON.stringify(entry));
  }

  return Object.freeze({
    debug: (event, attributes) => log("debug", event, attributes),
    error: (event, attributes) => log("error", event, attributes),
    info: (event, attributes) => log("info", event, attributes),
    warn: (event, attributes) => log("warn", event, attributes),
  });
}
