# MeterPilot

MeterPilot is a usage-metering and pricing-safety control plane for small SaaS teams.

## Prerequisites

- Bun 1.3.13

## Workspace

```bash
bun install --frozen-lockfile
bun run check
```

The monorepo is organized into deployable applications under `apps/`, shared packages under `packages/` and deployment support under `infra/`.
