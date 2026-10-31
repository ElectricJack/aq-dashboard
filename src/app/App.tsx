import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { appRoutes } from "./routes";
import { SessionProvider } from "./session";

type Router = ReturnType<typeof createBrowserRouter>;

export function App(props: { router?: Router; queryClient?: QueryClient }) {
  const [router] = useState(() => props.router ?? createBrowserRouter(appRoutes));
  const [queryClient] = useState(
    () =>
      props.queryClient ??
      new QueryClient({
        defaultOptions: { queries: { refetchIntervalInBackground: false, staleTime: 5_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  );
}
