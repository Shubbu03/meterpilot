import { sql, type SQL } from "drizzle-orm";

import { usageEvents } from "./schema/events";

/**
 * Selects the terminal, billable event in every append-only correction chain.
 * A receive-time watermark keeps historical previews and simulations reproducible:
 * corrections received later than that snapshot do not suppress their target.
 */
export function effectiveUsageEventPredicate(receivedAtOrBefore?: Date): SQL<boolean> {
  const correctionWatermark = receivedAtOrBefore
    ? sql`and correction.received_at <= ${receivedAtOrBefore}`
    : sql``;

  return sql<boolean>`
    ${usageEvents.correctionKind} is distinct from 'reverse'
    and not exists (
      select 1
      from usage_events correction
      where correction.organization_id = ${usageEvents.organizationId}
        and correction.correction_of_event_id = ${usageEvents.id}
        ${correctionWatermark}
    )
  `;
}
