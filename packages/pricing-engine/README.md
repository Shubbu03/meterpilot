# @meterpilot/pricing-engine

Pure deterministic pricing for MeterPilot's four V1 models:

- flat recurring fee;
- per-unit usage;
- included quantity with per-unit overage;
- graduated tiers.

All quantities, rates, amounts, and minor-unit totals cross the engine as decimal strings. Each line
rounds once using its explicit policy, totals sum rounded lines, and the result includes stable SHA-256
calculation hashes. The engine has no database, network, clock, or random dependency.

From the repository root:

```bash
bun run --cwd packages/pricing-engine typecheck
bun run --cwd packages/pricing-engine test
```
