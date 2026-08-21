import type { HealthResponse } from "@meterpilot/contracts";
import type { Observability } from "@meterpilot/observability";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { registerApiKeyRoutes } from "../features/api-keys/routes";
import type { ApiKeyService } from "../features/api-keys/service";
import type { CatalogRepository } from "../features/catalog/repository";
import { registerCatalogRoutes } from "../features/catalog/routes";
import type { CustomerRepository } from "../features/customers/repository";
import { registerCustomerRoutes } from "../features/customers/routes";
import type { EntitlementRepository } from "../features/entitlements/repository";
import { registerEntitlementRoutes } from "../features/entitlements/routes";
import { registerEventRoutes } from "../features/events/routes";
import type { EventService } from "../features/events/service";
import type { AuthGateway } from "../features/identity/authentication";
import type { JobOperationsRepository } from "../features/job-operations/repository";
import { registerJobOperationsRoutes } from "../features/job-operations/routes";
import type { MeterRepository } from "../features/meters/repository";
import { registerMeterRoutes } from "../features/meters/routes";
import type { OperationsRepository } from "../features/operations/repository";
import { registerOperationsRoutes } from "../features/operations/routes";
import type { OrganizationRepository } from "../features/organizations/repository";
import { registerOrganizationRoutes } from "../features/organizations/routes";
import type { PreviewRepository } from "../features/previews/repository";
import { registerPreviewRoutes } from "../features/previews/routes";
import {
  type CredentialRateLimitOptions,
  createCredentialRateLimitMiddleware,
} from "../features/rate-limits/middleware";
import type { RetentionRepository } from "../features/retention/repository";
import { registerRetentionRoutes } from "../features/retention/routes";
import type { SimulationRepository } from "../features/simulations/repository";
import { registerSimulationRoutes } from "../features/simulations/routes";
import type { UsageRepository } from "../features/usage/repository";
import { registerUsageRoutes } from "../features/usage/routes";
import type { AppEnvironment } from "./environment";
import { openApiDocument } from "./openapi";

const REQUEST_ID_MAX_LENGTH = 128;
const SERVICE_NAME = "meterpilot-server";
const CORS_MAX_AGE_SECONDS = 600;

type HttpObservability = Pick<Observability, "logger" | "metrics" | "withSpan">;

export type AppDependencies = Readonly<{
  apiKeyService: ApiKeyService;
  auth: AuthGateway;
  checkDatabaseHealth: () => Promise<void>;
  catalogRepository: CatalogRepository;
  customerRepository: CustomerRepository;
  eventService: EventService;
  entitlementRepository: EntitlementRepository;
  jobOperationsRepository?: JobOperationsRepository;
  meterRepository: MeterRepository;
  now?: () => number;
  observability: HttpObservability;
  organizationRepository: OrganizationRepository;
  operationsRepository?: OperationsRepository;
  previewRepository?: PreviewRepository;
  rateLimit?: CredentialRateLimitOptions;
  retentionRepository?: RetentionRepository;
  simulationRepository?: SimulationRepository;
  trustedBrowserOrigin?: string;
  usageRepository: UsageRepository;
}>;

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<AppEnvironment>();
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
  app.use("*", async (context, next) => {
    context.set("trustedBrowserOrigin", dependencies.trustedBrowserOrigin);
    await next();
  });
  app.use(
    "*",
    cors({
      allowHeaders: ["Content-Type", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      exposeHeaders: ["X-Request-Id"],
      maxAge: CORS_MAX_AGE_SECONDS,
      origin: dependencies.trustedBrowserOrigin ? [dependencies.trustedBrowserOrigin] : [],
    }),
  );
  if (dependencies.rateLimit) {
    app.use("/v1/*", createCredentialRateLimitMiddleware(dependencies.rateLimit));
  }

  app.all("/api/auth/*", (context) => dependencies.auth.handler(context.req.raw));
  registerOrganizationRoutes(app, {
    auth: dependencies.auth,
    repository: dependencies.organizationRepository,
  });
  registerApiKeyRoutes(app, {
    auth: dependencies.auth,
    organizationRepository: dependencies.organizationRepository,
    service: dependencies.apiKeyService,
  });
  registerCustomerRoutes(app, {
    auth: dependencies.auth,
    organizationRepository: dependencies.organizationRepository,
    repository: dependencies.customerRepository,
  });
  registerCatalogRoutes(app, {
    auth: dependencies.auth,
    organizationRepository: dependencies.organizationRepository,
    repository: dependencies.catalogRepository,
  });
  registerEntitlementRoutes(app, {
    apiKeyService: dependencies.apiKeyService,
    auth: dependencies.auth,
    metrics: dependencies.observability.metrics,
    organizationRepository: dependencies.organizationRepository,
    repository: dependencies.entitlementRepository,
  });
  registerMeterRoutes(app, {
    auth: dependencies.auth,
    organizationRepository: dependencies.organizationRepository,
    repository: dependencies.meterRepository,
  });
  registerEventRoutes(app, {
    apiKeyService: dependencies.apiKeyService,
    auth: dependencies.auth,
    eventService: dependencies.eventService,
    organizationRepository: dependencies.organizationRepository,
  });
  registerUsageRoutes(app, {
    apiKeyService: dependencies.apiKeyService,
    auth: dependencies.auth,
    organizationRepository: dependencies.organizationRepository,
    repository: dependencies.usageRepository,
  });
  if (dependencies.previewRepository) {
    registerPreviewRoutes(app, {
      auth: dependencies.auth,
      organizationRepository: dependencies.organizationRepository,
      repository: dependencies.previewRepository,
    });
  }
  if (dependencies.simulationRepository) {
    registerSimulationRoutes(app, {
      auth: dependencies.auth,
      organizationRepository: dependencies.organizationRepository,
      repository: dependencies.simulationRepository,
    });
  }
  if (dependencies.operationsRepository) {
    registerOperationsRoutes(app, {
      auth: dependencies.auth,
      organizationRepository: dependencies.organizationRepository,
      repository: dependencies.operationsRepository,
    });
  }
  if (dependencies.retentionRepository) {
    registerRetentionRoutes(app, {
      auth: dependencies.auth,
      organizationRepository: dependencies.organizationRepository,
      repository: dependencies.retentionRepository,
    });
  }
  if (dependencies.jobOperationsRepository) {
    registerJobOperationsRoutes(app, {
      auth: dependencies.auth,
      organizationRepository: dependencies.organizationRepository,
      repository: dependencies.jobOperationsRepository,
    });
  }

  app.get("/openapi.json", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    return context.json(openApiDocument);
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
