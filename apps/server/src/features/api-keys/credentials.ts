import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX_RANDOM_BYTES = 9;
const SECRET_RANDOM_BYTES = 32;
const PREFIX_PATTERN = /^mpk_[A-Za-z0-9_-]{12}$/;
const KEY_PATTERN = /^(mpk_[A-Za-z0-9_-]{12})\.[A-Za-z0-9_-]{43}$/;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type GeneratedApiKey = Readonly<{
  key: string;
  prefix: string;
  secretHash: string;
}>;

export type RandomBytesSource = (size: number) => Uint8Array;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function parseApiKeyPrefix(key: string): string | null {
  return KEY_PATTERN.exec(key)?.[1] ?? null;
}

export function verifyApiKeyHash(key: string, expectedHash: string): boolean {
  if (!SHA_256_HEX_PATTERN.test(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashApiKey(key), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function generateApiKey(source: RandomBytesSource = randomBytes): GeneratedApiKey {
  const randomPrefix = Buffer.from(source(PREFIX_RANDOM_BYTES)).toString("base64url");
  const secret = Buffer.from(source(SECRET_RANDOM_BYTES)).toString("base64url");
  const prefix = `mpk_${randomPrefix}`;

  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error("API key generation produced an invalid prefix.");
  }

  const key = `${prefix}.${secret}`;
  return {
    key,
    prefix,
    secretHash: hashApiKey(key),
  };
}
