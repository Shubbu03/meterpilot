import {
  metrics as openTelemetryMetrics,
  trace,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";

import { createLogger, type Logger, type LoggerOptions } from "./logger";
import { createMeterPilotMetrics, type MeterPilotMetrics } from "./metrics";
import { runInSpan, type SpanOperation } from "./tracing";

export type ObservabilityOptions = LoggerOptions &
  Readonly<{
    instrumentationVersion?: string;
    meter?: Meter;
    tracer?: Tracer;
  }>;

export type Observability = Readonly<{
  logger: Logger;
  metrics: MeterPilotMetrics;
  withSpan: <T>(
    name: string,
    operation: SpanOperation<T>,
    attributes?: Parameters<typeof runInSpan>[3],
  ) => Promise<T>;
}>;

export function createObservability(options: ObservabilityOptions): Observability {
  const meter =
    options.meter ?? openTelemetryMetrics.getMeter(options.service, options.instrumentationVersion);
  const tracer = options.tracer ?? trace.getTracer(options.service, options.instrumentationVersion);

  return Object.freeze({
    logger: createLogger(options),
    metrics: createMeterPilotMetrics(meter),
    withSpan: <T>(
      name: string,
      operation: SpanOperation<T>,
      attributes: Parameters<typeof runInSpan>[3] = {},
    ) => runInSpan(tracer, name, operation, attributes),
  });
}

export * from "./logger";
export * from "./metrics";
export * from "./tracing";
