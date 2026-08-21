CREATE TYPE "billing_interval" AS ENUM('month');--> statement-breakpoint
CREATE TYPE "plan_component_type" AS ENUM('flat', 'per_unit', 'included_overage', 'graduated');--> statement-breakpoint
CREATE TYPE "plan_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "subscription_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TABLE "plan_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"component_key" varchar(128) NOT NULL,
	"feature_id" uuid,
	"component_type" "plan_component_type" NOT NULL,
	"billing_interval" "billing_interval" DEFAULT 'month'::"billing_interval" NOT NULL,
	"pricing_definition" jsonb NOT NULL,
	"entitlement_definition" jsonb,
	"rounding_definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_components_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "plan_components_organization_version_key_unique" UNIQUE("organization_id","plan_version_id","component_key"),
	CONSTRAINT "plan_components_key_format_check" CHECK ("component_key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "plan_components_pricing_model_check" CHECK ("pricing_definition"->>'model' = "component_type"::text),
	CONSTRAINT "plan_components_feature_shape_check" CHECK ("component_type" = 'flat' or "feature_id" is not null),
	CONSTRAINT "plan_components_entitlement_shape_check" CHECK ("entitlement_definition" is null or "feature_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "plan_version_status" DEFAULT 'draft'::"plan_version_status" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_versions_organization_plan_version_unique" UNIQUE("organization_id","plan_id","version"),
	CONSTRAINT "plan_versions_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "plan_versions_version_check" CHECK ("version" >= 1),
	CONSTRAINT "plan_versions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "plan_versions_lifecycle_check" CHECK ((
        "status" = 'draft' and "published_at" is null and "archived_at" is null
      ) or (
        "status" = 'published' and "published_at" is not null and "archived_at" is null
      ) or (
        "status" = 'archived' and "published_at" is not null and "archived_at" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "plans_organization_key_unique" UNIQUE("organization_id","key"),
	CONSTRAINT "plans_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "plans_key_format_check" CHECK ("key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "plans_name_not_empty_check" CHECK (length(trim("name")) > 0),
	CONSTRAINT "plans_archive_time_check" CHECK ("archived_at" is null or "archived_at" >= "created_at")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"commercial_slot" varchar(64) DEFAULT 'default' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"billing_anchor" timestamp with time zone NOT NULL,
	"status" "subscription_status" DEFAULT 'active'::"subscription_status" NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "subscriptions_slot_format_check" CHECK ("commercial_slot" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "subscriptions_period_check" CHECK ("ends_at" is null or "ends_at" > "starts_at"),
	CONSTRAINT "subscriptions_anchor_check" CHECK ("billing_anchor" <= "starts_at"),
	CONSTRAINT "subscriptions_status_check" CHECK ((
        "status" = 'active' and "canceled_at" is null
      ) or (
        "status" = 'canceled' and "canceled_at" is not null and "ends_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
CREATE INDEX "plan_components_feature_idx" ON "plan_components" ("organization_id","feature_id");--> statement-breakpoint
CREATE INDEX "plan_versions_effective_idx" ON "plan_versions" ("organization_id","plan_id","effective_from");--> statement-breakpoint
CREATE INDEX "plans_organization_created_at_idx" ON "plans" ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_time_idx" ON "subscriptions" ("organization_id","customer_id","commercial_slot","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_version_idx" ON "subscriptions" ("organization_id","plan_version_id");--> statement-breakpoint
ALTER TABLE "plan_components" ADD CONSTRAINT "plan_components_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "plan_components" ADD CONSTRAINT "plan_components_organization_plan_version_fk" FOREIGN KEY ("organization_id","plan_version_id") REFERENCES "plan_versions"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "plan_components" ADD CONSTRAINT "plan_components_organization_feature_fk" FOREIGN KEY ("organization_id","feature_id") REFERENCES "features"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_organization_plan_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "plans"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_plan_version_fk" FOREIGN KEY ("organization_id","plan_version_id") REFERENCES "plan_versions"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_subscription_fk" FOREIGN KEY ("organization_id","subscription_id") REFERENCES "subscriptions"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_commercial_slot_no_overlap" EXCLUDE USING gist (
	"organization_id" WITH =,
	"customer_id" WITH =,
	"commercial_slot" WITH =,
	tstzrange("starts_at", "ends_at", '[)') WITH &&
);
--> statement-breakpoint
CREATE FUNCTION "protect_published_plan_version"() RETURNS trigger AS $$
BEGIN
	IF OLD."status" = 'archived' THEN
		RAISE EXCEPTION 'archived plan versions are immutable' USING ERRCODE = '55000';
	END IF;

	IF OLD."status" = 'published' THEN
		IF TG_OP = 'DELETE' THEN
			RAISE EXCEPTION 'published plan versions cannot be deleted' USING ERRCODE = '55000';
		END IF;

		IF ROW(
			NEW."organization_id", NEW."plan_id", NEW."version", NEW."currency",
			NEW."effective_from", NEW."published_at", NEW."created_at"
		) IS DISTINCT FROM ROW(
			OLD."organization_id", OLD."plan_id", OLD."version", OLD."currency",
			OLD."effective_from", OLD."published_at", OLD."created_at"
		) OR NEW."status" <> 'archived' OR NEW."archived_at" IS NULL THEN
			RAISE EXCEPTION 'published plan versions are immutable except for archival' USING ERRCODE = '55000';
		END IF;
	END IF;

	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "plan_versions_published_immutable"
BEFORE UPDATE OR DELETE ON "plan_versions"
FOR EACH ROW EXECUTE FUNCTION "protect_published_plan_version"();
--> statement-breakpoint
CREATE FUNCTION "protect_published_plan_components"() RETURNS trigger AS $$
DECLARE
	old_status "plan_version_status";
	new_status "plan_version_status";
BEGIN
	IF TG_OP <> 'INSERT' THEN
		SELECT "status" INTO old_status FROM "plan_versions" WHERE "id" = OLD."plan_version_id";
		IF old_status <> 'draft' THEN
			RAISE EXCEPTION 'published plan components are immutable' USING ERRCODE = '55000';
		END IF;
	END IF;

	IF TG_OP <> 'DELETE' THEN
		SELECT "status" INTO new_status FROM "plan_versions" WHERE "id" = NEW."plan_version_id";
		IF new_status <> 'draft' THEN
			RAISE EXCEPTION 'components can only be written on draft plan versions' USING ERRCODE = '55000';
		END IF;
	END IF;

	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "plan_components_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "plan_components"
FOR EACH ROW EXECUTE FUNCTION "protect_published_plan_components"();
