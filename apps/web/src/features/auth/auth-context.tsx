import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { authClient } from "../../lib/auth/client";
import { subscribeToSessionExpiry } from "../../lib/auth/session-events";
import { queryClient } from "../../lib/query-client";
import { clearSelectedOrganization } from "../organizations/organization-storage";

export interface DashboardSession {
  session: {
    id: string;
  };
  user: {
    email: string;
    id: string;
    name: string;
  };
}

export type AuthState =
  | { status: "pending" }
  | { reason?: "expired"; status: "unauthenticated" }
  | { retry: () => Promise<void>; status: "error" }
  | { session: DashboardSession; signOut: () => Promise<void>; status: "authenticated" };

const AuthContext = createContext<AuthState | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
  value?: AuthState | undefined;
}

function LiveAuthProvider({ children }: Pick<AuthProviderProps, "children">) {
  const sessionQuery = authClient.useSession();
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    return subscribeToSessionExpiry(() => {
      setSessionExpired(true);
      void sessionQuery.refetch();
    });
  }, [sessionQuery.refetch]);

  useEffect(() => {
    if (sessionQuery.data) {
      setSessionExpired(false);
    }
  }, [sessionQuery.data]);

  let value: AuthState;

  if (sessionExpired) {
    value = { reason: "expired", status: "unauthenticated" };
  } else if (sessionQuery.isPending && !sessionQuery.data) {
    value = { status: "pending" };
  } else if (sessionQuery.error) {
    value = {
      retry: async () => {
        await sessionQuery.refetch();
      },
      status: "error",
    };
  } else if (!sessionQuery.data) {
    value = { status: "unauthenticated" };
  } else {
    value = {
      session: {
        session: { id: sessionQuery.data.session.id },
        user: {
          email: sessionQuery.data.user.email,
          id: sessionQuery.data.user.id,
          name: sessionQuery.data.user.name,
        },
      },
      signOut: async () => {
        const result = await authClient.signOut();

        if (result.error) {
          throw new Error("Unable to sign out.");
        }

        clearSelectedOrganization();
        queryClient.clear();
      },
      status: "authenticated",
    };
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children, value }: AuthProviderProps) {
  if (value) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }

  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}

export function useAuth() {
  const state = useContext(AuthContext);

  if (!state) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return state;
}

export function useAuthenticatedSession() {
  const state = useAuth();

  if (state.status !== "authenticated") {
    throw new Error("An authenticated session is required.");
  }

  return state;
}
