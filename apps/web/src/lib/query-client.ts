import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (error instanceof ApiError && error.status < 500) {
          return false;
        }

        return failureCount < 2;
      },
      staleTime: 15_000,
    },
  },
});
