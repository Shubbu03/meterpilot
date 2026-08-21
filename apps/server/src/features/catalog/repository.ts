import type {
  CancelSubscriptionRequest,
  CreatePlanRequest,
  CreatePlanVersionRequest,
  CreateSubscriptionRequest,
  Plan,
  PlanVersion,
  Subscription,
} from "@meterpilot/contracts/catalog";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

export type PlanMutationResult =
  | Readonly<{ plan: Plan; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type PlanVersionMutationResult =
  | Readonly<{ planVersion: PlanVersion; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type SubscriptionMutationResult =
  | Readonly<{ status: "ok"; subscription: Subscription }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type CatalogRepository = Readonly<{
  archivePlan: (
    tenant: TenantAuthorization,
    planKey: string,
    requestId: string,
  ) => Promise<PlanMutationResult>;
  archiveVersion: (
    tenant: TenantAuthorization,
    planKey: string,
    version: number,
    requestId: string,
  ) => Promise<PlanVersionMutationResult>;
  cancelSubscription: (
    tenant: TenantAuthorization,
    subscriptionId: string,
    input: CancelSubscriptionRequest,
    requestId: string,
  ) => Promise<SubscriptionMutationResult>;
  createPlan: (
    tenant: TenantAuthorization,
    input: CreatePlanRequest,
    requestId: string,
  ) => Promise<PlanMutationResult>;
  createSubscription: (
    tenant: TenantAuthorization,
    input: CreateSubscriptionRequest,
    requestId: string,
  ) => Promise<SubscriptionMutationResult>;
  createVersion: (
    tenant: TenantAuthorization,
    planKey: string,
    input: CreatePlanVersionRequest,
    requestId: string,
  ) => Promise<PlanVersionMutationResult>;
  findPlan: (organizationId: string, planKey: string) => Promise<Plan | null>;
  listPlans: (tenant: TenantAuthorization, page: PageRequest) => Promise<PageResult<Plan>>;
  listSubscriptions: (
    tenant: TenantAuthorization,
    page: PageRequest,
  ) => Promise<PageResult<Subscription>>;
  publishVersion: (
    tenant: TenantAuthorization,
    planKey: string,
    version: number,
    requestId: string,
  ) => Promise<PlanVersionMutationResult>;
}>;
