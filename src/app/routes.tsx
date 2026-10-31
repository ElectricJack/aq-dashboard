import { Navigate, useLocation, type RouteObject } from "react-router";
import { NotFoundPage } from "./DestinationPage";
import { Shell } from "./Shell";

function IndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/overview", search }} replace />;
}

/** Routes from docs/specs/0002-product-design.md section 3; feature modules load lazily. */
export const appRoutes: RouteObject[] = [
  {
    path: "/",
    Component: Shell,
    children: [
      { index: true, Component: IndexRedirect },
      { path: "overview", lazy: () => import("../features/overview") },
      { path: "supervisor", lazy: () => import("../features/supervisor") },
      { path: "work/:taskId?", lazy: () => import("../features/work") },
      { path: "results", lazy: () => import("../features/results") },
      { path: "results/:resultId/revisions/:revision", lazy: () => import("../features/results") },
      { path: "decisions/:decisionId?", lazy: () => import("../features/decisions") },
      { path: "agents/:sessionId?", lazy: () => import("../features/agents") },
      { path: "playbooks", lazy: () => import("../features/playbooks") },
      { path: "playbooks/runs/:runId", lazy: () => import("../features/playbooks") },
      { path: "knowledge/:nodeId?", lazy: () => import("../features/knowledge") },
      { path: "settings", lazy: () => import("../features/settings") },
      { path: "*", Component: NotFoundPage },
    ],
  },
];
