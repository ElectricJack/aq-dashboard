import { http, HttpResponse } from "msw";
import type { ResourceRequest, WorkspaceDecision, WorkspaceRequest, WorkspaceResources } from "../api/taskWorkspaceResources";
import { envelope } from "./handlers";
import { fixtureProject, FIXTURE_IDS } from "./humanGraphData";
import taskFixture from "../../contracts/live/human-graph/examples/task.json";

export const workspaceTarget = { id: "00000000-0000-0000-0000-000000000090", label: "Fixture library" };
export const workspaceHome = { id: fixtureProject.id, label: fixtureProject.name };
export const workspaceTask = FIXTURE_IDS.approve;
export const workspacePin = {
  target_project_id: workspaceTarget.id, repository_id: "00000000-0000-0000-0000-000000000091",
  binding_generation: 2, project_revision: 5, commit_oid: "a1".repeat(20),
};
const taskPath = `/api/projects/${workspaceHome.id}/tasks/${workspaceTask}/workspace`;
const inboxPath = `/api/projects/${workspaceTarget.id}/workspace-requests`;

export function workspaceResourceHandlers() {
  let source: WorkspaceRequest | undefined;
  let services: WorkspaceResources["services"] = [];
  const conflict = () => HttpResponse.json({ error: "conflict", message: "Workspace request changed" }, { status: 409 });
  const body = () => ({ sources: source ? [source] : [], services });
  return [
    http.get("/api/v1/projects", () => HttpResponse.json(envelope({
      items: [workspaceHome, workspaceTarget], next_cursor: null, has_more: false, snapshot_id: "fixture-workspace-projects",
      total: { value: 2, accuracy: "exact" },
    }))),
    http.get(`/api/human/projects/${workspaceTarget.id}/tasks`, () => HttpResponse.json({
      ...taskFixture, project: { ...fixtureProject, id: workspaceTarget.id, name: workspaceTarget.label },
      data: { items: [], next_cursor: null },
    })),
    http.get(taskPath, () => HttpResponse.json(body())),
    http.post(taskPath, async ({ request }) => {
      const payload = await request.json() as ResourceRequest;
      if ("service" in payload) services = [{ service: "postgres" }];
      else if (payload.target_project_id === workspaceTarget.id) source = {
        ...workspacePin, home_project_id: workspaceHome.id, task_id: workspaceTask,
        access: payload.access, state: "pending",
      };
      else return conflict();
      return HttpResponse.json(body());
    }),
    http.get(inboxPath, () => HttpResponse.json({ sources: source && source.state !== "approved" ? [source] : [], has_more: false })),
    http.post(`${inboxPath}/${workspaceHome.id}/${workspaceTask}/decision`, async ({ request }) => {
      const payload = await request.json() as WorkspaceDecision;
      if (!source || source.state === "approved" || (source.state === "denied" && payload.decision !== "approved") ||
          payload.project_revision !== source.project_revision ||
          payload.commit_oid !== source.commit_oid || payload.access !== source.access) return conflict();
      source = { ...source, state: payload.decision };
      return HttpResponse.json({ sources: [source], services: [] });
    }),
  ];
}
