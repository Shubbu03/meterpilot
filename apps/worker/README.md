# MeterPilot worker

The Bun process that claims and executes durable PostgreSQL jobs. Install dependencies from the repository root.

The worker uses bounded PostgreSQL leases with `FOR UPDATE SKIP LOCKED`, safe retries, structured
telemetry, and graceful shutdown. It processes usage events into deterministic hourly customer
buckets, rebuilds published meter ranges, and releases expired hard-quota reservations through
idempotent handlers. It also materializes each subscription's calendar-month entitlement periods
and grants at the customer's local billing boundary.
Invoice preview jobs pin an immutable raw-event watermark, calculate exact usage and all four price
models, persist per-line explanation traces and hashes, and create a new revision when later event
processing affects an already-previewed period.
Simulation jobs compare the same receive-time-watermarked raw events under published baseline and
non-archived candidate versions. Definitions are loaded once per run, customer events are read in
bounded batches, and terminal per-customer results and the calculation hash are immutable.
Correction jobs rebuild both the former and replacement bucket identities. Current aggregates use
only terminal effective events, while previews and simulations evaluate correction chains as of the
stored receive-time watermark.
Reconciliation jobs rebuild expected hourly buckets from effective raw events at a pinned watermark,
record immutable drift findings, optionally repair only derived state, and schedule new preview
revisions for repaired periods. Stripe export jobs pin one completed preview revision and produce a
content-hashed, immutable invoice-item file without contacting or mutating Stripe.
Retention jobs remove eligible processed-event properties in bounded batches, audit each batch, and
schedule the next scan. Stale policy versions stop without redacting data, and historical operations
fail explicitly when required source properties have already been removed.
When a retryable failure exhausts its automatic attempt budget, the worker persists that
classification for owner/admin inspection. A safe manual recovery starts a new automatic attempt
cycle; permanent handler failures remain non-retryable because their domain resource may already be
terminal and immutable.

Copy `.env.example` to `.env` and set `DATABASE_URL` before starting the process. The runtime validates all queue settings and checks database connectivity before polling.

## Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```

PostgreSQL lease-concurrency and simulation non-mutation tests are skipped by default. Run them only
against a migrated disposable database by setting `WORKER_TEST_DATABASE_URL`; the tests refuse to
reuse the worker's normal `DATABASE_URL` implicitly.
