import { cx, Notice, StatusBadge } from "@meterpilot/ui";
import { ListIcon, SignOutIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { useAuthenticatedSession } from "../../features/auth/auth-context";
import { useActiveOrganization } from "../../features/organizations/organization-context";
import { navigationSections } from "./navigation";

interface NavigationProps {
  idPrefix: string;
  onNavigate?: () => void;
}

function PrimaryNavigation({ idPrefix, onNavigate }: NavigationProps) {
  return (
    <nav aria-label="Primary navigation" className="space-y-6">
      {navigationSections.map((section) => (
        <section
          aria-labelledby={`${idPrefix}-nav-${section.label.toLowerCase()}`}
          key={section.label}
        >
          <h2
            className="px-3 font-mp-mono text-[0.625rem] tracking-[0.18em] text-mp-border uppercase"
            id={`${idPrefix}-nav-${section.label.toLowerCase()}`}
          >
            {section.label}
          </h2>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((item) => {
              const ItemIcon = item.icon;

              return (
                <li key={item.to}>
                  <NavLink
                    className={({ isActive }) =>
                      cx(
                        "group flex min-h-11 items-center gap-3 border border-transparent px-3 py-2 text-sm font-medium text-mp-border transition-colors hover:border-mp-border/30 hover:bg-mp-paper/10 hover:text-mp-paper focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mp-warning motion-reduce:transition-none",
                        isActive && "border-mp-border/30 bg-mp-paper/10 text-mp-paper",
                      )
                    }
                    end={item.to === "/"}
                    onClick={onNavigate}
                    to={item.to}
                  >
                    {({ isActive }) => (
                      <>
                        <ItemIcon
                          aria-hidden="true"
                          size={18}
                          weight={isActive ? "fill" : "regular"}
                        />
                        <span>{item.label}</span>
                        {isActive ? (
                          <span
                            aria-hidden="true"
                            className="ml-auto size-1.5 rounded-full bg-mp-signal"
                          />
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <NavLink
      aria-label="MeterPilot overview"
      className="inline-flex min-h-11 items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mp-warning"
      to="/"
    >
      <span className="font-mp-display text-2xl font-semibold tracking-tight">MeterPilot</span>
      <span className="font-mp-mono text-[0.625rem] tracking-[0.2em] text-mp-signal uppercase">
        control
      </span>
    </NavLink>
  );
}

function OrganizationControl({
  idPrefix,
  inverse = false,
}: {
  idPrefix: string;
  inverse?: boolean;
}) {
  const organization = useActiveOrganization();

  return (
    <div>
      <label
        className={cx(
          "block font-mp-mono text-[0.625rem] tracking-[0.18em] uppercase",
          inverse ? "text-mp-border" : "text-mp-ink-muted",
        )}
        htmlFor={`${idPrefix}-organization`}
      >
        Organization
      </label>
      <select
        className={cx(
          "mt-2 min-h-11 w-full cursor-pointer appearance-none border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-warning",
          inverse
            ? "border-mp-border/40 bg-mp-ink text-mp-paper"
            : "border-mp-border bg-mp-panel text-mp-ink",
        )}
        id={`${idPrefix}-organization`}
        onChange={(event) => organization.selectOrganization(event.currentTarget.value)}
        value={organization.active.organization.id}
      >
        {organization.organizations.map((item) => (
          <option key={item.organization.id} value={item.organization.id}>
            {item.organization.name}
          </option>
        ))}
      </select>
    </div>
  );
}

interface AccountActionsProps {
  onSignOut: () => void;
  signingOut: boolean;
}

function AccountActions({ onSignOut, signingOut }: AccountActionsProps) {
  const auth = useAuthenticatedSession();

  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-mp-border/30 border-t pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{auth.session.user.name}</p>
        <p className="mt-0.5 truncate text-xs text-mp-border">{auth.session.user.email}</p>
      </div>
      <button
        aria-label="Sign out"
        className="grid size-11 shrink-0 cursor-pointer place-items-center border border-mp-border/40 text-mp-border hover:bg-mp-paper/10 hover:text-mp-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-warning disabled:cursor-not-allowed disabled:opacity-60"
        disabled={signingOut}
        onClick={onSignOut}
        type="button"
      >
        <SignOutIcon aria-hidden="true" size={19} />
      </button>
    </div>
  );
}

function MobileHeader({ onSignOut, signingOut }: AccountActionsProps) {
  const navigationRef = useRef<HTMLDetailsElement>(null);

  function closeNavigation() {
    navigationRef.current?.removeAttribute("open");
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-mp-border border-b bg-mp-ink px-4 text-mp-paper lg:hidden">
      <Brand />
      <details className="mobile-navigation" ref={navigationRef}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 border border-mp-border/40 px-3 font-mp-mono text-xs tracking-wider uppercase hover:bg-mp-paper/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-warning [&::-webkit-details-marker]:hidden">
          <ListIcon aria-hidden="true" size={20} />
          Menu
        </summary>
        <div className="absolute top-full right-0 left-0 max-h-[calc(100dvh-4rem)] overflow-y-auto border-mp-border border-y bg-mp-ink px-4 py-6 shadow-mp-raised">
          <PrimaryNavigation idPrefix="mobile" onNavigate={closeNavigation} />
          <div className="mt-6 border-mp-border/30 border-t pt-5">
            <OrganizationControl idPrefix="mobile" inverse />
            <AccountActions onSignOut={onSignOut} signingOut={signingOut} />
          </div>
        </div>
      </details>
    </header>
  );
}

export function AppShell() {
  const auth = useAuthenticatedSession();
  const organization = useActiveOrganization();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      await auth.signOut();
      navigate("/sign-in", { replace: true });
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <a
        className="fixed top-3 left-3 z-50 -translate-y-24 bg-mp-signal px-4 py-3 font-semibold text-mp-ink focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <div className="app-shell min-h-svh bg-mp-canvas text-mp-ink">
        <aside className="hidden min-h-svh flex-col border-mp-border/35 border-r bg-mp-ink text-mp-paper lg:sticky lg:top-0 lg:flex lg:max-h-svh">
          <div className="flex min-h-20 items-center justify-between border-mp-border/30 border-b px-5">
            <Brand />
            <span className="border border-mp-border/30 px-2 py-1 font-mp-mono text-[0.5625rem] tracking-[0.16em] text-mp-border uppercase">
              alpha
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6">
            <PrimaryNavigation idPrefix="desktop" />
          </div>
          <div className="border-mp-border/30 border-t p-5">
            <OrganizationControl idPrefix="desktop" inverse />
            <AccountActions onSignOut={() => void handleSignOut()} signingOut={signingOut} />
          </div>
        </aside>

        <div className="min-w-0">
          <MobileHeader onSignOut={() => void handleSignOut()} signingOut={signingOut} />
          <header className="flex min-h-16 items-center justify-between gap-4 border-mp-border border-b bg-mp-panel px-4 sm:px-6 lg:min-h-20 lg:px-8">
            <div>
              <p className="font-mp-mono text-[0.625rem] tracking-[0.18em] text-mp-ink-muted uppercase">
                Metering operations
              </p>
              <p className="mt-1 text-sm font-semibold">{organization.active.organization.name}</p>
            </div>
            <StatusBadge tone="info">{organization.active.membership.role}</StatusBadge>
          </header>
          {signOutFailed ? (
            <div className="px-4 pt-4 sm:px-6 lg:px-8">
              <Notice title="Sign out failed" tone="danger">
                <p>Your session remains active. Try signing out again.</p>
              </Notice>
            </div>
          ) : null}
          <main
            className="ledger-surface min-h-[calc(100svh-8rem)]"
            id="main-content"
            tabIndex={-1}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
