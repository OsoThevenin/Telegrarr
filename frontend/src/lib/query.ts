import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";

const MAX_NETWORK_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The backend's answer will not change on a retry; a dropped connection might.
        retry: (failures, error) => !(error instanceof ApiError) && failures < MAX_NETWORK_RETRIES,
      },
    },
  });
}
