import { zValidator } from "@hono/zod-validator";
import {
  createInvoicePreviewRequestSchema,
  invoicePreviewListQuerySchema,
  invoicePreviewParamSchema,
  invoicePreviewRevisionParamSchema,
} from "@meterpilot/contracts/previews";
import { cursorPaginationQuerySchema } from "@meterpilot/contracts/common";
import type { Context, Env, Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { InvalidPreviewCursorError } from "./repository";
import type { PreviewMutationResult, PreviewRepository } from "./repository";

export type PreviewRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: PreviewRepository;
}>;

function previewError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<PreviewMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The requested interval is not a complete billing period for this subscription.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot request previews.",
      );
    case "not_found":
      return publicError(context, 404, "not_found", "The requested subscription was not found.");
  }
}

export function registerPreviewRoutes(
  app: Hono<AppEnvironment>,
  dependencies: PreviewRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateParam = zValidator("param", invoicePreviewParamSchema, (result, context) => {
    if (!result.success) {
      return validationError(context, result.error.issues);
    }
  });
  const validateOrganization = zValidator(
    "param",
    invoicePreviewParamSchema.pick({ organizationId: true }),
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );
  const validateRevisionParam = zValidator(
    "param",
    invoicePreviewRevisionParamSchema,
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/invoice-previews",
    requireSession,
    validateOrganization,
    requireTenant,
    zValidator("query", invoicePreviewListQuerySchema, (result, context) => {
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
        if (error instanceof InvalidPreviewCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/invoice-previews",
    requireSession,
    requireSameOrigin,
    validateOrganization,
    requireTenant,
    zValidator("json", createInvoicePreviewRequestSchema, (result, context) => {
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
        return previewError(context, result);
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        { jobId: result.jobId, preview: result.preview, requestId: context.get("requestId") },
        202,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/invoice-previews/:previewId/revisions",
    requireSession,
    validateParam,
    requireTenant,
    zValidator("query", cursorPaginationQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.repository.listRevisions(
          context.get("tenant"),
          context.req.valid("param").previewId,
          context.req.valid("query"),
        );
        if (!page) {
          return publicError(
            context,
            404,
            "not_found",
            "The requested invoice preview was not found.",
          );
        }
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidPreviewCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/invoice-previews/:previewId/revisions/:revision",
    requireSession,
    validateRevisionParam,
    requireTenant,
    async (context) => {
      const param = context.req.valid("param");
      const preview = await dependencies.repository.findRevision(
        context.get("tenant"),
        param.previewId,
        param.revision,
      );
      if (!preview) {
        return publicError(
          context,
          404,
          "not_found",
          "The requested invoice preview revision was not found.",
        );
      }
      context.header("Cache-Control", "no-store");
      return context.json({ preview });
    },
  );

  app.get(
    "/v1/organizations/:organizationId/invoice-previews/:previewId",
    requireSession,
    validateParam,
    requireTenant,
    async (context) => {
      const preview = await dependencies.repository.find(
        context.get("tenant"),
        context.req.valid("param").previewId,
      );
      if (!preview) {
        return publicError(
          context,
          404,
          "not_found",
          "The requested invoice preview was not found.",
        );
      }
      context.header("Cache-Control", "no-store");
      return context.json({ preview });
    },
  );
}
