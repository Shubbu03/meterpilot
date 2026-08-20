import { apiKeyScopeSchema, type ApiKey, type ApiKeyScope } from "@meterpilot/contracts/api-keys";
import type { Database } from "@meterpilot/db";
import { apiKeys, auditLog, memberships } from "@meterpilot/db/schema";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import { canManageApiKeys } from "../organizations/authorization";
import type { ApiKeyAuthenticationCandidate, ApiKeyRepository } from "./repository";

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
    throw new InvalidApiKeyCursorError();
  }

  return decoded;
}

export class InvalidApiKeyCursorError extends Error {
  constructor() {
    super("The API key pagination cursor is invalid.");
    this.name = "InvalidApiKeyCursorError";
  }
}

function apiKeySelection() {
  return {
    createdAt: apiKeys.createdAt,
    expiresAt: apiKeys.expiresAt,
    id: apiKeys.id,
    lastUsedAt: apiKeys.lastUsedAt,
    prefix: apiKeys.prefix,
    revokedAt: apiKeys.revokedAt,
    scopes: apiKeys.scopes,
  };
}

type ApiKeyRow = Readonly<{
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  prefix: string;
  revokedAt: Date | null;
  scopes: string[];
}>;

function parseScopes(scopes: readonly string[]): readonly ApiKeyScope[] {
  return apiKeyScopeSchema.array().parse(scopes);
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    id: row.id,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    prefix: row.prefix,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    scopes: [...parseScopes(row.scopes)],
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

async function findActorRole(database: Transaction, organizationId: string, actorUserId: string) {
  const [actor] = await database
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, actorUserId)))
    .for("update");
  return actor?.role;
}

async function writeAudit(
  database: Transaction,
  input: Readonly<{
    action: string;
    actorUserId: string;
    metadata?: Record<string, unknown>;
    occurredAt: Date;
    organizationId: string;
    requestId: string;
    resourceId: string;
  }>,
) {
  await database.insert(auditLog).values({
    action: input.action,
    actorType: "user",
    actorUserId: input.actorUserId,
    metadata: input.metadata,
    occurredAt: input.occurredAt,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceType: "api_key",
  });
}

export function createDrizzleApiKeyRepository(database: Database["db"]): ApiKeyRepository {
  return {
    async activate(candidate, usedAt) {
      const activated = await database
        .update(apiKeys)
        .set({ lastUsedAt: usedAt })
        .where(
          and(
            eq(apiKeys.id, candidate.apiKeyId),
            eq(apiKeys.organizationId, candidate.organizationId),
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, usedAt)),
          ),
        )
        .returning({ id: apiKeys.id });
      return activated.length === 1;
    },

    async create(tenant, write, requestId) {
      try {
        return await database.transaction(async (transaction) => {
          const role = await findActorRole(transaction, tenant.organization.id, tenant.actorUserId);
          if (!role || !canManageApiKeys(role)) {
            return { status: "forbidden" } as const;
          }

          const [created] = await transaction
            .insert(apiKeys)
            .values({
              createdAt: write.createdAt,
              expiresAt: write.expiresAt,
              organizationId: tenant.organization.id,
              prefix: write.prefix,
              scopes: [...write.scopes],
              secretHash: write.secretHash,
            })
            .returning(apiKeySelection());

          if (!created) {
            throw new Error("API key insertion returned no row.");
          }

          await writeAudit(transaction, {
            action: "api_key.created",
            actorUserId: tenant.actorUserId,
            metadata: { scopes: [...write.scopes] },
            occurredAt: write.createdAt,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: created.id,
          });

          return { apiKey: toApiKey(created), status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "prefix_conflict" };
        }

        throw error;
      }
    },

    async findAuthenticationCandidate(prefix) {
      const [candidate] = await database
        .select({
          apiKeyId: apiKeys.id,
          expiresAt: apiKeys.expiresAt,
          organizationId: apiKeys.organizationId,
          revokedAt: apiKeys.revokedAt,
          scopes: apiKeys.scopes,
          secretHash: apiKeys.secretHash,
        })
        .from(apiKeys)
        .where(eq(apiKeys.prefix, prefix))
        .limit(1);

      if (!candidate) {
        return null;
      }

      const result: ApiKeyAuthenticationCandidate = {
        ...candidate,
        scopes: parseScopes(candidate.scopes),
      };
      return result;
    },

    async list(tenant, page) {
      return database.transaction(async (transaction) => {
        const role = await findActorRole(transaction, tenant.organization.id, tenant.actorUserId);
        if (!role || !canManageApiKeys(role)) {
          return { status: "forbidden" };
        }

        const cursor = decodeCursor(page.cursor);
        const rows = await transaction
          .select(apiKeySelection())
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.organizationId, tenant.organization.id),
              cursor ? gt(apiKeys.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(apiKeys.id))
          .limit(page.limit + 1);
        const hasNextPage = rows.length > page.limit;
        const visibleRows = rows.slice(0, page.limit);
        const lastRow = visibleRows.at(-1);

        return {
          page: {
            items: visibleRows.map(toApiKey),
            nextCursor: hasNextPage && lastRow ? encodeCursor(lastRow.id) : null,
          },
          status: "ok",
        };
      });
    },

    async revoke(tenant, apiKeyId, revokedAt, requestId) {
      return database.transaction(async (transaction) => {
        const role = await findActorRole(transaction, tenant.organization.id, tenant.actorUserId);
        if (!role || !canManageApiKeys(role)) {
          return { status: "forbidden" };
        }

        const [existing] = await transaction
          .select(apiKeySelection())
          .from(apiKeys)
          .where(and(eq(apiKeys.organizationId, tenant.organization.id), eq(apiKeys.id, apiKeyId)))
          .for("update");

        if (!existing) {
          return { status: "not_found" };
        }

        if (existing.revokedAt) {
          return { apiKey: toApiKey(existing), status: "ok" };
        }

        const [revoked] = await transaction
          .update(apiKeys)
          .set({ revokedAt })
          .where(
            and(
              eq(apiKeys.organizationId, tenant.organization.id),
              eq(apiKeys.id, apiKeyId),
              isNull(apiKeys.revokedAt),
            ),
          )
          .returning(apiKeySelection());

        if (!revoked) {
          return { status: "not_found" };
        }

        await writeAudit(transaction, {
          action: "api_key.revoked",
          actorUserId: tenant.actorUserId,
          occurredAt: revokedAt,
          organizationId: tenant.organization.id,
          requestId,
          resourceId: apiKeyId,
        });

        return { apiKey: toApiKey(revoked), status: "ok" };
      });
    },

    async rotate(tenant, apiKeyId, write, requestId) {
      try {
        return await database.transaction(async (transaction) => {
          const role = await findActorRole(transaction, tenant.organization.id, tenant.actorUserId);
          if (!role || !canManageApiKeys(role)) {
            return { status: "forbidden" } as const;
          }

          const [existing] = await transaction
            .select(apiKeySelection())
            .from(apiKeys)
            .where(
              and(eq(apiKeys.organizationId, tenant.organization.id), eq(apiKeys.id, apiKeyId)),
            )
            .for("update");

          if (!existing) {
            return { status: "not_found" } as const;
          }

          if (existing.revokedAt) {
            return { status: "revoked" } as const;
          }

          if (existing.expiresAt && existing.expiresAt <= write.createdAt) {
            return { status: "expired" } as const;
          }

          const [replacement] = await transaction
            .insert(apiKeys)
            .values({
              createdAt: write.createdAt,
              expiresAt: existing.expiresAt,
              organizationId: tenant.organization.id,
              prefix: write.prefix,
              scopes: existing.scopes,
              secretHash: write.secretHash,
            })
            .returning(apiKeySelection());

          if (!replacement) {
            throw new Error("Rotated API key insertion returned no row.");
          }

          await transaction
            .update(apiKeys)
            .set({ revokedAt: write.createdAt })
            .where(
              and(
                eq(apiKeys.organizationId, tenant.organization.id),
                eq(apiKeys.id, apiKeyId),
                isNull(apiKeys.revokedAt),
              ),
            );
          await writeAudit(transaction, {
            action: "api_key.rotated",
            actorUserId: tenant.actorUserId,
            metadata: { replacementApiKeyId: replacement.id },
            occurredAt: write.createdAt,
            organizationId: tenant.organization.id,
            requestId,
            resourceId: apiKeyId,
          });

          return { apiKey: toApiKey(replacement), status: "ok" } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { status: "prefix_conflict" };
        }

        throw error;
      }
    },
  };
}
