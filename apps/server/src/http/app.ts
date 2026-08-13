import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

const REQUEST_ID_MAX_LENGTH = 128;

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    requestId({
      limitLength: REQUEST_ID_MAX_LENGTH,
    }),
  );
  app.use("*", secureHeaders());

  app.get("/", (context) => {
    return context.text("MeterPilot API");
  });

  app.get("/health", (context) => {
    return context.json({
      service: "meterpilot-server",
      status: "ok",
    });
  });

  app.notFound((context) => {
    return context.json(
      {
        error: {
          code: "route_not_found",
          message: "The requested route does not exist.",
          requestId: context.get("requestId"),
        },
      },
      404,
    );
  });

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        errorName: error.name,
        event: "unhandled_request_error",
        level: "error",
        method: context.req.method,
        path: context.req.path,
        requestId: context.get("requestId"),
      }),
    );

    return context.json(
      {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
          requestId: context.get("requestId"),
        },
      },
      500,
    );
  });

  return app;
}

const app = createApp();

export type AppType = typeof app;

export default app;
