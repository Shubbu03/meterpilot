import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  createCursorPageSchema,
  cursorPaginationQuerySchema,
  healthResponseSchema,
  publicErrorResponseSchema,
} from "../src/common";

describe("common HTTP contracts", () => {
  test("parses health and stable public errors", () => {
    expect(healthResponseSchema.parse({ service: "meterpilot-server", status: "ok" })).toEqual({
      service: "meterpilot-server",
      status: "ok",
    });

    expect(
      publicErrorResponseSchema.parse({
        error: {
          code: "route_not_found",
          message: "The requested route does not exist.",
          requestId: "request_01",
        },
      }),
    ).toEqual({
      error: {
        code: "route_not_found",
        message: "The requested route does not exist.",
        requestId: "request_01",
      },
    });
  });

  test("rejects unknown error fields that could leak internals", () => {
    expect(
      publicErrorResponseSchema.safeParse({
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
          requestId: "request_02",
          stack: "private stack trace",
        },
      }).success,
    ).toBeFalse();
  });

  test("parses bounded cursor pagination", () => {
    expect(cursorPaginationQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(cursorPaginationQuerySchema.safeParse({ limit: "101" }).success).toBeFalse();

    const pageSchema = createCursorPageSchema(z.strictObject({ id: z.string() }));
    expect(pageSchema.parse({ items: [{ id: "item_01" }], nextCursor: null })).toEqual({
      items: [{ id: "item_01" }],
      nextCursor: null,
    });
  });
});
