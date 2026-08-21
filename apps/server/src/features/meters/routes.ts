import { zValidator } from "@hono/zod-validator";
import { cursorPaginationQuerySchema } from "@meterpilot/contracts/common";
import {
  createMeterRequestSchema,
  createMeterVersionRequestSchema,
  meterParamSchema,
  meterVersionParamSchema,
} from "@meterpilot/contracts/meters";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import type { Context, Env, Hono } from "hono";

import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidMeterCursorError } from "./drizzle-repository";
import type {
  MeterMutationResult,
  MeterPublishResult,
  MeterRepository,
  MeterVersionMutationResult,
} from "./repository";

export type MeterRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: MeterRepository;
}>;

function meterError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<MeterMutationResult | MeterVersionMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The meter change conflicts with its current lifecycle state.",
      );
    case "forbidden":
      return publicError(context, 403, "forbidden", "Your organization role cannot manage meters.");
    case "not_found":
      return publicError(context, 404, "not_found", "The requested meter was not found.");
  }
}

function publishError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<MeterPublishResult, { status: "ok" }>,
) {
  return meterError(context, result);
}

export function registerMeterRoutes(
  app: Hono<AppEnvironment>,
  dependencies: MeterRouteDependencies,
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
  const validateMeterParam = zValidator("param", meterParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validateMeterVersionParam = zValidator(
    "param",
    meterVersionParamSchema,
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
    "/v1/organizations/:organizationId/meters",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validatePagination,
    async (context) => {
      try {
        return context.json(
          await dependencies.repository.list(context.get("tenant"), context.req.valid("query")),
        );
      } catch (error) {
        if (error instanceof InvalidMeterCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/meters",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createMeterRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.create(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return meterError(context, result);
      }
      return context.json({ meter: result.meter, requestId: context.get("requestId") }, 201);
    },
  );

  app.post(
    "/v1/organizations/:organizationId/meters/:meterKey/versions",
    requireSession,
    requireSameOrigin,
    validateMeterParam,
    requireTenant,
    zValidator("json", createMeterVersionRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.createVersion(
        context.get("tenant"),
        context.req.valid("param").meterKey,
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return meterError(context, result);
      }
      return context.json(
        { meterVersion: result.meterVersion, requestId: context.get("requestId") },
        201,
      );
    },
  );

  app.post(
    "/v1/organizations/:organizationId/meters/:meterKey/versions/:version/publish",
    requireSession,
    requireSameOrigin,
    validateMeterVersionParam,
    requireTenant,
    async (context) => {
      const params = context.req.valid("param");
      const result = await dependencies.repository.publish(
        context.get("tenant"),
        params.meterKey,
        params.version,
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return publishError(context, result);
      }
      return context.json({
        meterVersion: result.meterVersion,
        rebuildJobId: result.rebuildJobId,
        requestId: context.get("requestId"),
      });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/meters/:meterKey/archive",
    requireSession,
    requireSameOrigin,
    validateMeterParam,
    requireTenant,
    async (context) => {
      const result = await dependencies.repository.archive(
        context.get("tenant"),
        context.req.valid("param").meterKey,
        context.get("requestId"),
      );
      if (result.status !== "ok") {
        return meterError(context, result);
      }
      return context.json({ meter: result.meter, requestId: context.get("requestId") });
    },
  );
}
