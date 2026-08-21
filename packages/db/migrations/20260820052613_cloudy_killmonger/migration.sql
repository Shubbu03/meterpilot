CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"external_key" varchar(128) NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(320),
	"billing_timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "customers_organization_external_key_unique" UNIQUE("organization_id","external_key"),
	CONSTRAINT "customers_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_external_key_format_check" CHECK ("external_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "customers_name_not_empty_check" CHECK (length(trim("name")) > 0),
	CONSTRAINT "customers_billing_timezone_not_empty_check" CHECK (length(trim("billing_timezone")) > 0),
	CONSTRAINT "customers_archived_at_check" CHECK ("archived_at" is null or "archived_at" >= "created_at")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"external_key" varchar(128) NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_organization_external_key_unique" UNIQUE("organization_id","external_key"),
	CONSTRAINT "subjects_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "subjects_external_key_format_check" CHECK ("external_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
);
--> statement-breakpoint
DROP INDEX "usage_buckets_subject_time_idx";--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "customer_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "customer_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" DROP CONSTRAINT "usage_buckets_identity_unique";--> statement-breakpoint
ALTER TABLE "usage_buckets" DROP COLUMN "subject_key";--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_identity_unique" UNIQUE("organization_id","meter_version_id","customer_id","bucket_start","bucket_size","dimensions_hash");--> statement-breakpoint
CREATE INDEX "customers_organization_created_at_idx" ON "customers" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "subjects_organization_customer_idx" ON "subjects" ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "usage_events_organization_customer_occurred_at_idx" ON "usage_events" ("organization_id","customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_buckets_customer_time_idx" ON "usage_buckets" ("organization_id","customer_id","bucket_start");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;