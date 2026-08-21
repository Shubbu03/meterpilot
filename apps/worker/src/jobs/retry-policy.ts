export type RetryPolicy = Readonly<{
  baseDelayMs: number;
  maxAttempts: number;
  maxDelayMs: number;
}>;

function assertPolicy(policy: RetryPolicy): void {
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${field} must be a positive safe integer.`);
    }
  }
  if (policy.baseDelayMs > policy.maxDelayMs) {
    throw new RangeError("Retry base delay cannot exceed maximum delay.");
  }
}

export function shouldRetry(
  attemptCount: number,
  retryable: boolean,
  policy: RetryPolicy,
): boolean {
  assertPolicy(policy);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError("Attempt count must be a positive safe integer.");
  }
  return retryable && attemptCount < policy.maxAttempts;
}

export function retryDelayMs(
  attemptCount: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  assertPolicy(policy);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError("Attempt count must be a positive safe integer.");
  }

  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError(
      "Retry random source must return a number from 0 inclusive to 1 exclusive.",
    );
  }

  const exponent = Math.min(attemptCount - 1, 30);
  const cappedDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const halfDelay = Math.ceil(cappedDelay / 2);
  return Math.min(policy.maxDelayMs, halfDelay + Math.floor(randomValue * halfDelay));
}
