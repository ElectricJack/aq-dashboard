import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";

const CODE = "ENROLL-7f3a9c-ONCE";
const server = setupServer(...handlersFor("default"));
let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); server.listen({ onUnhandledFrame: "error" }); });
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { server.resetHandlers(); server.events.removeAllListeners(); vi.restoreAllMocks(); });
afterAll(() => { server.close(); restore(); });

async function openServerPane() { renderApp("/agents"); fireEvent.click(await screen.findByRole("button", { name: /^AQ server/ })); }
function enroll(status = 201) {
  const seen: { method: string; headers: Headers; body: string }[] = [];
  server.use(http.post("/api/enrollments", async ({ request }) => {
    seen.push({ method: request.method, headers: request.headers, body: await request.text() });
    return status === 201 ? HttpResponse.json({ code: CODE, expires_at: "2026-11-07T12:15:00.000Z" }, { status }) : HttpResponse.json({ message: "no" }, { status });
  }));
  return seen;
}

test("creates a code and shows it apart from the command", async () => {
  const seen = enroll();
  await openServerPane();
  await userEvent.click(await screen.findByRole("button", { name: "Add machine" }));
  const code = await screen.findByRole("textbox", { name: "Enrollment code" });
  expect(code).toHaveValue(CODE);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.headers.get("X-AQ-Request")).toBe("1");
  expect(seen[0]!.body).toBe("");
  const url = screen.getByRole("textbox", { name: /Worker URL/ }) as HTMLInputElement;
  expect(url.value).toBe(`${window.location.protocol}//${window.location.hostname}:28081`);
  expect(screen.getByText(/^packaging\/service\/aq-install\.sh --server /)).toBeInTheDocument();
  expect(screen.getByText(/Paste this when the script asks for it\. It works once and expires at/)).toBeInTheDocument();
  await userEvent.clear(url); await userEvent.type(url, "https://aq.example");
  expect(screen.getByText("packaging/service/aq-install.sh --server https://aq.example --bundle ~/aq-bundle --slots 2")).toBeInTheDocument();
});

test("command never contains the code", async () => {
  enroll();
  const log = vi.spyOn(console, "log"), info = vi.spyOn(console, "info"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
  await openServerPane();
  await userEvent.click(await screen.findByRole("button", { name: "Add machine" }));
  await screen.findByRole("textbox", { name: "Enrollment code" });
  const command = screen.getByText(/^packaging\/service\/aq-install\.sh/);
  expect(command.textContent).not.toContain(CODE);
  expect(window.location.href).not.toContain(CODE);
  expect(JSON.stringify({ ...localStorage })).not.toContain(CODE);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(CODE);
  for (const spy of [log, info, warn, error]) expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE);
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copied.push(t); } } });
  await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(copied).toEqual([CODE]));
  await userEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByDisplayValue(CODE)).toBeNull();
});

test("hidden without swarm.worker.enroll", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !["swarm.read", "swarm.worker.enroll"].includes(c.name)), { name: "swarm.read", version: "1", enabled: true },
    { name: "swarm.worker.enroll", version: "1", enabled: false, reason: "Adding a machine requires an owner account" }] } })));
  await openServerPane();
  await screen.findByText("Running agents", { selector: "dt" });
  expect(screen.queryByRole("button", { name: "Add machine" })).toBeNull();
});

test("a failed request says so", async () => {
  enroll(500);
  await openServerPane();
  await userEvent.click(await screen.findByRole("button", { name: "Add machine" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The enrollment code could not be created.");
  expect(screen.queryByRole("textbox", { name: "Enrollment code" })).toBeNull();
});

test("settings offers Add machine too", async () => {
  renderApp("/settings");
  const panel = await screen.findByRole("region", { name: "Add machine" });
  expect(within(panel).getByRole("button", { name: "Add machine" })).toBeInTheDocument();
});
