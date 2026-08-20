# @meterpilot/contracts

Runtime-validated HTTP contracts shared by the API, dashboard, and TypeScript SDK.

Current boundaries:

- stable public errors, health responses, request IDs, and cursor pagination;
- immutable usage-event request and result shapes;
- organization, membership, role, timezone, and tenant route shapes;
- scoped API key records, one-time reveal responses, and create-request validation;
- deterministic event-time checks through an injected clock;
- explicit batch, payload-size, property-depth, and property-key limits.

This package contains transport contracts only. It does not contain database records, authorization,
or business rules.

From the repository root:

```bash
bun run --cwd packages/contracts typecheck
bun run --cwd packages/contracts test
```
