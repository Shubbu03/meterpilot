import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AuthProvider, type AuthState } from "../features/auth/auth-context";
import {
  OrganizationProvider,
  type OrganizationState,
} from "../features/organizations/organization-context";
import { queryClient } from "../lib/query-client";

export interface AppProvidersProps {
  authState?: AuthState | undefined;
  children: ReactNode;
  organizationState?: OrganizationState | undefined;
}

export function AppProviders({ authState, children, organizationState }: AppProvidersProps) {
  const content = organizationState ? (
    <OrganizationProvider value={organizationState}>{children}</OrganizationProvider>
  ) : (
    children
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider value={authState}>{content}</AuthProvider>
    </QueryClientProvider>
  );
}
