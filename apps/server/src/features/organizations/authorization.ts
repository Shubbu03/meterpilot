import type { OrganizationMembershipRole } from "@meterpilot/contracts/organizations";

const ADMIN_MANAGEABLE_ROLES: ReadonlySet<OrganizationMembershipRole> = new Set([
  "developer",
  "analyst",
  "support",
]);

export function canAssignMembershipRole(
  actorRole: OrganizationMembershipRole,
  assignedRole: OrganizationMembershipRole,
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  return actorRole === "admin" && ADMIN_MANAGEABLE_ROLES.has(assignedRole);
}

export function canChangeMembershipRole(
  actorRole: OrganizationMembershipRole,
  currentRole: OrganizationMembershipRole,
  nextRole: OrganizationMembershipRole,
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  return (
    actorRole === "admin" &&
    ADMIN_MANAGEABLE_ROLES.has(currentRole) &&
    ADMIN_MANAGEABLE_ROLES.has(nextRole)
  );
}

export function canRemoveMembership(
  actorRole: OrganizationMembershipRole,
  targetRole: OrganizationMembershipRole,
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  return actorRole === "admin" && ADMIN_MANAGEABLE_ROLES.has(targetRole);
}
