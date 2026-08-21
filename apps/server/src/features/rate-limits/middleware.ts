import { createHash } from "node:crypto";

import { createMiddleware } from "hono/factory";

import type { AppEnvironment } from "../../http/environment";
import { publicError } from "../../http/public-errors";
import type { RateLimitRepository } from "./repository";

export type CredentialRateLimitOptions = Readonly<{
  apiKeyRequests: number;
  dashboardRequests: number;
  now?: () => Date;
  repository: RateLimitRepository;
  windowMs: number;
}>;

function hashCredential(kind: "api_key" | "dashboard", organizationId: string, value: string) {
  return createHash("sha256").update(`${kind}:${organizationId}:${value}`).digest("hex");
}

function organizationKey(path: string): string {
  const segments = path.split("/");
  return segments[1] === "v1" && segments[2] === "organizations" && segments[3]
    ? segments[3]
    : "credential-owned";
}

function sessionCredential(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== "better-auth.session_token" && name !== "__Secure-better-auth.session_token") {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    if (value) return value;
  }
  return null;
}

export function createCredentialRateLimitMiddleware(options: CredentialRateLimitOptions) {
  const now = options.now ?? (() => new Date());
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const authorization = context.req.header("Authorization");
    const session = sessionCredential(context.req.header("Cookie"));
    const organizationId = organizationKey(context.req.path);
    const credential = authorization?.startsWith("Bearer ")
      ? { kind: "api_key" as const, limit: options.apiKeyRequests, value: authorization.slice(7) }
      : session
        ? { kind: "dashboard" as const, limit: options.dashboardRequests, value: session }
        : null;
    if (!credential) {
      await next();
      return;
    }

    const consumedAt = now();
    const result = await options.repository.consume({
      keyHash: hashCredential(credential.kind, organizationId, credential.value),
      limit: credential.limit,
      now: consumedAt,
      windowMs: options.windowMs,
    });
    const resetSeconds = Math.max(
      0,
      Math.ceil((result.resetAt.getTime() - consumedAt.getTime()) / 1000),
    );
    context.header("RateLimit-Limit", String(result.limit));
    context.header("RateLimit-Remaining", String(result.remaining));
    context.header("RateLimit-Reset", String(Math.floor(result.resetAt.getTime() / 1000)));
    if (!result.allowed) {
      context.header("Retry-After", String(resetSeconds));
      return publicError(context, 429, "rate_limited", "Too many requests for this credential.");
    }
    await next();
  });
}
