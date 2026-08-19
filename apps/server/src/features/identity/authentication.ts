import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@meterpilot/db";
import * as databaseSchema from "@meterpilot/db/schema";
import { betterAuth } from "better-auth";

export type AuthenticatedSession = Readonly<{
  session: Readonly<{
    id: string;
  }>;
  user: Readonly<{
    email: string;
    id: string;
    name: string;
  }>;
}>;

export type AuthGateway = Readonly<{
  getSession: (headers: Headers) => Promise<AuthenticatedSession | null>;
  handler: (request: Request) => Promise<Response>;
}>;

export type AuthenticationOptions = Readonly<{
  baseUrl: string;
  database: Database["db"];
  secret: string;
}>;

export function createAuthentication(options: AuthenticationOptions) {
  return betterAuth({
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    baseURL: options.baseUrl,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: databaseSchema,
      transaction: true,
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
    },
    secret: options.secret,
  });
}

export function createAuthGateway(
  authentication: ReturnType<typeof createAuthentication>,
): AuthGateway {
  return {
    getSession: async (headers) => {
      const result = await authentication.api.getSession({ headers });

      if (!result) {
        return null;
      }

      return {
        session: {
          id: result.session.id,
        },
        user: {
          email: result.user.email,
          id: result.user.id,
          name: result.user.name,
        },
      };
    },
    handler: (request) => authentication.handler(request),
  };
}
