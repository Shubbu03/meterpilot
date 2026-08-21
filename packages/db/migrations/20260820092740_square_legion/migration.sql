CREATE TYPE "operation_run_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "reconciliation_finding_kind" AS ENUM('missing', 'unexpected', 'mismatch');--> statement-breakpoint
CREATE TYPE "reconciliation_run_kind" AS ENUM('reconciliation', 'replay');--> statement-breakpoint
CREATE TABLE "billing_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"source_preview_id" uuid NOT NULL,
	"source_preview_revision_id" uuid NOT NULL,
	"source_preview_hash" varchar(64) NOT NULL,
	"source_preview_revision" integer NOT NULL,
	"stripe_customer_id" varchar(255) NOT NULL,
	"status" "operation_run_status" DEFAULT 'pending'::"operation_run_status" NOT NULL,
	"payload" jsonb,
	"content_hash" varchar(64),
	"failure_code" varchar(128),
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "billing_exports_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "billing_exports_preview_hash_check" CHECK ("source_preview_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "billing_exports_preview_revision_check" CHECK ("source_preview_revision" >= 1),
	CONSTRAINT "billing_exports_stripe_customer_check" CHECK ("stripe_customer_id" ~ '^cus_[A-Za-z0-9]+$'),
	CONSTRAINT "billing_exports_result_shape_check" CHECK ((
        "status" = 'pending'
        and "payload" is null
        and "content_hash" is null
        and "failure_code" is null
        and "completed_at" is null
      ) or (
        "status" = 'completed'
        and "payload" is not null
        and "content_hash" ~ '^[a-f0-9]{64}$'
        and "failure_code" is null
        and "completed_at" is not null
      ) or (
        "status" = 'failed'
        and "payload" is null
        and "content_hash" is null
        and length(trim("failure_code")) > 0
        and "completed_at" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"meter_version_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"dimensions_hash" varchar(64) NOT NULL,
	"dimensions" jsonb DEFAULT '{}' NOT NULL,
	"kind" "reconciliation_finding_kind" NOT NULL,
	"expected_quantity" numeric,
	"actual_quantity" numeric,
	"expected_event_count" integer,
	"actual_event_count" integer,
	"repaired" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_findings_run_bucket_unique" UNIQUE("organization_id","run_id","meter_version_id","bucket_start","dimensions_hash"),
	CONSTRAINT "reconciliation_findings_hash_check" CHECK ("dimensions_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "reconciliation_findings_shape_check" CHECK ((
        "kind" = 'missing'
        and "expected_quantity" is not null
        and "expected_event_count" is not null
        and "actual_quantity" is null
        and "actual_event_count" is null
      ) or (
        "kind" = 'unexpected'
        and "expected_quantity" is null
        and "expected_event_count" is null
        and "actual_quantity" is not null
        and "actual_event_count" is not null
      ) or (
        "kind" = 'mismatch'
        and "expected_quantity" is not null
        and "expected_event_count" is not null
        and "actual_quantity" is not null
        and "actual_event_count" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"kind" "reconciliation_run_kind" NOT NULL,
	"customer_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"input_watermark" timestamp with time zone NOT NULL,
	"repair_requested" boolean DEFAULT false NOT NULL,
	"status" "operation_run_status" DEFAULT 'pending'::"operation_run_status" NOT NULL,
	"summary" jsonb,
	"before_hash" varchar(64),
	"after_hash" varchar(64),
	"failure_code" varchar(128),
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "reconciliation_runs_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reconciliation_runs_period_check" CHECK ("period_end" > "period_start"),
	CONSTRAINT "reconciliation_runs_result_shape_check" CHECK ((
        "status" = 'pending'
        and "summary" is null
        and "before_hash" is null
        and "after_hash" is null
        and "failure_code" is null
        and "completed_at" is null
      ) or (
        "status" = 'completed'
        and "summary" is not null
        and "before_hash" ~ '^[a-f0-9]{64}$'
        and "after_hash" ~ '^[a-f0-9]{64}$'
        and "failure_code" is null
        and "completed_at" is not null
      ) or (
        "status" = 'failed'
        and "summary" is null
        and "before_hash" is null
        and "after_hash" is null
        and length(trim("failure_code")) > 0
        and "completed_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD COLUMN "adjustment_of_preview_id" uuid;--> statement-breakpoint
CREATE INDEX "billing_exports_organization_created_at_idx" ON "billing_exports" ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "reconciliation_findings_run_idx" ON "reconciliation_findings" ("organization_id","run_id","id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_organization_created_at_idx" ON "reconciliation_runs" ("organization_id","created_at","id");--> statement-breakpoint
ALTER TABLE "billing_exports" ADD CONSTRAINT "billing_exports_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "billing_exports" ADD CONSTRAINT "billing_exports_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "billing_exports" ADD CONSTRAINT "billing_exports_organization_preview_revision_fk" FOREIGN KEY ("organization_id","source_preview_revision_id") REFERENCES "invoice_previews"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_organization_run_fk" FOREIGN KEY ("organization_id","run_id") REFERENCES "reconciliation_runs"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_organization_meter_version_fk" FOREIGN KEY ("organization_id","meter_version_id") REFERENCES "meter_versions"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organization_meter_fk" FOREIGN KEY ("organization_id","meter_id") REFERENCES "meters"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_adjustment_preview_fk" FOREIGN KEY ("organization_id","adjustment_of_preview_id") REFERENCES "invoice_previews"("organization_id","id") ON DELETE RESTRICT;