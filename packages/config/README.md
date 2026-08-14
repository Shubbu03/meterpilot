# @meterpilot/config

Shared environment validation for MeterPilot processes.

- `@meterpilot/config/database` validates PostgreSQL connection URLs.
- `@meterpilot/config/server` parses private API runtime settings.
- `@meterpilot/config/worker` parses private worker runtime settings.
- `@meterpilot/config/web` parses browser-safe public settings only.

Configuration errors name invalid fields without including their values, which prevents secrets from
being copied into logs.

From the repository root:

```bash
bun run --cwd packages/config typecheck
bun run --cwd packages/config test
```
