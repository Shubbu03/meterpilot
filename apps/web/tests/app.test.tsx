import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../src/app/app";
import { createMemoryAppRouter } from "../src/app/router";
import type { AuthState } from "../src/features/auth/auth-context";
import type { OrganizationState } from "../src/features/organizations/organization-context";

const testUser = {
  email: "owner@example.com",
  id: "11111111-1111-4111-8111-111111111111",
  name: "Owner",
} as const;

const authState: AuthState = {
  session: {
    session: { id: "session-1" },
    user: testUser,
  },
  signOut: () => Promise.resolve(),
  status: "authenticated",
};

const organizationItem = {
  membership: {
    createdAt: "2026-08-21T09:00:00.000Z",
    role: "owner",
    user: testUser,
  },
  organization: {
    createdAt: "2026-08-21T09:00:00.000Z",
    defaultTimezone: "UTC",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Acme",
    slug: "acme",
  },
} as const;

const organizationState: OrganizationState = {
  active: organizationItem,
  organizations: [organizationItem],
  selectOrganization: () => undefined,
  status: "ready",
};

describe("web application shell", () => {
  test("renders the grouped product navigation and live overview shell", () => {
    const router = createMemoryAppRouter();
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain("Primary navigation");
    expect(markup).toContain("Operate");
    expect(markup).toContain("Configure");
    expect(markup).toContain("Verify");
    expect(markup).toContain("Administration");
    expect(markup).toContain("Connected");
    expect(markup).toContain("Acme");
    expect(markup).toContain("owner@example.com");
    expect(markup).toContain("Know what was used");
    expect(markup).toContain("Evidence, not estimates");
    expect(markup).not.toContain("$0.00");
  });

  test("renders the event explorer as a connected product route", () => {
    const router = createMemoryAppRouter(["/events"]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain("Event explorer");
    expect(markup).toContain("Narrow the ledger");
    expect(markup).not.toContain("Route reserved");
  });

  test("renders the usage query workspace without a fabricated total", () => {
    const router = createMemoryAppRouter(["/usage"]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain("Usage lens");
    expect(markup).toContain("Select usage scope");
    expect(markup).toContain("No usage query has been run");
    expect(markup).not.toContain("$0.00");
  });

  test.each([
    ["/customers", "Create customer", "Customer records"],
    ["/meters", "Create meter identity", "Meter definitions"],
    ["/features", "Create product feature", "Entitlement balance"],
  ])("renders the connected configuration workspace at %s", (path, primary, secondary) => {
    const router = createMemoryAppRouter([path]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain(primary);
    expect(markup).toContain(secondary);
    expect(markup).not.toContain("Route reserved");
  });

  test("renders a bounded not-found state for unknown routes", () => {
    const router = createMemoryAppRouter(["/unknown"]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain("Page not found");
    expect(markup).toContain("Return to overview");
  });

  test.each([
    ["/plans", "Draft version", "Plan lifecycle"],
    ["/subscriptions", "Create subscription", "Assignments"],
    ["/previews", "Request preview", "Preview ledger"],
    ["/simulations", "Run comparison", "Simulation history"],
  ])("renders the connected commercial workspace at %s", (path, primary, secondary) => {
    const router = createMemoryAppRouter([path]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain(primary);
    expect(markup).toContain(secondary);
    expect(markup).not.toContain("Route reserved");
  });

  test.each([
    ["/reconciliation", "Start reconciliation", "Run history"],
    ["/api-keys", "Issue credential", "API keys"],
    ["/exports", "Stripe customer ID", "Exports"],
    ["/audit-log", "Immutable evidence", "Audit log"],
    ["/failed-jobs", "Recovery", "Failed jobs"],
    ["/retention", "Event property retention", "Retention"],
    ["/members", "Member email", "Members"],
  ])("renders the connected operations workspace at %s", (path, primary, secondary) => {
    const router = createMemoryAppRouter([path]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={organizationState} router={router} />,
    );

    expect(markup).toContain(primary);
    expect(markup).toContain(secondary);
  });

  test("renders the real sign-in screen and an expired-session notice", () => {
    const router = createMemoryAppRouter([
      { pathname: "/sign-in", state: { from: "/events", reason: "expired" } },
    ]);
    const markup = renderToStaticMarkup(
      <App authState={{ reason: "expired", status: "unauthenticated" }} router={router} />,
    );

    expect(markup).toContain("Return to the ledger");
    expect(markup).toContain("Session expired");
    expect(markup).toContain("Create one");
  });

  test("renders organization onboarding for an authenticated user without a tenant", () => {
    const router = createMemoryAppRouter(["/onboarding"]);
    const markup = renderToStaticMarkup(
      <App authState={authState} organizationState={{ status: "empty" }} router={router} />,
    );

    expect(markup).toContain("Create your organization");
    expect(markup).toContain("Organization identity");
    expect(markup).toContain("owner@example.com");
  });
});
