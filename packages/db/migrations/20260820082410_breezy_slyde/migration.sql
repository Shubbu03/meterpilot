ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_amounts_check" CHECK ("baseline_amount_minor" >= 0
        and "candidate_amount_minor" >= 0
        and "delta_minor" = "candidate_amount_minor" - "baseline_amount_minor");--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_increase_threshold_check" CHECK ("increase_threshold_percent" >= 0);--> statement-breakpoint
ALTER TABLE "simulation_runs" DROP CONSTRAINT "simulation_runs_customer_count_check", ADD CONSTRAINT "simulation_runs_customer_count_check" CHECK (jsonb_typeof("customer_ids") = 'array'
        and jsonb_array_length("customer_ids") between 1 and 500);