# MeterPilot database

Shared PostgreSQL access and Drizzle migration tooling using Bun's native SQL client.

## Commands

Schema generation and validation do not connect to PostgreSQL and do not require an environment
file:

```bash
bun run db:generate
bun run db:check
```

Only create the database package's local environment file when you are ready to apply migrations:

```bash
cp -n packages/db/.env.example packages/db/.env
bun run infra:up
bun run db:migrate
```

The root scripts execute Drizzle with `packages/db` as its working directory, and the package
`db:migrate` explicitly loads `packages/db/.env`. No repository-level environment file is used.

The event ledger stores tenant-qualified immutable payloads and canonical hashes. Every newly
accepted event is paired with one durable processing job by the server's Drizzle repository in a
single transaction. Job rows include lease state, attempts, retry timing, and inspectable failure
state for the worker phase.
