import { createMiddleware } from "hono/factory";

import type { AppEnvironment } from "../../http/environment";
import { publicError } from "../../http/public-errors";
import type { AuthGateway } from "./authentication";

export function createSessionMiddleware(auth: AuthGateway) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const session = await auth.getSession(context.req.raw.headers);

    if (!session) {
      return publicError(context, 401, "unauthorized", "A valid dashboard session is required.");
    }

    context.set("authenticatedSession", session);
    await next();
  });
}
