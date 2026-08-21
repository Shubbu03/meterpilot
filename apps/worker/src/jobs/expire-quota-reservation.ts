import { QUOTA_RESERVATION_EXPIRE_JOB_TYPE } from "@meterpilot/db/schema";
import type { MeterPilotMetrics } from "@meterpilot/observability";
import { z } from "zod";

import type { RegisteredJobHandler } from "./dispatcher";
import { permanentJobError, retryableJobError } from "./errors";
import type { QuotaReservationExpirer } from "./quota-reservation-expirer";

const expiryPayloadSchema = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }),
  requestId: z.string().trim().min(1).max(128),
  reservationId: z.uuid(),
});

export function createExpireQuotaReservationHandler(
  options: Readonly<{
    expirer: QuotaReservationExpirer;
    metrics: MeterPilotMetrics;
    now?: () => Date;
    timer?: () => number;
  }>,
): RegisteredJobHandler {
  const now = options.now ?? (() => new Date());
  const timer = options.timer ?? (() => performance.now());

  return Object.freeze({
    async handle(job, context) {
      const payload = expiryPayloadSchema.safeParse(job.payload);
      if (
        !payload.success ||
        job.resourceType !== "quota_reservation" ||
        job.resourceId !== payload.data.reservationId
      ) {
        throw permanentJobError(
          "invalid_job_payload",
          "Stored quota-reservation expiry metadata is invalid.",
        );
      }

      const startedAt = timer();
      const result = await options.expirer.expire(
        job.organizationId,
        payload.data.reservationId,
        now(),
        context.signal,
      );
      if (result.status === "not_found") {
        throw permanentJobError(
          "quota_reservation_not_found",
          "The quota reservation referenced by this job does not exist.",
        );
      }
      if (result.status === "not_due") {
        throw retryableJobError(
          "quota_reservation_not_due",
          "The quota reservation expiry job was claimed before its expiry time.",
        );
      }
      if (result.status === "expired") {
        options.metrics.recordReservation("expired", Math.max(0, timer() - startedAt));
      }
    },
    type: QUOTA_RESERVATION_EXPIRE_JOB_TYPE,
  });
}
