import { DomainInvariantError } from "./errors";

declare const payloadHashBrand: unique symbol;

export type PayloadHash = string & { readonly [payloadHashBrand]: "PayloadHash" };

export type IdempotencyDecision =
  | Readonly<{ status: "new" }>
  | Readonly<{ payloadHash: PayloadHash; status: "duplicate" }>
  | Readonly<{
      existingPayloadHash: PayloadHash;
      incomingPayloadHash: PayloadHash;
      status: "conflict";
    }>;

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function payloadHash(value: string): PayloadHash {
  if (!SHA_256_HEX_PATTERN.test(value)) {
    throw new DomainInvariantError(
      "invalid_payload_hash",
      "Payload hash must be a lowercase SHA-256 hexadecimal digest.",
    );
  }

  return value as PayloadHash;
}

export function decideIdempotency(
  existingPayloadHash: PayloadHash | null,
  incomingPayloadHash: PayloadHash,
): IdempotencyDecision {
  if (existingPayloadHash === null) {
    return Object.freeze({ status: "new" });
  }

  if (existingPayloadHash === incomingPayloadHash) {
    return Object.freeze({ payloadHash: incomingPayloadHash, status: "duplicate" });
  }

  return Object.freeze({
    existingPayloadHash,
    incomingPayloadHash,
    status: "conflict",
  });
}
