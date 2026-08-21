CREATE TYPE "meter_aggregation" AS ENUM('count', 'sum');--> statement-breakpoint
CREATE TYPE "meter_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "usage_bucket_size" AS ENUM('hour');--> statement-breakpoint
CREATE TABLE "meter_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"aggregation" "meter_aggregation" NOT NULL,
	"value_property" varchar(128),
	"filter_definition" jsonb DEFAULT '[]' NOT NULL,
	"group_by_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_versions_organization_meter_version_unique" UNIQUE("organization_id","meter_id","version"),
	CONSTRAINT "meter_versions_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "meter_versions_version_check" CHECK ("version" >= 1),
	CONSTRAINT "meter_versions_event_type_format_check" CHECK ("event_type" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "meter_versions_aggregation_shape_check" CHECK ((
        ("aggregation" = 'count' and "value_property" is null)
        or ("aggregation" = 'sum' and length(trim("value_property")) > 0)
      )),
	CONSTRAINT "meter_versions_effective_range_check" CHECK ("effective_to" is null or "effective_to" > "effective_from"),
	CONSTRAINT "meter_versions_group_by_limit_check" CHECK (cardinality("group_by_keys") <= 3)
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "meter_status" DEFAULT 'draft'::"meter_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meters_organization_id_key_unique" UNIQUE("organization_id","key"),
	CONSTRAINT "meters_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "meters_key_format_check" CHECK ("key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
	CONSTRAINT "meters_name_not_empty_check" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_buckets" (
	"organization_id" uuid NOT NULL,
	"meter_version_id" uuid NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_size" "usage_bucket_size" DEFAULT 'hour'::"usage_bucket_size" NOT NULL,
	"dimensions_hash" varchar(64) NOT NULL,
	"dimensions" jsonb DEFAULT '{}' NOT NULL,
	"quantity" numeric NOT NULL,
	"event_count" integer NOT NULL,
	"max_received_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_buckets_identity_unique" UNIQUE("organization_id","meter_version_id","subject_key","bucket_start","bucket_size","dimensions_hash"),
	CONSTRAINT "usage_buckets_dimensions_hash_check" CHECK ("dimensions_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "usage_buckets_event_count_check" CHECK ("event_count" > 0),
	CONSTRAINT "usage_buckets_revision_check" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX "meter_versions_event_effective_idx" ON "meter_versions" ("organization_id","event_type","effective_from");--> statement-breakpoint
CREATE INDEX "usage_buckets_subject_time_idx" ON "usage_buckets" ("organization_id","subject_key","bucket_start");--> statement-breakpoint
ALTER TABLE "meter_versions" ADD CONSTRAINT "meter_versions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "meter_versions" ADD CONSTRAINT "meter_versions_organization_meter_fk" FOREIGN KEY ("organization_id","meter_id") REFERENCES "meters"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_organization_meter_version_fk" FOREIGN KEY ("organization_id","meter_version_id") REFERENCES "meter_versions"("organization_id","id") ON DELETE RESTRICT;