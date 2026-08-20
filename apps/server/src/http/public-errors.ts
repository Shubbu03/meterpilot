import type { PublicErrorCode, PublicValidationIssue } from "@meterpilot/contracts";
import type { Context, Env } from "hono";

type PublicErrorStatus = 400 | 401 | 403 | 404 | 409 | 413;

export function publicError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  status: PublicErrorStatus,
  code: PublicErrorCode,
  message: string,
  details?: readonly PublicValidationIssue[],
) {
  return context.json(
    {
      error: {
        code,
        ...(details ? { details } : {}),
        message,
        requestId: context.get("requestId" as keyof TEnvironment["Variables"]) as string,
      },
    },
    status,
  );
}

export function validationError<TEnvironment extends Env>(
  context: Context<TEnvironment>,
  issues: readonly Readonly<{ message: string; path: readonly PropertyKey[] }>[],
) {
  return publicError(
    context,
    400,
    "validation_error",
    "The request contains invalid data.",
    issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.map(String).join(".") : "request",
      message: issue.message,
    })),
  );
}
