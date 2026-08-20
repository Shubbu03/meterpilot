import type { ApiKey, ApiKeyScope } from "@meterpilot/contracts/api-keys";

import type { PageRequest, PageResult, TenantAuthorization } from "../organizations/repository";

export type ApiKeyWrite = Readonly<{
  createdAt: Date;
  expiresAt: Date | null;
  prefix: string;
  scopes: readonly ApiKeyScope[];
  secretHash: string;
}>;

export type ApiKeyRotationWrite = Readonly<{
  createdAt: Date;
  prefix: string;
  secretHash: string;
}>;

export type ApiKeyAuthenticationCandidate = Readonly<{
  apiKeyId: string;
  expiresAt: Date | null;
  organizationId: string;
  revokedAt: Date | null;
  scopes: readonly ApiKeyScope[];
  secretHash: string;
}>;

export type ApiKeyPrincipal = Readonly<{
  apiKeyId: string;
  organizationId: string;
  scopes: readonly ApiKeyScope[];
}>;

export type ApiKeyCreateResult =
  | Readonly<{ apiKey: ApiKey; status: "ok" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "prefix_conflict" }>;

export type ApiKeyListResult =
  | Readonly<{ page: PageResult<ApiKey>; status: "ok" }>
  | Readonly<{ status: "forbidden" }>;

export type ApiKeyRotateResult =
  | Readonly<{ apiKey: ApiKey; status: "ok" }>
  | Readonly<{ status: "expired" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "prefix_conflict" }>
  | Readonly<{ status: "revoked" }>;

export type ApiKeyRevokeResult =
  | Readonly<{ apiKey: ApiKey; status: "ok" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>;

export type ApiKeyRepository = Readonly<{
  activate: (candidate: ApiKeyAuthenticationCandidate, usedAt: Date) => Promise<boolean>;
  create: (
    tenant: TenantAuthorization,
    write: ApiKeyWrite,
    requestId: string,
  ) => Promise<ApiKeyCreateResult>;
  findAuthenticationCandidate: (prefix: string) => Promise<ApiKeyAuthenticationCandidate | null>;
  list: (tenant: TenantAuthorization, page: PageRequest) => Promise<ApiKeyListResult>;
  revoke: (
    tenant: TenantAuthorization,
    apiKeyId: string,
    revokedAt: Date,
    requestId: string,
  ) => Promise<ApiKeyRevokeResult>;
  rotate: (
    tenant: TenantAuthorization,
    apiKeyId: string,
    write: ApiKeyRotationWrite,
    requestId: string,
  ) => Promise<ApiKeyRotateResult>;
}>;
