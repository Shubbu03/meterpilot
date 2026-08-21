import { describe, expect, test } from "bun:test";

import {
  attachCustomerSubjectRequestSchema,
  createCustomerRequestSchema,
  customerListQuerySchema,
  customerMutationResponseSchema,
} from "../src/customers";

describe("customer contracts", () => {
  test("accepts bounded cursor pagination for collection reads", () => {
    expect(customerListQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
  });

  test("normalizes a create request and supplies safe defaults", () => {
    expect(
      createCustomerRequestSchema.parse({
        email: "BILLING@EXAMPLE.COM",
        externalKey: "customer_123",
        name: " Acme, Inc. ",
      }),
    ).toEqual({
      billingTimezone: "UTC",
      email: "billing@example.com",
      externalKey: "customer_123",
      metadata: {},
      name: "Acme, Inc.",
      subjects: [],
    });
  });

  test("rejects duplicate and unsafe subject keys", () => {
    expect(
      createCustomerRequestSchema.safeParse({
        externalKey: "customer_123",
        name: "Acme",
        subjects: ["workspace:one", "workspace:one"],
      }).success,
    ).toBe(false);
    expect(attachCustomerSubjectRequestSchema.safeParse({ externalKey: "not safe" }).success).toBe(
      false,
    );
  });

  test("keeps customer data inside the authenticated response shape", () => {
    const response = customerMutationResponseSchema.parse({
      customer: {
        archivedAt: null,
        billingTimezone: "America/New_York",
        createdAt: "2026-08-20T00:00:00.000Z",
        email: null,
        externalKey: "customer_123",
        id: "018f4e55-1df0-7c00-8000-000000000001",
        metadata: { plan: "growth" },
        name: "Acme",
        subjects: [
          {
            createdAt: "2026-08-20T00:00:00.000Z",
            externalKey: "customer_123",
            id: "018f4e55-1df0-7c00-8000-000000000002",
          },
        ],
      },
      requestId: "req_123",
    });

    expect(response.customer.subjects[0]?.externalKey).toBe("customer_123");
  });
});
