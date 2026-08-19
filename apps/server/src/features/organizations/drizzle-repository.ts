import type { OrganizationMembershipRole } from "@meterpilot/contracts/organizations";
import type { Database } from "@meterpilot/db";
import { auditLog, memberships, organizations, users } from "@meterpilot/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";

import {
  canAssignMembershipRole,
  canChangeMembershipRole,
  canRemoveMembership,
} from "./authorization";
import { type OrganizationRepository, toMembership, toOrganization } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }

  const decoded = Buffer.from(cursor, "base64url").toString("utf8");

  if (!UUID_PATTERN.test(decoded)) {
    throw new InvalidPaginationCursorError();
  }

  return decoded;
}

export class InvalidPaginationCursorError extends Error {
  constructor() {
    super("The pagination cursor is invalid.");
    this.name = "InvalidPaginationCursorError";
  }
}

function organizationSelection() {
  return {
    createdAt: organizations.createdAt,
    defaultTimezone: organizations.defaultTimezone,
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
  };
}

function membershipSelection() {
  return {
    createdAt: memberships.createdAt,
    email: users.email,
    name: users.name,
    role: memberships.role,
    userId: users.id,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function writeAudit(
  database: Parameters<Parameters<Database["db"]["transaction"]>[0]>[0],
  input: Readonly<{
    action: string;
    actorUserId: string;
    organizationId: string;
    requestId: string;
    resourceId: string;
    resourceType: string;
  }>,
) {
  await database.insert(auditLog).values({
    action: input.action,
    actorType: "user",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
}

export function createDrizzleOrganizationRepository(
  database: Database["db"],
): OrganizationRepository {
  return {
    async addMembership(tenant, input, requestId) {
      try {
        return await database.transaction(async (transaction) => {
          const [actor] = await transaction
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, tenant.organization.id),
                eq(memberships.userId, tenant.actorUserId),
              ),
            )
            .for("update");

          if (!actor || !canAssignMembershipRole(actor.role, input.role)) {
            return { status: "forbidden" } as const;
          }

          const [user] = await transaction
            .select({ email: users.email, id: users.id, name: users.name })
            .from(users)
            .where(eq(users.email, input.email))
            .limit(1);

          if (!user) {
            return { status: "not_found" } as const;
          }

          const [created] = await transaction
            .insert(memberships)
            .values({
              organizationId: tenant.organization.id,
              role: input.role,
              userId: user.id,
            })
            .returning({ createdAt: memberships.createdAt, role: memberships.role });

          if (!created) {
            throw new Error("Membership insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "membership.created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: user.id,
            resourceType: "membership",
          });

          return {
            membership: toMembership({
              createdAt: created.createdAt,
              email: user.email,
              name: user.name,
              role: created.role,
              userId: user.id,
            }),
            status: "ok",
          } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }

        throw error;
      }
    },

    async createOrganization(actor, input, requestId) {
      try {
        return await database.transaction(async (transaction) => {
          const [organizationRow] = await transaction
            .insert(organizations)
            .values({
              defaultTimezone: input.defaultTimezone,
              name: input.name,
              slug: input.slug,
            })
            .returning(organizationSelection());

          if (!organizationRow) {
            throw new Error("Organization insertion returned no row.");
          }

          const [membershipRow] = await transaction
            .insert(memberships)
            .values({
              organizationId: organizationRow.id,
              role: "owner",
              userId: actor.id,
            })
            .returning({ createdAt: memberships.createdAt, role: memberships.role });

          if (!membershipRow) {
            throw new Error("Owner membership insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "organization.created",
            actorUserId: actor.id,
            organizationId: organizationRow.id,
            requestId,
            resourceId: organizationRow.id,
            resourceType: "organization",
          });

          return {
            membership: toMembership({
              createdAt: membershipRow.createdAt,
              email: actor.email,
              name: actor.name,
              role: membershipRow.role,
              userId: actor.id,
            }),
            organization: toOrganization(organizationRow),
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return null;
        }

        throw error;
      }
    },

    async listMemberships(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select(membershipSelection())
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, tenant.organization.id),
            cursor ? gt(memberships.userId, cursor) : undefined,
          ),
        )
        .orderBy(asc(memberships.userId))
        .limit(page.limit + 1);
      const hasNextPage = rows.length > page.limit;
      const items = rows.slice(0, page.limit).map(toMembership);
      const lastItem = items.at(-1);

      return {
        items,
        nextCursor: hasNextPage && lastItem ? encodeCursor(lastItem.user.id) : null,
      };
    },

    async listOrganizations(actorUserId, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select({
          membership: membershipSelection(),
          organization: organizationSelection(),
        })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.userId, actorUserId),
            cursor ? gt(organizations.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(organizations.id))
        .limit(page.limit + 1);
      const hasNextPage = rows.length > page.limit;
      const visibleRows = rows.slice(0, page.limit);
      const lastRow = visibleRows.at(-1);

      return {
        items: visibleRows.map((row) => ({
          membership: toMembership(row.membership),
          organization: toOrganization(row.organization),
        })),
        nextCursor: hasNextPage && lastRow ? encodeCursor(lastRow.organization.id) : null,
      };
    },

    async removeMembership(tenant, userId, requestId) {
      return database.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, tenant.actorUserId),
            ),
          )
          .for("update");
        const [target] = await transaction
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, userId),
            ),
          )
          .for("update");

        if (!target) {
          return { status: "not_found" };
        }

        if (!actor || !canRemoveMembership(actor.role, target.role)) {
          return { status: "forbidden" };
        }

        if (target.role === "owner") {
          const owners = await transaction
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, tenant.organization.id),
                eq(memberships.role, "owner"),
              ),
            )
            .for("update");

          if (owners.length === 1) {
            return { status: "last_owner" };
          }
        }

        await transaction
          .delete(memberships)
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, userId),
            ),
          );
        await writeAudit(transaction, {
          action: "membership.removed",
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: userId,
          resourceType: "membership",
        });

        return { status: "ok" };
      });
    },

    async resolveTenant(actorUserId, organizationId) {
      const [row] = await database
        .select({
          membership: membershipSelection(),
          organization: organizationSelection(),
        })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.userId, actorUserId)),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      return {
        actorUserId,
        membership: toMembership(row.membership),
        organization: toOrganization(row.organization),
      };
    },

    async updateMembership(tenant, userId, input, requestId) {
      return database.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, tenant.actorUserId),
            ),
          )
          .for("update");
        const [target] = await transaction
          .select(membershipSelection())
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, userId),
            ),
          )
          .for("update");

        if (!target) {
          return { status: "not_found" };
        }

        if (!actor || !canChangeMembershipRole(actor.role, target.role, input.role)) {
          return { status: "forbidden" };
        }

        if (target.role === "owner" && input.role !== "owner") {
          const owners = await transaction
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, tenant.organization.id),
                eq(memberships.role, "owner"),
              ),
            )
            .for("update");

          if (owners.length === 1) {
            return { status: "last_owner" };
          }
        }

        const [updated] = await transaction
          .update(memberships)
          .set({ role: input.role })
          .where(
            and(
              eq(memberships.organizationId, tenant.organization.id),
              eq(memberships.userId, userId),
            ),
          )
          .returning({ createdAt: memberships.createdAt, role: memberships.role });

        if (!updated) {
          return { status: "not_found" };
        }

        await writeAudit(transaction, {
          action: "membership.role_changed",
          actorUserId: tenant.actorUserId,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: userId,
          resourceType: "membership",
        });

        return {
          membership: toMembership({
            ...target,
            createdAt: updated.createdAt,
            role: updated.role as OrganizationMembershipRole,
          }),
          status: "ok",
        };
      });
    },
  };
}
