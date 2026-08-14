import type { PublicErrorCode, PublicValidationIssue } from "@meterpilot/contracts/common";

export class MeterPilotConfigurationError extends Error {
  override readonly name = "MeterPilotConfigurationError";
}

export class MeterPilotValidationError extends Error {
  override readonly name = "MeterPilotValidationError";

  constructor(readonly issues: readonly PublicValidationIssue[]) {
    super("The MeterPilot request is invalid.");
  }
}

export class MeterPilotHttpError extends Error {
  override readonly name = "MeterPilotHttpError";

  constructor(
    readonly status: number,
    readonly code: PublicErrorCode | "unexpected_http_status",
    message: string,
    readonly requestId: string | null,
    readonly details?: readonly PublicValidationIssue[],
  ) {
    super(message);
  }
}

export class MeterPilotResponseError extends Error {
  override readonly name = "MeterPilotResponseError";

  constructor(readonly requestId: string | null) {
    super("MeterPilot returned an invalid response.");
  }
}

export class MeterPilotTimeoutError extends Error {
  override readonly name = "MeterPilotTimeoutError";

  constructor(readonly timeoutMs: number) {
    super(`The MeterPilot request exceeded its ${timeoutMs}ms timeout.`);
  }
}
