import { zValidator } from "@hono/zod-validator";
import {
  attachCustomerSubjectRequestSchema,
  createCustomerRequestSchema,
  customerListQuerySchema,
  customerParamSchema,
} from "@meterpilot/contracts/customers";
import { organizationIdParamSchema } from "@meterpilot/contracts/organizations";
import type { Context, Env, Hono } from "hono";

import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import { InvalidCustomerCursorError } from "./repository";
import type {
  CustomerMutationResult,
  CustomerRepository,
  CustomerSubjectMutationResult,
} from "./repository";

export type CustomerRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: CustomerRepository;
}>;

function creationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<CustomerMutationResult, { status: "ok" }>,
) {
  if (result.status === "forbidden") {
    return publicError(
      context,
      403,
      "forbidden",
      "Your organization role cannot manage customers.",
    );
  }

  return publicError(
    context,
    409,
    "conflict",
    "That customer or one of its subject keys is already in use.",
  );
}

function subjectError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<CustomerSubjectMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(context, 409, "conflict", "That subject key is already in use.");
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot manage customers.",
      );
    case "not_found":
      return publicError(context, 404, "not_found", "The requested customer was not found.");
  }
}

export function registerCustomerRoutes(
  app: Hono<AppEnvironment>,
  dependencies: CustomerRouteDependencies,
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
  const validateCustomerParam = zValidator("param", customerParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });

  app.get(
    "/v1/organizations/:organizationId/customers",
    requireSession,
    validateOrganizationId,
    requireTenant,
    zValidator("query", customerListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.repository.list(
          context.get("tenant"),
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidCustomerCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/customers",
    requireSession,
    requireSameOrigin,
    validateOrganizationId,
    requireTenant,
    zValidator("json", createCustomerRequestSchema, (result, context) => {
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
        return creationError(context, result);
      }

      context.header("Cache-Control", "no-store");
      return context.json({ customer: result.customer, requestId: context.get("requestId") }, 201);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/customers/:customerKey",
    requireSession,
    validateCustomerParam,
    requireTenant,
    async (context) => {
      const customer = await dependencies.repository.find(
        context.get("tenant").organization.id,
        context.req.valid("param").customerKey,
      );

      if (!customer) {
        return publicError(context, 404, "not_found", "The requested customer was not found.");
      }

      context.header("Cache-Control", "no-store");
      return context.json({ customer });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/customers/:customerKey/subjects",
    requireSession,
    requireSameOrigin,
    validateCustomerParam,
    requireTenant,
    zValidator("json", attachCustomerSubjectRequestSchema, (result, context) => {
      if (!result.success) {
        return validationError(context, result.error.issues);
      }
    }),
    async (context) => {
      const result = await dependencies.repository.attachSubject(
        context.get("tenant"),
        context.req.valid("param").customerKey,
        context.req.valid("json"),
        context.get("requestId"),
      );

      if (result.status !== "ok") {
        return subjectError(context, result);
      }

      context.header("Cache-Control", "no-store");
      return context.json({ requestId: context.get("requestId"), subject: result.subject }, 201);
    },
  );
}
