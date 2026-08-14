# @meterpilot/sdk

Typed TypeScript client for MeterPilot's public API.

The current SDK surface sends single usage events and batches. It validates requests before sending,
validates responses before returning them, applies bounded request timeouts, disables redirects so
credentials cannot be forwarded, and never includes the API key in an error message.

```ts
import { createMeterPilotClient } from "@meterpilot/sdk";

const meterPilot = createMeterPilotClient({
  apiKey: process.env.METERPILOT_API_KEY,
  baseUrl: "https://meterpilot.example.com",
});

await meterPilot.events.send({
  id: "evt_01JZ",
  occurredAt: new Date().toISOString(),
  properties: { inputTokens: "820" },
  subject: "workspace_acme",
  type: "llm.tokens.consumed",
});
```

Do not put personal data, credentials, access tokens, prompts, or other secrets in event properties.
Use opaque customer and subject keys.
