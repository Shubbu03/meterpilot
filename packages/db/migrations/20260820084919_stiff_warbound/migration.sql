DROP INDEX "usage_events_corrections_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_direct_correction_unique" ON "usage_events" ("organization_id","correction_of_event_id") WHERE "correction_of_event_id" is not null;--> statement-breakpoint
CREATE FUNCTION "protect_usage_events"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'usage events are immutable; append a correction instead' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "usage_events_immutable"
	BEFORE UPDATE OR DELETE ON "usage_events"
	FOR EACH ROW EXECUTE FUNCTION "protect_usage_events"();
