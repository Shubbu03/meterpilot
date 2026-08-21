import type { Customer, CustomerSubject } from "@meterpilot/contracts/customers";
import { eventPropertiesSchema } from "@meterpilot/contracts/events";
import type { Database } from "@meterpilot/db";
import { auditLog, customers, subjects } from "@meterpilot/db/schema";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";

import { canManageCustomers } from "../organizations/authorization";
import { InvalidCustomerCursorError, type CustomerRepository } from "./repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CustomerRow = typeof customers.$inferSelect;
type SubjectRow = typeof subjects.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function encodeCursor(id: string): string {
  return Buffer.from(id).toString("base64url");
}

function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (Buffer.from(decoded).toString("base64url") !== cursor || !UUID_PATTERN.test(decoded)) {
    throw new InvalidCustomerCursorError();
  }
  return decoded;
}

function toSubject(row: SubjectRow): CustomerSubject {
  return {
    createdAt: row.createdAt.toISOString(),
    externalKey: row.externalKey,
    id: row.id,
  };
}

function toCustomer(row: CustomerRow, subjectRows: readonly SubjectRow[]): Customer {
  return {
    archivedAt: row.archivedAt?.toISOString() ?? null,
    billingTimezone: row.billingTimezone,
    createdAt: row.createdAt.toISOString(),
    email: row.email,
    externalKey: row.externalKey,
    id: row.id,
    metadata: eventPropertiesSchema.parse(row.metadata),
    name: row.name,
    subjects: subjectRows.map(toSubject),
  };
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

export function createDrizzleCustomerRepository(database: Database["db"]): CustomerRepository {
  return {
    async attachSubject(tenant, customerKey, input, requestId) {
      if (!canManageCustomers(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          const [customer] = await transaction
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.organizationId, tenant.organization.id),
                eq(customers.externalKey, customerKey),
                isNull(customers.archivedAt),
              ),
            )
            .limit(1);

          if (!customer) {
            return { status: "not_found" } as const;
          }

          const [subject] = await transaction
            .insert(subjects)
            .values({
              customerId: customer.id,
              externalKey: input.externalKey,
              organizationId: tenant.organization.id,
            })
            .returning();

          if (!subject) {
            throw new Error("Customer subject insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "customer.subject_attached",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: subject.id,
            resourceType: "customer_subject",
          });

          return { status: "ok", subject: toSubject(subject) } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "conflict" };
        }

        throw error;
      }
    },

    async create(tenant, input, requestId) {
      if (!canManageCustomers(tenant.membership.role)) {
        return { status: "forbidden" };
      }

      try {
        return await database.transaction(async (transaction) => {
          const [customer] = await transaction
            .insert(customers)
            .values({
              billingTimezone: input.billingTimezone,
              email: input.email ?? null,
              externalKey: input.externalKey,
              metadata: input.metadata,
              name: input.name,
              organizationId: tenant.organization.id,
            })
            .returning();

          if (!customer) {
            throw new Error("Customer insertion returned no row.");
          }

          const subjectKeys = [...new Set([input.externalKey, ...input.subjects])];
          const createdSubjects = await transaction
            .insert(subjects)
            .values(
              subjectKeys.map((externalKey) => ({
                customerId: customer.id,
                externalKey,
                organizationId: tenant.organization.id,
              })),
            )
            .returning();

          await writeAudit(transaction, {
            action: "customer.created",
            actorUserId: tenant.actorUserId,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: customer.id,
            resourceType: "customer",
          });

          return {
            customer: toCustomer(customer, createdSubjects),
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

    async find(organizationId, customerKey) {
      const [customer] = await database
        .select()
        .from(customers)
        .where(
          and(eq(customers.organizationId, organizationId), eq(customers.externalKey, customerKey)),
        )
        .limit(1);

      if (!customer) {
        return null;
      }

      const subjectRows = await database
        .select()
        .from(subjects)
        .where(
          and(eq(subjects.organizationId, organizationId), eq(subjects.customerId, customer.id)),
        )
        .orderBy(asc(subjects.createdAt), asc(subjects.id));

      return toCustomer(customer, subjectRows);
    },

    async list(tenant, page) {
      const cursor = decodeCursor(page.cursor);
      const rows = await database
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, tenant.organization.id),
            cursor ? gt(customers.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(customers.id))
        .limit(page.limit + 1);
      const hasNext = rows.length > page.limit;
      const selected = rows.slice(0, page.limit);
      const subjectRows =
        selected.length === 0
          ? []
          : await database
              .select()
              .from(subjects)
              .where(
                and(
                  eq(subjects.organizationId, tenant.organization.id),
                  inArray(
                    subjects.customerId,
                    selected.map((customer) => customer.id),
                  ),
                ),
              )
              .orderBy(asc(subjects.createdAt), asc(subjects.id));
      const subjectsByCustomer = new Map<string, SubjectRow[]>();
      for (const subject of subjectRows) {
        const current = subjectsByCustomer.get(subject.customerId) ?? [];
        current.push(subject);
        subjectsByCustomer.set(subject.customerId, current);
      }
      const items = selected.map((customer) =>
        toCustomer(customer, subjectsByCustomer.get(customer.id) ?? []),
      );
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last.id) : null,
      };
    },
  };
}
