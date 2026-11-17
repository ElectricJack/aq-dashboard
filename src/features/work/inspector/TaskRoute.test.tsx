import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../../mocks/handlers";
import { FIXTURE_IDS } from "../../../mocks/humanGraph";
import { renderApp } from "../../../test/renderApp";
import { classLabel, elapsed, whoMayTake } from "./TaskRoute";

// Spec 0011 §8 against the labelled routing fixtures (src/mocks/humanGraph.ts): "Approve recovery plan" is ready and waits
// for routing, "Replay reconciliation" was routed by the router, every other task is not under an automatic router.
const server = setupServer(...handlersFor("default", { fixtures: true }));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.events.removeAllListeners(); server.resetHandlers(...handlersFor("default", { fixtures: true })); localStorage.clear(); });
afterAll(() => server.close());
const project = "00000000-0000-0000-0000-000000000001";
async function open(id: string) {
  renderApp(`/work/${id}?scope=project:${project}`);
  const region = await screen.findByRole("region", { name: /^Fixture: / });
  await within(region).findByRole("heading", { name: "Status" });
  return region;
}
const action = async (region: HTMLElement, name: string) => {
  await userEvent.click(await within(region).findByRole("button", { name: "More actions" }));
  await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
  return screen.findByRole("dialog", { name });
};

test("labels: a class reads in the owner's words and the wait in minutes by the server clock", () => {
  expect(classLabel("standard-high")).toBe("Standard · High");
  expect(classLabel("deep-max")).toBe("Deep · Max");
  const now = "2026-10-31T12:00:00.000Z", at = Date.parse(now);
  expect([elapsed(now, at - 30_000), elapsed(now, at - 4 * 60_000), elapsed(now, at - 3 * 3_600_000), elapsed(now, at - 3 * 86_400_000), elapsed(now, at + 5_000), elapsed(null, at)])
    .toEqual(["under 1 min", "4 min", "3 h", "3 d", "under 1 min", null]);
  expect(whoMayTake({ harnesses: [], providers: [], prefer: [] })).toBe("Harness: any · Provider: any");
  expect(whoMayTake({ harnesses: ["codex"], providers: ["openai", "anthropic"], prefer: ["codex"] })).toBe("Harness: codex · Provider: openai, anthropic, preferring codex");
});

test("a ready task under an automatic router with no route says it is waiting for routing and for how long", async () => {
  const region = await open(FIXTURE_IDS.approve);
  const waiting = await within(region).findByText("Waiting for routing", { selector: "[data-task-route] strong" });
  expect(waiting.closest("[data-task-route]")).toHaveAttribute("data-task-route", "waiting");
  expect(waiting.parentElement).toHaveTextContent("Waiting for routing · 4 min");
  expect(within(region).queryByText("Why this route")).toBeNull();
});

test("a routed task shows its class, lane and who may take it, with the reasons behind it in a disclosure", async () => {
  const region = await open(FIXTURE_IDS.replay);
  const route = await within(region).findByText("Standard · High");
  const box = route.closest("[data-task-route]")!;
  expect(box).toHaveAttribute("data-task-route", "routed");
  expect(box).toHaveTextContent("lane backend");
  expect(box).toHaveTextContent("Harness: any · Provider: any, preferring claude-code");
  expect(box).toHaveTextContent("Set by the router · 12 min ago");
  // The history is read only when the disclosure opens, and lists each reason's detail.
  let reads = 0;
  server.use(http.get("/api/tasks/:id/routes", ({ params }) => { reads++; expect(params.id).toBe(FIXTURE_IDS.replay); return undefined; }));
  expect(reads).toBe(0);
  await userEvent.click(within(box as HTMLElement).getByText("Why this route"));
  const history = await within(box as HTMLElement).findByRole("list", { name: "Route history" });
  expect(reads).toBe(1);
  expect(within(history).getAllByRole("listitem").map(li => li.textContent)).toEqual(expect.arrayContaining([
    "Fixture: the task touches the backend lane.", "Fixture: risk was assessed as high, so the class was raised to high effort."]));
});

test("a task whose project is not on an automatic router shows no routing and offers no route actions", async () => {
  const region = await open(FIXTURE_IDS.lease);
  expect(region.querySelector("[data-task-route]")).toBeNull();
  await userEvent.click(await within(region).findByRole("button", { name: "More actions" }));
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map(i => i.firstChild!.textContent);
  expect(items.filter(i => /route/i.test(i ?? ""))).toEqual([]);
});

test("a viewer who is not the owner sees no history and no error when the routes read is refused", async () => {
  server.use(http.get("/api/tasks/:id/routes", () => HttpResponse.json({ request_id: "x", code: "forbidden", message: "Owner only", retryable: false }, { status: 403 })));
  const region = await open(FIXTURE_IDS.replay);
  await userEvent.click(await within(region).findByText("Why this route"));
  await waitFor(() => expect(within(region).queryByText("Why this route")).toBeNull());
  expect(within(region).queryByRole("alert")).toBeNull();
  expect(within(region).getByText("Standard · High")).toBeVisible();
});

test("a failed history read says so inside the disclosure and the rest of Status stays", async () => {
  server.use(http.get("/api/tasks/:id/routes", () => HttpResponse.json({ request_id: "x", code: "unavailable", message: "Down", retryable: false }, { status: 500 })));
  const region = await open(FIXTURE_IDS.replay);
  await userEvent.click(await within(region).findByText("Why this route"));
  expect(await within(region).findByText("The route history could not be read.")).toBeVisible();
  expect(within(region).getByText("Standard · High")).toBeVisible();
});

test("Set route lists the saved levels by id and sends the level as the class with its limits; the work read then shows the route", async () => {
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  server.events.on("request:start", async ({ request }) => { if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/actions") sent.push(await request.clone().json()); });
  const region = await open(FIXTURE_IDS.approve);
  const dialog = await action(region, "Set route");
  const select = await within(dialog).findByLabelText("Level");
  await waitFor(() => expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual(["Choose a level", "Standard · Low", "Standard · High"]));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  // The select is required: nothing is sent until a level is chosen.
  expect(select).toBeInvalid();
  expect(sent).toEqual([]);
  await userEvent.selectOptions(select, "standard-high");
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "fixture-provider" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Route set to Standard · High")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: "task.route.set", subject: { type: "task", id: FIXTURE_IDS.approve }, payload: { class: "standard-high", providers: ["fixture-provider"], project_id: project, expected_version: expect.any(String) } });
  expect(sent[0]!.payload).not.toHaveProperty("harnesses");
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  expect(await within(region).findByText("Standard · High", { selector: "[data-task-route] strong" })).toBeVisible();
  expect(within(region).queryByText("Waiting for routing")).toBeNull();
});

test("Clear route is offered once the task is routed and sends no fields beyond the common ones", async () => {
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  server.events.on("request:start", async ({ request }) => { if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/actions") sent.push(await request.clone().json()); });
  const region = await open(FIXTURE_IDS.replay);
  const dialog = await action(region, "Clear route");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Route cleared")).toBeVisible();
  expect(sent[0]).toMatchObject({ kind: "task.route.clear", subject: { type: "task", id: FIXTURE_IDS.replay } });
  expect(Object.keys(sent[0]!.payload).sort()).toEqual(["expected_version", "operation_id", "project_id"]);
});

test("a task that waits for routing offers Set route but not Clear route", async () => {
  const region = await open(FIXTURE_IDS.approve);
  await userEvent.click(await within(region).findByRole("button", { name: "More actions" }));
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map(i => i.firstChild!.textContent);
  expect(items).toContain("Set route");
  expect(items).not.toContain("Clear route");
});

test("an unrouted task on a router (not held back for routing) shows nothing but still offers Set route", async () => {
  const region = await open(FIXTURE_IDS.implement);
  expect(region.querySelector("[data-task-route]")).toBeNull();
  expect(within(region).queryByText(/Waiting for routing/)).toBeNull();
  await userEvent.click(await within(region).findByRole("button", { name: "More actions" }));
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map(i => i.firstChild!.textContent);
  expect(items).toContain("Set route");
  expect(items).not.toContain("Clear route");
});

test("Set route offers every saved level, whatever its id, in the order simple to deep and low to max, then the rest by id", async () => {
  const level = (id: string) => ({ kind: "intelligence", id, revision: "1", updated_at_ms: 1, markdown: `---\nid: ${id}\n---\n`, problem: null,
    fields: { id, name: id, description: "", candidates: [{ provider: "fixture-provider", model: "fixture-model", reasoning: "high", harnesses: ["claude"] }], selection: {} } });
  const unreadable = { kind: "intelligence", id: "complex-low", revision: "1", updated_at_ms: 1, markdown: "?", fields: null, problem: "a document starts with a `---` line" };
  server.use(http.get("/api/settings/intelligence-profiles", () => HttpResponse.json({ revision: "1", active_digest: null,
    documents: [...["deep-max", "research", "standard-medium", "simple-high", "deep-low", "simple-low", "architect-high", "standard-low"].map(level), unreadable] })));
  const region = await open(FIXTURE_IDS.approve);
  const dialog = await action(region, "Set route");
  const select = await within(dialog).findByLabelText("Level");
  // A level AQ cannot read cannot take work, so `complex-low` is not offered.
  await waitFor(() => expect(within(select).getAllByRole("option").map(o => (o as HTMLOptionElement).value)).toEqual(["", "simple-low", "simple-high", "standard-low", "standard-medium", "deep-low", "deep-max", "architect-high", "research"]));
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  server.events.on("request:start", async ({ request }) => { if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/actions") sent.push(await request.clone().json()); });
  await userEvent.selectOptions(select, "research");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({ kind: "task.route.set", payload: { class: "research" } });
});
