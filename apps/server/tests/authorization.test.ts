import { describe, expect, test } from "bun:test";

import {
  canAssignMembershipRole,
  canChangeMembershipRole,
  canRemoveMembership,
} from "../src/features/organizations/authorization";

describe("organization membership authorization", () => {
  test("allows owners to manage every membership role", () => {
    expect(canAssignMembershipRole("owner", "owner")).toBe(true);
    expect(canChangeMembershipRole("owner", "admin", "owner")).toBe(true);
    expect(canRemoveMembership("owner", "owner")).toBe(true);
  });

  test("limits administrators to non-privileged roles", () => {
    expect(canAssignMembershipRole("admin", "developer")).toBe(true);
    expect(canAssignMembershipRole("admin", "admin")).toBe(false);
    expect(canAssignMembershipRole("admin", "owner")).toBe(false);
    expect(canChangeMembershipRole("admin", "developer", "analyst")).toBe(true);
    expect(canChangeMembershipRole("admin", "admin", "developer")).toBe(false);
    expect(canRemoveMembership("admin", "owner")).toBe(false);
  });

  test("prevents ordinary members from managing memberships", () => {
    expect(canAssignMembershipRole("developer", "support")).toBe(false);
    expect(canChangeMembershipRole("analyst", "support", "developer")).toBe(false);
    expect(canRemoveMembership("support", "support")).toBe(false);
  });
});
