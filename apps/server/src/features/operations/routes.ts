import { zValidator } from "@hono/zod-validator";
import { cursorPaginationQuerySchema } from "@meterpilot/contracts/common";
import {
  auditLogQuerySchema,
  billingExportListQuerySchema,
  billingExportParamSchema,
  createReconciliationRunRequestSchema,
  createReplayRequestSchema,
  createStripeInvoiceLineExportRequestSchema,
  reconciliationRunListQuerySchema,
  reconciliationRunParamSchema,
} from "@meterpilot/contracts/operations";
import type { Context, Env, Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import {
  BillingExportNotReadyError,
  InvalidOperationsCursorError,
  type BillingExportMutationResult,
  type OperationsRepository,
  type ReconciliationMutationResult,
} from "./repository";

export type OperationsRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: OperationsRepository;
}>;

function reconciliationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<ReconciliationMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The requested operation conflicts with current state.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot run reconciliation operations.",
      );
    case "not_found":
      return publicError(
        context,
        404,
        "not_found",
        "The selected customer or meter was not found.",
      );
  }
}

function exportError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<BillingExportMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "Only a completed immutable invoice preview can be exported.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot create billing exports.",
      );
    case "not_found":
      return publicError(context, 404, "not_found", "The requested invoice preview was not found.");
  }
}

export function registerOperationsRoutes(
  app: Hono<AppEnvironment>,
  dependencies: OperationsRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateRunParam = zValidator("param", reconciliationRunParamSchema, (result, context) => {
    if (!result.success) return validationError(context, result.error.issues);
  });
  const validateExportParam = zValidator("param", billingExportParamSchema, (result, context) => {
    if (!result.success) return validationError(context, result.error.issues);
  });
  const validateOrganizationParam = zValidator(
    "param",
    reconciliationRunParamSchema.pick({ organizationId: true }),
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );

  app.post(
    "/v1/organizations/:organizationId/reconciliation-runs",
    requireSession,
    requireSameOrigin,
    validateOrganizationParam,
    requireTenant,
    zValidator("json", createReconciliationRunRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.createReconciliation(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") return reconciliationError(context, result);
      return context.json(
        { jobId: result.jobId, requestId: context.get("requestId"), run: result.run },
        202,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/reconciliation-runs",
    requireSession,
    validateOrganizationParam,
    requireTenant,
    zValidator("query", reconciliationRunListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.repository.listReconciliations(
          context.get("tenant"),
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidOperationsCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/replays",
    requireSession,
    requireSameOrigin,
    validateOrganizationParam,
    requireTenant,
    zValidator("json", createReplayRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.createReplay(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") return reconciliationError(context, result);
      return context.json(
        { jobId: result.jobId, requestId: context.get("requestId"), run: result.run },
        202,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/exports",
    requireSession,
    validateOrganizationParam,
    requireTenant,
    zValidator("query", billingExportListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const page = await dependencies.repository.listExports(
          context.get("tenant"),
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(page);
      } catch (error) {
        if (error instanceof InvalidOperationsCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/reconciliation-runs/:runId",
    requireSession,
    validateRunParam,
    requireTenant,
    async (context) => {
      const run = await dependencies.repository.findReconciliation(
        context.get("tenant"),
        context.req.valid("param").runId,
      );
      context.header("Cache-Control", "no-store");
      return run
        ? context.json({ run })
        : publicError(context, 404, "not_found", "The requested reconciliation run was not found.");
    },
  );

  app.get(
    "/v1/organizations/:organizationId/reconciliation-runs/:runId/findings",
    requireSession,
    validateRunParam,
    requireTenant,
    zValidator("query", cursorPaginationQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const result = await dependencies.repository.listFindings(
          context.get("tenant"),
          context.req.valid("param").runId,
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return result
          ? context.json(result)
          : publicError(
              context,
              404,
              "not_found",
              "The requested reconciliation run was not found.",
            );
      } catch (error) {
        if (error instanceof InvalidOperationsCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/audit-log",
    requireSession,
    validateOrganizationParam,
    requireTenant,
    zValidator("query", auditLogQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const result = await dependencies.repository.listAudit(
          context.get("tenant"),
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return context.json(result);
      } catch (error) {
        if (error instanceof InvalidOperationsCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/organizations/:organizationId/exports/stripe/invoice-lines",
    requireSession,
    requireSameOrigin,
    validateOrganizationParam,
    requireTenant,
    zValidator("json", createStripeInvoiceLineExportRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.createExport(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") return exportError(context, result);
      context.header("Cache-Control", "no-store");
      return context.json(
        { export: result.export, jobId: result.jobId, requestId: context.get("requestId") },
        202,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/exports/:exportId",
    requireSession,
    validateExportParam,
    requireTenant,
    async (context) => {
      const result = await dependencies.repository.findExport(
        context.get("tenant"),
        context.req.valid("param").exportId,
      );
      context.header("Cache-Control", "no-store");
      return result
        ? context.json({ export: result })
        : publicError(context, 404, "not_found", "The requested billing export was not found.");
    },
  );

  app.get(
    "/v1/organizations/:organizationId/exports/:exportId/download",
    requireSession,
    validateExportParam,
    requireTenant,
    async (context) => {
      try {
        const payload = await dependencies.repository.exportPayload(
          context.get("tenant"),
          context.req.valid("param").exportId,
        );
        if (!payload) {
          return publicError(
            context,
            404,
            "not_found",
            "The requested billing export was not found.",
          );
        }
        context.header("Cache-Control", "no-store");
        context.header(
          "Content-Disposition",
          `attachment; filename="stripe-invoice-items-${context.req.valid("param").exportId}.json"`,
        );
        return context.json(payload);
      } catch (error) {
        if (error instanceof BillingExportNotReadyError) {
          return publicError(context, 409, "conflict", error.message);
        }
        throw error;
      }
    },
  );
}
