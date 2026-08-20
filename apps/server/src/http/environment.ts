import type { AuthenticatedSession } from "../features/identity/authentication";
import type { ApiKeyPrincipal } from "../features/api-keys/repository";
import type { TenantAuthorization } from "../features/organizations/repository";

export type AppEnvironment = Readonly<{
  Variables: {
    apiKeyPrincipal: ApiKeyPrincipal;
    authenticatedSession: AuthenticatedSession;
    tenant: TenantAuthorization;
  };
}>;
