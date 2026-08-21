import type { OrganizationListItem } from "@meterpilot/contracts/organizations";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";

import { ApiError } from "../../lib/api/client";
import { listOrganizations, organizationKeys } from "./api";
import { readSelectedOrganization, writeSelectedOrganization } from "./organization-storage";

export type OrganizationState =
  | { status: "loading" }
  | { requestId?: string; retry: () => Promise<void>; status: "error" }
  | { status: "empty" }
  | {
      active: OrganizationListItem;
      organizations: readonly OrganizationListItem[];
      selectOrganization: (organizationId: string) => void;
      status: "ready";
    };

const OrganizationContext = createContext<OrganizationState | undefined>(undefined);

export interface OrganizationProviderProps {
  children: ReactNode;
  value?: OrganizationState | undefined;
}

function LiveOrganizationProvider({ children }: Pick<OrganizationProviderProps, "children">) {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(readSelectedOrganization);
  const organizationsQuery = useQuery({
    queryFn: listOrganizations,
    queryKey: organizationKeys.list(),
    staleTime: 30_000,
  });

  let value: OrganizationState;

  if (organizationsQuery.isPending) {
    value = { status: "loading" };
  } else if (organizationsQuery.error) {
    value = {
      ...(organizationsQuery.error instanceof ApiError
        ? { requestId: organizationsQuery.error.requestId }
        : {}),
      retry: async () => {
        await organizationsQuery.refetch();
      },
      status: "error",
    };
  } else if (organizationsQuery.data.items.length === 0) {
    value = { status: "empty" };
  } else {
    const fallback = organizationsQuery.data.items[0];

    if (!fallback) {
      value = { status: "empty" };
    } else {
      const active =
        organizationsQuery.data.items.find(
          (item) => item.organization.id === selectedOrganizationId,
        ) ?? fallback;

      value = {
        active,
        organizations: organizationsQuery.data.items,
        selectOrganization(organizationId) {
          if (
            !organizationsQuery.data.items.some((item) => item.organization.id === organizationId)
          ) {
            return;
          }

          setSelectedOrganizationId(organizationId);
          writeSelectedOrganization(organizationId);
        },
        status: "ready",
      };
    }
  }

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function OrganizationProvider({ children, value }: OrganizationProviderProps) {
  const inheritedValue = useContext(OrganizationContext);

  if (value) {
    return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
  }

  if (inheritedValue) {
    return children;
  }

  return <LiveOrganizationProvider>{children}</LiveOrganizationProvider>;
}

export function useOrganization() {
  const state = useContext(OrganizationContext);

  if (!state) {
    throw new Error("useOrganization must be used within OrganizationProvider.");
  }

  return state;
}

export function useActiveOrganization() {
  const state = useOrganization();

  if (state.status !== "ready") {
    throw new Error("An active organization is required.");
  }

  return state;
}
