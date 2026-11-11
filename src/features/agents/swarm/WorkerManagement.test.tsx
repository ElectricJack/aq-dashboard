import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";

const server = setupServer(...handlersFor("default"));
let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); server.listen({ onUnhandledFrame: "error" }); });
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => { server.close(); restore(); });

test("saves a machine name and zero maximum while agents are running", async () => {
  const seen: Record<string, unknown>[] = [];
  let settings: Record<string, unknown>[] = [];
  server.use(
    http.get("/api/worker-management", () => HttpResponse.json({ settings })),
    http.post("/api/worker-management/machine/desktop", async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      seen.push(body);
      const receipt = { kind: "machine", id: "desktop", label: body.label, max_agents: body.max_agents, removed: false, revision: 1 };
      settings = [receipt];
      return HttpResponse.json(receipt);
    }),
  );
  renderApp("/agents?select=machine:desktop");
  const form = await screen.findByRole("form", { name: "Machine settings" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Office machine" } });
  fireEvent.change(within(form).getByRole("spinbutton", { name: "Max agents" }), { target: { value: "0" } });
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(seen).toHaveLength(1));
  expect(seen[0]).toMatchObject({ label: "Office machine", max_agents: 0, expected_revision: 0, remove: false });
  expect(typeof seen[0]!.operation_id).toBe("string");
  expect(await screen.findByRole("heading", { name: "Office machine", level: 2 })).toBeInTheDocument();
});

test("removes an offline machine with a simple confirmation even with an unfinished name edit", async () => {
  const seen: unknown[] = [];
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  server.use(http.post("/api/worker-management/machine/laptop", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    seen.push(body);
    return HttpResponse.json({ kind: "machine", id: "laptop", label: body.label, max_agents: null, removed: false, revision: 1 });
  }));
  renderApp("/agents?select=machine:laptop");
  const form = await screen.findByRole("form", { name: "Machine settings" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "" } });
  await userEvent.click(within(form).getByRole("button", { name: "Remove machine" }));
  await waitFor(() => expect(seen).toHaveLength(1));
  expect(confirm).toHaveBeenCalledWith("Are you sure?");
  expect(seen[0]).toMatchObject({ remove: true, expected_revision: 0, label: "laptop" });
});

test("retries an uncertain save using the same operation", async () => {
  const seen: unknown[] = [];
  server.use(http.post("/api/worker-management/machine/desktop", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    seen.push(body);
    if (seen.length === 1) return HttpResponse.error();
    return HttpResponse.json({ kind: "machine", id: "desktop", label: body.label, max_agents: null, removed: false, revision: 1 });
  }));
  renderApp("/agents?select=machine:desktop");
  const form = await screen.findByRole("form", { name: "Machine settings" });
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  await userEvent.click(await within(form).findByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(seen).toHaveLength(2));
  expect(seen[1]).toEqual(seen[0]);
});
