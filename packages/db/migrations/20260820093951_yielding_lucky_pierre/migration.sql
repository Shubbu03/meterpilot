CREATE TABLE "rate_limit_windows" (
	"key_hash" varchar(64),
	"window_start" timestamp with time zone,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_windows_key_window_pk" PRIMARY KEY("key_hash","window_start"),
	CONSTRAINT "rate_limit_windows_key_hash_check" CHECK ("key_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "rate_limit_windows_request_count_check" CHECK ("request_count" >= 1),
	CONSTRAINT "rate_limit_windows_expiry_check" CHECK ("expires_at" > "window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expires_at_idx" ON "rate_limit_windows" ("expires_at");