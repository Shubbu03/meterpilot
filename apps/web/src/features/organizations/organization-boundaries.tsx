import { Button, Notice } from "@meterpilot/ui";
import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router";

import { useOrganization } from "./organization-context";

function OrganizationStatePage({ children }: { children: ReactNode }) {
  return (
    <main className="ledger-surface grid min-h-svh place-items-center bg-mp-canvas p-5 text-mp-ink">
      <div className="w-full max-w-lg border border-mp-border bg-mp-panel p-6 shadow-mp-raised">
        {children}
      </div>
    </main>
  );
}

export function RequireOrganization() {
  const organization = useOrganization();

  if (organization.status === "loading") {
    return (
      <OrganizationStatePage>
        <p className="section-kicker">Tenant boundary</p>
        <h1 className="mt-3 font-mp-display text-3xl font-semibold">Loading organizations…</h1>
        <p className="mt-3 text-sm text-mp-ink-muted">
          Resolving the organizations available to this dashboard session.
        </p>
      </OrganizationStatePage>
    );
  }

  if (organization.status === "error") {
    return (
      <OrganizationStatePage>
        <Notice title="Organizations unavailable" tone="danger">
          <p>
            The API could not load your organization access.
            {organization.requestId ? ` Request ID: ${organization.requestId}` : ""}
          </p>
        </Notice>
        <Button className="mt-5" onClick={() => void organization.retry()} variant="secondary">
          Try again
        </Button>
      </OrganizationStatePage>
    );
  }

  if (organization.status === "empty") {
    return <Navigate replace to="/onboarding" />;
  }

  return <Outlet />;
}
