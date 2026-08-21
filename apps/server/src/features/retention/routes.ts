import { zValidator } from "@hono/zod-validator";
import {
  retentionPolicyParamSchema,
  updateRetentionPolicyRequestSchema,
} from "@meterpilot/contracts/retention";
import type { Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import type { RetentionRepository } from "./repository";

export type RetentionRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: RetentionRepository;
}>;

export function registerRetentionRoutes(
  app: Hono<AppEnvironment>,
  dependencies: RetentionRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateOrganization = zValidator(
    "param",
    retentionPolicyParamSchema,
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/retention-policy",
    requireSession,
    validateOrganization,
    requireTenant,
    async (context) => {
      const policy = await dependencies.repository.findPolicy(context.get("tenant"));
      context.header("Cache-Control", "no-store");
      return context.json({ policy });
    },
  );

  app.put(
    "/v1/organizations/:organizationId/retention-policy",
    requireSession,
    requireSameOrigin,
    validateOrganization,
    requireTenant,
    zValidator("json", updateRetentionPolicyRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.updatePolicy(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status === "forbidden") {
        return publicError(
          context,
          403,
          "forbidden",
          "Only organization owners and administrators can change data retention.",
        );
      }
      context.header("Cache-Control", "no-store");
      const response = {
        jobId: result.jobId,
        policy: result.policy,
        requestId: context.get("requestId"),
      };
      return result.jobId ? context.json(response, 202) : context.json(response);
    },
  );
}
