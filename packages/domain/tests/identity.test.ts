import { describe, expect, test } from "bun:test";

import { customerId, organizationId, tenantContext } from "../src/identity";

describe("tenant identity", () => {
  test("requires a non-optional organization context", () => {
    const context = tenantContext(organizationId("org_acme"));

    expect(String(context.organizationId)).toBe("org_acme");
    expect(Object.isFrozen(context)).toBeTrue();
  });

  test("keeps branded identifiers valid at construction", () => {
    expect(String(customerId(" customer_acme "))).toBe("customer_acme");
    expect(() => organizationId("../other-tenant")).toThrow("OrganizationId");
  });
});
