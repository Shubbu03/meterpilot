import { type DataRouter, RouterProvider } from "react-router";
import type { AuthState } from "../features/auth/auth-context";
import type { OrganizationState } from "../features/organizations/organization-context";
import { AppProviders } from "./providers";

export interface AppProps {
  authState?: AuthState | undefined;
  organizationState?: OrganizationState | undefined;
  router: DataRouter;
}

export function App({ authState, organizationState, router }: AppProps) {
  return (
    <AppProviders authState={authState} organizationState={organizationState}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
