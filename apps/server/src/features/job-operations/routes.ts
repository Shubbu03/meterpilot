import { zValidator } from "@hono/zod-validator";
import {
  failedJobListQuerySchema,
  failedJobParamSchema,
  retryFailedJobRequestSchema,
} from "@meterpilot/contracts/jobs";
import type { Context, Env, Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import { InvalidFailedJobCursorError, type JobOperationsRepository } from "./repository";

export type JobOperationsRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: JobOperationsRepository;
}>;

function readError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  status: "forbidden" | "not_found",
) {
  return status === "forbidden"
    ? publicError(
        context,
        403,
        "forbidden",
        "Only organization owners and administrators can inspect failed jobs.",
      )
    : publicError(context, 404, "not_found", "The requested failed job was not found.");
}

export function registerJobOperationsRoutes(
  app: Hono<AppEnvironment>,
  dependencies: JobOperationsRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateParam = zValidator("param", failedJobParamSchema, (result, context) => {
    if (!result.success) return validationError(context, result.error.issues);
  });
  const validateOrganization = zValidator(
    "param",
    failedJobParamSchema.pick({ organizationId: true }),
    (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    },
  );

  app.get(
    "/v1/organizations/:organizationId/failed-jobs",
    requireSession,
    validateOrganization,
    requireTenant,
    zValidator("query", failedJobListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const result = await dependencies.repository.listFailedJobs(
          context.get("tenant"),
          context.req.valid("query"),
        );
        if (result.status !== "ok") return readError(context, result.status);
        context.header("Cache-Control", "no-store");
        return context.json(result.page);
      } catch (error) {
        if (error instanceof InvalidFailedJobCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/failed-jobs/:jobId",
    requireSession,
    validateParam,
    requireTenant,
    async (context) => {
      const result = await dependencies.repository.findFailedJob(
        context.get("tenant"),
        context.req.valid("param").jobId,
      );
      if (result.status !== "ok") return readError(context, result.status);
      context.header("Cache-Control", "no-store");
      return context.json({ job: result.job });
    },
  );

  app.post(
    "/v1/organizations/:organizationId/failed-jobs/:jobId/retry",
    requireSession,
    requireSameOrigin,
    validateParam,
    requireTenant,
    zValidator("json", retryFailedJobRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.retryFailedJob(
        context.get("tenant"),
        context.req.valid("param").jobId,
        context.req.valid("json"),
        context.get("requestId"),
      );
      switch (result.status) {
        case "forbidden":
        case "not_found":
          return readError(context, result.status);
        case "retry_limit":
          return publicError(
            context,
            409,
            "conflict",
            "The failed job reached its manual retry limit.",
          );
        case "not_retryable":
          return publicError(
            context,
            409,
            "conflict",
            "This job failed permanently and cannot be retried safely.",
          );
        case "conflict":
          return publicError(
            context,
            409,
            "conflict",
            "The job failure changed or is no longer eligible for retry. Inspect it again before retrying.",
          );
        case "ok":
          context.header("Cache-Control", "no-store");
          return context.json(
            {
              jobId: result.jobId,
              manualRetryCount: result.manualRetryCount,
              nextAttemptAt: result.nextAttemptAt.toISOString(),
              requestId: context.get("requestId"),
              status: "pending" as const,
            },
            202,
          );
      }
    },
  );
}
