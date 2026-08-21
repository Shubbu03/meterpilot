import { Button, EmptyState, Notice, StatusBadge } from "@meterpilot/ui";
import { WarningOctagonIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useActiveOrganization } from "../organizations/organization-context";
import { adminKeys, listFailedJobs, retryFailedJob } from "./api";
export function FailedJobsPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const query = useQuery({ queryFn: () => listFailedJobs(id), queryKey: adminKeys.failedJobs(id) });
  const mutation = useMutation({
    mutationFn: (job: Parameters<typeof retryFailedJob>[1]) => retryFailedJob(id, job),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.failedJobs(id) }),
  });
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Recovery</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Failed jobs</h1>
        <p className="mt-4 text-sm text-mp-ink-muted">
          Inspect bounded failure metadata before explicitly acknowledging and retrying eligible
          durable work.
        </p>
      </header>
      {mutation.error ? (
        <Notice className="mt-6" title="Retry not queued" tone="danger">
          <p>
            {mutation.error instanceof ApiError
              ? `${mutation.error.message} Request ID: ${mutation.error.requestId}`
              : "The retry failed."}
          </p>
        </Notice>
      ) : null}
      {query.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={<p>No terminal background failures require operator action.</p>}
          title="Job queue is clear"
        />
      ) : (
        <div className="mt-6 space-y-4">
          {query.data?.items.map((job) => (
            <article className="border border-mp-border bg-mp-panel p-5" key={job.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-3">
                  <WarningOctagonIcon className="text-mp-danger" size={24} />
                  <div>
                    <p className="font-semibold">{job.type}</p>
                    <p className="mt-1 font-mp-mono text-xs text-mp-ink-muted">
                      {job.id} · {job.resourceType}:{job.resourceId}
                    </p>
                  </div>
                </div>
                <StatusBadge tone="danger">{job.failure.code}</StatusBadge>
              </div>
              <p className="mt-4 text-sm">{job.failure.message}</p>
              <pre className="mt-4 overflow-auto border border-mp-border bg-mp-ink p-3 font-mp-mono text-xs text-mp-paper">
                {JSON.stringify(job.payloadMetadata, null, 2)}
              </pre>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-mp-ink-muted">
                  Attempts {job.attemptCount} · manual retries {job.manualRetryCount}
                </span>
                <Button
                  disabled={!job.retryable}
                  loading={mutation.isPending}
                  loadingLabel="Queuing…"
                  onClick={() => mutation.mutate(job)}
                  size="compact"
                >
                  Acknowledge & retry
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
