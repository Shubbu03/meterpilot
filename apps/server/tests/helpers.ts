import type { OrganizationRepository } from "../src/features/organizations/repository";
import type { ApiKeyService } from "../src/features/api-keys/service";
import type { ApiKeyRepository } from "../src/features/api-keys/repository";
import type { EventRepository } from "../src/features/events/repository";
import type { EventService } from "../src/features/events/service";

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

export function createEventRepositoryStub(
  overrides: Partial<EventRepository> = {},
): EventRepository {
  return {
    find: () => Promise.resolve(null),
    ingest: () => Promise.resolve([]),
    ...overrides,
  };
}

export function createEventServiceStub(overrides: Partial<EventService> = {}): EventService {
  return {
    find: () => Promise.resolve(null),
    ingestBatch: (_principal, _inputs, requestId) => Promise.resolve({ requestId, results: [] }),
    ingestOne: (_principal, _input, requestId) => Promise.resolve({ requestId, results: [] }),
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
