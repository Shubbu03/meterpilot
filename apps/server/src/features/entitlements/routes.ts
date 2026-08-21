import { zValidator } from "@hono/zod-validator";
import {
  apiCustomerReservationParamSchema,
  apiReservationParamSchema,
  commitQuotaReservationRequestSchema,
  configureEntitlementRequestSchema,
  createQuotaReservationRequestSchema,
  createFeatureRequestSchema,
  createQuotaGrantRequestSchema,
  customerReservationParamSchema,
  entitlementParamSchema,
  featureListQuerySchema,
  reservationParamSchema,
} from "@meterpilot/contracts/entitlements";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import type { MeterPilotMetrics, ReservationOutcome } from "@meterpilot/observability";
import type { Context, Env, Hono } from "hono";

import type { AuthGateway } from "../identity/authentication";
import { createApiKeyMiddleware } from "../api-keys/middleware";
import type { ApiKeyService } from "../api-keys/service";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidFeatureCursorError } from "./repository";
import type {
  EntitlementMutationResult,
  EntitlementRepository,
  FeatureMutationResult,
  QuotaGrantMutationResult,
  QuotaReservationMutationResult,
} from "./repository";

export type EntitlementRouteDependencies = Readonly<{
  apiKeyService: ApiKeyService;
  auth: AuthGateway;
  now?: () => Date;
  metrics: MeterPilotMetrics;
  organizationRepository: OrganizationRepository;
  repository: EntitlementRepository;
  timer?: () => number;
}>;

type MutationFailure = Exclude<
  | EntitlementMutationResult
  | FeatureMutationResult
  | QuotaGrantMutationResult
  | QuotaReservationMutationResult,
  { status: "ok" }
>;

function mutationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: MutationFailure,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The entitlement change conflicts with its current period or mode.",
      );
    case "expired":
      return publicError(context, 409, "reservation_expired", "The quota reservation has expired.");
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot manage entitlements.",
      );
    case "not_found":
      return publicError(
        context,
        404,
        "not_found",
        "The requested customer, feature, or entitlement was not found.",
      );
    case "idempotency_conflict":
      return publicError(
        context,
        409,
        "idempotency_conflict",
        "The idempotency key is already associated with different reservation input.",
      );
    case "over_limit":
      return publicError(
        context,
        409,
        "quota_exceeded",
        "The requested quantity exceeds the currently available hard allowance.",
      );
  }
}

export function registerEntitlementRoutes(
  app: Hono<AppEnvironment>,
  dependencies: EntitlementRouteDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const timer = dependencies.timer ?? (() => performance.now());
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireReservationKey = createApiKeyMiddleware(
    dependencies.apiKeyService,
    "reservations:write",
  );
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
  const validateEntitlementParam = zValidator(
    "param",
    entitlementParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateCustomerReservationParam = zValidator(
    "param",
    customerReservationParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateReservationParam = zValidator(
    "param",
    reservationParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateApiCustomerReservationParam = zValidator(
    "param",
    apiCustomerReservationParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateApiReservationParam = zValidator(
    "param",
    apiReservationParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/features",
    requireSession,
    validateOrganizationId,
    requireTenant,
    zValidator("query", featureListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.repository.listFeatures(
          context.get("tenant"),
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidFeatureCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/features",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createFeatureRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.createFeature(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      return context.json({ feature: result.feature, requestId: context.get("requestId") }, 201);
    },
  );

  app.post(
    "/v1/customers/:customerKey/reservations",
    requireReservationKey,
    validateApiCustomerReservationParam,
    zValidator("json", createQuotaReservationRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const startedAt = timer();
      const result = await dependencies.repository.reserve(
        context.get("apiKeyPrincipal"),
        context.req.valid("param").customerKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      const outcome: ReservationOutcome =
        result.status === "ok"
          ? "reserved"
          : result.status === "over_limit"
            ? "over_limit"
            : result.status === "expired"
              ? "expired"
              : "conflict";
      dependencies.metrics.recordReservation(outcome, Math.max(0, timer() - startedAt));
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        {
          entitlement: result.entitlement,
          requestId: context.get("requestId"),
          reservation: result.reservation,
        },
        201,
      );
    },
  );

  app.post(
    "/v1/reservations/:reservationId/commit",
    requireReservationKey,
    validateApiReservationParam,
    zValidator("json", commitQuotaReservationRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const startedAt = timer();
      const result = await dependencies.repository.commitReservation(
        context.get("apiKeyPrincipal"),
        context.req.valid("param").reservationId,
        context.req.valid("json"),
        context.get("requestId"),
      );
      dependencies.metrics.recordReservation(
        result.status === "ok" ? "committed" : result.status === "expired" ? "expired" : "conflict",
        Math.max(0, timer() - startedAt),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json({
        entitlement: result.entitlement,
        requestId: context.get("requestId"),
        reservation: result.reservation,
      });
    },
  );

  app.post(
    "/v1/reservations/:reservationId/release",
    requireReservationKey,
    validateApiReservationParam,
    async (context) => {
      const startedAt = timer();
      const result = await dependencies.repository.releaseReservation(
        context.get("apiKeyPrincipal"),
        context.req.valid("param").reservationId,
        context.get("requestId"),
      );
      dependencies.metrics.recordReservation(
        result.status === "ok" ? "released" : result.status === "expired" ? "expired" : "conflict",
        Math.max(0, timer() - startedAt),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json({
        entitlement: result.entitlement,
        requestId: context.get("requestId"),
        reservation: result.reservation,
      });
    },
  );

  app.put(
    "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey",
    requireSession,
    requireSameOrigin,
    validateEntitlementParam,
    requireTenant,
    zValidator("json", configureEntitlementRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const params = context.req.valid("param");
      const result = await dependencies.repository.configure(
        context.get("tenant"),
        params.customerKey,
        params.featureKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        { entitlement: result.entitlement, requestId: context.get("requestId") },
        201,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey",
    requireSession,
    validateEntitlementParam,
    requireTenant,
    async (context) => {
      const params = context.req.valid("param");
      const startedAt = timer();
      const entitlement = await dependencies.repository.findBalance(
        context.get("tenant").organization.id,
        params.customerKey,
        params.featureKey,
        now(),
      );
      dependencies.metrics.recordEntitlementCheck(Math.max(0, timer() - startedAt));
      if (!entitlement) {
        return publicError(context, 404, "not_found", "The requested entitlement was not found.");
      }
      context.header("Cache-Control", "no-store");
      return context.json({ entitlement, requestId: context.get("requestId") });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/customers/:customerKey/entitlements/:featureKey/grants",
    requireSession,
    requireSameOrigin,
    validateEntitlementParam,
    requireTenant,
    zValidator("json", createQuotaGrantRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const params = context.req.valid("param");
      const result = await dependencies.repository.addGrant(
        context.get("tenant"),
        params.customerKey,
        params.featureKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        {
          entitlement: result.entitlement,
          grant: result.grant,
          requestId: context.get("requestId"),
        },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/customers/:customerKey/reservations",
    requireSession,
    requireSameOrigin,
    validateCustomerReservationParam,
    requireTenant,
    zValidator("json", createQuotaReservationRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const params = context.req.valid("param");
      const startedAt = timer();
      const result = await dependencies.repository.reserve(
        context.get("tenant"),
        params.customerKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      const outcome: ReservationOutcome =
        result.status === "ok"
          ? "reserved"
          : result.status === "over_limit"
            ? "over_limit"
            : result.status === "expired"
              ? "expired"
              : "conflict";
      dependencies.metrics.recordReservation(outcome, Math.max(0, timer() - startedAt));
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        {
          entitlement: result.entitlement,
          requestId: context.get("requestId"),
          reservation: result.reservation,
        },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/reservations/:reservationId/commit",
    requireSession,
    requireSameOrigin,
    validateReservationParam,
    requireTenant,
    zValidator("json", commitQuotaReservationRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const startedAt = timer();
      const result = await dependencies.repository.commitReservation(
        context.get("tenant"),
        context.req.valid("param").reservationId,
        context.req.valid("json"),
        context.get("requestId"),
      );
      dependencies.metrics.recordReservation(
        result.status === "ok" ? "committed" : result.status === "expired" ? "expired" : "conflict",
        Math.max(0, timer() - startedAt),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json({
        entitlement: result.entitlement,
        requestId: context.get("requestId"),
        reservation: result.reservation,
      });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/reservations/:reservationId/release",
    requireSession,
    requireSameOrigin,
    validateReservationParam,
    requireTenant,
    async (context) => {
      const startedAt = timer();
      const result = await dependencies.repository.releaseReservation(
        context.get("tenant"),
        context.req.valid("param").reservationId,
        context.get("requestId"),
      );
      dependencies.metrics.recordReservation(
        result.status === "ok" ? "released" : result.status === "expired" ? "expired" : "conflict",
        Math.max(0, timer() - startedAt),
      );
      if (result.status !== "ok") {
        return mutationError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json({
        entitlement: result.entitlement,
        requestId: context.get("requestId"),
        reservation: result.reservation,
      });
    },
  );
}
