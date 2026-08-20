import type { ApiKeyScope } from "@meterpilot/contracts/api-keys";
import { createMiddleware } from "hono/factory";

import type { AppEnvironment } from "../../http/environment";
import { publicError } from "../../http/public-errors";
import type { ApiKeyAuthenticator } from "./service";

const BEARER_PATTERN = /^Bearer ([^\s,]+)$/i;

export function createApiKeyMiddleware(
  authenticator: ApiKeyAuthenticator,
  requiredScope: ApiKeyScope,
) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const authorization = context.req.header("Authorization");
    const key = authorization ? BEARER_PATTERN.exec(authorization)?.[1] : undefined;

    if (!key) {
      return publicError(context, 401, "unauthorized", "A valid API key is required.");
    }

    const principal = await authenticator.authenticate(key);
    if (!principal) {
      return publicError(context, 401, "unauthorized", "A valid API key is required.");
    }

    if (!principal.scopes.includes(requiredScope)) {
      return publicError(
        context,
        403,
        "forbidden",
        "The API key does not grant the required scope.",
      );
    }

    context.set("apiKeyPrincipal", principal);
    await next();
  });
}
