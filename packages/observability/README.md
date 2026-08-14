# @meterpilot/observability

Shared structured logging, OpenTelemetry metrics, and tracing for MeterPilot runtimes.

- JSON logs apply level filtering, bounded serialization, recursive sensitive-field redaction, and
  active trace correlation.
- The metric catalog covers ingestion, jobs, aggregation, entitlements, reservations, simulations,
  reconciliation, database contention, previews, and exports with low-cardinality attributes.
- The span helper records success or failure and always ends spans without copying exception messages
  or stack traces into telemetry.

This is an instrumentation library. It deliberately depends only on `@opentelemetry/api`; server and
worker entrypoints must initialize their OpenTelemetry SDK and exporters before creating observability.
An OpenTelemetry Prometheus exporter can consume the same metric instruments without changing this
package.

From the repository root:

```bash
bun run --cwd packages/observability typecheck
bun run --cwd packages/observability test
```
