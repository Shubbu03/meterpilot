import type { AuthenticatedSession } from "../features/identity/authentication";
import type { TenantAuthorization } from "../features/organizations/repository";

export type AppEnvironment = Readonly<{
  Variables: {
    authenticatedSession: AuthenticatedSession;
    tenant: TenantAuthorization;
  };
}>;
