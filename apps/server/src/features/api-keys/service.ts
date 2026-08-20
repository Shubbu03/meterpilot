import type { ApiKey, CreateApiKeyRequest } from "@meterpilot/contracts/api-keys";

import {
  generateApiKey,
  parseApiKeyPrefix,
  verifyApiKeyHash,
  type GeneratedApiKey,
} from "./credentials";
import type { ApiKeyPrincipal, ApiKeyRepository, ApiKeyRevokeResult } from "./repository";
import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

const MAX_GENERATION_ATTEMPTS = 3;
const DUMMY_SECRET_HASH = "0".repeat(64);

export type RevealedApiKey = Readonly<{
  apiKey: ApiKey;
  key: string;
}>;

export type CreateApiKeyServiceResult =
  | Readonly<{ revealed: RevealedApiKey; status: "ok" }>
  | Readonly<{ status: "conflict" | "forbidden" | "invalid_expiration" }>;

export type RotateApiKeyServiceResult =
  | Readonly<{ revealed: RevealedApiKey; status: "ok" }>
  | Readonly<{ status: "conflict" | "expired" | "forbidden" | "not_found" | "revoked" }>;

export type ListApiKeysServiceResult =
  | Readonly<{ page: PageResult<ApiKey>; status: "ok" }>
  | Readonly<{ status: "forbidden" }>;

export type ApiKeyAuthenticator = Readonly<{
  authenticate: (key: string) => Promise<ApiKeyPrincipal | null>;
}>;

export type ApiKeyService = ApiKeyAuthenticator &
  Readonly<{
    create: (
      tenant: TenantAuthorization,
      input: CreateApiKeyRequest,
      requestId: string,
    ) => Promise<CreateApiKeyServiceResult>;
    list: (tenant: TenantAuthorization, page: PageRequest) => Promise<ListApiKeysServiceResult>;
    revoke: (
      tenant: TenantAuthorization,
      apiKeyId: string,
      requestId: string,
    ) => Promise<ApiKeyRevokeResult>;
    rotate: (
      tenant: TenantAuthorization,
      apiKeyId: string,
      requestId: string,
    ) => Promise<RotateApiKeyServiceResult>;
  }>;

export type ApiKeyServiceOptions = Readonly<{
  generate?: () => GeneratedApiKey;
  now?: () => Date;
}>;

function parseExpiration(value: string | undefined, now: Date): Date | null | undefined {
  if (!value) {
    return null;
  }

  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    return undefined;
  }

  return expiresAt;
}

export function createApiKeyService(
  repository: ApiKeyRepository,
  options: ApiKeyServiceOptions = {},
): ApiKeyService {
  const createCredential = options.generate ?? generateApiKey;
  const now = options.now ?? (() => new Date());

  return {
    async authenticate(key) {
      const prefix = parseApiKeyPrefix(key);
      if (!prefix) {
        return null;
      }

      const candidate = await repository.findAuthenticationCandidate(prefix);
      const hashMatches = verifyApiKeyHash(key, candidate?.secretHash ?? DUMMY_SECRET_HASH);

      if (!candidate || !hashMatches) {
        return null;
      }

      const usedAt = now();
      if (
        candidate.revokedAt ||
        (candidate.expiresAt && candidate.expiresAt.getTime() <= usedAt.getTime())
      ) {
        return null;
      }

      if (!(await repository.activate(candidate, usedAt))) {
        return null;
      }

      return {
        apiKeyId: candidate.apiKeyId,
        organizationId: candidate.organizationId,
        scopes: candidate.scopes,
      };
    },

    async create(tenant, input, requestId) {
      const createdAt = now();
      const expiresAt = parseExpiration(input.expiresAt, createdAt);
      if (expiresAt === undefined) {
        return { status: "invalid_expiration" };
      }

      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const credential = createCredential();
        const result = await repository.create(
          tenant,
          {
            createdAt,
            expiresAt,
            prefix: credential.prefix,
            scopes: input.scopes,
            secretHash: credential.secretHash,
          },
          requestId,
        );

        if (result.status === "ok") {
          return {
            revealed: { apiKey: result.apiKey, key: credential.key },
            status: "ok",
          };
        }

        if (result.status === "forbidden") {
          return result;
        }
      }

      return { status: "conflict" };
    },

    async list(tenant, page) {
      return repository.list(tenant, page);
    },

    async revoke(tenant, apiKeyId, requestId) {
      return repository.revoke(tenant, apiKeyId, now(), requestId);
    },

    async rotate(tenant, apiKeyId, requestId) {
      const createdAt = now();

      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const credential = createCredential();
        const result = await repository.rotate(
          tenant,
          apiKeyId,
          {
            createdAt,
            prefix: credential.prefix,
            secretHash: credential.secretHash,
          },
          requestId,
        );

        if (result.status === "ok") {
          return {
            revealed: { apiKey: result.apiKey, key: credential.key },
            status: "ok",
          };
        }

        if (result.status !== "prefix_conflict") {
          return result;
        }
      }

      return { status: "conflict" };
    },
  };
}
