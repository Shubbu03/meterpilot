import type { OrganizationRepository } from "../src/features/organizations/repository";

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
