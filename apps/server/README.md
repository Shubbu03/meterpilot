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
middleware when the immutable event ledger is implemented in Phase 2.

## Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```
