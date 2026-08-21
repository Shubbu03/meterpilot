import { zValidator } from "@hono/zod-validator";
import { cursorPaginationQuerySchema } from "@meterpilot/contracts/common";
import {
  cancelSubscriptionRequestSchema,
  createPlanRequestSchema,
  createPlanVersionRequestSchema,
  createSubscriptionRequestSchema,
  duplicatePlanVersionRequestSchema,
  planParamSchema,
  planVersionParamSchema,
  subscriptionParamSchema,
} from "@meterpilot/contracts/catalog";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import type { Context, Env, Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { InvalidCatalogCursorError } from "./drizzle-repository";
import type {
  CatalogRepository,
  PlanMutationResult,
  PlanVersionMutationResult,
  SubscriptionMutationResult,
} from "./repository";

export type CatalogRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: CatalogRepository;
}>;

function catalogError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<
    PlanMutationResult | PlanVersionMutationResult | SubscriptionMutationResult,
    { status: "ok" }
  >,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The catalog change conflicts with the current resource lifecycle or billing period.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot manage the product catalog.",
      );
    case "not_found":
      return publicError(
        context,
        404,
        "not_found",
        "The requested catalog resource was not found.",
      );
  }
}

export function registerCatalogRoutes(
  app: Hono<AppEnvironment>,
  dependencies: CatalogRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateOrganizationId = zValidator(
    "param",
    organizationIdParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validatePlanParam = zValidator("param", planParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validatePlanVersionParam = zValidator(
    "param",
    planVersionParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateSubscriptionParam = zValidator(
    "param",
    subscriptionParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validatePagination = zValidator("query", cursorPaginationQuerySchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });

  app.get(
    "/v1/organizations/:organizationId/plans",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validatePagination,
    async (context) => {
      try {
        return context.json(
          await dependencies.repository.listPlans(
            context.get("tenant"),
            context.req.valid("query"),
          ),
        );
      } catch (error) {
        if (error instanceof InvalidCatalogCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createPlanRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.createPlan(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json({ plan: result.plan, requestId: context.get("requestId") }, 201);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/plans/:planKey",
    requireSession,
    validatePlanParam,
    requireTenant,
    async (context) => {
      const plan = await dependencies.repository.findPlan(
        context.get("tenant").organization.id,
        context.req.valid("param").planKey,
      );
      if (!plan) {
        return publicError(context, 404, "not_found", "The requested plan was not found.");
      }
      return context.json({ plan });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans/:planKey/versions",
    requireSession,
    requireSameOrigin,
    validatePlanParam,
    requireTenant,
    zValidator("json", createPlanVersionRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.createVersion(
        context.get("tenant"),
        context.req.valid("param").planKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json(
        { planVersion: result.planVersion, requestId: context.get("requestId") },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans/:planKey/versions/:version/publish",
    requireSession,
    requireSameOrigin,
    validatePlanVersionParam,
    requireTenant,
    async (context) => {
      const params = context.req.valid("param");
      const result = await dependencies.repository.publishVersion(
        context.get("tenant"),
        params.planKey,
        params.version,
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json({
        planVersion: result.planVersion,
        requestId: context.get("requestId"),
      });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans/:planKey/versions/:version/duplicate",
    requireSession,
    requireSameOrigin,
    validatePlanVersionParam,
    requireTenant,
    zValidator("json", duplicatePlanVersionRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const params = context.req.valid("param");
      const input = context.req.valid("json");
      const sourcePlan = await dependencies.repository.findPlan(
        context.get("tenant").organization.id,
        params.planKey,
      );
      const sourceVersion = sourcePlan?.versions.find(
        (version) => version.version === params.version,
      );
      if (!sourcePlan || !sourceVersion) {
        return publicError(context, 404, "not_found", "The source plan version was not found.");
      }
      if (sourceVersion.status !== "published") {
        return publicError(
          context,
          409,
          "conflict",
          "Only a published plan version can be duplicated as a candidate.",
        );
      }
      const componentKeys = new Set(
        sourceVersion.components.map((component) => component.componentKey),
      );
      if (Object.keys(input.priceOverrides).some((key) => !componentKeys.has(key))) {
        return publicError(
          context,
          400,
          "validation_error",
          "Every price override must reference a source component.",
        );
      }
      const result = await dependencies.repository.createVersion(
        context.get("tenant"),
        params.planKey,
        {
          components: sourceVersion.components.map((component) => ({
            billingInterval: component.billingInterval,
            componentKey: component.componentKey,
            entitlement: component.entitlement,
            featureKey: component.featureKey,
            price: input.priceOverrides[component.componentKey] ?? component.price,
            rounding: component.rounding,
          })),
          currency: sourceVersion.currency,
          effectiveFrom: input.effectiveFrom,
        },
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json(
        { planVersion: result.planVersion, requestId: context.get("requestId") },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans/:planKey/versions/:version/archive",
    requireSession,
    requireSameOrigin,
    validatePlanVersionParam,
    requireTenant,
    async (context) => {
      const params = context.req.valid("param");
      const result = await dependencies.repository.archiveVersion(
        context.get("tenant"),
        params.planKey,
        params.version,
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json({
        planVersion: result.planVersion,
        requestId: context.get("requestId"),
      });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/plans/:planKey/archive",
    requireSession,
    requireSameOrigin,
    validatePlanParam,
    requireTenant,
    async (context) => {
      const result = await dependencies.repository.archivePlan(
        context.get("tenant"),
        context.req.valid("param").planKey,
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json({ plan: result.plan, requestId: context.get("requestId") });
    },
  );

  app.get(
    "/v1/organizations/:organizationId/subscriptions",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validatePagination,
    async (context) => {
      try {
        return context.json(
          await dependencies.repository.listSubscriptions(
            context.get("tenant"),
            context.req.valid("query"),
          ),
        );
      } catch (error) {
        if (error instanceof InvalidCatalogCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/subscriptions",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createSubscriptionRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.createSubscription(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json(
        { requestId: context.get("requestId"), subscription: result.subscription },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/subscriptions/:subscriptionId/cancel",
    requireSession,
    requireSameOrigin,
    validateSubscriptionParam,
    requireTenant,
    zValidator("json", cancelSubscriptionRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.cancelSubscription(
        context.get("tenant"),
        context.req.valid("param").subscriptionId,
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return catalogError(context, result);
      }
      return context.json({
        requestId: context.get("requestId"),
        subscription: result.subscription,
      });
    },
  );
}
