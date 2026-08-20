import { z } from "zod";
import { API_KEY_SCOPES } from "@meterpilot/domain/identity";

import { createCursorPageSchema, requestIdSchema } from "./common";
import { organizationIdSchema } from "./organizations";

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export const apiKeyIdSchema = z.uuid();
export const apiKeyPrefixSchema = z
  .string()
  .regex(/^mpk_[A-Za-z0-9_-]{12}$/, "must be a valid MeterPilot key prefix");
export const revealedApiKeySchema = z
  .string()
  .regex(/^mpk_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/, "must be a valid MeterPilot API key");

export const apiKeySchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  id: apiKeyIdSchema,
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
  prefix: apiKeyPrefixSchema,
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  scopes: z.array(apiKeyScopeSchema).min(1).max(API_KEY_SCOPES.length),
});

export const createApiKeyRequestSchema = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1)
    .max(API_KEY_SCOPES.length)
    .refine(
      (scopes) => new Set(scopes).size === scopes.length,
      "must not contain duplicate scopes",
    ),
});

export const apiKeyListResponseSchema = createCursorPageSchema(apiKeySchema);

export const apiKeyParamSchema = z.strictObject({
  apiKeyId: apiKeyIdSchema,
  organizationId: organizationIdSchema,
});

export const revealedApiKeyResponseSchema = z.strictObject({
  apiKey: apiKeySchema,
  key: revealedApiKeySchema,
  requestId: requestIdSchema,
});

export const revokedApiKeyResponseSchema = z.strictObject({
  apiKey: apiKeySchema,
  requestId: requestIdSchema,
});

export type ApiKey = z.infer<typeof apiKeySchema>;
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
export type CreateApiKeyRequest = z.output<typeof createApiKeyRequestSchema>;
export type RevealedApiKeyResponse = z.infer<typeof revealedApiKeyResponseSchema>;
