import type { Database } from "@meterpilot/db";
import { rateLimitWindows } from "@meterpilot/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";

import type { RateLimitRepository } from "./repository";

export function createDrizzleRateLimitRepository(database: Database["db"]): RateLimitRepository {
  let consumptionCount = 0;
  return Object.freeze({
    async consume(input) {
      consumptionCount++;
      await database
        .delete(rateLimitWindows)
        .where(
          and(
            eq(rateLimitWindows.keyHash, input.keyHash),
            lte(rateLimitWindows.expiresAt, input.now),
          ),
        );
      if (consumptionCount % 256 === 0) {
        await database.execute(sql`
          with expired as (
            select ${rateLimitWindows.keyHash}, ${rateLimitWindows.windowStart}
            from ${rateLimitWindows}
            where ${rateLimitWindows.expiresAt} <= ${input.now}
            order by ${rateLimitWindows.expiresAt}
            limit 1000
          )
          delete from ${rateLimitWindows}
          using expired
          where ${rateLimitWindows.keyHash} = expired.${sql.identifier("key_hash")}
            and ${rateLimitWindows.windowStart} = expired.${sql.identifier("window_start")}
        `);
      }
      const windowStartMs = Math.floor(input.now.getTime() / input.windowMs) * input.windowMs;
      const windowStart = new Date(windowStartMs);
      const resetAt = new Date(windowStartMs + input.windowMs);
      const expiresAt = new Date(windowStartMs + input.windowMs * 2);
      const [consumed] = await database
        .insert(rateLimitWindows)
        .values({
          expiresAt,
          keyHash: input.keyHash,
          requestCount: 1,
          windowStart,
        })
        .onConflictDoUpdate({
          set: { requestCount: sql`${rateLimitWindows.requestCount} + 1` },
          setWhere: sql`${rateLimitWindows.requestCount} < ${input.limit}`,
          target: [rateLimitWindows.keyHash, rateLimitWindows.windowStart],
        })
        .returning({ requestCount: rateLimitWindows.requestCount });
      if (consumed) {
        return {
          allowed: true,
          limit: input.limit,
          remaining: Math.max(0, input.limit - consumed.requestCount),
          resetAt,
        };
      }

      const [existing] = await database
        .select({ requestCount: rateLimitWindows.requestCount })
        .from(rateLimitWindows)
        .where(
          and(
            eq(rateLimitWindows.keyHash, input.keyHash),
            eq(rateLimitWindows.windowStart, windowStart),
          ),
        )
        .limit(1);
      return {
        allowed: false,
        limit: input.limit,
        remaining: Math.max(0, input.limit - (existing?.requestCount ?? input.limit)),
        resetAt,
      };
    },
  });
}
