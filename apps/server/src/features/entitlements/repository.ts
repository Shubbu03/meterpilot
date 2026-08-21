import type {
  CommitQuotaReservationRequest,
  ConfigureEntitlementRequest,
  CreateFeatureRequest,
  CreateQuotaGrantRequest,
  CreateQuotaReservationRequest,
  EntitlementBalance,
  Feature,
  QuotaGrant,
  QuotaReservation,
} from "@meterpilot/contracts/entitlements";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";
import type { ApiKeyPrincipal } from "../api-keys/repository";

export type ReservationAuthorization = ApiKeyPrincipal | TenantAuthorization;

export class InvalidFeatureCursorError extends Error {
  override readonly name = "InvalidFeatureCursorError";

  constructor() {
    super("The pagination cursor is invalid.");
  }
}

export type FeatureMutationResult =
  | Readonly<{ feature: Feature; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type EntitlementMutationResult =
  | Readonly<{ entitlement: EntitlementBalance; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type QuotaGrantMutationResult =
  | Readonly<{ entitlement: EntitlementBalance; grant: QuotaGrant; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "not_found" }>;

export type QuotaReservationMutationResult =
  | Readonly<{
      entitlement: EntitlementBalance;
      reservation: QuotaReservation;
      status: "ok";
    }>
  | Readonly<{
      status:
        | "conflict"
        | "expired"
        | "forbidden"
        | "idempotency_conflict"
        | "not_found"
        | "over_limit";
    }>;

export type EntitlementRepository = Readonly<{
  addGrant: (
    tenant: TenantAuthorization,
    customerKey: string,
    featureKey: string,
    input: CreateQuotaGrantRequest,
    requestId: string,
  ) => Promise<QuotaGrantMutationResult>;
  configure: (
    tenant: TenantAuthorization,
    customerKey: string,
    featureKey: string,
    input: ConfigureEntitlementRequest,
    requestId: string,
  ) => Promise<EntitlementMutationResult>;
  commitReservation: (
    authorization: ReservationAuthorization,
    reservationId: string,
    input: CommitQuotaReservationRequest,
    requestId: string,
  ) => Promise<QuotaReservationMutationResult>;
  createFeature: (
    tenant: TenantAuthorization,
    input: CreateFeatureRequest,
    requestId: string,
  ) => Promise<FeatureMutationResult>;
  findBalance: (
    organizationId: string,
    customerKey: string,
    featureKey: string,
    at: Date,
  ) => Promise<EntitlementBalance | null>;
  listFeatures: (tenant: TenantAuthorization, page: PageRequest) => Promise<PageResult<Feature>>;
  releaseReservation: (
    authorization: ReservationAuthorization,
    reservationId: string,
    requestId: string,
  ) => Promise<QuotaReservationMutationResult>;
  reserve: (
    authorization: ReservationAuthorization,
    customerKey: string,
    input: CreateQuotaReservationRequest,
    requestId: string,
  ) => Promise<QuotaReservationMutationResult>;
}>;
