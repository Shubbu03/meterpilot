import { z } from "zod";

export const REQUEST_ID_MAX_LENGTH = 128;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(REQUEST_ID_MAX_LENGTH)
  .regex(SAFE_IDENTIFIER_PATTERN, "must contain only safe identifier characters");

export const cursorPaginationQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPaginationQuery = z.output<typeof cursorPaginationQuerySchema>;

export const publicErrorCodeSchema = z.enum([
  "conflict",
  "forbidden",
  "internal_error",
  "not_found",
  "payload_too_large",
  "rate_limited",
  "route_not_found",
  "service_unavailable",
  "unauthorized",
  "validation_error",
]);

export const publicValidationIssueSchema = z.strictObject({
  field: z.string().min(1).max(256),
  message: z.string().min(1).max(512),
});

export type PublicValidationIssue = z.infer<typeof publicValidationIssueSchema>;

export const publicErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: publicErrorCodeSchema,
    details: z.array(publicValidationIssueSchema).max(100).optional(),
    message: z.string().min(1).max(512),
    requestId: requestIdSchema,
  }),
});

export type PublicErrorCode = z.infer<typeof publicErrorCodeSchema>;
export type PublicErrorResponse = z.infer<typeof publicErrorResponseSchema>;

export const healthResponseSchema = z.strictObject({
  service: z.literal("meterpilot-server"),
  status: z.enum(["ok", "degraded"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export function createCursorPageSchema<TItemSchema extends z.ZodType>(itemSchema: TItemSchema) {
  return z.strictObject({
    items: z.array(itemSchema),
    nextCursor: z.string().min(1).max(2048).nullable(),
  });
}

export type CursorPage<TItem> = Readonly<{
  items: readonly TItem[];
  nextCursor: string | null;
}>;
