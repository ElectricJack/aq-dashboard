import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { SWARM_MOCKUP, swarmEnvelope } from "../../../mocks/swarm";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";

const server = setupServer(...handlersFor("default"));
let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); server.listen({ onUnhandledFrame: "error" }); });
beforeEach(() => sessionStorage.clear());
afterEach(() => { server.resetHandlers(); server.events.removeAllListeners(); });
afterAll(() => { server.close(); restore(); });

const fact = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const withAvailability = (owner_availability: unknown) => server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, server: { ...SWARM_MOCKUP.server, owner_availability } }))));
async function openServerPane() { renderApp("/agents/swarm"); fireEvent.click(await screen.findByRole("button", { name: /^AQ server/ })); await screen.findByText("Owner availability", { selector: "dt" }); }
function capture() {
  const bodies: Record<string, unknown>[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { bodies.push(await request.clone().json() as Record<string, unknown>); return undefined; }));
  return bodies;
}
async function submit(title: string, checkbox: RegExp) {
  const dialog = await screen.findByRole("dialog", { name: title });
  await userEvent.click(within(dialog).getByRole("checkbox", { name: checkbox }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
}

test("shows on with its age", async () => {
  await openServerPane();
  await waitFor(() => expect(fact("Owner availability")).toHaveTextContent("On (kept on since 1h ago)"));
  expect(screen.getByRole("button", { name: "Turn off availability" })).toBeEnabled();
});

test("keep available posts swarm.availability.set true at the generation", async () => {
  withAvailability({ state: "off", generation: "3", since: null });
  const bodies = capture();
  await openServerPane();
  expect(fact("Owner availability")).toHaveTextContent("Off");
  await userEvent.click(await screen.findByRole("button", { name: "Keep available" }));
  expect(await screen.findByRole("dialog", { name: "Keep available" })).toHaveTextContent("AQ keeps your subscription available for new agents until you turn it off.");
  await submit("Keep available", /Keep my availability on/);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ kind: "swarm.availability.set", subject: { type: "swarm", id: "owner-availability" }, expected_versions: {}, payload: { available: true, expected_generation: "3" } });
});

test("unset reads Not kept on and offers keep available", async () => {
  withAvailability({ state: "unset", generation: "1", since: null });
  await openServerPane();
  expect(fact("Owner availability")).toHaveTextContent("Not kept on");
  expect(await screen.findByRole("button", { name: "Keep available" })).toBeInTheDocument();
});

test("turn off posts false", async () => {
  const bodies = capture();
  await openServerPane();
  await userEvent.click(await screen.findByRole("button", { name: "Turn off availability" }));
  expect(await screen.findByRole("dialog", { name: "Turn off availability" })).toHaveTextContent("AQ stops starting new agents until you turn availability back on. Running agents continue.");
  await submit("Turn off availability", /Turn my availability off/);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ kind: "swarm.availability.set", payload: { available: false, expected_generation: "2" } });
});

test("hidden button without capability shows the reason", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !["swarm.read", "swarm.availability.control"].includes(c.name)), { name: "swarm.read", version: "1", enabled: true },
    { name: "swarm.availability.control", version: "1", enabled: false, reason: "Availability control requires an owner account" }] } })));
  await openServerPane();
  expect(screen.getByText("Availability control requires an owner account")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /availability|Keep available/ })).toBeNull();
});

test("null availability shows unknown", async () => {
  withAvailability(null);
  await openServerPane();
  expect(fact("Owner availability")).toHaveTextContent("unknown");
  expect(screen.queryByRole("button", { name: "Keep available" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Turn off availability" })).toBeNull();
});

test("a former owner's switch reads unset, shows its note and turning on sends the real generation", async () => {
  withAvailability({ state: "unset", generation: "7", since: null, note: "Set by a former owner; reads as unset." });
  const bodies = capture();
  await openServerPane();
  expect(fact("Owner availability")).toHaveTextContent("Not kept on");
  expect(await screen.findByRole("note")).toHaveTextContent("Set by a former owner; reads as unset.");
  await userEvent.click(await screen.findByRole("button", { name: "Keep available" }));
  await submit("Keep available", /Keep my availability on/);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ kind: "swarm.availability.set", payload: { available: true, expected_generation: "7" } });
});

test("the availability dialog survives the refetch after it confirms, keeps its reference and returns focus", async () => {
  const bodies = capture();
  await openServerPane();
  const opener = await screen.findByRole("button", { name: "Turn off availability" });
  await userEvent.click(opener);
  await submit("Turn off availability", /Turn my availability off/);
  withAvailability({ state: "off", generation: "3", since: null });
  const dialog = await screen.findByRole("dialog", { name: "Turn off availability" });
  await waitFor(() => expect(dialog.querySelector("details p")?.textContent).toBeTruthy());
  const reference = dialog.querySelector("details p")?.textContent;
  expect(await within(dialog).findByText("Availability is off.", {}, { timeout: 6000 })).toBeInTheDocument();
  await waitFor(() => expect(fact("Owner availability")).toHaveTextContent("Off"));
  expect(screen.getByRole("dialog", { name: "Turn off availability" })).toBeInTheDocument();
  expect(bodies).toHaveLength(1);
  expect(dialog.querySelector("details p")?.textContent).toBe(reference);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  const keep = await screen.findByRole("button", { name: "Keep available" });
  expect(keep).toBe(opener);
  await waitFor(() => expect(keep).toHaveFocus());
}, 15000);

test("an availability conflict says availability changed, not the machine", async () => {
  server.use(http.post("/api/v1/actions", () => HttpResponse.json({ request_id: "r", code: "conflict", message: "The availability switch changed.", retryable: false }, { status: 409 })));
  await openServerPane();
  await userEvent.click(await screen.findByRole("button", { name: "Turn off availability" }));
  await submit("Turn off availability", /Turn my availability off/);
  const dialog = await screen.findByRole("dialog", { name: "Turn off availability" });
  expect(await within(dialog).findByRole("status")).toHaveTextContent("availability changed since this page loaded");
  expect(dialog).toHaveTextContent("The availability switch changed.");
  expect(dialog).not.toHaveTextContent("machine changed");
});
