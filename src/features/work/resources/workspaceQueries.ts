import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError } from "../../../api/client";
import { queryKey, type QueryContext } from "../../../api/queryKeys";
import { readWorkspaceRequests, readWorkspaceResources } from "../../../api/taskWorkspaceResources";
import { PANEL_READ, useSession } from "../../../app/session";

export const workspaceKey = (context: QueryContext, project: string, task: string) =>
  queryKey(context, "task-workspace-resources", { project, task });
export const incomingKey = (context: QueryContext, target: string) =>
  queryKey(context, "incoming-workspace-requests", { target });

export function useWorkspaceResources(project: string, task: string) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: workspaceKey(queryContext, project, task),
    queryFn: ({ signal }) => readWorkspaceResources(project, task, signal),
    meta: PANEL_READ,
  });
}

export function useWorkspaceRequests(target: string) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: incomingKey(queryContext, target),
    queryFn: ({ signal }) => readWorkspaceRequests(target, signal),
    meta: PANEL_READ,
  });
}

export function useResourceAction() {
  const { reportAccessDenied } = useSession();
  const cache = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "confirmed" | "problem"; text: string } | null>(null);

  async function run(key: ReturnType<typeof workspaceKey | typeof incomingKey>, change: () => Promise<void>, confirmation: string) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      await cache.cancelQueries({ queryKey: key, exact: true });
      await change();
      setNotice({ kind: "confirmed", text: confirmation });
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        reportAccessDenied(error);
        cache.removeQueries({ queryKey: key, exact: true });
      }
      const conflict = error instanceof ApiError && error.status === 409;
      const text = conflict ? "The workspace request changed. Review the current details before trying again."
        : error instanceof ApiError && error.status && error.status < 500 ? error.serverMessage ?? "AQ refused the workspace change."
        : "AQ did not confirm the workspace change. Check the current status before trying again.";
      setNotice({ kind: "problem", text });
      return false;
    } finally {
      await cache.invalidateQueries({ queryKey: key, exact: true });
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, notice, run };
}
