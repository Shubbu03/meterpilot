import { zValidator } from "@hono/zod-validator";
import {
  createSimulationRequestSchema,
  simulationListQuerySchema,
  simulationParamSchema,
  simulationResultListQuerySchema,
  simulationReportQuerySchema,
} from "@meterpilot/contracts/simulations";
import type { Context, Env, Hono } from "hono";

import { requireSameOrigin } from "../../http/csrf";
import type { AppEnvironment } from "../../http/environment";
import { publicError, validationError } from "../../http/public-errors";
import type { AuthGateway } from "../identity/authentication";
import { createSessionMiddleware } from "../identity/session-middleware";
import type { OrganizationRepository } from "../organizations/repository";
import { createTenantMiddleware } from "../organizations/tenant-middleware";
import {
  InvalidSimulationCursorError,
  SimulationNotReadyError,
  type SimulationMutationResult,
  type SimulationRepository,
} from "./repository";

export type SimulationRouteDependencies = Readonly<{
  auth: AuthGateway;
  organizationRepository: OrganizationRepository;
  repository: SimulationRepository;
}>;

function simulationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  result: Exclude<SimulationMutationResult, { status: "ok" }>,
) {
  switch (result.status) {
    case "conflict":
      return publicError(
        context,
        409,
        "conflict",
        "The selected plans, currencies, or customer cohort cannot be compared.",
      );
    case "forbidden":
      return publicError(
        context,
        403,
        "forbidden",
        "Your organization role cannot run simulations.",
      );
    case "not_found":
      return publicError(context, 404, "not_found", "A selected plan or customer was not found.");
  }
}

function csvReport(
  results: readonly Readonly<{
    baselineAmountMinor: string | null;
    candidateAmountMinor: string | null;
    customerKey: string;
    deltaMinor: string | null;
    deltaPercent: string | null;
    failureCode: string | null;
    status: "excluded" | "included";
    warningFlags: readonly string[];
  }>[],
): string {
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    "customer_key,status,baseline_amount_minor,candidate_amount_minor,delta_minor,delta_percent,failure_code,warning_flags",
    ...results.map((result) =>
      [
        result.customerKey,
        result.status,
        result.baselineAmountMinor ?? "",
        result.candidateAmountMinor ?? "",
        result.deltaMinor ?? "",
        result.deltaPercent ?? "",
        result.failureCode ?? "",
        result.warningFlags.join("|"),
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return `${rows.join("\n")}\n`;
}

export function registerSimulationRoutes(
  app: Hono<AppEnvironment>,
  dependencies: SimulationRouteDependencies,
) {
  const requireSession = createSessionMiddleware(dependencies.auth);
  const requireTenant = createTenantMiddleware(dependencies.organizationRepository);
  const validateParam = zValidator("param", simulationParamSchema, (result, context) => {
    if (!result.success) return validationError(context, result.error.issues);
  });

  app.post(
    "/v1/organizations/:organizationId/simulations",
    requireSession,
    requireSameOrigin,
    zValidator("param", simulationParamSchema.pick({ organizationId: true }), (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    requireTenant,
    zValidator("json", createSimulationRequestSchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      const result = await dependencies.repository.create(
        context.get("tenant"),
        context.req.valid("json"),
        context.get("requestId"),
      );
      if (result.status !== "ok") return simulationError(context, result);
      return context.json(
        { jobId: result.jobId, requestId: context.get("requestId"), simulation: result.simulation },
        202,
      );
    },
  );

  app.get(
    "/v1/organizations/:organizationId/simulations",
    requireSession,
    zValidator("param", simulationParamSchema.pick({ organizationId: true }), (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    requireTenant,
    zValidator("query", simulationListQuerySchema, (result, context) => {
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
        if (error instanceof InvalidSimulationCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/simulations/:simulationId",
    requireSession,
    validateParam,
    requireTenant,
    async (context) => {
      const simulation = await dependencies.repository.find(
        context.get("tenant"),
        context.req.valid("param").simulationId,
      );
      context.header("Cache-Control", "no-store");
      return simulation
        ? context.json({ simulation })
        : publicError(context, 404, "not_found", "The requested simulation was not found.");
    },
  );

  app.get(
    "/v1/organizations/:organizationId/simulations/:simulationId/customers",
    requireSession,
    validateParam,
    requireTenant,
    zValidator("query", simulationResultListQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      try {
        const result = await dependencies.repository.listResults(
          context.get("tenant"),
          context.req.valid("param").simulationId,
          context.req.valid("query"),
        );
        context.header("Cache-Control", "no-store");
        return result
          ? context.json(result)
          : publicError(context, 404, "not_found", "The requested simulation was not found.");
      } catch (error) {
        if (error instanceof InvalidSimulationCursorError) {
          return publicError(context, 400, "validation_error", error.message);
        }
        if (error instanceof SimulationNotReadyError) {
          return publicError(context, 409, "conflict", error.message);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/organizations/:organizationId/simulations/:simulationId/report",
    requireSession,
    validateParam,
    requireTenant,
    zValidator("query", simulationReportQuerySchema, (result, context) => {
      if (!result.success) return validationError(context, result.error.issues);
    }),
    async (context) => {
      let report: Awaited<ReturnType<SimulationRepository["report"]>>;
      try {
        report = await dependencies.repository.report(
          context.get("tenant"),
          context.req.valid("param").simulationId,
        );
      } catch (error) {
        if (error instanceof SimulationNotReadyError) {
          return publicError(context, 409, "conflict", error.message);
        }
        throw error;
      }
      if (!report) {
        return publicError(context, 404, "not_found", "The requested simulation was not found.");
      }
      const format = context.req.valid("query").format;
      context.header("Cache-Control", "no-store");
      context.header(
        "Content-Disposition",
        `attachment; filename="simulation-${report.simulation.id}.${format}"`,
      );
      return format === "csv"
        ? context.text(csvReport(report.results), 200, {
            "Content-Type": "text/csv; charset=utf-8",
          })
        : context.json(report);
    },
  );
}
