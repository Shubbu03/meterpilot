import type { OrganizationRepository } from "../src/features/organizations/repository";
import type { ApiKeyService } from "../src/features/api-keys/service";
import type { ApiKeyRepository } from "../src/features/api-keys/repository";
import type { EventRepository } from "../src/features/events/repository";
import type { EventService } from "../src/features/events/service";
import type { CustomerRepository } from "../src/features/customers/repository";
import type { MeterRepository } from "../src/features/meters/repository";
import type { UsageRepository } from "../src/features/usage/repository";
import type { EntitlementRepository } from "../src/features/entitlements/repository";
import type { CatalogRepository } from "../src/features/catalog/repository";
import type { PreviewRepository } from "../src/features/previews/repository";
import type { SimulationRepository } from "../src/features/simulations/repository";
import type { OperationsRepository } from "../src/features/operations/repository";
import type { RetentionRepository } from "../src/features/retention/repository";
import type { JobOperationsRepository } from "../src/features/job-operations/repository";

export function createJobOperationsRepositoryStub(
  overrides: Partial<JobOperationsRepository> = {},
): JobOperationsRepository {
  return {
    findFailedJob: () => Promise.resolve({ status: "not_found" }),
    listFailedJobs: () => Promise.resolve({ page: { items: [], nextCursor: null }, status: "ok" }),
    retryFailedJob: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createRetentionRepositoryStub(
  overrides: Partial<RetentionRepository> = {},
): RetentionRepository {
  return {
    findPolicy: (tenant) =>
      Promise.resolve({
        eventPropertiesRetentionDays: null,
        organizationId: tenant.organization.id,
        updatedAt: null,
        updatedBy: null,
        version: 0,
      }),
    updatePolicy: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createOperationsRepositoryStub(
  overrides: Partial<OperationsRepository> = {},
): OperationsRepository {
  return {
    createExport: () => Promise.resolve({ status: "forbidden" }),
    createReconciliation: () => Promise.resolve({ status: "forbidden" }),
    createReplay: () => Promise.resolve({ status: "forbidden" }),
    exportPayload: () => Promise.resolve(null),
    findExport: () => Promise.resolve(null),
    findReconciliation: () => Promise.resolve(null),
    listAudit: () => Promise.resolve({ items: [], nextCursor: null }),
    listExports: () => Promise.resolve({ items: [], nextCursor: null }),
    listFindings: () => Promise.resolve(null),
    listReconciliations: () => Promise.resolve({ items: [], nextCursor: null }),
    ...overrides,
  };
}

export function createSimulationRepositoryStub(
  overrides: Partial<SimulationRepository> = {},
): SimulationRepository {
  return {
    create: () => Promise.resolve({ status: "forbidden" }),
    find: () => Promise.resolve(null),
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    listResults: () => Promise.resolve(null),
    report: () => Promise.resolve(null),
    ...overrides,
  };
}

export function createPreviewRepositoryStub(
  overrides: Partial<PreviewRepository> = {},
): PreviewRepository {
  return {
    create: () => Promise.resolve({ status: "forbidden" }),
    find: () => Promise.resolve(null),
    findRevision: () => Promise.resolve(null),
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    listRevisions: () => Promise.resolve(null),
    ...overrides,
  };
}

export function createCatalogRepositoryStub(
  overrides: Partial<CatalogRepository> = {},
): CatalogRepository {
  return {
    archivePlan: () => Promise.resolve({ status: "forbidden" }),
    archiveVersion: () => Promise.resolve({ status: "forbidden" }),
    cancelSubscription: () => Promise.resolve({ status: "forbidden" }),
    createPlan: () => Promise.resolve({ status: "forbidden" }),
    createSubscription: () => Promise.resolve({ status: "forbidden" }),
    createVersion: () => Promise.resolve({ status: "forbidden" }),
    findPlan: () => Promise.resolve(null),
    listPlans: () => Promise.resolve({ items: [], nextCursor: null }),
    listSubscriptions: () => Promise.resolve({ items: [], nextCursor: null }),
    publishVersion: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createEntitlementRepositoryStub(
  overrides: Partial<EntitlementRepository> = {},
): EntitlementRepository {
  return {
    addGrant: () => Promise.resolve({ status: "forbidden" }),
    commitReservation: () => Promise.resolve({ status: "forbidden" }),
    configure: () => Promise.resolve({ status: "forbidden" }),
    createFeature: () => Promise.resolve({ status: "forbidden" }),
    findBalance: () => Promise.resolve(null),
    listFeatures: () => Promise.resolve({ items: [], nextCursor: null }),
    releaseReservation: () => Promise.resolve({ status: "forbidden" }),
    reserve: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createUsageRepositoryStub(
  overrides: Partial<UsageRepository> = {},
): UsageRepository {
  return {
    getTimeseries: () => Promise.resolve({ status: "not_found" }),
    getTotal: () => Promise.resolve({ status: "not_found" }),
    ...overrides,
  };
}

export function createMeterRepositoryStub(
  overrides: Partial<MeterRepository> = {},
): MeterRepository {
  return {
    archive: () => Promise.resolve({ status: "forbidden" }),
    create: () => Promise.resolve({ status: "forbidden" }),
    createVersion: () => Promise.resolve({ status: "forbidden" }),
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    publish: () => Promise.resolve({ status: "forbidden" }),
    ...overrides,
  };
}

export function createCustomerRepositoryStub(
  overrides: Partial<CustomerRepository> = {},
): CustomerRepository {
  return {
    attachSubject: () => Promise.resolve({ status: "forbidden" }),
    create: () => Promise.resolve({ status: "forbidden" }),
    find: () => Promise.resolve(null),
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    ...overrides,
  };
}

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
    correct: () => Promise.resolve({ status: "not_found" }),
    find: () => Promise.resolve(null),
    ingest: () => Promise.resolve([]),
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    ...overrides,
  };
}

export function createEventServiceStub(overrides: Partial<EventService> = {}): EventService {
  return {
    correct: () => Promise.resolve({ status: "not_found" }),
    find: () => Promise.resolve(null),
    findForOrganization: () => Promise.resolve(null),
    ingestBatch: (_principal, _inputs, requestId) => Promise.resolve({ requestId, results: [] }),
    ingestOne: (_principal, _input, requestId) => Promise.resolve({ requestId, results: [] }),
    listForOrganization: () => Promise.resolve({ items: [], nextCursor: null }),
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
