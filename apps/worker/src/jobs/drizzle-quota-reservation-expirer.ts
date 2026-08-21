import type { Database } from "@meterpilot/db";
import { auditLog, entitlements, quotaReservations } from "@meterpilot/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { retryableJobError } from "./errors";
import type { QuotaReservationExpirer } from "./quota-reservation-expirer";

export function createDrizzleQuotaReservationExpirer(
  database: Database["db"],
): QuotaReservationExpirer {
  return Object.freeze({
    async expire(organizationId, reservationId, at, signal) {
      if (signal.aborted) {
        throw retryableJobError(
          "worker_shutdown",
          "Worker shutdown interrupted reservation expiry.",
        );
      }

      return database.transaction(async (transaction) => {
        const [reservation] = await transaction
          .select()
          .from(quotaReservations)
          .where(
            and(
              eq(quotaReservations.organizationId, organizationId),
              eq(quotaReservations.id, reservationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!reservation) {
          return { status: "not_found" } as const;
        }
        if (reservation.status !== "pending") {
          return { status: "terminal" } as const;
        }
        if (reservation.expiresAt > at) {
          return { expiresAt: reservation.expiresAt, status: "not_due" } as const;
        }

        await transaction
          .select({ id: entitlements.id })
          .from(entitlements)
          .where(
            and(
              eq(entitlements.organizationId, organizationId),
              eq(entitlements.id, reservation.entitlementId),
            ),
          )
          .for("update")
          .limit(1);
        if (signal.aborted) {
          throw retryableJobError(
            "worker_shutdown",
            "Worker shutdown interrupted reservation expiry.",
          );
        }

        const [expired] = await transaction
          .update(quotaReservations)
          .set({ completedAt: at, status: "expired" })
          .where(
            and(
              eq(quotaReservations.organizationId, organizationId),
              eq(quotaReservations.id, reservationId),
              eq(quotaReservations.status, "pending"),
            ),
          )
          .returning({ id: quotaReservations.id });
        if (!expired) {
          return { status: "terminal" } as const;
        }
        await transaction
          .update(entitlements)
          .set({
            reservedQuantity: sql`${entitlements.reservedQuantity} - ${reservation.requestedQuantity}::numeric`,
            updatedAt: at,
            version: sql`${entitlements.version} + 1`,
          })
          .where(
            and(
              eq(entitlements.organizationId, organizationId),
              eq(entitlements.id, reservation.entitlementId),
            ),
          );
        await transaction.insert(auditLog).values({
          action: "quota_reservation.expired",
          actorType: "system",
          organizationId,
          resourceId: reservationId,
          resourceType: "quota_reservation",
        });

        return { status: "expired" } as const;
      });
    },
  });
}
