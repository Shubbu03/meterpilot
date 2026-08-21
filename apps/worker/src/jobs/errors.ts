const JOB_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_JOB_ERROR_CODE_LENGTH = 64;
const MAX_JOB_ERROR_MESSAGE_LENGTH = 512;

export type JobFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export class JobHandlerError extends Error {
  override readonly name = "JobHandlerError";
  readonly code: string;
  readonly retryable: boolean;

  constructor(failure: JobFailure) {
    if (
      !JOB_ERROR_CODE_PATTERN.test(failure.code) ||
      failure.code.length > MAX_JOB_ERROR_CODE_LENGTH
    ) {
      throw new TypeError("Job error code must be a bounded snake_case identifier.");
    }
    if (
      failure.message.trim().length === 0 ||
      failure.message.length > MAX_JOB_ERROR_MESSAGE_LENGTH
    ) {
      throw new TypeError(
        `Job error message must be between 1 and ${MAX_JOB_ERROR_MESSAGE_LENGTH} characters.`,
      );
    }

    super(failure.message);
    this.code = failure.code;
    this.retryable = failure.retryable;
  }
}

export function permanentJobError(code: string, message: string): JobHandlerError {
  return new JobHandlerError({ code, message, retryable: false });
}

export function retryableJobError(code: string, message: string): JobHandlerError {
  return new JobHandlerError({ code, message, retryable: true });
}

export function classifyJobFailure(error: unknown): JobFailure {
  if (error instanceof JobHandlerError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }

  return {
    code: "unexpected_error",
    message: "Unexpected job handler failure.",
    retryable: true,
  };
}

export function persistedJobError(failure: JobFailure): string {
  return `${failure.code}: ${failure.message}`;
}
