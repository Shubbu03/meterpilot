CREATE TYPE "job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "usage_event_correction_kind" AS ENUM('reverse', 'replace');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"event_id" uuid,
	"type" varchar(128) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"status" "job_status" DEFAULT 'pending'::"job_status" NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_organization_type_resource_unique" UNIQUE("organization_id","type","resource_type","resource_id"),
	CONSTRAINT "jobs_type_not_empty_check" CHECK (length(trim("type")) > 0),
	CONSTRAINT "jobs_resource_not_empty_check" CHECK (length(trim("resource_type")) > 0 and length(trim("resource_id")) > 0),
	CONSTRAINT "jobs_event_reference_shape_check" CHECK ((
        "event_id" is null
        or (
          "resource_type" = 'usage_event'
          and "resource_id" = "event_id"::text
        )
      )
      and (
        "type" <> 'usage_event.process'
        or "event_id" is not null
      )),
	CONSTRAINT "jobs_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "jobs_lease_shape_check" CHECK ((
        (
          "status" = 'processing'
          and "lease_owner" is not null
          and "lease_expires_at" is not null
          and "completed_at" is null
        )
        or (
          "status" = 'pending'
          and "lease_owner" is null
          and "lease_expires_at" is null
          and "completed_at" is null
        )
        or (
          "status" in ('completed', 'failed')
          and "lease_owner" is null
          and "lease_expires_at" is null
          and "completed_at" is not null
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"event_key" varchar(128) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}' NOT NULL,
	"source" varchar(32) DEFAULT 'api_key' NOT NULL,
	"source_api_key_id" uuid NOT NULL,
	"correction_of_event_id" uuid,
	"correction_kind" "usage_event_correction_kind",
	CONSTRAINT "usage_events_organization_id_event_key_unique" UNIQUE("organization_id","event_key"),
	CONSTRAINT "usage_events_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "usage_events_event_key_format_check" CHECK ("event_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "usage_events_event_type_format_check" CHECK ("event_type" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "usage_events_subject_key_format_check" CHECK ("subject_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "usage_events_payload_hash_format_check" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "usage_events_source_check" CHECK ("source" = 'api_key'),
	CONSTRAINT "usage_events_correction_shape_check" CHECK ((
        ("correction_of_event_id" is null and "correction_kind" is null)
        or (
          "correction_of_event_id" is not null
          and "correction_kind" is not null
          and "correction_of_event_id" <> "id"
        )
      ))
);
--> statement-breakpoint
CREATE INDEX "jobs_available_idx" ON "jobs" ("next_attempt_at","created_at","id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_lease_expiry_idx" ON "jobs" ("lease_expires_at") WHERE "status" = 'processing';--> statement-breakpoint
CREATE INDEX "jobs_organization_status_created_at_idx" ON "jobs" ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_organization_subject_occurred_at_idx" ON "usage_events" ("organization_id","subject_key","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_organization_type_occurred_at_idx" ON "usage_events" ("organization_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_organization_received_at_idx" ON "usage_events" ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "usage_events_corrections_idx" ON "usage_events" ("organization_id","correction_of_event_id") WHERE "correction_of_event_id" is not null;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "usage_events"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_source_api_key_fk" FOREIGN KEY ("organization_id","source_api_key_id") REFERENCES "api_keys"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_correction_event_fk" FOREIGN KEY ("organization_id","correction_of_event_id") REFERENCES "usage_events"("organization_id","id") ON DELETE RESTRICT;