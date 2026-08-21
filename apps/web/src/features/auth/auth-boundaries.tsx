import { Button, Notice } from "@meterpilot/ui";
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "./auth-context";

function SessionStatePage({ children }: { children: ReactNode }) {
  return (
    <main className="ledger-surface grid min-h-svh place-items-center bg-mp-canvas p-5 text-mp-ink">
      <div className="w-full max-w-md border border-mp-border bg-mp-panel p-6 shadow-mp-raised">
        {children}
      </div>
    </main>
  );
}

export function RequireSession() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "pending") {
    return (
      <SessionStatePage>
        <p className="section-kicker">Session check</p>
        <h1 className="mt-3 font-mp-display text-3xl font-semibold">Opening your workspace…</h1>
        <p className="mt-3 text-sm text-mp-ink-muted">Confirming the secure dashboard session.</p>
      </SessionStatePage>
    );
  }

  if (auth.status === "error") {
    return (
      <SessionStatePage>
        <Notice title="Session check unavailable" tone="danger">
          <p>The API could not confirm your session. No workspace data has been loaded.</p>
        </Notice>
        <Button className="mt-5" onClick={() => void auth.retry()} variant="secondary">
          Try again
        </Button>
      </SessionStatePage>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <Navigate
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
          ...(auth.reason ? { reason: auth.reason } : {}),
        }}
        to="/sign-in"
      />
    );
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const auth = useAuth();

  if (auth.status === "pending") {
    return (
      <SessionStatePage>
        <p className="section-kicker">Session check</p>
        <h1 className="mt-3 font-mp-display text-3xl font-semibold">Preparing sign in…</h1>
      </SessionStatePage>
    );
  }

  if (auth.status === "authenticated") {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}
