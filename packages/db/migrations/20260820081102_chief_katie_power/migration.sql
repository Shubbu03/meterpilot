CREATE TYPE "simulation_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "simulation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"simulation_run_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"baseline_amount_minor" numeric NOT NULL,
	"candidate_amount_minor" numeric NOT NULL,
	"delta_minor" numeric NOT NULL,
	"delta_percent" numeric,
	"explanation" jsonb NOT NULL,
	"warning_flags" varchar(64)[] DEFAULT '{}'::varchar(64)[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulation_results_organization_run_customer_unique" UNIQUE("organization_id","simulation_run_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"baseline_plan_version_id" uuid NOT NULL,
	"candidate_plan_version_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "simulation_status" DEFAULT 'pending'::"simulation_status" NOT NULL,
	"input_watermark" timestamp with time zone NOT NULL,
	"customer_ids" jsonb NOT NULL,
	"increase_threshold_percent" numeric DEFAULT '20' NOT NULL,
	"summary" jsonb DEFAULT '{}' NOT NULL,
	"calculation_hash" varchar(64),
	"failure_code" varchar(64),
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "simulation_runs_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "simulation_runs_period_check" CHECK ("period_end" > "period_start"),
	CONSTRAINT "simulation_runs_customer_count_check" CHECK (jsonb_array_length("customer_ids") > 0),
	CONSTRAINT "simulation_runs_result_shape_check" CHECK ((
        "status" = 'pending' and "calculation_hash" is null and "failure_code" is null and "completed_at" is null
      ) or (
        "status" = 'completed' and "calculation_hash" ~ '^[a-f0-9]{64}$' and "failure_code" is null and "completed_at" is not null
      ) or (
        "status" = 'failed' and "calculation_hash" is null and length(trim("failure_code")) > 0 and "completed_at" is not null
      ))
);
--> statement-breakpoint
CREATE INDEX "simulation_results_delta_idx" ON "simulation_results" ("organization_id","simulation_run_id","delta_minor");--> statement-breakpoint
CREATE INDEX "simulation_runs_organization_created_idx" ON "simulation_runs" ("organization_id","created_at","id");--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_organization_run_fk" FOREIGN KEY ("organization_id","simulation_run_id") REFERENCES "simulation_runs"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_organization_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "customers"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_organization_baseline_plan_version_fk" FOREIGN KEY ("organization_id","baseline_plan_version_id") REFERENCES "plan_versions"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_organization_candidate_plan_version_fk" FOREIGN KEY ("organization_id","candidate_plan_version_id") REFERENCES "plan_versions"("organization_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION "protect_simulation_runs"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'simulation runs are immutable' USING ERRCODE = '55000';
	END IF;
	IF ROW(NEW."id", NEW."organization_id", NEW."baseline_plan_version_id", NEW."candidate_plan_version_id", NEW."period_start", NEW."period_end", NEW."input_watermark", NEW."customer_ids", NEW."increase_threshold_percent", NEW."requested_by", NEW."created_at")
		IS DISTINCT FROM ROW(OLD."id", OLD."organization_id", OLD."baseline_plan_version_id", OLD."candidate_plan_version_id", OLD."period_start", OLD."period_end", OLD."input_watermark", OLD."customer_ids", OLD."increase_threshold_percent", OLD."requested_by", OLD."created_at")
		OR NEW."status" NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'pending simulations may only transition to a terminal result' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "simulation_runs_immutable" BEFORE UPDATE OR DELETE ON "simulation_runs"
FOR EACH ROW EXECUTE FUNCTION "protect_simulation_runs"();
--> statement-breakpoint
CREATE FUNCTION "protect_simulation_results"() RETURNS trigger AS $$
DECLARE run_status "simulation_status";
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'simulation results are immutable' USING ERRCODE = '55000';
	END IF;
	SELECT "status" INTO run_status FROM "simulation_runs" WHERE "id" = NEW."simulation_run_id";
	IF run_status <> 'pending' THEN
		RAISE EXCEPTION 'results can only be inserted into pending simulations' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "simulation_results_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "simulation_results"
FOR EACH ROW EXECUTE FUNCTION "protect_simulation_results"();
