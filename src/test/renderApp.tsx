import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { App } from "../app/App";
import { appRoutes } from "../app/routes";

export function renderApp(path = "/") {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  // Mirror production cache timing (App.tsx) so tests see the same cache reuse.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
  return { router, queryClient, ...render(<App router={router} queryClient={queryClient} />) };
}
