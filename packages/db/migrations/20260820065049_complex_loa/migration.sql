CREATE TYPE "entitlement_mode" AS ENUM('boolean', 'advisory', 'hard');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"mode" "entitlement_mode" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"granted_quantity" numeric DEFAULT '0' NOT NULL,
	"committed_quantity" numeric DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "entitlements_organization_customer_feature_period_unique" UNIQUE("organization_id","customer_id","feature_id","period_start","period_end"),
	CONSTRAINT "entitlements_period_check" CHECK ("period_end" > "period_start"),
	CONSTRAINT "entitlements_quantities_non_negative_check" CHECK ("granted_quantity" >= 0 and "committed_quantity" >= 0 and "reserved_quantity" >= 0),
	CONSTRAINT "entitlements_boolean_shape_check" CHECK ("mode" <> 'boolean' or ("granted_quantity" = 0 and "committed_quantity" = 0 and "reserved_quantity" = 0)),
	CONSTRAINT "entitlements_version_check" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(200) NOT NULL,
	"meter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "features_organization_key_unique" UNIQUE("organization_id","key"),
	CONSTRAINT "features_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "features_key_format_check" CHECK ("key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "features_name_not_empty_check" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "quota_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_grants_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quota_grants_quantity_positive_check" CHECK ("quantity" > 0),
	CONSTRAINT "quota_grants_reason_not_empty_check" CHECK (length(trim("reason")) > 0),
	CONSTRAINT "quota_grants_effective_range_check" CHECK ("expires_at" is null or "expires_at" > "effective_at")
);
--> statement-breakpoint
CREATE INDEX "entitlements_customer_period_idx" ON "entitlements" ("organization_id","customer_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "entitlements_feature_period_idx" ON "entitlements" ("organization_id","feature_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "features_organization_created_at_idx" ON "features" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "quota_grants_entitlement_effective_idx" ON "quota_grants" ("organization_id","entitlement_id","effective_at");--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_feature_fk" FOREIGN KEY ("organization_id","feature_id") REFERENCES "features"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_organization_meter_fk" FOREIGN KEY ("organization_id","meter_id") REFERENCES "meters"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_organization_entitlement_fk" FOREIGN KEY ("organization_id","entitlement_id") REFERENCES "entitlements"("organization_id","id") ON DELETE RESTRICT;