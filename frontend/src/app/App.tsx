import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import type { AppRouter } from "@/app/router";

type Props = {
  router: AppRouter;
  queryClient: QueryClient;
};

export function App({ router, queryClient }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
