ALTER TABLE "jobs" ADD COLUMN "manual_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "failure_retryable" boolean;--> statement-breakpoint
UPDATE "jobs"
SET "last_error" = 'unknown_failure: The job failed without a recognized error.'
WHERE "status" = 'failed' AND "last_error" IS NULL;--> statement-breakpoint
UPDATE "jobs"
SET "last_error" = NULL
WHERE "status" = 'completed';--> statement-breakpoint
UPDATE "jobs"
SET "failure_retryable" = CASE
  WHEN "last_error" IS NULL THEN NULL
  WHEN "status" IN ('pending', 'processing') THEN TRUE
  ELSE FALSE
END;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_manual_retry_count_check" CHECK ("manual_retry_count" between 0 and 10);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_failure_shape_check" CHECK ((
        (("last_error" is null and "failure_retryable" is null)
          or ("last_error" is not null and "failure_retryable" is not null))
        and ("status" <> 'completed' or "last_error" is null)
        and ("status" <> 'failed' or "last_error" is not null)
      ));
