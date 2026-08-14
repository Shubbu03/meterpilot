# @meterpilot/domain

Pure cross-feature domain primitives and invariant guards.

This package owns tenant identity, normalized instants and half-open intervals, idempotency outcomes,
published-version lifecycle, and append-only correction relationships. It has no HTTP, database,
clock, randomness, or framework dependency.

From the repository root:

```bash
bun run --cwd packages/domain typecheck
bun run --cwd packages/domain test
```
