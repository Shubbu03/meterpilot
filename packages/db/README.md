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
`db:migrate` explicitly loads `packages/db/.env` under Bun so drizzle-kit can use the native SQL
driver. No repository-level environment file is used.

The event ledger stores tenant-qualified immutable payloads and canonical hashes. Every newly
accepted event is paired with one durable processing job by the server's Drizzle repository in a
single transaction. Job rows include lease state, attempts, retry timing, and inspectable failure
state for the worker phase.
The failure record distinguishes exhausted transient work from permanent failure. Owner/admin
manual recovery is generation-checked, capped, and audited; it resets the automatic attempt budget
without changing the immutable job payload.

Catalog migrations enforce tenant-qualified references, non-overlapping subscription slots, and
database-level immutability for published plan versions and components. Subscription-created
entitlements retain their subscription reference and renew through durable worker jobs.

Invoice previews are stored as immutable revision series. A terminal revision pins its input
watermark, line-level price traces, source bucket revisions, exact minor-unit total, and calculation
hash. Late event processing appends another pending revision instead of rewriting a completed one.

Simulation runs pin plan versions, a bounded customer cohort, period, threshold, and raw-event
watermark. Database checks enforce valid terminal shapes and exact candidate-minus-baseline deltas;
triggers make terminal runs and every customer result immutable.

Usage corrections are append-only rows with a tenant-scoped self-reference. A partial unique index
keeps each chain linear, and receive-time-aware effective-event queries preserve historical preview
and simulation snapshots.

Reconciliation runs, findings, completed billing exports, audit entries, and invoice-preview
adjustment links are protected by database constraints and terminal-state immutability triggers.

Event properties can only make one trigger-guarded transition to `{}` after durable processing. The
event identity and canonical payload hash remain immutable, while a versioned tenant retention
policy and recurring jobs make enforcement bounded, auditable, and stale-policy safe.
