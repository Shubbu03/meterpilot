import type { HealthResponse } from "@meterpilot/contracts";
import type { Observability } from "@meterpilot/observability";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

const REQUEST_ID_MAX_LENGTH = 128;
const SERVICE_NAME = "meterpilot-server";

type HttpObservability = Pick<Observability, "logger" | "withSpan">;

export type AppDependencies = Readonly<{
  checkDatabaseHealth: () => Promise<void>;
  now?: () => number;
  observability: HttpObservability;
}>;

export function createApp(dependencies: AppDependencies) {
  const app = new Hono();
  const now = dependencies.now ?? (() => performance.now());

  app.use(
    "*",
    requestId({
      limitLength: REQUEST_ID_MAX_LENGTH,
    }),
  );
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    const startedAt = now();

    await next();

    dependencies.observability.logger.info("http_request_completed", {
      durationMs: Math.max(0, now() - startedAt),
      method: context.req.method,
      path: context.req.path,
      requestId: context.get("requestId"),
      statusCode: context.res.status,
    });
  });

  app.get("/", (context) => {
    return context.text("MeterPilot API");
  });

  app.get("/health", async (context) => {
    try {
      await dependencies.observability.withSpan(
        "server.health.database",
        dependencies.checkDatabaseHealth,
        { "server.health.dependency": "postgresql" },
      );

      const response: HealthResponse = {
        service: SERVICE_NAME,
        status: "ok",
      };
      return context.json(response);
    } catch (error) {
      dependencies.observability.logger.warn("database_health_check_failed", { error });

      const response: HealthResponse = {
        service: SERVICE_NAME,
        status: "degraded",
      };
      return context.json(response, 503);
    }
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
    dependencies.observability.logger.error("unhandled_request_error", {
      error,
      method: context.req.method,
      path: context.req.path,
      requestId: context.get("requestId"),
    });

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

export type AppType = ReturnType<typeof createApp>;
