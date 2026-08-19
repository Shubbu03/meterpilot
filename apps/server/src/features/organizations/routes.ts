import { zValidator } from "@hono/zod-validator";
import {
  addOrganizationMemberRequestSchema,
  createOrganizationRequestSchema,
  cursorPaginationQuerySchema,
  organizationIdParamSchema,
  organizationMemberParamSchema,
  updateOrganizationMemberRequestSchema,
} from "@meterpilot/contracts";
import type { Context, Env, Hono } from "hono";

import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { AppEnvironment } from "../../http/environment";
import { requireSameOrigin } from "../../http/csrf";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidPaginationCursorError } from "./drizzle-repository";
import type {
  MembershipMutationResult,
  MembershipRemovalResult,
  OrganizationRepository,
} from "./repository";
import { createTenantMiddleware } from "./tenant-middleware";

export type OrganizationRouteDependencies = Readonly<{
  auth: AuthGateway;
  repository: OrganizationRepository;
}>;

function mutationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<MembershipMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(context, 409, "conflict", "That user is already a member.");
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot perform this membership change.",
      );
    case "last_owner":
      return publicError(context, 409, "conflict", "An organization must retain an owner.");
    case "not_found":
      return publicError(
        context,
        404,
        "not_found",
        "The requested user or membership was not found.",
      );
  }
}

function removalError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<MembershipRemovalResult, { status: "ok" }>,
) {
  return mutationError(context, result);
}

export function registerOrganizationRoutes(
  app: Hono<AppEnvironment>,
  dependencies: OrganizationRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.repository);
  const validateOrganizationId = zValidator(
    "param",
    organizationIdParamSchema,
    (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    },
  );
  const validateMemberId = zValidator("param", organizationMemberParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validatePagination = zValidator("query", cursorPaginationQuerySchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });

  app.get("/v1/organizations", requireSession, validatePagination, async (context) => {
    const session = context.get("authenticatedSession");

    try {
      return context.json(
        await dependencies.repository.listOrganizations(
          session.user.id,
          context.req.valid("query"),
        ),
      );
    } catch (error) {
      if (error instanceof InvalidPaginationCursorError) {
        return publicError(context, 400, "validation_error", error.message);
      }

      throw error;
    }
  });

  app.post(
    "/v1/organizations",
    requireSession,
    requireSameOrigin,
    zValidator("json", createOrganizationRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const session = context.get("authenticatedSession");
      const created = await dependencies.repository.createOrganization(
        session.user,
        context.req.valid("json"),
        context.get("requestId"),
      );

      if (!created) {
        return publicError(context, 409, "conflict", "That organization slug is already in use.");
      }

      return context.json(
        {
          ...created,
          requestId: context.get("requestId"),
        },
        201,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId",
    requireSession,
    validateOrganizationId,
    requireTenant,
    (context) => {
      const tenant = context.get("tenant");
      return context.json({
        membership: tenant.membership,
        organization: tenant.organization,
      });
    },
  );

  app.get(
    "/v1/organizations/:organizationId/members",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validatePagination,
    async (context) => {
      try {
        return context.json(
          await dependencies.repository.listMemberships(
            context.get("tenant"),
            context.req.valid("query"),
          ),
        );
      } catch (error) {
        if (error instanceof InvalidPaginationCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }

        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/members",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", addOrganizationMemberRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.addMembership(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return mutationError(context, result);
      }

      return context.json(
        { membership: result.membership, requestId: context.get("requestId") },
        201,
      );
    },
  );

  app.patch(
    "/v1/organizations/:organizationId/members/:userId",
    requireSession,
    requireSameOrigin,
    validateMemberId,
    requireTenant,
    zValidator("json", updateOrganizationMemberRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.updateMembership(
        context.get("tenant"),
        context.req.param("userId"),
        context.req.valid("json"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return mutationError(context, result);
      }

      return context.json({
        membership: result.membership,
        requestId: context.get("requestId"),
      });
    },
  );

  app.delete(
    "/v1/organizations/:organizationId/members/:userId",
    requireSession,
    requireSameOrigin,
    validateMemberId,
    requireTenant,
    async (context) => {
      const result = await dependencies.repository.removeMembership(
        context.get("tenant"),
        context.req.param("userId"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return removalError(context, result);
      }

      return context.json({ requestId: context.get("requestId") });
    },
  );
}
