import { createMiddleware } from "hono/factory";

import { publicError } from "./public-errors";

export const requireSameOrigin = createMiddleware(async (context, next) => {
  const origin = context.req.header("Origin");
  const requestOrigin = new URL(context.req.url).origin;

  if (!origin || origin !== requestOrigin) {
    return publicError(
      context,
      403,
      "forbidden",
      "This browser request did not come from the trusted application origin.",
    );
  }

  await next();
});
