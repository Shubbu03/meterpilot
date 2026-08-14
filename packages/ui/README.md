# @meterpilot/ui

Accessible React primitives built with Tailwind CSS v4 and semantic design tokens shared by
MeterPilot interfaces.

## Use

Import the component styles once at the application entry point:

```css
@import "@meterpilot/ui/globals.css";
```

Then import components from the package root:

```tsx
import { Button, StatusBadge } from "@meterpilot/ui";
```

Set `data-theme="night"` on a containing element to activate the dark theme tokens.

The package uses Tailwind v4's CSS-first configuration. The global entrypoint registers the package
source with `@source`, so no `tailwind.config` file is required.

## Commands

```bash
bun run test
bun run typecheck
bun run build
```
