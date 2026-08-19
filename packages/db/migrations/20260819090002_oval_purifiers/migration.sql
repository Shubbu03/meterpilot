CREATE TYPE "audit_actor_type" AS ENUM('system', 'user', 'api_key');--> statement-breakpoint
CREATE TYPE "membership_role" AS ENUM('owner', 'admin', 'developer', 'analyst', 'support');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_api_key_id" uuid,
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" varchar(128),
	"request_id" varchar(128),
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action_not_empty_check" CHECK (length(trim("action")) > 0),
	CONSTRAINT "audit_log_resource_type_not_empty_check" CHECK (length(trim("resource_type")) > 0),
	CONSTRAINT "audit_log_actor_shape_check" CHECK ((
        ("actor_type" = 'system' and "actor_user_id" is null and "actor_api_key_id" is null)
        or ("actor_type" = 'user' and "actor_user_id" is not null and "actor_api_key_id" is null)
        or ("actor_type" = 'api_key' and "actor_user_id" is null and "actor_api_key_id" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" varchar(100) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token" text NOT NULL CONSTRAINT "sessions_token_unique" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(200) NOT NULL,
	"email" varchar(320) NOT NULL CONSTRAINT "users_email_unique" UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"prefix" varchar(32) NOT NULL CONSTRAINT "api_keys_prefix_unique" UNIQUE,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "api_keys_prefix_format_check" CHECK ("prefix" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "api_keys_secret_hash_length_check" CHECK (length("secret_hash") >= 32),
	CONSTRAINT "api_keys_scopes_not_empty_check" CHECK (cardinality("scopes") > 0 and array_position("scopes", null) is null and array_position("scopes", '') is null),
	CONSTRAINT "api_keys_last_used_at_check" CHECK ("last_used_at" is null or "last_used_at" >= "created_at"),
	CONSTRAINT "api_keys_expires_at_check" CHECK ("expires_at" is null or "expires_at" > "created_at"),
	CONSTRAINT "api_keys_revoked_at_check" CHECK ("revoked_at" is null or "revoked_at" >= "created_at")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" uuid,
	"user_id" uuid,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(63) NOT NULL CONSTRAINT "organizations_slug_unique" UNIQUE,
	"name" varchar(200) NOT NULL,
	"default_timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "organizations_name_not_empty_check" CHECK (length(trim("name")) > 0),
	CONSTRAINT "organizations_default_timezone_not_empty_check" CHECK (length(trim("default_timezone")) > 0)
);
--> statement-breakpoint
CREATE INDEX "audit_log_organization_occurred_at_idx" ON "audit_log" ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_organization_resource_idx" ON "audit_log" ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_api_key_id_idx" ON "audit_log" ("actor_api_key_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "verifications" ("expires_at");--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_created_at_idx" ON "api_keys" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_active_idx" ON "api_keys" ("organization_id","expires_at") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_organization_id_role_idx" ON "memberships" ("organization_id","role");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_actor_api_key_fk" FOREIGN KEY ("organization_id","actor_api_key_id") REFERENCES "api_keys"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;