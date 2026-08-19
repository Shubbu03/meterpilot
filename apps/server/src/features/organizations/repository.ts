import type {
  AddOrganizationMemberRequest,
  CreateOrganizationRequest,
  Organization,
  OrganizationListItem,
  OrganizationMembership,
  OrganizationMembershipRole,
  UpdateOrganizationMemberRequest,
} from "@meterpilot/contracts/organizations";

import type { AuthenticatedSession } from "../identity/authentication";

export type PageRequest = Readonly<{
  cursor?: string | undefined;
  limit: number;
}>;

export type PageResult<TItem> = Readonly<{
  items: readonly TItem[];
  nextCursor: string | null;
}>;

export type TenantAuthorization = Readonly<{
  actorUserId: string;
  membership: OrganizationMembership;
  organization: Organization;
}>;

export type MembershipMutationResult =
  | Readonly<{ membership: OrganizationMembership; status: "ok" }>
  | Readonly<{
      status: "conflict" | "forbidden" | "last_owner" | "not_found";
    }>;

export type MembershipRemovalResult =
  | Readonly<{ status: "ok" }>
  | Readonly<{ status: "forbidden" | "last_owner" | "not_found" }>;

export type OrganizationRepository = Readonly<{
  addMembership: (
    tenant: TenantAuthorization,
    input: AddOrganizationMemberRequest,
    requestId: string,
  ) => Promise<MembershipMutationResult>;
  createOrganization: (
    actor: AuthenticatedSession["user"],
    input: CreateOrganizationRequest,
    requestId: string,
  ) => Promise<OrganizationListItem | null>;
  listMemberships: (
    tenant: TenantAuthorization,
    page: PageRequest,
  ) => Promise<PageResult<OrganizationMembership>>;
  listOrganizations: (
    actorUserId: string,
    page: PageRequest,
  ) => Promise<PageResult<OrganizationListItem>>;
  removeMembership: (
    tenant: TenantAuthorization,
    userId: string,
    requestId: string,
  ) => Promise<MembershipRemovalResult>;
  resolveTenant: (
    actorUserId: string,
    organizationId: string,
  ) => Promise<TenantAuthorization | null>;
  updateMembership: (
    tenant: TenantAuthorization,
    userId: string,
    input: UpdateOrganizationMemberRequest,
    requestId: string,
  ) => Promise<MembershipMutationResult>;
}>;

export type MembershipRow = Readonly<{
  createdAt: Date;
  email: string;
  name: string;
  role: OrganizationMembershipRole;
  userId: string;
}>;

export type OrganizationRow = Readonly<{
  createdAt: Date;
  defaultTimezone: string;
  id: string;
  name: string;
  slug: string;
}>;

export function toOrganization(row: OrganizationRow): Organization {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMembership(row: MembershipRow): OrganizationMembership {
  return {
    createdAt: row.createdAt.toISOString(),
    role: row.role,
    user: {
      email: row.email,
      id: row.userId,
      name: row.name,
    },
  };
}
