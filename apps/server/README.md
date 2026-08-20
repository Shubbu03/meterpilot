# MeterPilot server

The Bun-hosted Hono API process. Runtime configuration is loaded from this app's local `.env`
file, PostgreSQL is created during bootstrap, and `SIGINT` or `SIGTERM` closes the listener and
database pool gracefully.

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
later. Supported scopes are `events:write`, `events:read`, and `usage:read`.

The reusable Bearer authentication middleware resolves an API key to its organization and scopes,
rejects revoked or expired keys, and atomically records `lastUsedAt`. Event routes will apply that
middleware when accepting or reading usage events.

## Immutable event ledger

Scoped API keys access the event API through:

```text
POST /v1/events              events:write
POST /v1/events/batch        events:write
GET  /v1/events/:eventKey    events:read
```

An ingestion response uses `202 Accepted` only after the immutable event and its processing job are
committed in the same PostgreSQL transaction. Reusing an event ID with the same canonical payload
returns `duplicate`; reusing it with different content returns `idempotency_conflict`. Batch inputs
are validated independently so valid events can be accepted alongside stable rejection results.

Event lookup is always derived from the authenticated key's organization. Responses expose the
event's `pending`, `processing`, `processed`, or `failed` state without exposing internal job IDs,
lease data, source credentials, or worker errors.

## Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```
