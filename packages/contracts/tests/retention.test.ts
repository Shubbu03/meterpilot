import { describe, expect, test } from "bun:test";

import {
  MAX_EVENT_PROPERTY_RETENTION_DAYS,
  MIN_EVENT_PROPERTY_RETENTION_DAYS,
  retentionPolicyMutationResponseSchema,
  updateRetentionPolicyRequestSchema,
} from "../src/retention";

describe("data retention contracts", () => {
  test("accepts an explicit bounded retention period or disabled policy", () => {
    expect(
      updateRetentionPolicyRequestSchema.parse({
        eventPropertiesRetentionDays: MIN_EVENT_PROPERTY_RETENTION_DAYS,
      }),
    ).toEqual({ eventPropertiesRetentionDays: MIN_EVENT_PROPERTY_RETENTION_DAYS });
    expect(
      updateRetentionPolicyRequestSchema.parse({ eventPropertiesRetentionDays: null }),
    ).toEqual({ eventPropertiesRetentionDays: null });
    expect(
      updateRetentionPolicyRequestSchema.safeParse({
        eventPropertiesRetentionDays: MAX_EVENT_PROPERTY_RETENTION_DAYS + 1,
      }).success,
    ).toBe(false);
  });

  test("represents a first policy update and its durable enforcement job", () => {
    expect(
      retentionPolicyMutationResponseSchema.parse({
        jobId: "bde6a881-6d23-4482-92b4-9804605d1050",
        policy: {
          eventPropertiesRetentionDays: 90,
          organizationId: "f49fab3b-41f0-45e7-a3f2-300d4ae2f910",
          updatedAt: "2026-08-20T10:00:00.000Z",
          updatedBy: "77e12dbe-0cd7-4592-89f2-90c9b4420c17",
          version: 1,
        },
        requestId: "req-retention",
      }).policy.version,
    ).toBe(1);
  });
});
