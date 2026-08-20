import { zValidator } from "@hono/zod-validator";
import {
  apiKeyParamSchema,
  createApiKeyRequestSchema,
  cursorPaginationQuerySchema,
  organizationIdParamSchema,
} from "@meterpilot/contracts";
import type { Context, Env, Hono } from "hono";

import { createSessionMiddleware } from "../identity/session-middleware";
import type { AuthGateway } from "../identity/authentication";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidApiKeyCursorError } from "./drizzle-repository";
import type {
  ApiKeyService,
  CreateApiKeyServiceResult,
  RotateApiKeyServiceResult,
} from "./service";

export type ApiKeyRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  service: ApiKeyService;
}>;

function creationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<CreateApiKeyServiceResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "A secure API key could not be allocated. Please retry.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot manage API keys.",
      );
    case "invalid_expiration":
      return publicError(
        context,
        400,
        "validation_error",
        "The API key expiration must be in the future.",
      );
  }
}

function rotationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<RotateApiKeyServiceResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "A secure replacement key could not be allocated. Please retry.",
      );
    case "expired":
      return publicError(context, 409, "conflict", "An expired API key cannot be rotated.");
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot manage API keys.",
      );
    case "not_found":
      return publicError(context, 404, "not_found", "The requested API key was not found.");
    case "revoked":
      return publicError(context, 409, "conflict", "A revoked API key cannot be rotated.");
  }
}

export function registerApiKeyRoutes(
  app: Hono<AppEnvironment>,
  dependencies: ApiKeyRouteDependencies,
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
  const validateApiKeyId = zValidator("param", apiKeyParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validatePagination = zValidator("query", cursorPaginationQuerySchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });

  app.get(
    "/v1/organizations/:organizationId/api-keys",
    requireSession,
    validateOrganizationId,
    requireTenant,
    validatePagination,
    async (context) => {
      try {
        const result = await dependencies.service.list(
          context.get("tenant"),
          context.req.valid("query"),
        );

        if (result.status === "forbidden") {
          return publicError(
            context,
            403,
            "forbidden",
            "Your organization role cannot view API keys.",
          );
        }

        return context.json(result.page);
      } catch (error) {
        if (error instanceof InvalidApiKeyCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }

        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/api-keys",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createApiKeyRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.service.create(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return creationError(context, result);
      }

      context.header("Cache-Control", "no-store");
      return context.json({ ...result.revealed, requestId: context.get("requestId") }, 201);
    },
  );

  app.post(
    "/v1/organizations/:organizationId/api-keys/:apiKeyId/rotate",
    requireSession,
    requireSameOrigin,
    validateApiKeyId,
    requireTenant,
    async (context) => {
      const result = await dependencies.service.rotate(
        context.get("tenant"),
        context.req.param("apiKeyId"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return rotationError(context, result);
      }

      context.header("Cache-Control", "no-store");
      return context.json({ ...result.revealed, requestId: context.get("requestId") }, 201);
    },
  );

  app.post(
    "/v1/organizations/:organizationId/api-keys/:apiKeyId/revoke",
    requireSession,
    requireSameOrigin,
    validateApiKeyId,
    requireTenant,
    async (context) => {
      const result = await dependencies.service.revoke(
        context.get("tenant"),
        context.req.param("apiKeyId"),
        context.get("requestId"),
      );

      if (result.status === "forbidden") {
        return publicError(
          context,
          403,
          "forbidden",
          "Your organization role cannot manage API keys.",
        );
      }

      if (result.status === "not_found") {
        return publicError(context, 404, "not_found", "The requested API key was not found.");
      }

      return context.json({ apiKey: result.apiKey, requestId: context.get("requestId") });
    },
  );
}
