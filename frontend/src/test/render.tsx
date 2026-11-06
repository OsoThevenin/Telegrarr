import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

import { App } from "@/app/App";
import { createAppRouter, type AppRouter } from "@/app/router";

interface RenderAppOptions {
  /** Where the browser is, as a full URL path: "/ui/channels". */
  route?: string;
}

interface RenderedApp {
  queryClient: QueryClient;
  router: AppRouter;
  user: UserEvent;
}

/** Renders the whole app, shell included, at a URL. */
export async function renderApp({ route = "/ui/" }: RenderAppOptions = {}): Promise<RenderedApp> {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [route] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await router.load();
  render(<App router={router} queryClient={queryClient} />);

  return { queryClient, router, user: userEvent.setup() };
}
