import type { OrganizationRepository } from "../src/features/organizations/repository";
import type { ApiKeyService } from "../src/features/api-keys/service";
import type { ApiKeyRepository } from "../src/features/api-keys/repository";

export function createApiKeyRepositoryStub(
  overrides: Partial<ApiKeyRepository> = {},
): ApiKeyRepository {
  return {
    activate: () => Promise.resolve(false),
    create: () => Promise.resolve({ status: "forbidden" }),
    findAuthenticationCandidate: () => Promise.resolve(null),
    list: () => Promise.resolve({ status: "forbidden" }),
    revoke: () => Promise.resolve({ status: "forbidden" }),
    rotate: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createApiKeyServiceStub(overrides: Partial<ApiKeyService> = {}): ApiKeyService {
  return {
    authenticate: () => Promise.resolve(null),
    create: () => Promise.resolve({ status: "forbidden" }),
    list: () => Promise.resolve({ status: "forbidden" }),
    revoke: () => Promise.resolve({ status: "forbidden" }),
    rotate: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createOrganizationRepositoryStub(
  overrides: Partial<OrganizationRepository> = {},
): OrganizationRepository {
  return {
    addMembership: () => Promise.resolve({ status: "forbidden" }),
    createOrganization: () => Promise.resolve(null),
    listMemberships: () => Promise.resolve({ items: [], nextCursor: null }),
    listOrganizations: () => Promise.resolve({ items: [], nextCursor: null }),
    removeMembership: () => Promise.resolve({ status: "forbidden" }),
    resolveTenant: () => Promise.resolve(null),
    updateMembership: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}
