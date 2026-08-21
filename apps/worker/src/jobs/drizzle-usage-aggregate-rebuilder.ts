import type { Database } from "@meterpilot/db";
import { meterVersions, usageEvents } from "@meterpilot/db/schema";
import { and, asc, eq, gt, gte, isNotNull, lt } from "drizzle-orm";

import { permanentJobError, retryableJobError } from "./errors";
import type { UsageAggregateRebuilder } from "./usage-aggregate-rebuilder";
import type { UsageEventProcessor } from "./usage-event-processor";

const REBUILD_PAGE_SIZE = 500;

export function createDrizzleUsageAggregateRebuilder(
  database: Database["db"],
  processor: UsageEventProcessor,
): UsageAggregateRebuilder {
  return Object.freeze({
    async rebuild(organizationId, meterVersionId, signal) {
      const [meterVersion] = await database
        .select({
          effectiveFrom: meterVersions.effectiveFrom,
          effectiveTo: meterVersions.effectiveTo,
          eventType: meterVersions.eventType,
        })
        .from(meterVersions)
        .where(
          and(
            eq(meterVersions.organizationId, organizationId),
            eq(meterVersions.id, meterVersionId),
            isNotNull(meterVersions.publishedAt),
          ),
        )
        .limit(1);
      if (!meterVersion) {
        return { status: "not_found" };
      }

      const [redacted] = await database
        .select({ id: usageEvents.id })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, organizationId),
            eq(usageEvents.eventType, meterVersion.eventType),
            gte(usageEvents.occurredAt, meterVersion.effectiveFrom),
            meterVersion.effectiveTo
              ? lt(usageEvents.occurredAt, meterVersion.effectiveTo)
              : undefined,
            isNotNull(usageEvents.propertiesRedactedAt),
          ),
        )
        .limit(1);
      if (redacted) {
        throw permanentJobError(
          "source_properties_redacted",
          "Aggregate rebuild source properties were removed by retention policy.",
        );
      }

      let cursor: string | undefined;
      let eventCount = 0;

      while (true) {
        if (signal.aborted) {
          throw retryableJobError("worker_shutdown", "Worker shutdown interrupted usage rebuild.");
        }

        const events = await database
          .select({ id: usageEvents.id })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.organizationId, organizationId),
              eq(usageEvents.eventType, meterVersion.eventType),
              gte(usageEvents.occurredAt, meterVersion.effectiveFrom),
              meterVersion.effectiveTo
                ? lt(usageEvents.occurredAt, meterVersion.effectiveTo)
                : undefined,
              cursor ? gt(usageEvents.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(usageEvents.id))
          .limit(REBUILD_PAGE_SIZE);

        for (const event of events) {
          const result = await processor.process(organizationId, event.id, signal);
          if (result.status === "not_found") {
            throw permanentJobError(
              "usage_event_not_found",
              "A usage event disappeared during aggregate rebuild.",
            );
          }
          eventCount++;
        }

        if (events.length < REBUILD_PAGE_SIZE) {
          break;
        }
        cursor = events.at(-1)?.id;
        if (!cursor) {
          throw new Error("Usage rebuild pagination did not advance.");
        }
      }

      return { eventCount, status: "rebuilt" };
    },
  });
}
