import {
  createOrganizationRequestSchema,
  type OrganizationListItem,
  timezoneSchema,
} from "@meterpilot/contracts/organizations";
import { Button, Notice, TextField } from "@meterpilot/ui";
import { BuildingsIcon, CheckIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useAuthenticatedSession } from "../auth/auth-context";
import { firstFieldErrors } from "../auth/form-errors";
import { createOrganization, organizationKeys } from "./api";
import { useOrganization } from "./organization-context";
import { writeSelectedOrganization } from "./organization-storage";

function defaultTimezone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezoneSchema.safeParse(timezone).success ? timezone : "UTC";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function OnboardingPage() {
  const auth = useAuthenticatedSession();
  const organization = useOrganization();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const createMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess(data) {
      const item: OrganizationListItem = {
        membership: data.membership,
        organization: data.organization,
      };
      queryClient.setQueryData(organizationKeys.list(), {
        items: [item],
        nextCursor: null,
      });
      writeSelectedOrganization(data.organization.id);
      navigate("/", { replace: true });
    },
  });

  if (organization.status === "ready") {
    return <Navigate replace to="/" />;
  }

  if (organization.status === "loading") {
    return (
      <main className="ledger-surface grid min-h-svh place-items-center bg-mp-canvas p-5">
        <p className="font-mp-display text-3xl font-semibold">Checking organization access…</p>
      </main>
    );
  }

  if (organization.status === "error") {
    return (
      <main className="ledger-surface grid min-h-svh place-items-center bg-mp-canvas p-5">
        <div className="w-full max-w-lg">
          <Notice title="Organization check failed" tone="danger">
            <p>
              Retry before creating a workspace.
              {organization.requestId ? ` Request ID: ${organization.requestId}` : ""}
            </p>
          </Notice>
          <Button className="mt-5" onClick={() => void organization.retry()} variant="secondary">
            Try again
          </Button>
        </div>
      </main>
    );
  }

  function handleNameChange(nextName: string) {
    setName(nextName);

    if (!slugEdited) {
      setSlug(slugify(nextName));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsedInput = createOrganizationRequestSchema.safeParse(Object.fromEntries(formData));

    if (!parsedInput.success) {
      setFieldErrors(firstFieldErrors(parsedInput.error));
      return;
    }

    setFieldErrors({});
    createMutation.mutate(parsedInput.data);
  }

  const mutationError = createMutation.error;

  return (
    <main className="ledger-surface min-h-svh bg-mp-canvas p-4 text-mp-ink sm:p-8 lg:p-12">
      <div className="mx-auto grid min-h-[calc(100svh-2rem)] max-w-6xl overflow-hidden border border-mp-border bg-mp-panel shadow-mp-raised lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
        <aside className="bg-mp-ink p-6 text-mp-paper sm:p-8 lg:p-10">
          <p className="font-mp-mono text-xs tracking-[0.2em] text-mp-signal uppercase">
            Setup 01 / 03
          </p>
          <h1 className="mt-5 font-mp-display text-5xl leading-[0.95] font-semibold tracking-[-0.04em]">
            Establish the data owner.
          </h1>
          <p className="mt-5 text-sm leading-7 text-mp-border">
            Every customer, event, meter, plan, and audit record belongs to one organization.
          </p>
          <ol className="mt-10 space-y-3 border-mp-border/30 border-t pt-6 text-sm">
            <li className="flex items-center gap-3 text-mp-paper">
              <span className="grid size-6 place-items-center bg-mp-signal font-mp-mono text-xs text-mp-ink">
                1
              </span>
              Organization identity
            </li>
            <li className="flex items-center gap-3 text-mp-border">
              <span className="grid size-6 place-items-center border border-mp-border/50 font-mp-mono text-xs">
                2
              </span>
              Ingestion key
            </li>
            <li className="flex items-center gap-3 text-mp-border">
              <span className="grid size-6 place-items-center border border-mp-border/50 font-mp-mono text-xs">
                3
              </span>
              First usage event
            </li>
          </ol>
        </aside>

        <section className="p-6 sm:p-8 lg:p-12" aria-labelledby="organization-form-heading">
          <div className="flex items-start justify-between gap-5 border-mp-border border-b pb-5">
            <div>
              <p className="section-kicker">Signed in operator</p>
              <p className="mt-2 font-semibold">{auth.session.user.name}</p>
              <p className="mt-1 text-xs text-mp-ink-muted">{auth.session.user.email}</p>
            </div>
            <UserCircleIcon aria-hidden="true" className="text-mp-signal-strong" size={30} />
          </div>

          <div className="mt-8 max-w-xl">
            <BuildingsIcon aria-hidden="true" className="text-mp-signal-strong" size={30} />
            <h2
              className="mt-5 font-mp-display text-4xl font-semibold tracking-[-0.035em]"
              id="organization-form-heading"
            >
              Create your organization
            </h2>
            <p className="mt-3 text-sm leading-6 text-mp-ink-muted">
              This creates your owner membership in the same transaction.
            </p>

            {mutationError ? (
              <Notice className="mt-6" title="Organization not created" tone="danger">
                <p>
                  {mutationError instanceof ApiError && mutationError.code === "conflict"
                    ? "That organization slug is already in use."
                    : "The organization could not be created."}
                  {mutationError instanceof ApiError
                    ? ` Request ID: ${mutationError.requestId}`
                    : ""}
                </p>
              </Notice>
            ) : null}

            <form className="mt-7 grid gap-5" noValidate onSubmit={handleSubmit}>
              <TextField
                autoComplete="organization"
                {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
                label="Organization name"
                maxLength={200}
                name="name"
                onChange={(event) => handleNameChange(event.currentTarget.value)}
                placeholder="Acme Labs"
                required
                value={name}
              />
              <TextField
                autoCapitalize="none"
                {...(fieldErrors.slug ? { error: fieldErrors.slug } : {})}
                hint="Lowercase letters, numbers, and hyphens. Used as a stable human-readable key."
                label="Organization slug"
                maxLength={63}
                name="slug"
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.currentTarget.value);
                }}
                placeholder="acme-labs"
                required
                value={slug}
              />
              <TextField
                {...(fieldErrors.defaultTimezone ? { error: fieldErrors.defaultTimezone } : {})}
                hint="Used for billing-period boundaries; it can be changed later."
                label="Default timezone"
                maxLength={64}
                name="defaultTimezone"
                required
                defaultValue={defaultTimezone()}
              />
              <Button
                loading={createMutation.isPending}
                loadingLabel="Creating organization…"
                type="submit"
              >
                <CheckIcon aria-hidden="true" size={17} />
                Create organization
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
