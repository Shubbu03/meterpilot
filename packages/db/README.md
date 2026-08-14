# MeterPilot database

Shared PostgreSQL access and Drizzle migration tooling using Bun's native SQL client.

## Commands

Create the database package's local environment file once:

```bash
cp packages/db/.env.example packages/db/.env
```

Then run database commands from the repository root:

```bash
bun run infra:up
bun run db:generate
bun run db:check
bun run db:migrate
```

The root scripts execute Drizzle with `packages/db` as its working directory, and the package
scripts explicitly load `packages/db/.env`. No repository-level environment file is used.

`db:generate` creates migration files from the declared schema. `db:migrate` is the only command here that changes a database.
