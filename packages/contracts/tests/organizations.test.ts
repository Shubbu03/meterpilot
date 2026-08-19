import { describe, expect, test } from "bun:test";

import {
  addOrganizationMemberRequestSchema,
  createOrganizationRequestSchema,
  organizationIdParamSchema,
} from "../src/organizations";

describe("organization contracts", () => {
  test("normalizes valid creation input and defaults the timezone", () => {
    expect(
      createOrganizationRequestSchema.parse({
        name: "  Acme Incorporated  ",
        slug: "acme-inc",
      }),
    ).toEqual({
      defaultTimezone: "UTC",
      name: "Acme Incorporated",
      slug: "acme-inc",
    });
  });

  test("rejects unsafe slugs and unknown fields", () => {
    expect(
      createOrganizationRequestSchema.safeParse({ name: "Acme", slug: "Acme Inc" }).success,
    ).toBe(false);
    expect(
      createOrganizationRequestSchema.safeParse({
        extra: true,
        name: "Acme",
        slug: "acme",
      }).success,
    ).toBe(false);
  });

  test("requires UUID organization identifiers", () => {
    expect(organizationIdParamSchema.safeParse({ organizationId: "org_acme" }).success).toBe(false);
  });

  test("normalizes member email addresses", () => {
    expect(
      addOrganizationMemberRequestSchema.parse({
        email: "OWNER@EXAMPLE.COM",
        role: "owner",
      }),
    ).toEqual({ email: "owner@example.com", role: "owner" });
  });
});
