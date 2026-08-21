CREATE TYPE "quota_reservation_status" AS ENUM('pending', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "quota_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"requested_quantity" numeric NOT NULL,
	"committed_quantity" numeric,
	"status" "quota_reservation_status" DEFAULT 'pending'::"quota_reservation_status" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "quota_reservations_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quota_reservations_organization_entitlement_key_unique" UNIQUE("organization_id","entitlement_id","idempotency_key"),
	CONSTRAINT "quota_reservations_idempotency_key_format_check" CHECK ("idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "quota_reservations_quantity_check" CHECK ("requested_quantity" > 0 and ("committed_quantity" is null or ("committed_quantity" > 0 and "committed_quantity" <= "requested_quantity"))),
	CONSTRAINT "quota_reservations_expiry_check" CHECK ("expires_at" > "created_at"),
	CONSTRAINT "quota_reservations_state_check" CHECK ((
        "status" = 'pending'
        and "committed_quantity" is null
        and "completed_at" is null
      ) or (
        "status" = 'committed'
        and "committed_quantity" is not null
        and "completed_at" is not null
      ) or (
        "status" in ('released', 'expired')
        and "committed_quantity" is null
        and "completed_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "source_api_key_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "quota_reservations_expiry_idx" ON "quota_reservations" ("expires_at","id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "quota_reservations_entitlement_status_idx" ON "quota_reservations" ("organization_id","entitlement_id","status");--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_organization_entitlement_fk" FOREIGN KEY ("organization_id","entitlement_id") REFERENCES "entitlements"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_hard_limit_check" CHECK ("mode" <> 'hard' or "committed_quantity" + "reserved_quantity" <= "granted_quantity");--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_source_check", ADD CONSTRAINT "usage_events_source_check" CHECK ((
        "source" = 'api_key' and "source_api_key_id" is not null
      ) or (
        "source" = 'quota_reservation' and "source_api_key_id" is null
      ));