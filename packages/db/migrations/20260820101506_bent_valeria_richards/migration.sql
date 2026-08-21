CREATE TABLE "data_retention_policies" (
	"organization_id" uuid,
	"event_properties_retention_days" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_retention_policies_pk" PRIMARY KEY("organization_id"),
	CONSTRAINT "data_retention_policies_days_check" CHECK ("event_properties_retention_days" is null or "event_properties_retention_days" between 30 and 3650),
	CONSTRAINT "data_retention_policies_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "properties_redacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "usage_events_retention_eligible_idx" ON "usage_events" ("organization_id","received_at","id") WHERE "properties_redacted_at" is null;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_properties_redaction_check" CHECK ("properties_redacted_at" is null or (
        "properties_redacted_at" >= "received_at"
        and "properties" = '{}'::jsonb
      ));--> statement-breakpoint
DROP TRIGGER "usage_events_immutable" ON "usage_events";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_usage_events"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD."properties_redacted_at" IS NULL
		AND NEW."properties_redacted_at" IS NOT NULL
		AND NEW."properties" = '{}'::jsonb
		AND ROW(
			NEW."id", NEW."organization_id", NEW."event_key", NEW."payload_hash",
			NEW."event_type", NEW."subject_key", NEW."customer_id", NEW."occurred_at",
			NEW."received_at", NEW."source", NEW."source_api_key_id",
			NEW."correction_of_event_id", NEW."correction_kind"
		) IS NOT DISTINCT FROM ROW(
			OLD."id", OLD."organization_id", OLD."event_key", OLD."payload_hash",
			OLD."event_type", OLD."subject_key", OLD."customer_id", OLD."occurred_at",
			OLD."received_at", OLD."source", OLD."source_api_key_id",
			OLD."correction_of_event_id", OLD."correction_kind"
		) THEN
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'usage events are immutable; only one-way property redaction or an appended correction is allowed' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "usage_events_immutable"
	BEFORE UPDATE OR DELETE ON "usage_events"
	FOR EACH ROW EXECUTE FUNCTION "protect_usage_events"();
