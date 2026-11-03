import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeAll } from "vitest";
import { App } from "../app/App";
import { appRoutes } from "../app/routes";

// Resolve the production lazy modules before assertions start. Cold Vite work
// and initial router hydration belong to setup, not application response time.
// Keep the production route components and the normal assertion deadlines.
const testRoutes = appRoutes.map(route => ({ ...route }));
beforeAll(async () => {
  testRoutes[0]!.children = await Promise.all(appRoutes[0]!.children!.map(async route => {
    if (typeof route.lazy !== "function") return route;
    const { lazy, ...definition } = route;
    return { ...definition, ...await lazy() };
  }));
});

const renderedApps = new Set<{ router: ReturnType<typeof createMemoryRouter>; queryClient: QueryClient }>();
afterEach(() => {
  for (const { router, queryClient } of renderedApps) {
    router.dispose();
    queryClient.clear();
  }
  renderedApps.clear();
});

export function renderApp(path = "/") {
  const router = createMemoryRouter(testRoutes, { initialEntries: [path] });
  // Mirror production cache timing (App.tsx) so tests see the same cache reuse.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
  renderedApps.add({ router, queryClient });
  return { router, queryClient, ...render(<App router={router} queryClient={queryClient} />) };
}
