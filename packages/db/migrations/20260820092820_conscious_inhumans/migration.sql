ALTER TABLE "invoice_previews" ADD CONSTRAINT "invoice_previews_organization_series_id_unique" UNIQUE("organization_id","series_id","id");--> statement-breakpoint
ALTER TABLE "billing_exports" DROP CONSTRAINT "billing_exports_organization_preview_revision_fk", ADD CONSTRAINT "billing_exports_organization_preview_revision_fk" FOREIGN KEY ("organization_id","source_preview_id","source_preview_revision_id") REFERENCES "invoice_previews"("organization_id","series_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_invoice_preview_revisions"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'invoice preview revisions are immutable' USING ERRCODE = '55000';
	END IF;

	IF ROW(
		NEW."id", NEW."adjustment_of_preview_id", NEW."series_id", NEW."organization_id",
		NEW."customer_id", NEW."subscription_id", NEW."plan_version_id", NEW."period_start",
		NEW."period_end", NEW."revision", NEW."currency", NEW."requested_by", NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id", OLD."adjustment_of_preview_id", OLD."series_id", OLD."organization_id",
		OLD."customer_id", OLD."subscription_id", OLD."plan_version_id", OLD."period_start",
		OLD."period_end", OLD."revision", OLD."currency", OLD."requested_by", OLD."created_at"
	) OR NEW."status" NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'pending invoice previews may only transition to a terminal result' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_reconciliation_runs"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'reconciliation runs are immutable' USING ERRCODE = '55000';
	END IF;

	IF ROW(
		NEW."id", NEW."organization_id", NEW."kind", NEW."customer_id", NEW."meter_id",
		NEW."period_start", NEW."period_end", NEW."input_watermark", NEW."repair_requested",
		NEW."requested_by", NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id", OLD."organization_id", OLD."kind", OLD."customer_id", OLD."meter_id",
		OLD."period_start", OLD."period_end", OLD."input_watermark", OLD."repair_requested",
		OLD."requested_by", OLD."created_at"
	) OR NEW."status" NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'pending reconciliation runs may only transition to a terminal result' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "reconciliation_runs_immutable"
BEFORE UPDATE OR DELETE ON "reconciliation_runs"
FOR EACH ROW EXECUTE FUNCTION "protect_reconciliation_runs"();
--> statement-breakpoint
CREATE FUNCTION "protect_reconciliation_findings"() RETURNS trigger AS $$
DECLARE
	run_status "operation_run_status";
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'reconciliation findings are immutable' USING ERRCODE = '55000';
	END IF;

	SELECT "status" INTO run_status FROM "reconciliation_runs"
	WHERE "organization_id" = NEW."organization_id" AND "id" = NEW."run_id";
	IF run_status <> 'pending' THEN
		RAISE EXCEPTION 'findings can only be inserted into pending reconciliation runs' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "reconciliation_findings_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "reconciliation_findings"
FOR EACH ROW EXECUTE FUNCTION "protect_reconciliation_findings"();
--> statement-breakpoint
CREATE FUNCTION "protect_billing_exports"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD."status" <> 'pending' THEN
		RAISE EXCEPTION 'billing exports are immutable' USING ERRCODE = '55000';
	END IF;

	IF ROW(
		NEW."id", NEW."organization_id", NEW."source_preview_id", NEW."source_preview_revision_id",
		NEW."source_preview_hash", NEW."source_preview_revision", NEW."stripe_customer_id",
		NEW."requested_by", NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id", OLD."organization_id", OLD."source_preview_id", OLD."source_preview_revision_id",
		OLD."source_preview_hash", OLD."source_preview_revision", OLD."stripe_customer_id",
		OLD."requested_by", OLD."created_at"
	) OR NEW."status" NOT IN ('completed', 'failed') THEN
		RAISE EXCEPTION 'pending billing exports may only transition to a terminal result' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "billing_exports_immutable"
BEFORE UPDATE OR DELETE ON "billing_exports"
FOR EACH ROW EXECUTE FUNCTION "protect_billing_exports"();
--> statement-breakpoint
CREATE FUNCTION "protect_audit_log"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit log entries are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_log_immutable"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "protect_audit_log"();
