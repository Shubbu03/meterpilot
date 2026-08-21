# MeterPilot server

The Bun-hosted Hono API process. Runtime configuration is loaded from this app's local `.env`
file, PostgreSQL is created during bootstrap, and `SIGINT` or `SIGTERM` closes the listener and
database pool gracefully.

`WEB_APP_URL` is the exact browser origin allowed to make credentialed dashboard requests. It is
also used by Better Auth and the CSRF boundary; do not configure a wildcard or include a path.

## Local setup

From the repository root:

```bash
cp -n apps/server/.env.example apps/server/.env
openssl rand -base64 48
bun run infra:up
bun run --cwd apps/server dev
```

The single `GET /health` endpoint checks PostgreSQL. It returns `200` with `status: "ok"` when the
database is reachable and `503` with `status: "degraded"` otherwise. Database errors and connection
details are never included in the response.

`GET /openapi.json` serves the complete OpenAPI 3.1 contract for every concrete server route. See
[`docs/api-reference.md`](../../docs/api-reference.md) for authentication, pagination, error, and
asynchronous-operation conventions.

## API key management

Authenticated organization owners and administrators can manage scoped ingestion keys through:

```text
GET  /v1/organizations/:organizationId/api-keys
POST /v1/organizations/:organizationId/api-keys
POST /v1/organizations/:organizationId/api-keys/:apiKeyId/rotate
POST /v1/organizations/:organizationId/api-keys/:apiKeyId/revoke
```

Create and rotate responses reveal the complete key once and use `Cache-Control: no-store`. Only a
SHA-256 hash and the non-secret lookup prefix are persisted; the complete key cannot be retrieved
later. Supported scopes are `events:write`, `events:read`, `usage:read`, and
`reservations:write`.

The reusable Bearer authentication middleware resolves an API key to its organization and scopes,
rejects revoked or expired keys, and atomically records `lastUsedAt`. Event and reservation routes
apply that middleware before reading or mutating tenant data.

## Immutable event ledger

Scoped API keys access the event API through:

```text
POST /v1/events              events:write
POST /v1/events/batch        events:write
GET  /v1/events/:eventKey    events:read
POST /v1/events/:eventKey/corrections events:write
```

An ingestion response uses `202 Accepted` only after the immutable event and its processing job are
committed in the same PostgreSQL transaction. Reusing an event ID with the same canonical payload
returns `duplicate`; reusing it with different content returns `idempotency_conflict`. Batch inputs
are validated independently so valid events can be accepted alongside stable rejection results.

Event lookup is always derived from the authenticated key's organization. Responses expose the
event's `pending`, `processing`, `processed`, or `failed` state without exposing internal job IDs,
lease data, source credentials, or worker errors.

Corrections append a reversal or complete replacement without mutating the original row. They are
idempotent, tenant-scoped, auditable, and queue derived-state repair in the same transaction. See
[`docs/semantics/event-corrections.md`](../../docs/semantics/event-corrections.md).

## Hard quota reservations

Server-to-server quota enforcement uses API keys with the `reservations:write` scope:

```text
POST /v1/customers/:customerKey/reservations
POST /v1/reservations/:reservationId/commit
POST /v1/reservations/:reservationId/release
```

Reservation, commit, release, and expiry behavior is documented in
[`docs/semantics/quota-reservations.md`](../../docs/semantics/quota-reservations.md).

## Product catalog and subscriptions

Organization owners, administrators, and developers can manage versioned plans and explicit
customer subscriptions through:

```text
GET  /v1/organizations/:organizationId/plans
POST /v1/organizations/:organizationId/plans
GET  /v1/organizations/:organizationId/plans/:planKey
POST /v1/organizations/:organizationId/plans/:planKey/versions
POST /v1/organizations/:organizationId/plans/:planKey/versions/:version/publish
POST /v1/organizations/:organizationId/plans/:planKey/versions/:version/duplicate
POST /v1/organizations/:organizationId/plans/:planKey/versions/:version/archive
POST /v1/organizations/:organizationId/plans/:planKey/archive
GET  /v1/organizations/:organizationId/subscriptions
POST /v1/organizations/:organizationId/subscriptions
POST /v1/organizations/:organizationId/subscriptions/:subscriptionId/cancel
```

Published definitions are database-immutable, subscriptions pin one published version, and a
customer cannot have overlapping subscriptions in the same commercial slot. Creating a
subscription materializes its first entitlement period and queues calendar-month renewal work.
See [`docs/semantics/catalog-and-subscriptions.md`](../../docs/semantics/catalog-and-subscriptions.md).

## Invoice previews

Authenticated catalog managers request and inspect asynchronous, non-payable previews through:

```text
GET  /v1/organizations/:organizationId/invoice-previews
POST /v1/organizations/:organizationId/invoice-previews
GET  /v1/organizations/:organizationId/invoice-previews/:previewId
GET  /v1/organizations/:organizationId/invoice-previews/:previewId/revisions
GET  /v1/organizations/:organizationId/invoice-previews/:previewId/revisions/:revision
```

The create response is `202 Accepted` with a durable job ID. Reads return the latest immutable
revision in the preview series. Calculation inputs, exact amounts, source references, traces, and
hashes are described in [`docs/semantics/invoice-previews.md`](../../docs/semantics/invoice-previews.md).

## Pricing simulations

Catalog managers can create a candidate version from a published source and compare a bounded
customer cohort against an immutable raw-event watermark:

```text
GET  /v1/organizations/:organizationId/simulations
POST /v1/organizations/:organizationId/simulations
GET  /v1/organizations/:organizationId/simulations/:simulationId
GET  /v1/organizations/:organizationId/simulations/:simulationId/customers
GET  /v1/organizations/:organizationId/simulations/:simulationId/report?format=csv|json
```

Runs are asynchronous and reports are downloadable only after completion. See
[`docs/semantics/pricing-simulations.md`](../../docs/semantics/pricing-simulations.md).

## Reconciliation, replay, audit, and export

Authorized organization users can detect or repair derived usage drift, inspect immutable findings
and audit history, and produce a Stripe-compatible invoice-item file from one exact completed
preview revision:

```text
GET  /v1/organizations/:organizationId/reconciliation-runs
POST /v1/organizations/:organizationId/reconciliation-runs
POST /v1/organizations/:organizationId/replays
GET  /v1/organizations/:organizationId/reconciliation-runs/:runId
GET  /v1/organizations/:organizationId/reconciliation-runs/:runId/findings
GET  /v1/organizations/:organizationId/audit-log
GET  /v1/organizations/:organizationId/exports
POST /v1/organizations/:organizationId/exports/stripe/invoice-lines
GET  /v1/organizations/:organizationId/exports/:exportId
GET  /v1/organizations/:organizationId/exports/:exportId/download
```

These asynchronous operations and their immutability guarantees are documented in
[`docs/semantics/reconciliation-and-export.md`](../../docs/semantics/reconciliation-and-export.md).

## Data retention

Organization owners and administrators can read or update the event-property retention policy:

```text
GET /v1/organizations/:organizationId/retention-policy
PUT /v1/organizations/:organizationId/retention-policy
```

Retention is disabled by default. Enabling it queues durable, version-pinned enforcement that only
redacts properties from fully processed events; event identity, canonical hashes, aggregates, and
terminal billing evidence remain. The irreversible boundary and historical-calculation behavior are
documented in [`docs/semantics/data-retention.md`](../../docs/semantics/data-retention.md).

## Failed-job recovery

Organization owners and administrators can inspect failed durable work and safely requeue exhausted
transient failures through:

```text
GET  /v1/organizations/:organizationId/failed-jobs
GET  /v1/organizations/:organizationId/failed-jobs/:jobId
POST /v1/organizations/:organizationId/failed-jobs/:jobId/retry
```

Responses expose only allowlisted operational metadata. Permanent failures cannot be retried, and a
manual retry must acknowledge the current failure code, automatic attempt count, and manual retry
count. Recovery semantics, concurrency protection, and the ten-retry limit are documented in
[`docs/semantics/failed-job-recovery.md`](../../docs/semantics/failed-job-recovery.md).

## Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```
