# MeterPilot database

Shared PostgreSQL access and Drizzle migration tooling using Bun's native SQL client.

## Commands

Run database commands from the repository root so the shared environment contract is used:

```bash
cp .env.example .env
bun run infra:up
bun run db:generate
bun run db:check
bun run db:migrate
```

`db:generate` creates migration files from the declared schema. `db:migrate` is the only command here that changes a database.
