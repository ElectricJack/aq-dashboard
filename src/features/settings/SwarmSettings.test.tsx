import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { SaveSwarmSettings, SwarmSettings } from "../../api/swarmSettings";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

function snapshot(): SwarmSettings {
  return { revision: "12", catalog_revision: "2", active_mode: "normal", unclassified: [], normal: [
    { provider: "fixture-provider", intelligence_class: "standard", limit: 2 },
    { provider: "other-provider", intelligence_class: "deep", limit: 1 },
  ], reduced: null, cells: [
    { provider: "fixture-provider", intelligence_class: "standard", display_name: "Fixture standard", normal_limit: 2, reduced_limit: null, effective_limit: 2, running: 3, waiting: 2 },
    { provider: "other-provider", intelligence_class: "deep", display_name: "Fixture deep", normal_limit: 1, reduced_limit: null, effective_limit: 1, running: null, waiting: null },
  ] };
}
function confirmed(request: SaveSwarmSettings): SwarmSettings {
  const data = snapshot();
  return { ...data, revision: "13", normal: request.normal, reduced: request.reduced, cells: data.cells.map(cell => ({ ...cell,
    normal_limit: request.normal.find(c => c.provider === cell.provider && c.intelligence_class === cell.intelligence_class)!.limit,
    reduced_limit: request.reduced?.find(c => c.provider === cell.provider && c.intelligence_class === cell.intelligence_class)!.limit ?? null,
    effective_limit: request.normal.find(c => c.provider === cell.provider && c.intelligence_class === cell.intelligence_class)!.limit,
  })) };
}
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function read(data = snapshot()) { server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data))); }
async function open() {
  const app = renderApp("/settings#swarm");
  await screen.findByRole("spinbutton", { name: "Normal fixture-provider Fixture standard limit" });
  return app;
}
function normal() { return screen.getByRole("spinbutton", { name: "Normal fixture-provider Fixture standard limit" }); }
async function replace(input: HTMLElement, value: string) { await userEvent.clear(input); if (value) await userEvent.type(input, value); }

test("the direct Swarm anchor opens a catalog-driven matrix with unavailable pairs and truthful counts", async () => {
  read(); await open();
  expect(screen.getByRole("tab", { name: "Swarm", selected: true })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Normal limits" })).toBeVisible();
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByText("3 active / limit 2")).toBeVisible();
  expect(screen.getByText("Existing agents finish")).toBeVisible();
  expect(screen.getByText(/Active unknown/)).toBeVisible();
  expect(screen.getByText(/Waiting unknown/)).toBeVisible();
  expect(screen.queryByRole("spinbutton", { name: /Normal fixture-provider Fixture deep/ })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Normal concurrency matrix" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
});

test("unclassified active agents and waiting tasks stay visible outside the editable matrix", async () => {
  const data = snapshot(); data.unclassified = [{ provider: "fixture-provider", running: 2, waiting: 1 }];
  read(data); await open();
  expect(screen.getByText(/2 active agents and 1 waiting task have no current intelligence class/)).toBeVisible();
  expect(screen.getByText(/still count toward provider capacity/)).toBeVisible();
  expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
});

test("a coherent matrix saves once and waits for matching server confirmation", async () => {
  let data = snapshot(), release: (() => void) | undefined, request: SaveSwarmSettings | undefined;
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data)), http.post("/api/settings/swarm", async ({ request: incoming }) => {
    request = await incoming.json() as SaveSwarmSettings;
    await new Promise<void>(resolve => { release = resolve; }); data = confirmed(request);
    return HttpResponse.json(data);
  }));
  await open(); await replace(normal(), "0");
  await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  await waitFor(() => expect(request).toBeDefined());
  expect(screen.queryByText("Limits saved. Running agents continue.")).not.toBeInTheDocument();
  expect(normal()).toBeDisabled();
  expect(request).toMatchObject({ expected_revision: "12", expected_catalog_revision: "2", reduced: null, normal: [
    { provider: "fixture-provider", intelligence_class: "standard", limit: 0 },
    { provider: "other-provider", intelligence_class: "deep", limit: 1 },
  ] });
  expect(request!.operation_id).toMatch(/^[a-f\d-]{36}$/);
  release!(); await screen.findByText("Limits saved. Running agents continue.");
  expect(screen.getByText("New starts paused")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
});

test("Reduced usage starts blank and validates whole numbers and its Normal ceiling", async () => {
  read(); await open(); await userEvent.click(screen.getByRole("button", { name: "Configure reduced usage" }));
  const reduced = screen.getByRole("spinbutton", { name: "Reduced usage fixture-provider Fixture standard limit" });
  expect(reduced).toHaveFocus();
  expect(reduced).toHaveValue(null); expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  await replace(reduced, "3");
  expect(reduced).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Reduced must be at or below Normal.")).toBeVisible();
  await replace(reduced, "1.5"); expect(reduced).toHaveAttribute("aria-invalid", "true");
  await replace(reduced, "1");
  await replace(screen.getByRole("spinbutton", { name: "Reduced usage other-provider Fixture deep limit" }), "0");
  expect(reduced).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByRole("button", { name: "Save limits" })).toBeEnabled();
  await replace(normal(), "-1"); expect(normal()).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  await replace(normal(), "4294967296");
  expect(screen.getByText("Enter a whole number from 0 to 4,294,967,295.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  await replace(normal(), "4294967295");
  expect(screen.getByRole("button", { name: "Save limits" })).toBeEnabled();
});

test("Normal and Reduced limits are saved together with the complete catalog", async () => {
  let data = snapshot(), submitted: SaveSwarmSettings | undefined;
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data)), http.post("/api/settings/swarm", async ({ request }) => {
    submitted = await request.json() as SaveSwarmSettings; data = confirmed(submitted); return HttpResponse.json(data);
  }));
  await open(); await replace(normal(), "4");
  await userEvent.click(screen.getByRole("button", { name: "Configure reduced usage" }));
  await replace(screen.getByRole("spinbutton", { name: "Reduced usage fixture-provider Fixture standard limit" }), "1");
  await replace(screen.getByRole("spinbutton", { name: "Reduced usage other-provider Fixture deep limit" }), "0");
  await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  await screen.findByText("Limits saved. Running agents continue.");
  expect(submitted).toMatchObject({ normal: [
    { provider: "fixture-provider", intelligence_class: "standard", limit: 4 },
    { provider: "other-provider", intelligence_class: "deep", limit: 1 },
  ], reduced: [
    { provider: "fixture-provider", intelligence_class: "standard", limit: 1 },
    { provider: "other-provider", intelligence_class: "deep", limit: 0 },
  ] });
});

test("a conflict retains edits and blocks another save until explicit reload", async () => {
  let posts = 0; read();
  server.use(http.post("/api/settings/swarm", () => { posts++; return HttpResponse.json({ error: "conflict", message: "Swarm changed." }, { status: 409 }); }));
  await open(); await replace(normal(), "5"); await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are preserved");
  expect(normal()).toHaveValue(5); expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Reload saved limits" }));
  await screen.findByText("Saved limits reloaded. Review the current values before editing.");
  expect(normal()).toHaveValue(2); expect(posts).toBe(1);
});

test("an interrupted save checks its operation without sending another save", async () => {
  read(); let submitted: SaveSwarmSettings | undefined, posts = 0;
  server.use(http.post("/api/settings/swarm", async ({ request }) => { submitted = await request.json() as SaveSwarmSettings; posts++; return HttpResponse.error(); }),
    http.get("/api/settings/swarm/operations/:id", ({ params }) => {
      expect(params.id).toBe(submitted!.operation_id); return HttpResponse.json(confirmed(submitted!));
    }));
  await open(); await replace(normal(), "4"); await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save not confirmed");
  expect(normal()).toHaveValue(4); expect(normal()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload saved limits" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Check save status" }));
  await screen.findByText("Limits saved. Running agents continue."); expect(posts).toBe(1);
});

test("an unrecorded save retries the exact operation and coherent request", async () => {
  let data = snapshot(); const requests: SaveSwarmSettings[] = [];
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data)), http.post("/api/settings/swarm", async ({ request }) => {
    const body = await request.json() as SaveSwarmSettings; requests.push(body);
    if (requests.length === 1) return HttpResponse.error();
    data = confirmed(body); return HttpResponse.json(data);
  }), http.get("/api/settings/swarm/operations/:id", () => HttpResponse.json({}, { status: 404 })));
  await open(); await replace(normal(), "4"); await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same save" }));
  await screen.findByText("Limits saved. Running agents continue.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test("a mismatched success is unconfirmed and never presented as saved", async () => {
  read(); server.use(http.post("/api/settings/swarm", () => HttpResponse.json(snapshot())));
  await open(); await replace(normal(), "4"); await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save not confirmed");
  expect(screen.queryByText("Limits saved. Running agents continue.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check save status" })).toBeEnabled();
});

test("Swarm drafts survive keyboard navigation between settings tabs", async () => {
  read(); await open(); await replace(normal(), "6");
  await userEvent.click(screen.getByRole("tab", { name: "Display" }));
  await screen.findByRole("region", { name: "Display" });
  await userEvent.click(screen.getByRole("tab", { name: "Swarm" }));
  expect(normal()).toHaveValue(6);
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Intelligence", selected: true })).toHaveFocus();
  expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(7);
});
