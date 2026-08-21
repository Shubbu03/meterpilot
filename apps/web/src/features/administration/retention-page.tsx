import {
  Button,
  Notice,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  TextField,
} from "@meterpilot/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useActiveOrganization } from "../organizations/organization-context";
import { adminKeys, getRetention, updateRetention } from "./api";
export function RetentionPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery({ queryFn: () => getRetention(id), queryKey: adminKeys.retention(id) });
  const mutation = useMutation({
    mutationFn: (days: number | null) => updateRetention(id, days),
    async onSuccess() {
      setConfirmation("");
      await queryClient.invalidateQueries({ queryKey: adminKeys.retention(id) });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("days") ?? "");
    if (confirmation === "APPLY RETENTION") mutation.mutate(value ? Number(value) : null);
  }
  const policy = query.data?.policy;
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Data lifecycle</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Retention</h1>
        <p className="mt-4 max-w-2xl text-sm text-mp-ink-muted">
          Control when event properties are redacted. Canonical event identity and aggregate
          evidence remain; source properties cannot be recovered.
        </p>
      </header>
      {mutation.error ? (
        <Notice className="mt-6" title="Policy not updated" tone="danger">
          <p>
            {mutation.error instanceof ApiError
              ? `${mutation.error.message} Request ID: ${mutation.error.requestId}`
              : "The update failed."}
          </p>
        </Notice>
      ) : null}
      <Panel className="mt-6">
        <PanelHeader>
          <PanelTitle as="h2">Event property retention</PanelTitle>
        </PanelHeader>
        <PanelContent>
          {policy ? (
            <>
              <p className="text-sm">
                Current policy:{" "}
                <strong>
                  {policy.eventPropertiesRetentionDays === null
                    ? "Disabled — properties retained indefinitely"
                    : `${policy.eventPropertiesRetentionDays} days`}
                </strong>
              </p>
              <p className="mt-2 text-xs text-mp-ink-muted">
                Version {policy.version}
                {policy.updatedAt
                  ? ` · updated ${new Intl.DateTimeFormat().format(new Date(policy.updatedAt))}`
                  : ""}
              </p>
              <form className="mt-6 grid max-w-xl gap-4" onSubmit={submit}>
                <TextField
                  defaultValue={policy.eventPropertiesRetentionDays ?? ""}
                  hint="Leave blank to disable. Allowed range: 30–3650 days."
                  label="Retention days"
                  max={3650}
                  min={30}
                  name="days"
                  type="number"
                />
                <TextField
                  label='Type "APPLY RETENTION" to confirm'
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  value={confirmation}
                />
                <Button
                  disabled={confirmation !== "APPLY RETENTION"}
                  loading={mutation.isPending}
                  loadingLabel="Applying…"
                  type="submit"
                  variant="danger"
                >
                  Apply policy and queue enforcement
                </Button>
              </form>
            </>
          ) : (
            <p>Loading policy…</p>
          )}
        </PanelContent>
      </Panel>
    </div>
  );
}
