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

## Commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```
