CREATE TYPE "simulation_result_status" AS ENUM('included', 'excluded');--> statement-breakpoint
ALTER TABLE "simulation_results" DROP CONSTRAINT "simulation_results_amounts_check";--> statement-breakpoint
ALTER TABLE "simulation_results" ADD COLUMN "status" "simulation_result_status" DEFAULT 'included'::"simulation_result_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD COLUMN "failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "simulation_results" ALTER COLUMN "baseline_amount_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_results" ALTER COLUMN "candidate_amount_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_results" ALTER COLUMN "delta_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_results" ALTER COLUMN "explanation" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_shape_check" CHECK ((
        "status" = 'included'
        and "baseline_amount_minor" >= 0
        and "candidate_amount_minor" >= 0
        and "delta_minor" = "candidate_amount_minor" - "baseline_amount_minor"
        and "explanation" is not null
        and "failure_code" is null
      ) or (
        "status" = 'excluded'
        and "baseline_amount_minor" is null
        and "candidate_amount_minor" is null
        and "delta_minor" is null
        and "delta_percent" is null
        and "explanation" is null
        and "failure_code" = 'invalid_usage_value'
        and cardinality("warning_flags") = 0
      ));