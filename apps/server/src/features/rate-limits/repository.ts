export type RateLimitConsumption = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}>;

export type RateLimitRepository = Readonly<{
  consume: (
    input: Readonly<{
      keyHash: string;
      limit: number;
      now: Date;
      windowMs: number;
    }>,
  ) => Promise<RateLimitConsumption>;
}>;
