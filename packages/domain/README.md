# @meterpilot/domain

Pure cross-feature domain primitives and invariant guards.

This package owns tenant identity, normalized instants and half-open intervals, idempotency outcomes,
published-version lifecycle, and append-only correction relationships. It has no HTTP, database,
clock, randomness, or framework dependency. Billing-period resolution uses Temporal calendar
arithmetic so local monthly anchors remain stable across month-length and daylight-saving changes.

From the repository root:

```bash
bun run --cwd packages/domain typecheck
bun run --cwd packages/domain test
```
