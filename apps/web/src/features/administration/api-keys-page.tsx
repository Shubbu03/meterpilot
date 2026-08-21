import { apiKeyScopeSchema, type RevealedApiKeyResponse } from "@meterpilot/contracts/api-keys";
import { Button, EmptyState, Notice, StatusBadge, TextField } from "@meterpilot/ui";
import { KeyIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useActiveOrganization } from "../organizations/organization-context";
import { adminKeys, createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./api";

export function ApiKeysPage() {
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const [revealed, setRevealed] = useState<RevealedApiKeyResponse>();
  const query = useQuery({ queryFn: () => listApiKeys(id), queryKey: adminKeys.apiKeys(id) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.apiKeys(id) });
  const createMutation = useMutation({
    mutationFn: ({
      expiresAt,
      scopes,
    }: {
      expiresAt?: string;
      scopes: Parameters<typeof createApiKey>[1];
    }) => createApiKey(id, scopes, expiresAt),
    async onSuccess(data) {
      setRevealed(data);
      await refresh();
    },
  });
  const rotateMutation = useMutation({
    mutationFn: (keyId: string) => rotateApiKey(id, keyId),
    async onSuccess(data) {
      setRevealed(data);
      await refresh();
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeApiKey(id, keyId),
    onSuccess: refresh,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scopes = apiKeyScopeSchema.array().safeParse(data.getAll("scopes"));
    const expiry = String(data.get("expiresAt") ?? "");
    if (scopes.success)
      createMutation.mutate({
        ...(expiry ? { expiresAt: new Date(`${expiry}T00:00:00.000Z`).toISOString() } : {}),
        scopes: scopes.data,
      });
  }
  const error = createMutation.error ?? rotateMutation.error ?? revokeMutation.error;
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Credentials</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">API keys</h1>
        <p className="mt-4 max-w-2xl text-sm text-mp-ink-muted">
          Issue least-privilege organization credentials. Plaintext appears once and is never
          persisted by MeterPilot.
        </p>
      </header>
      {revealed ? (
        <Notice className="mt-6" title="Copy this key now" tone="warning">
          <p className="break-all font-mp-mono text-sm">{revealed.key}</p>
          <Button
            className="mt-4"
            onClick={() => void navigator.clipboard.writeText(revealed.key)}
            size="compact"
            variant="secondary"
          >
            Copy key
          </Button>
        </Notice>
      ) : null}
      {error ? (
        <Notice className="mt-6" title="Credential operation failed" tone="danger">
          <p>
            {error instanceof ApiError
              ? `${error.message} Request ID: ${error.requestId}`
              : "The operation failed."}
          </p>
        </Notice>
      ) : null}
      <form className="mt-6 border border-mp-border bg-mp-panel p-5" onSubmit={submit}>
        <h2 className="font-mp-display text-2xl font-semibold">Issue credential</h2>
        <fieldset className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <legend className="section-kicker mb-2">Scopes</legend>
          {apiKeyScopeSchema.options.map((scope) => (
            <label
              className="flex min-h-11 items-center gap-2 border border-mp-border px-3 text-xs font-semibold"
              key={scope}
            >
              <input name="scopes" type="checkbox" value={scope} />
              {scope}
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField className="flex-1" label="Expires (optional)" name="expiresAt" type="date" />
          <Button loading={createMutation.isPending} loadingLabel="Issuing…" type="submit">
            Create API key
          </Button>
        </div>
      </form>
      {query.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={<p>Issue the first scoped key above.</p>}
          title="No API keys"
        />
      ) : (
        <div className="mt-6 space-y-3">
          {query.data?.items.map((key) => (
            <article
              className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
              key={key.id}
            >
              <KeyIcon aria-hidden="true" size={22} />
              <div>
                <div className="flex flex-wrap gap-2">
                  <p className="font-mp-mono text-xs font-semibold">{key.prefix}</p>
                  <StatusBadge tone={key.revokedAt ? "danger" : "success"}>
                    {key.revokedAt ? "revoked" : "active"}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-mp-ink-muted">
                  {key.scopes.join(", ")} · last used{" "}
                  {key.lastUsedAt
                    ? new Intl.DateTimeFormat().format(new Date(key.lastUsedAt))
                    : "never"}
                </p>
              </div>
              {!key.revokedAt ? (
                <div className="flex gap-2">
                  <Button
                    onClick={() => rotateMutation.mutate(key.id)}
                    size="compact"
                    variant="secondary"
                  >
                    Rotate
                  </Button>
                  <Button
                    onClick={() => revokeMutation.mutate(key.id)}
                    size="compact"
                    variant="danger"
                  >
                    Revoke
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
