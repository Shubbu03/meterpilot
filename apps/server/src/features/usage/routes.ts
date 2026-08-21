import { zValidator } from "@hono/zod-validator";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import { usageQuerySchema } from "@meterpilot/contracts/usage";
import type { Hono } from "hono";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { createApiKeyMiddleware } from "../api-keys/middleware";
import type { ApiKeyService } from "../api-keys/service";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import type { UsageRepository } from "./repository";

export type UsageRouteDependencies = Readonly<{
  apiKeyService: ApiKeyService;
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: UsageRepository;
}>;

export function registerUsageRoutes(
  app: Hono<AppEnvironment>,
  dependencies: UsageRouteDependencies,
) {
  const requireUsageRead = createApiKeyMiddleware(dependencies.apiKeyService, "usage:read");
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateQuery = zValidator("query", usageQuerySchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validateOrganizationId = zValidator(
    "param",
    organizationIdParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );

  app.get("/v1/usage", requireUsageRead, validateQuery, async (context) => {
    const result = await dependencies.repository.getTotal(
      context.get("apiKeyPrincipal").organizationId,
      context.req.valid("query"),
    );
    if (result.status === "not_found") {
      return publicError(context, 404, "not_found", "The requested usage scope was not found.");
    }

    context.header("Cache-Control", "no-store");
    return context.json({ requestId: context.get("requestId"), usage: result.usage });
  });

  app.get("/v1/usage/timeseries", requireUsageRead, validateQuery, async (context) => {
    const result = await dependencies.repository.getTimeseries(
      context.get("apiKeyPrincipal").organizationId,
      context.req.valid("query"),
    );
    if (result.status === "not_found") {
      return publicError(context, 404, "not_found", "The requested usage scope was not found.");
    }

    context.header("Cache-Control", "no-store");
    return context.json({
      customerKey: result.customerKey,
      freshness: result.freshness,
      from: result.from,
      meterKey: result.meterKey,
      points: result.points,
      requestId: context.get("requestId"),
      to: result.to,
    });
  });

  app.get(
    "/v1/organizations/:organizationId/usage",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validateQuery,
    async (context) => {
      const result = await dependencies.repository.getTotal(
        context.get("tenant").organization.id,
        context.req.valid("query"),
      );
      if (result.status === "not_found") {
        return publicError(context, 404, "not_found", "The requested usage scope was not found.");
      }

      context.header("Cache-Control", "no-store");
      return context.json({ requestId: context.get("requestId"), usage: result.usage });
    },
  );

  app.get(
    "/v1/organizations/:organizationId/usage/timeseries",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validateQuery,
    async (context) => {
      const result = await dependencies.repository.getTimeseries(
        context.get("tenant").organization.id,
        context.req.valid("query"),
      );
      if (result.status === "not_found") {
        return publicError(context, 404, "not_found", "The requested usage scope was not found.");
      }

      context.header("Cache-Control", "no-store");
      return context.json({
        customerKey: result.customerKey,
        freshness: result.freshness,
        from: result.from,
        meterKey: result.meterKey,
        points: result.points,
        requestId: context.get("requestId"),
        to: result.to,
      });
    },
  );
}
