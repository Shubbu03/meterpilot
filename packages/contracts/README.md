# @meterpilot/contracts

Runtime-validated HTTP contracts shared by the API, dashboard, and TypeScript SDK.

Current boundaries:

- stable public errors, health responses, request IDs, and cursor pagination;
- immutable usage-event request, ingestion result, body-limit, and processing-state shapes;
- organization, membership, role, timezone, and tenant route shapes;
- scoped API key records, one-time reveal responses, and create-request validation;
- deterministic event-time checks through an injected clock;
- explicit batch, payload-size, property-depth, and property-key limits.
- customers, meters, usage, entitlements, quota reservations, plans, versions, components, and
  subscriptions.
- asynchronous invoice preview requests, immutable revisions, exact line amounts, traces, and
  stable failure states.
- bounded pricing-simulation requests, mutually exclusive lifecycle responses, customer deltas,
  warning flags, and report formats.
- append-only reverse/replace event corrections and correction relationships.
- bounded reconciliation and replay requests, immutable findings and audit pages, and
  revision-bound Stripe invoice-item export files.
- disabled-by-default, bounded data-retention policies and trusted enforcement-job payloads.
- private failed-job inspection and generation-acknowledged manual retry contracts.

This package contains transport contracts only. It does not contain database records, authorization,
or business rules.

From the repository root:

```bash
bun run --cwd packages/contracts typecheck
bun run --cwd packages/contracts test
```
