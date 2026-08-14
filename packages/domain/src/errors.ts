export type DomainErrorCode =
  | "invalid_identifier"
  | "invalid_instant"
  | "invalid_interval"
  | "invalid_payload_hash"
  | "invalid_state_transition"
  | "invalid_correction";

export class DomainInvariantError extends Error {
  override readonly name = "DomainInvariantError";

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}
