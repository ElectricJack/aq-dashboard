import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../../mocks/handlers";
import { workspaceHome, workspacePin, workspaceTarget, workspaceTask } from "../../../mocks/taskWorkspaceResources";
import { renderApp } from "../../../test/renderApp";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.resetHandlers(); localStorage.clear(); });
afterAll(() => server.close());

const home = `/work/${workspaceTask}?scope=project:${workspaceHome.id}`;
const target = `/work?scope=project:${workspaceTarget.id}`;
const decisionPath = `/api/projects/${workspaceTarget.id}/workspace-requests/${workspaceHome.id}/${workspaceTask}/decision`;

async function requestSource() {
  await userEvent.click(await screen.findByRole("button", { name: "Workspace resources" }));
  await screen.findByText("No additional sources requested.");
  await userEvent.selectOptions(screen.getByLabelText("Source project"), workspaceTarget.id);
  await userEvent.selectOptions(screen.getByLabelText("Source access"), "write");
  await userEvent.click(screen.getByRole("button", { name: "Request source" }));
  const sources = await screen.findByRole("list", { name: "Task workspace sources" });
  expect(within(sources).getByText(/Awaiting approval/)).toBeInTheDocument();
  return sources;
}

test("requests sibling write access and PostgreSQL, then approves the reviewed pin under the target project", async () => {
  server.use(...handlersFor("workspace-resources", { fixtures: true }));
  const decisions: unknown[] = [];
  server.use(http.post(decisionPath, async ({ request }) => { decisions.push(await request.clone().json()); }));
  const { router } = renderApp(home);
  await requestSource();
  await userEvent.click(screen.getByRole("button", { name: "Request PostgreSQL service" }));
  await screen.findByText("PostgreSQL service requested.");
  await act(async () => { await router.navigate(target); });
  await userEvent.click(await screen.findByText("Incoming workspace requests"));
  const inbox = await screen.findByRole("list", { name: "Incoming workspace requests" });
  expect(within(inbox).getByText(workspacePin.commit_oid)).toBeInTheDocument();
  expect(within(inbox).getByText("Read and write")).toBeInTheDocument();
  await userEvent.click(within(inbox).getByRole("button", { name: "Approve access" }));
  await screen.findByText("Source access approved.");
  await screen.findByText("No incoming workspace requests.");
  expect(decisions).toEqual([{ decision: "approved", project_revision: workspacePin.project_revision, commit_oid: workspacePin.commit_oid, access: "write" }]);
  await act(async () => { await router.navigate(home); });
  const sources = await screen.findByRole("list", { name: "Task workspace sources" });
  expect(await within(sources).findByText(/Approved/)).toHaveTextContent("Fixture library · Approved");
  expect(await screen.findByText("PostgreSQL service requested.")).toBeInTheDocument();
});

test("stale decision requires a fresh review and never confirms the old request", async () => {
  server.use(...handlersFor("workspace-resources", { fixtures: true }));
  server.use(http.post(decisionPath, () => HttpResponse.json({ error: "conflict" }, { status: 409 })));
  const { router } = renderApp(home);
  await requestSource();
  await act(async () => { await router.navigate(target); });
  await userEvent.click(await screen.findByText("Incoming workspace requests"));
  await userEvent.click(await screen.findByRole("button", { name: "Deny access" }));
  expect(await screen.findByText("The workspace request changed. Review the current details before trying again.")).toHaveAttribute("role", "alert");
  expect(screen.queryByText("Source access denied.")).not.toBeInTheDocument();
});

test("older servers hide the workspace controls without reading new endpoints", async () => {
  let reads = 0;
  server.use(...handlersFor("default", { fixtures: true }));
  server.use(http.get(/\/api\/projects\/.*\/workspace(?:-requests)?$/, () => { reads++; return HttpResponse.json({}); }));
  renderApp(home);
  await screen.findByRole("heading", { name: "Fixture: Approve recovery plan" });
  expect(screen.queryByRole("button", { name: "Workspace resources" })).toBeNull();
  expect(reads).toBe(0);
});
