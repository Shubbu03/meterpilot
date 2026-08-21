import { SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE } from "@meterpilot/db/schema";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { permanentJobError, retryableJobError } from "./errors";
import type { SubscriptionEntitlementRefresher } from "./subscription-entitlement-refresher";

const refreshPayloadSchema = z.strictObject({
  periodStart: z.iso.datetime({ offset: true }),
  requestId: z.string().trim().min(1).max(128),
  subscriptionId: z.uuid(),
});

export function createRefreshSubscriptionEntitlementsHandler(
  options: Readonly<{
    now?: () => Date;
    refresher: SubscriptionEntitlementRefresher;
  }>,
): RegisteredJobHandler {
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async handle(job, context) {
      const payload = refreshPayloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "subscription_period" ||
        job.resourceId !== `${payload.data.subscriptionId}:${payload.data.periodStart}`
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored subscription entitlement refresh metadata is invalid.",
        );
      }
      const periodStart = new Date(payload.data.periodStart);
      if (periodStart > now()) {
        throw retryableJobError(
          "subscription_period_not_due",
          "The subscription entitlement refresh job was claimed before its period started.",
        );
      }

      const result = await options.refresher.refresh(
        job.organizationId,
        payload.data.subscriptionId,
        periodStart,
        payload.data.requestId,
        context.signal,
      );
      if (result.status === "not_found") {
        throw permanentJobError(
          "subscription_not_found",
          "The subscription referenced by this job does not exist.",
        );
      }
      if (result.status === "conflict") {
        throw permanentJobError(
          "entitlement_period_conflict",
          "The subscription period conflicts with an existing entitlement.",
        );
      }
    },
    type: SUBSCRIPTION_ENTITLEMENT_REFRESH_JOB_TYPE,
  });
}
