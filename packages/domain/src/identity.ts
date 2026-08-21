import { DomainInvariantError } from "./errors";

declare const domainIdentifierBrand: unique symbol;

export type DomainIdentifier<TKind extends string> = string & {
  readonly [domainIdentifierBrand]: TKind;
};

export type OrganizationId = DomainIdentifier<"OrganizationId">;
export type CustomerId = DomainIdentifier<"CustomerId">;
export type UsageEventId = DomainIdentifier<"UsageEventId">;
export type MeterId = DomainIdentifier<"MeterId">;
export type MeterVersionId = DomainIdentifier<"MeterVersionId">;
export type PlanId = DomainIdentifier<"PlanId">;
export type PlanVersionId = DomainIdentifier<"PlanVersionId">;
export type SubscriptionId = DomainIdentifier<"SubscriptionId">;

export const ORGANIZATION_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "developer",
  "analyst",
  "support",
] as const;

export type OrganizationMembershipRole = (typeof ORGANIZATION_MEMBERSHIP_ROLES)[number];

export const API_KEY_SCOPES = [
  "events:write",
  "events:read",
  "usage:read",
  "reservations:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const IDENTIFIER_MAX_LENGTH = 128;

export function createDomainIdentifier<TKind extends string>(
  value: string,
  kind: TKind,
): DomainIdentifier<TKind> {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(normalized)
  ) {
    throw new DomainInvariantError(
      "invalid_identifier",
      `${kind} must contain only safe identifier characters and be at most ${IDENTIFIER_MAX_LENGTH} characters.`,
    );
  }

  return normalized as DomainIdentifier<TKind>;
}

export const organizationId = (value: string): OrganizationId =>
  createDomainIdentifier(value, "OrganizationId");
export const customerId = (value: string): CustomerId =>
  createDomainIdentifier(value, "CustomerId");
export const usageEventId = (value: string): UsageEventId =>
  createDomainIdentifier(value, "UsageEventId");
export const meterId = (value: string): MeterId => createDomainIdentifier(value, "MeterId");
export const meterVersionId = (value: string): MeterVersionId =>
  createDomainIdentifier(value, "MeterVersionId");
export const planId = (value: string): PlanId => createDomainIdentifier(value, "PlanId");
export const planVersionId = (value: string): PlanVersionId =>
  createDomainIdentifier(value, "PlanVersionId");
export const subscriptionId = (value: string): SubscriptionId =>
  createDomainIdentifier(value, "SubscriptionId");

export type TenantContext = Readonly<{
  organizationId: OrganizationId;
}>;

export function tenantContext(value: OrganizationId): TenantContext {
  return Object.freeze({ organizationId: value });
}
