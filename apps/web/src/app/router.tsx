import {
  createBrowserRouter,
  createMemoryRouter,
  type InitialEntry,
  Outlet,
  type RouteObject,
} from "react-router";
import { ApiKeysPage } from "../features/administration/api-keys-page";
import { FailedJobsPage } from "../features/administration/failed-jobs-page";
import { MembersPage } from "../features/administration/members-page";
import { RetentionPage } from "../features/administration/retention-page";
import { PublicOnlyRoute, RequireSession } from "../features/auth/auth-boundaries";
import { SignInPage, SignUpPage } from "../features/auth/auth-pages";
import { PlansPage } from "../features/catalog/plans-page";
import { SubscriptionsPage } from "../features/catalog/subscriptions-page";
import { CustomerDetailPage } from "../features/customers/customer-detail-page";
import { CustomersPage } from "../features/customers/customers-page";
import { FeaturesPage } from "../features/entitlements/features-page";
import { EventDetailPage } from "../features/events/event-detail-page";
import { EventsPage } from "../features/events/events-page";
import { NotFoundPage } from "../features/foundation/not-found-page";
import { MetersPage } from "../features/meters/meters-page";
import {
  AuditLogPage,
  ExportsPage,
  ReconciliationPage,
} from "../features/operations/operations-pages";
import { OnboardingPage } from "../features/organizations/onboarding-page";
import { RequireOrganization } from "../features/organizations/organization-boundaries";
import { OrganizationProvider } from "../features/organizations/organization-context";
import { OverviewPage } from "../features/overview/overview-page";
import { PreviewDetailPage } from "../features/previews/preview-detail-page";
import { PreviewsPage } from "../features/previews/previews-page";
import { SimulationDetailPage } from "../features/simulations/simulation-detail-page";
import { SimulationsPage } from "../features/simulations/simulations-page";
import { UsagePage } from "../features/usage/usage-page";
import { AppShell } from "./shell/app-shell";

const routes: RouteObject[] = [
  {
    Component: PublicOnlyRoute,
    children: [
      { Component: SignInPage, path: "/sign-in" },
      { Component: SignUpPage, path: "/sign-up" },
    ],
  },
  {
    Component: RequireSession,
    children: [
      {
        element: (
          <OrganizationProvider>
            <Outlet />
          </OrganizationProvider>
        ),
        children: [
          { Component: OnboardingPage, path: "/onboarding" },
          {
            Component: RequireOrganization,
            children: [
              {
                Component: AppShell,
                children: [
                  { Component: OverviewPage, index: true },
                  { Component: EventsPage, path: "events" },
                  { Component: EventDetailPage, path: "events/:eventKey" },
                  { Component: UsagePage, path: "usage" },
                  { Component: CustomersPage, path: "customers" },
                  { Component: CustomerDetailPage, path: "customers/:customerKey" },
                  { Component: MetersPage, path: "meters" },
                  { Component: FeaturesPage, path: "features" },
                  { Component: PlansPage, path: "plans" },
                  { Component: SubscriptionsPage, path: "subscriptions" },
                  { Component: PreviewsPage, path: "previews" },
                  { Component: PreviewDetailPage, path: "previews/:previewId" },
                  { Component: SimulationsPage, path: "simulations" },
                  { Component: SimulationDetailPage, path: "simulations/:simulationId" },
                  { Component: ReconciliationPage, path: "reconciliation" },
                  { Component: ApiKeysPage, path: "api-keys" },
                  { Component: ExportsPage, path: "exports" },
                  { Component: AuditLogPage, path: "audit-log" },
                  { Component: FailedJobsPage, path: "failed-jobs" },
                  { Component: RetentionPage, path: "retention" },
                  { Component: MembersPage, path: "members" },
                  { Component: NotFoundPage, path: "*" },
                ],
                path: "/",
              },
            ],
          },
        ],
      },
    ],
  },
];

export function createBrowserAppRouter() {
  return createBrowserRouter(routes);
}

export function createMemoryAppRouter(initialEntries: InitialEntry[] = ["/"]) {
  return createMemoryRouter(routes, { initialEntries });
}
