import { createHash } from "node:crypto";

import {
  MAX_STRIPE_INVOICE_ITEMS,
  stripeInvoiceLineExportFileSchema,
} from "@meterpilot/contracts/operations";
import type { Database } from "@meterpilot/db";
import {
  auditLog,
  billingExports,
  invoicePreviewLines,
  invoicePreviews,
} from "@meterpilot/db/schema";
import { and, asc, eq } from "drizzle-orm";

import type { BillingExportGenerator } from "./billing-export-generator";
import { permanentJobError, retryableJobError } from "./errors";

const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function amount(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw permanentJobError(
      "invalid_export_amount",
      "An invoice preview line does not contain an integer minor-unit amount.",
    );
  }
  const parsed = BigInt(value);
  if (parsed < MIN_SAFE_INTEGER || parsed > MAX_SAFE_INTEGER) {
    throw permanentJobError(
      "export_amount_out_of_range",
      "An invoice preview amount exceeds Stripe-compatible safe integer bounds.",
    );
  }
  return Number(parsed);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createDrizzleBillingExportGenerator(
  database: Database["db"],
  now: () => Date = () => new Date(),
): BillingExportGenerator {
  return Object.freeze({
    async fail(organizationId, exportId, failureCode, requestId) {
      const completedAt = now();
      await database.transaction(async (transaction) => {
        const [failed] = await transaction
          .update(billingExports)
          .set({ completedAt, failureCode, status: "failed" })
          .where(
            and(
              eq(billingExports.organizationId, organizationId),
              eq(billingExports.id, exportId),
              eq(billingExports.status, "pending"),
            ),
          )
          .returning({ id: billingExports.id });
        if (failed) {
          await transaction.insert(auditLog).values({
            action: "billing_export.failed",
            actorType: "system",
            metadata: { failureCode },
            occurredAt: completedAt,
            organizationId,
            requestId,
            resourceId: failed.id,
            resourceType: "billing_export",
          });
        }
      });
    },

    async generate(organizationId, exportId, requestId, signal) {
      if (signal.aborted) {
        throw retryableJobError(
          "worker_shutdown",
          "Worker shutdown interrupted billing export generation.",
        );
      }

      return database.transaction(async (transaction) => {
        const [billingExport] = await transaction
          .select()
          .from(billingExports)
          .where(
            and(eq(billingExports.organizationId, organizationId), eq(billingExports.id, exportId)),
          )
          .for("update")
          .limit(1);
        if (!billingExport) return { status: "not_found" } as const;
        if (billingExport.status !== "pending") return { status: "terminal" } as const;

        const [preview] = await transaction
          .select()
          .from(invoicePreviews)
          .where(
            and(
              eq(invoicePreviews.organizationId, organizationId),
              eq(invoicePreviews.id, billingExport.sourcePreviewRevisionId),
            ),
          )
          .limit(1);
        if (
          !preview ||
          preview.seriesId !== billingExport.sourcePreviewId ||
          preview.revision !== billingExport.sourcePreviewRevision ||
          preview.status !== "completed" ||
          !preview.calculationHash ||
          preview.calculationHash !== billingExport.sourcePreviewHash
        ) {
          throw permanentJobError(
            "source_preview_changed",
            "The immutable source preview no longer matches the requested export.",
          );
        }

        const lines = await transaction
          .select()
          .from(invoicePreviewLines)
          .where(
            and(
              eq(invoicePreviewLines.organizationId, organizationId),
              eq(invoicePreviewLines.previewId, preview.id),
            ),
          )
          .orderBy(asc(invoicePreviewLines.componentKey));
        if (lines.length === 0) {
          throw permanentJobError(
            "source_preview_empty",
            "The source preview contains no invoice lines.",
          );
        }
        if (lines.length > MAX_STRIPE_INVOICE_ITEMS) {
          throw permanentJobError(
            "stripe_item_limit_exceeded",
            `The source preview exceeds Stripe's ${MAX_STRIPE_INVOICE_ITEMS}-item invoice limit.`,
          );
        }

        const payload = stripeInvoiceLineExportFileSchema.parse({
          items: lines.map((line) => ({
            amount: amount(line.amountMinor),
            currency: preview.currency.toLowerCase(),
            customer: billingExport.stripeCustomerId,
            description: `${line.componentKey} usage for ${preview.periodStart.toISOString()} to ${preview.periodEnd.toISOString()}`,
            metadata: {
              meterpilot_component_key: line.componentKey,
              meterpilot_line_hash: line.calculationHash,
              meterpilot_preview_hash: preview.calculationHash,
              meterpilot_preview_id: preview.seriesId,
              meterpilot_preview_revision: String(preview.revision),
              meterpilot_preview_revision_id: preview.id,
            },
          })),
          object: "meterpilot.stripe_invoice_item_batch",
          source: {
            previewHash: preview.calculationHash,
            previewId: preview.seriesId,
            previewRevision: preview.revision,
            previewRevisionId: preview.id,
          },
          version: "2026-08-20",
        });
        const contentHash = hash(payload);
        const completedAt = now();
        await transaction
          .update(billingExports)
          .set({ completedAt, contentHash, payload, status: "completed" })
          .where(
            and(
              eq(billingExports.organizationId, organizationId),
              eq(billingExports.id, exportId),
              eq(billingExports.status, "pending"),
            ),
          );
        await transaction.insert(auditLog).values({
          action: "billing_export.completed",
          actorType: "system",
          metadata: {
            contentHash,
            itemCount: payload.items.length,
            sourcePreviewHash: preview.calculationHash,
          },
          occurredAt: completedAt,
          organizationId,
          requestId,
          resourceId: exportId,
          resourceType: "billing_export",
        });
        return { status: "completed" } as const;
      });
    },
  });
}
