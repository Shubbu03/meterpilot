CREATE TYPE "invoice_preview_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "invoice_preview_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"plan_component_id" uuid NOT NULL,
	"component_key" varchar(128) NOT NULL,
	"quantity" numeric NOT NULL,
	"meter_version_ids" jsonb DEFAULT '[]' NOT NULL,
	"pricing_trace" jsonb NOT NULL,
	"source_buckets" jsonb DEFAULT '[]' NOT NULL,
	"pre_round_amount" numeric NOT NULL,
	"rounded_amount" numeric NOT NULL,
	"amount_minor" numeric NOT NULL,
	"calculation_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_preview_lines_organization_preview_component_unique" UNIQUE("organization_id","preview_id","plan_component_id"),
	CONSTRAINT "invoice_preview_lines_quantity_check" CHECK ("quantity" >= 0),
	CONSTRAINT "invoice_preview_lines_hash_check" CHECK ("calculation_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "invoice_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"series_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"revision" integer NOT NULL,
	"status" "invoice_preview_status" DEFAULT 'pending'::"invoice_preview_status" NOT NULL,
	"input_snapshot" jsonb DEFAULT '{}' NOT NULL,
	"subtotal_minor" numeric,
	"currency" varchar(3) NOT NULL,
	"calculation_hash" varchar(64),
	"failure_code" varchar(64),
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "invoice_previews_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_previews_organization_series_revision_unique" UNIQUE("organization_id","series_id","revision"),
	CONSTRAINT "invoice_previews_period_check" CHECK ("period_end" > "period_start"),
	CONSTRAINT "invoice_previews_revision_check" CHECK ("revision" >= 1),
	CONSTRAINT "invoice_previews_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoice_previews_result_shape_check" CHECK ((
        "status" = 'pending'
        and "subtotal_minor" is null
        and "calculation_hash" is null
        and "failure_code" is null
        and "completed_at" is null
      ) or (
        "status" = 'completed'
        and "subtotal_minor" is not null
        and "calculation_hash" ~ '^[a-f0-9]{64}$'
        and "failure_code" is null
        and "completed_at" is not null
      ) or (
        "status" = 'failed'
        and "subtotal_minor" is null
        and "calculation_hash" is null
        and length(trim("failure_code")) > 0
        and "completed_at" is not null
      ))
);
--> statement-breakpoint
CREATE INDEX "invoice_preview_lines_preview_idx" ON "invoice_preview_lines" ("organization_id","preview_id");--> statement-breakpoint
CREATE INDEX "invoice_previews_series_latest_idx" ON "invoice_previews" ("organization_id","series_id","revision");--> statement-breakpoint
CREATE INDEX "invoice_previews_customer_period_idx" ON "invoice_previews" ("organization_id","customer_id","period_start","period_end");--> statement-breakpoint
ALTER TABLE "invoice_preview_lines" ADD CONSTRAINT "invoice_preview_lines_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_preview_lines" ADD CONSTRAINT "invoice_preview_lines_organization_preview_fk" FOREIGN KEY ("organization_id","preview_id") REFERENCES "invoice_previews"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_preview_lines" ADD CONSTRAINT "invoice_preview_lines_organization_component_fk" FOREIGN KEY ("organization_id","plan_component_id") REFERENCES "plan_components"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_subscription_fk" FOREIGN KEY ("organization_id","subscription_id") REFERENCES "subscriptions"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_plan_version_fk" FOREIGN KEY ("organization_id","plan_version_id") REFERENCES "plan_versions"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION "protect_invoice_preview_revisions"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'invoice preview revisions are immutable' USING ERRCODE = '55000';
	END IF;

	IF ROW(
		NEW."id", NEW."series_id", NEW."organization_id", NEW."customer_id",
		NEW."subscription_id", NEW."plan_version_id", NEW."period_start", NEW."period_end",
		NEW."revision", NEW."currency", NEW."requested_by", NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id", OLD."series_id", OLD."organization_id", OLD."customer_id",
		OLD."subscription_id", OLD."plan_version_id", OLD."period_start", OLD."period_end",
		OLD."revision", OLD."currency", OLD."requested_by", OLD."created_at"
	) OR NEW."status" NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'pending invoice previews may only transition to a terminal result' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "invoice_previews_immutable"
BEFORE UPDATE OR DELETE ON "invoice_previews"
FOR EACH ROW EXECUTE FUNCTION "protect_invoice_preview_revisions"();
--> statement-breakpoint
CREATE FUNCTION "protect_invoice_preview_lines"() RETURNS trigger AS $$
DECLARE
	preview_status "invoice_preview_status";
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'invoice preview lines are immutable' USING ERRCODE = '55000';
	END IF;

	SELECT "status" INTO preview_status FROM "invoice_previews" WHERE "id" = NEW."preview_id";
	IF preview_status <> 'pending' THEN
		RAISE EXCEPTION 'lines can only be inserted into pending invoice previews' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "invoice_preview_lines_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "invoice_preview_lines"
FOR EACH ROW EXECUTE FUNCTION "protect_invoice_preview_lines"();
