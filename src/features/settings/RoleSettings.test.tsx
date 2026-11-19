import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { routingDocumentHandlers } from "../../mocks/routingDocument";
import { internalWorkHandlers } from "../../mocks/internalWork";
import { roleSettingsHandlers } from "../../mocks/roleSettings";
import { swarmSettingsHandlers } from "../../mocks/swarmSettings";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
type Sent = { method: string; path: string; search: string; body: Record<string, unknown> | null };
let sent: Sent[] = [];
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  sent = [];
  server.use(...roleSettingsHandlers(), ...routingDocumentHandlers(), ...internalWorkHandlers(), ...swarmSettingsHandlers());
  server.events.on("request:start", async ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== "GET" && url.pathname.startsWith("/api/settings/")) sent.push({ method: request.method, path: url.pathname, search: url.search, body: await request.clone().json().catch(() => null) as Sent["body"] });
  });
});
afterEach(() => { server.events.removeAllListeners(); server.resetHandlers(); });
afterAll(() => server.close());

async function openTab(tab: "roles" | "intelligence" | "execution", table: string) {
  renderApp(`/settings?tab=${tab}`);
  return screen.findByRole("table", { name: table });
}
async function edit(name: string) {
  await userEvent.click(screen.getByRole("button", { name: `Edit ${name}` }));
  return screen.findByRole("region", { name: `Edit ${name}` });
}
const markdown = (editor: HTMLElement) => within(editor).getByLabelText("Markdown") as HTMLTextAreaElement;
const type = (editor: HTMLElement, text: string) => fireEvent.change(markdown(editor), { target: { value: text } });

describe("Roles", () => {
  test("lists each role's name, description, execution profile, operations and whether it is enabled", async () => {
    const table = await openTab("roles", "Roles");
    expect(within(table).getAllByRole("columnheader").map(th => th.textContent)).toEqual(["Name", "Description", "Execution profile", "Operations", "Enabled", "Actions"]);
    const row = within(table).getByRole("row", { name: "Fixture developer" });
    expect(row).toHaveTextContent("developer");
    expect(row).toHaveTextContent("Fixture: makes the change a task asks for and reports evidence.");
    expect(row).toHaveTextContent("fixture-sandbox");
    expect(row).toHaveTextContent("task.read, knowledge.read, source.write");
    expect(within(row).getByRole("switch", { name: "Fixture developer enabled" })).toBeChecked();
    expect(within(table).getByRole("row", { name: "Fixture reviewer" })).toHaveTextContent("task.read, knowledge.read");
    const digest = await screen.findByTitle(/^[0-9a-f]{64}$/);
    expect(digest.parentElement).toHaveTextContent(/^Active snapshot [0-9a-f]{12} · revision 1$/);
  });

  test("the editor shows the Markdown and how AQ read it; Save sends the Markdown at the revision it was read", async () => {
    await openTab("roles", "Roles");
    const editor = await edit("Fixture developer");
    expect(within(editor).getByRole("heading", { name: "Fixture developer" })).toHaveFocus();
    const text = markdown(editor).value;
    expect(text).toMatch(/^---\nid: developer\nname: Fixture developer\n/);
    const summary = within(editor).getByRole("heading", { name: "How AQ reads the saved role" }).parentElement!;
    expect(summary).toHaveTextContent("Execution profilefixture-sandbox");
    expect(summary).toHaveTextContent("Operationstask.read, knowledge.read, source.write");
    expect(summary).toHaveTextContent("New workEnabled");
    expect(within(editor).getByRole("button", { name: "Save role" })).toBeDisabled();
    const changed = text.replace("operations: [task.read, knowledge.read, source.write]", "operations: [task.read]");
    type(editor, changed);
    expect(screen.getByRole("row", { name: "Fixture developer" })).toHaveTextContent("Unsaved changes");
    expect(summary).toHaveTextContent("This is the saved version. Save to see how AQ reads your changes.");
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(await within(editor).findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ method: "PUT", path: "/api/settings/roles/developer", search: "", body: { markdown: changed, expected_revision: "1", operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/) } }]);
    await waitFor(() => expect(summary).toHaveTextContent("Operationstask.read"));
    expect(summary).not.toHaveTextContent("source.write");
    expect(summary).toHaveTextContent("Revision 2");
    expect(markdown(editor)).toHaveValue(changed);
    expect(await screen.findByText(/revision 2$/)).toBeVisible();
  });

  test("an invalid save shows every problem in the server's words beside the editor and keeps the text", async () => {
    await openTab("roles", "Roles");
    const editor = await edit("Fixture developer");
    const broken = markdown(editor).value.replace("execution: fixture-sandbox", "execution: nowhere").replace("task.read", "task.fly");
    type(editor, broken);
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    const alert = await within(editor).findByRole("alert");
    expect(alert).toHaveTextContent("AQ did not save this role:");
    expect(within(alert).getAllByRole("listitem").map(li => li.textContent)).toEqual([
      "role `developer`: execution: no execution profile `nowhere` exists",
      "role `developer`: operations: `task.fly` is not an AQ operation a role can hold",
    ]);
    expect(markdown(editor)).toHaveValue(broken);
    expect(within(editor).getByRole("button", { name: "Save role" })).toBeEnabled();
    // Editing again clears the old report.
    type(editor, `${broken}\n`);
    expect(within(editor).queryByRole("alert")).toBeNull();
  });

  test("a stale copy is said to be stale, the saved version is loaded beside the kept text, and saving again replaces it", async () => {
    await openTab("roles", "Roles");
    const editor = await edit("Fixture developer");
    const mine = `${markdown(editor).value}- Mine.\n`;
    type(editor, mine);
    // Someone else saves first.
    const theirs = mine.replace("- Mine.\n", "- Theirs.\n").replace("name: Fixture developer", "name: Fixture engineer");
    await fetch("/api/settings/roles/developer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: theirs, expected_revision: "1", operation_id: crypto.randomUUID() }) });
    sent = [];
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(await screen.findByText("This role changed since you opened it. Your text is kept and the saved version is shown beside it. Save again to replace the saved version, or discard your changes.")).toBeVisible();
    const stale = screen.getByRole("region", { name: "Edit Fixture engineer" });
    expect(markdown(stale)).toHaveValue(mine);
    expect(stale).toHaveTextContent("NameFixture engineer");
    expect(within(stale).getByText("Saved Markdown").closest("details")).toHaveTextContent("- Theirs.");
    await userEvent.click(within(stale).getByRole("button", { name: "Save role" }));
    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(sent.map(s => s.body?.expected_revision)).toEqual(["1", "2"]);
    expect(sent[1]!.body?.markdown).toBe(mine);
    expect(sent[1]!.body?.operation_id).not.toBe(sent[0]!.body?.operation_id);
  });

  test("a save whose answer is lost keeps the text and retries the same operation", async () => {
    await openTab("roles", "Roles");
    const editor = await edit("Fixture reviewer");
    const changed = `${markdown(editor).value}- Extra.\n`;
    type(editor, changed);
    server.use(http.put("/api/settings/roles/reviewer", () => HttpResponse.error(), { once: true }));
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("The save could not be confirmed. Your text is kept.");
    expect(markdown(editor)).toHaveValue(changed);
    await userEvent.click(within(editor).getByRole("button", { name: "Retry save" }));
    expect(await within(editor).findByText("Saved.")).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test("a new role is created from a starting document under the id its text states", async () => {
    await openTab("roles", "Roles");
    await userEvent.click(screen.getByRole("button", { name: "New role" }));
    const editor = await screen.findByRole("region", { name: "New role" });
    expect(markdown(editor).value).toContain("execution: fixture-sandbox\n");
    expect(editor).toHaveTextContent("Save the role to see how AQ reads it.");
    type(editor, markdown(editor).value.replace("id: new-role", "id: Not An Id"));
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("Give the role an id on its “id:” line");
    expect(sent).toEqual([]);
    const tester = markdown(editor).value.replace("id: Not An Id", "id: tester").replace("name: New role", "name: Fixture tester");
    type(editor, tester);
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    const saved = await screen.findByRole("region", { name: "Edit Fixture tester" });
    expect(sent).toEqual([{ method: "PUT", path: "/api/settings/roles/tester", search: "", body: { markdown: tester, expected_revision: "0", operation_id: expect.any(String) } }]);
    expect(within(saved).getByText("Saved.")).toBeVisible();
    expect(screen.getByRole("row", { name: "Fixture tester" })).toHaveTextContent("tester");
  });

  test("creating over an id that exists is refused without losing the text", async () => {
    await openTab("roles", "Roles");
    await userEvent.click(screen.getByRole("button", { name: "New role" }));
    const editor = await screen.findByRole("region", { name: "New role" });
    const text = markdown(editor).value.replace("id: new-role", "id: reviewer");
    type(editor, text);
    await userEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("A role with the id “reviewer” already exists. Your text is kept.");
    expect(markdown(editor)).toHaveValue(text);
  });

  test("the Enabled switch rewrites the role's enabled line; the last enabled role cannot be disabled", async () => {
    const table = await openTab("roles", "Roles");
    await userEvent.click(within(table).getByRole("switch", { name: "Fixture reviewer enabled" }));
    await waitFor(() => expect(within(table).getByRole("switch", { name: "Fixture reviewer enabled" })).not.toBeChecked());
    expect(sent[0]).toMatchObject({ method: "PUT", path: "/api/settings/roles/reviewer", body: { expected_revision: "1" } });
    expect(sent[0]!.body?.markdown).toContain("\nenabled: false\n---\n");
    expect(within(table).getByRole("row", { name: "Fixture reviewer" })).toHaveTextContent("Disabled");
    await userEvent.click(within(table).getByRole("switch", { name: "Fixture developer enabled" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AQ did not disable “Fixture developer”:");
    expect(within(table).getByRole("switch", { name: "Fixture developer enabled" })).toBeChecked();
  });

  test("delete asks first and then removes the role", async () => {
    const table = await openTab("roles", "Roles");
    await userEvent.click(within(table).getByRole("button", { name: "Delete Fixture reviewer" }));
    const confirm = within(table).getByRole("group", { name: "Confirm delete Fixture reviewer" });
    expect(within(confirm).getByRole("button", { name: "Confirm delete Fixture reviewer" })).toHaveFocus();
    expect(sent).toEqual([]);
    await userEvent.click(within(confirm).getByRole("button", { name: "Confirm delete Fixture reviewer" }));
    expect(await screen.findByText("Deleted “Fixture reviewer”.")).toBeVisible();
    expect(sent[0]).toMatchObject({ method: "DELETE", path: "/api/settings/roles/reviewer" });
    expect(sent[0]!.search).toMatch(/^\?expected_revision=1&operation_id=[0-9a-f-]{36}$/);
    expect(within(table).queryByRole("row", { name: "Fixture reviewer" })).toBeNull();
  });

  test("a failed read offers a retry, and no roles is said plainly", async () => {
    let fail = true;
    server.use(http.get("/api/settings/roles", () => fail ? HttpResponse.json({ error: "unavailable", message: "Down" }, { status: 503 }) : HttpResponse.json({ revision: "1", active_digest: null, documents: [] })));
    renderApp("/settings?tab=roles");
    const retry = await screen.findByRole("button", { name: /Try again/ });
    expect(screen.getByRole("button", { name: "New role" })).toBeDisabled();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText("No roles yet.")).toBeVisible();
  });

  test("a stored role AQ cannot read is listed with the reason and stays editable", async () => {
    server.use(http.get("/api/settings/roles", () => HttpResponse.json({ revision: "3", active_digest: null, documents: [
      { kind: "role", id: "broken", revision: "3", updated_at_ms: 1, markdown: "not a document", fields: null, problem: "line 1: a document starts with a `---` line" }] })));
    const table = await openTab("roles", "Roles");
    expect(within(table).getByRole("row", { name: "broken" })).toHaveTextContent("AQ cannot read this role: line 1: a document starts with a `---` line");
    const editor = await edit("broken");
    expect(markdown(editor)).toHaveValue("not a document");
    expect(editor).toHaveTextContent("AQ cannot read the saved text: line 1: a document starts with a `---` line");
  });
});

describe("Execution profiles", () => {
  test("lists and summarises harnesses, environment, confinement, credentials and limits", async () => {
    const table = await openTab("execution", "Execution profiles");
    const row = within(table).getByRole("row", { name: "Fixture sandbox" });
    for (const text of ["claude, codex, opencode", "fixture-environment", "container"]) expect(row).toHaveTextContent(text);
    const editor = await edit("Fixture sandbox");
    expect(markdown(editor).value).toContain("## Limits\n- wall_time_ms: 900000\n");
    for (const text of ["Harnessesclaude, codex, opencode", "Environmentfixture-environment", "Confinementcontainer (always in a container)", "claude: fixture-claude-credential", "Wall time900,000 ms (15 min)", "Memory4,294,967,296 bytes (4 GiB)", "Output32,000 tokens"])
      expect(editor).toHaveTextContent(text);
  });

  test("deleting a profile a role still runs under shows the server's refusal and deletes nothing", async () => {
    const table = await openTab("execution", "Execution profiles");
    await userEvent.click(within(table).getByRole("button", { name: "Delete Fixture sandbox" }));
    await userEvent.click(within(table).getByRole("button", { name: "Confirm delete Fixture sandbox" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AQ did not delete “Fixture sandbox”:");
    expect(within(alert).getAllByRole("listitem").map(li => li.textContent)).toEqual([
      "role `developer`: execution: no execution profile `fixture-sandbox` exists",
      "role `reviewer`: execution: no execution profile `fixture-sandbox` exists",
    ]);
    expect(within(table).getByRole("row", { name: "Fixture sandbox" })).toBeVisible();
  });
});

describe("Intelligence levels", () => {
  const TABLE = "| provider | model | reasoning | harnesses |\n|---|---|---|---|\n";
  test("lists each level's candidates in order", async () => {
    const table = await openTab("intelligence", "Levels");
    const row = within(table).getByRole("row", { name: "Fixture standard, high" });
    expect(within(row).getAllByRole("listitem").map(li => li.textContent)).toEqual(["fixture-provider · fixture-model · high · opencode", "anthropic · fixture-model-large · high · claude"]);
  });

  test("moving a candidate rewrites the Candidates table in the Markdown, and Save sends it", async () => {
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, high");
    const candidates = within(editor).getByRole("table", { name: "Candidates" });
    expect(within(candidates).getByRole("button", { name: "Move candidate 1 up" })).toBeDisabled();
    expect(within(candidates).getByRole("button", { name: "Move candidate 2 down" })).toBeDisabled();
    await userEvent.click(within(candidates).getByRole("button", { name: "Move candidate 2 up" }));
    const reordered = `---\nid: standard-high\nname: Fixture standard, high\ndescription: Labelled fixture level\n---\n## Candidates\n${TABLE}| anthropic | fixture-model-large | high | claude |\n| fixture-provider | fixture-model | high | opencode |\n`;
    expect(markdown(editor)).toHaveValue(reordered);
    expect(within(candidates).getByLabelText("Model of candidate 1")).toHaveValue("fixture-model-large");
    // The moved row keeps the keyboard: its Up button is disabled at the top, so focus lands on its Down button.
    expect(within(candidates).getByRole("button", { name: "Move candidate 1 down" })).toHaveFocus();
    await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
    expect(await within(editor).findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ method: "PUT", path: "/api/settings/intelligence-profiles/standard-high", search: "", body: { markdown: reordered, expected_revision: "1", operation_id: expect.any(String) } }]);
    await waitFor(() => expect(within(screen.getByRole("row", { name: "Fixture standard, high" })).getAllByRole("listitem")[0]).toHaveTextContent("anthropic · fixture-model-large · high · claude"));
  });

  test("candidates are added, edited and removed through the table; reasoning follows the harness", async () => {
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, low");
    const candidates = () => within(editor).getByRole("table", { name: "Candidates" });
    await userEvent.click(within(editor).getByRole("button", { name: "Add candidate" }));
    const model = within(candidates()).getByLabelText("Model of candidate 2");
    expect(model).toHaveFocus();
    expect(model).toBeInvalid();
    expect(within(editor).getByText(/Every candidate needs a provider and a model/)).toBeVisible();
    await userEvent.type(model, "fixture-model-large");
    const options = (label: string) => within(within(candidates()).getByLabelText(label)).getAllByRole("option").map(o => o.textContent);
    expect(options("Reasoning of candidate 2")).toEqual(["default", "off", "low", "medium", "high", "xhigh", "max"]);
    await userEvent.selectOptions(within(candidates()).getByLabelText("Reasoning of candidate 2"), "xhigh");
    // Codex takes OpenAI models and does not accept xhigh, so both follow the harness.
    await userEvent.selectOptions(within(candidates()).getByLabelText("Harness of candidate 2"), "codex");
    expect(options("Reasoning of candidate 2")).toEqual(["default", "low", "medium", "high"]);
    expect(within(candidates()).getByLabelText("Reasoning of candidate 2")).toHaveValue("default");
    expect(within(candidates()).getByLabelText("Provider of candidate 2")).toHaveValue("openai");
    await userEvent.selectOptions(within(candidates()).getByLabelText("Harness of candidate 1"), "gemini");
    expect(options("Reasoning of candidate 1")).toEqual(["default"]);
    expect(markdown(editor).value.endsWith(`## Candidates\n${TABLE}| fixture-provider | fixture-model | default | gemini |\n| openai | fixture-model-large | default | codex |\n`)).toBe(true);
    await userEvent.click(within(candidates()).getByRole("button", { name: "Remove candidate 1" }));
    expect(markdown(editor).value.endsWith(`## Candidates\n${TABLE}| openai | fixture-model-large | default | codex |\n`)).toBe(true);
    expect(within(editor).getByRole("button", { name: "Add candidate" })).toHaveFocus();
  });

  test("the model field suggests the models found for the row's harness, and any other model may still be typed and saved", async () => {
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, high");
    const model = (n: number) => within(editor).getByLabelText(`Model of candidate ${n}`) as HTMLInputElement;
    const offered = (n: number) => Array.from(model(n).list?.querySelectorAll("option") ?? []).map(option => [option.value, option.label]);
    // Candidate 2 runs on claude; candidate 1 on opencode, for which the fixture has no suggestions.
    await waitFor(() => expect(offered(2)).toEqual([["fixture-model-large", "anthropic · Fixture discovery"], ["fixture-model-small", "anthropic"]]));
    expect(model(1).list).toBeNull();
    expect(within(editor).getByText(/The model field suggests the models AQ found for the row’s harness; any other model may be typed\./)).toBeVisible();
    // The suggestions follow the harness.
    await userEvent.selectOptions(within(editor).getByLabelText("Harness of candidate 1"), "codex");
    expect(offered(1)).toEqual([["fixture-codex-model", "openai · Fixture discovery"]]);
    // Not a gate: a model nobody suggested is accepted and saved.
    fireEvent.change(model(2), { target: { value: "a-model-nobody-suggested" } });
    expect(model(2)).toBeValid();
    await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
    expect(await within(editor).findByText("Saved.")).toBeVisible();
    expect((sent[0]!.body as { markdown: string }).markdown).toContain("| anthropic | a-model-nobody-suggested | high | claude |");
  });
  test("a model suggested for one provider brings that provider where the harness does not fix it", async () => {
    server.use(http.get("/api/settings/model-suggestions", () => HttpResponse.json({ harnesses: [{ harness: "opencode", models: [{ provider: "longcat", model: "long-one", source: null, observed_at: null }] }] })));
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, low");
    const model = within(editor).getByLabelText("Model of candidate 1") as HTMLInputElement;
    await waitFor(() => expect(model.list).not.toBeNull());
    fireEvent.change(model, { target: { value: "long-one" } });
    expect(within(editor).getByLabelText("Provider of candidate 1")).toHaveValue("longcat");
    expect(markdown(editor).value).toContain("| longcat | long-one | low | opencode |");
  });
  test("when the suggestions cannot be read, or there are none, the candidates are edited and saved as before", async () => {
    for (const answer of [() => HttpResponse.json({ error: "internal", message: "no" }, { status: 500 }), () => HttpResponse.json({ harnesses: [] })]) {
      server.use(http.get("/api/settings/model-suggestions", answer));
      const { unmount } = await (async () => { const view = renderApp("/settings?tab=intelligence"); await screen.findByRole("table", { name: "Levels" }); return view; })();
      const editor = await edit("Fixture standard, high");
      const model = within(editor).getByLabelText("Model of candidate 2") as HTMLInputElement;
      expect(await within(editor).findByText(/AQ has no model suggestions to offer here now\./)).toBeVisible();
      expect(model.list).toBeNull();
      expect(within(editor).queryByRole("alert")).toBeNull();
      fireEvent.change(model, { target: { value: "typed-model" } });
      await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
      expect(await within(editor).findByText("Saved.")).toBeVisible();
      unmount(); sessionStorage.clear(); sent = [];
      server.resetHandlers(); server.use(...roleSettingsHandlers(), ...routingDocumentHandlers(), ...internalWorkHandlers(), ...swarmSettingsHandlers());
    }
  });

  test("the Markdown stays editable, the table follows it, and a table that cannot be read is edited as text", async () => {
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, low");
    type(editor, `${markdown(editor).value}| anthropic | fixture-model-large | max | claude |\n\n## Selection\n- max_attempts: 3\n`);
    expect(within(editor).getByLabelText("Reasoning of candidate 2")).toHaveValue("max");
    await userEvent.selectOptions(within(editor).getByLabelText("Reasoning of candidate 2"), "off");
    expect(markdown(editor).value.endsWith("| anthropic | fixture-model-large | off | claude |\n\n## Selection\n- max_attempts: 3\n")).toBe(true);
    type(editor, "---\nid: standard-low\nname: Fixture standard, low\n---\n## Candidates\nnot a table\n");
    expect(within(editor).queryByRole("table", { name: "Candidates" })).toBeNull();
    expect(within(editor).getByRole("note")).toHaveTextContent("The candidates table cannot be read from the Markdown");
    await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("intelligence profile document `standard-low`: line 5: `## Candidates` expects a table that starts with `| provider | model | reasoning | harnesses |`");
  });

  test("a reasoning value the harness does not accept is shown as such and refused by the server in its words", async () => {
    await openTab("intelligence", "Levels");
    const editor = await edit("Fixture standard, low");
    type(editor, markdown(editor).value.replace("| low | opencode |", "| xhigh | opencode |"));
    expect(within(within(editor).getByLabelText("Reasoning of candidate 1")).getAllByRole("option")[0]).toHaveTextContent("xhigh (not accepted by opencode)");
    await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("intelligence profile `standard-low`: candidates:");
  });

  test("levels are listed simple to deep and, within each, low to max; any other id comes after, by id", async () => {
    const level = (id: string) => ({ kind: "intelligence", id, revision: "1", updated_at_ms: 1, markdown: `---\nid: ${id}\nname: ${id}\n---\n## Candidates\n${TABLE}`, problem: null, fields: { id, name: id, description: "", candidates: [], selection: {} } });
    const ids = ["deep-high", "research", "standard-medium", "complex-max", "simple-high", "deep-low", "standard-low", "simple-low", "architect", "complex-low", "standard-high", "simple-max"];
    server.use(http.get("/api/settings/intelligence-profiles", () => HttpResponse.json({ revision: "1", active_digest: null, documents: ids.map(level) })));
    const table = await openTab("intelligence", "Levels");
    expect([...table.querySelectorAll("tbody tr")].map(row => row.getAttribute("data-document-id"))).toEqual(
      ["simple-low", "simple-high", "simple-max", "standard-low", "standard-medium", "standard-high", "complex-low", "complex-max", "deep-low", "deep-high", "architect", "research"]);
  });

  test("the description leads the editor, says the router reads it, and is written into the document's description line", async () => {
    const table = await openTab("intelligence", "Levels");
    expect(within(table).getByRole("row", { name: "Fixture standard, high" })).toHaveTextContent("Labelled fixture level");
    const editor = await edit("Fixture standard, high");
    const description = within(editor).getByRole("textbox", { name: "Description" });
    expect(description).toHaveValue("Labelled fixture level");
    expect(description).toHaveAccessibleDescription("The router reads this text when it chooses a level for a task. Say what kind of work belongs on this level.");
    // It comes before the candidates and the Markdown.
    expect(description.compareDocumentPosition(within(editor).getByRole("table", { name: "Candidates" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(description, { target: { value: "Work that touches several parts.\nCheck it carefully." } });
    expect(markdown(editor).value).toMatch(/^---\nid: standard-high\nname: Fixture standard, high\ndescription: Work that touches several parts\. Check it carefully\.\n---\n/);
    await userEvent.click(within(editor).getByRole("button", { name: "Save level" }));
    expect(await within(editor).findByText("Saved.")).toBeVisible();
    expect(sent[0]!.body!.markdown).toContain("\ndescription: Work that touches several parts. Check it carefully.\n");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Levels" })).getByRole("row", { name: "Fixture standard, high" })).toHaveTextContent("Work that touches several parts. Check it carefully."));
    // Text the grammar would read as a list or a quote is quoted; no text removes the line; the field follows the Markdown.
    fireEvent.change(description, { target: { value: "[draft] \"hard\" work" } });
    expect(markdown(editor).value).toContain("\ndescription: \"[draft] \\\"hard\\\" work\"\n");
    expect(description).toHaveValue("[draft] \"hard\" work");
    fireEvent.change(description, { target: { value: "" } });
    expect(markdown(editor).value).toMatch(/^---\nid: standard-high\nname: Fixture standard, high\n---\n/);
    type(editor, markdown(editor).value.replace("name: Fixture standard, high\n", "name: Fixture standard, high\ndescription: Typed in the Markdown\n"));
    expect(description).toHaveValue("Typed in the Markdown");
  });

  describe("Max agents", () => {
    const limits = () => sent.filter(request => request.path === "/api/settings/swarm/limits");
    const input = (name: string) => screen.findByRole("textbox", { name });
    beforeEach(() => server.use(...swarmSettingsHandlers("level-limits")));

    test("each level has a Max agents entry per provider the swarm limits; Save sends the changed cells with the level's id", async () => {
      const table = await openTab("intelligence", "Levels");
      expect(within(table).getAllByRole("columnheader").map(th => th.textContent)).toEqual(["Name", "Description", "Candidates (provider · model · reasoning · harness)", "Max agents", "Actions"]);
      const low = await input("Max agents for Fixture standard, low on fixture-provider");
      // The fixture limits every listed level to 2.
      expect(low).toHaveValue("2"); expect(low).toHaveAttribute("placeholder", "Unlimited");
      expect(within(table).getByRole("row", { name: "Fixture standard, high" })).toHaveTextContent("fixture-provider");
      const high = await input("Max agents for Fixture standard, high on anthropic");
      expect(screen.queryByRole("button", { name: "Save max agents" })).toBeNull();
      await userEvent.clear(low); await userEvent.type(low, "3"); await userEvent.clear(high); await userEvent.type(high, "0");
      expect(screen.getByText(/Blank means unlimited; 0 pauses new launches\. Running agents finish\./)).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Save max agents" }));
      expect(await screen.findByText("Max agents saved.")).toBeVisible();
      expect(limits().map(request => request.body)).toEqual([
        { operation_id: expect.any(String), expected_revision: "1", cell: { provider: "fixture-provider", intelligence_class: "standard-low", limit: 3 } },
        { operation_id: expect.any(String), expected_revision: "2", cell: { provider: "anthropic", intelligence_class: "standard-high", limit: 0 } },
      ]);
      expect(low).toHaveValue("3"); expect(high).toHaveValue("0");
      expect(screen.queryByRole("button", { name: "Save max agents" })).toBeNull();
      // Blank again removes the limit.
      await userEvent.clear(low);
      await userEvent.click(screen.getByRole("button", { name: "Save max agents" }));
      await waitFor(() => expect(limits()).toHaveLength(3));
      expect(limits()[2]!.body).toMatchObject({ cell: { provider: "fixture-provider", intelligence_class: "standard-low", limit: null } });
    });

    test("the page Save saves Max agents too, and an entry that is not a whole number is not sent", async () => {
      await openTab("intelligence", "Levels");
      const low = await input("Max agents for Fixture standard, low on fixture-provider");
      await userEvent.clear(low); await userEvent.type(low, "2.5");
      expect(low).toBeInvalid();
      expect(screen.getByRole("alert")).toHaveTextContent("Max agents is a whole number from 0 to 4,294,967,295, or blank for unlimited.");
      expect(screen.getByRole("button", { name: "Save max agents" })).toBeDisabled();
      await userEvent.clear(low); await userEvent.type(low, "5");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(limits()).toHaveLength(1));
      expect(limits()[0]!.body).toMatchObject({ cell: { provider: "fixture-provider", intelligence_class: "standard-low", limit: 5 } });
    });

    test("limits changed elsewhere keep the entry and offer a reload; discarding returns to what AQ holds", async () => {
      await openTab("intelligence", "Levels");
      const low = await input("Max agents for Fixture standard, low on fixture-provider");
      await userEvent.clear(low); await userEvent.type(low, "7");
      server.use(http.post("/api/settings/swarm/limits", () => HttpResponse.json({ error: "swarm_settings", message: "Settings changed; reload and try again." }, { status: 409 })));
      await userEvent.click(screen.getByRole("button", { name: "Save max agents" }));
      expect(await screen.findByText("The agent limits changed elsewhere. Your entries are kept; reload the limits, then save again.")).toBeVisible();
      expect(low).toHaveValue("7");
      expect(screen.getByRole("button", { name: "Save max agents" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Reload limits" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Save max agents" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Discard max agents changes" }));
      expect(low).toHaveValue("2");
    });

    test("a refusal is shown in AQ's words; without the limits the levels stay editable", async () => {
      server.use(http.post("/api/settings/swarm/limits", () => HttpResponse.json({ error: "swarm_settings", message: "Unknown class." }, { status: 400 })));
      await openTab("intelligence", "Levels");
      const low = await input("Max agents for Fixture standard, low on fixture-provider");
      await userEvent.clear(low); await userEvent.type(low, "1");
      await userEvent.click(screen.getByRole("button", { name: "Save max agents" }));
      expect(await screen.findByText("AQ did not save max agents: Unknown class.. Your entries are kept.")).toBeVisible();
    });

    test("a level whose providers the swarm does not limit says so, and unreadable limits do not block the levels", async () => {
      server.use(...swarmSettingsHandlers());
      const table = await openTab("intelligence", "Levels");
      expect(await within(table).findAllByText("No limit to set until one of this level’s providers is connected")).toHaveLength(2);
      expect(screen.queryByRole("textbox", { name: /^Max agents for/ })).toBeNull();
    });

    test("when the limits cannot be read the levels are still listed and editable", async () => {
      server.use(http.get("/api/settings/swarm", () => HttpResponse.json({ error: "swarm_settings", message: "down" }, { status: 503 })));
      const table = await openTab("intelligence", "Levels");
      expect(await screen.findByText(/The agent limits are unavailable, so max agents cannot be shown or changed\./)).toBeVisible();
      expect(within(table).getAllByText("Unavailable")).toHaveLength(2);
      expect(await edit("Fixture standard, high")).toBeVisible();
    });
  });

  test("Internal work chooses among the saved levels", async () => {
    renderApp("/settings?tab=intelligence");
    const panel = await screen.findByRole("region", { name: "Internal work" });
    const select = await within(panel).findByLabelText("Default profile");
    await waitFor(() => expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual(["Choose a profile", "Fixture standard, high", "Fixture standard, low"]));
    expect(await screen.findByRole("region", { name: "Routing policy" })).toBeVisible();
  });
});

describe("Selection defaults", () => {
  async function open() {
    renderApp("/settings?tab=intelligence");
    const form = await screen.findByRole("region", { name: "Selection defaults" });
    await within(form).findByLabelText("Attempts per task");
    return form;
  }
  test("shows the one set of defaults and saves the whole set at its revision", async () => {
    const form = await open();
    expect(within(form).getByLabelText("Attempts per task")).toHaveValue("2");
    expect(within(form).getByLabelText("Longest time across attempts (ms)")).toHaveValue("3600000");
    expect(form).toHaveTextContent("1 h · at most 7 days");
    expect(within(form).getByLabelText("When a candidate’s cost is unknown")).toHaveValue("allow_bounded");
    expect(within(form).getByRole("checkbox", { name: "The model is unavailable" })).toBeChecked();
    expect(within(form).getByRole("checkbox", { name: "Use a candidate whose availability is unknown" })).not.toBeChecked();
    expect(within(form).getByRole("button", { name: "Save selection defaults" })).toBeDisabled();
    await userEvent.clear(within(form).getByLabelText("Attempts per task"));
    await userEvent.type(within(form).getByLabelText("Attempts per task"), "3");
    await userEvent.click(within(form).getByRole("checkbox", { name: "Policy denies it" }));
    await userEvent.type(within(form).getByLabelText("Cost limit (millionths of the currency)"), "5000000");
    await userEvent.type(within(form).getByLabelText("Currency of the cost limit"), "usd");
    await userEvent.click(within(form).getByRole("button", { name: "Save selection defaults" }));
    expect(await within(form).findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ method: "PUT", path: "/api/settings/selection-defaults", search: "", body: { expected_revision: "0", operation_id: expect.any(String), selection_defaults: {
      max_attempts: 3, fallback_on: ["missing_credentials", "unavailable", "unsupported", "stale_unknown"], max_lineage_elapsed_ms: 3600000, observation_max_age_ms: 30000,
      allow_unknown_availability: false, unknown_cost: "allow_bounded", require_complete_accounting: false, require_hard_cost_enforcement: false, max_cost_microunits: 5000000, currency: "USD" } } }]);
    expect(within(form).getByLabelText("Attempts per task")).toHaveValue("3");
    expect(within(form).getByRole("button", { name: "Save selection defaults" })).toBeDisabled();
  });
  test("a value that cannot be sent is caught, and the server's refusal is shown in its words", async () => {
    const form = await open();
    await userEvent.clear(within(form).getByLabelText("Attempts per task"));
    await userEvent.click(within(form).getByRole("button", { name: "Save selection defaults" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Enter whole numbers for the attempts and both times.");
    expect(sent).toEqual([]);
    await userEvent.type(within(form).getByLabelText("Attempts per task"), "99");
    await userEvent.click(within(form).getByRole("button", { name: "Save selection defaults" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("AQ did not save these defaults:");
    expect(alert).toHaveTextContent("selection defaults: selection policy bounds");
    expect(within(form).getByLabelText("Attempts per task")).toHaveValue("99");
  });
  test("defaults changed elsewhere are reloaded without losing the edits", async () => {
    const form = await open();
    await userEvent.clear(within(form).getByLabelText("Attempts per task"));
    await userEvent.type(within(form).getByLabelText("Attempts per task"), "4");
    const current = await (await fetch("/api/settings/selection-defaults")).json() as { selection_defaults: Record<string, unknown> };
    await fetch("/api/settings/selection-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection_defaults: { ...current.selection_defaults, observation_max_age_ms: 60000 }, expected_revision: "0", operation_id: crypto.randomUUID() }) });
    sent = [];
    await userEvent.click(within(form).getByRole("button", { name: "Save selection defaults" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("The defaults changed since you opened them. Your edits are kept.");
    expect(within(form).getByLabelText("Attempts per task")).toHaveValue("4");
    await userEvent.click(within(form).getByRole("button", { name: "Save selection defaults" }));
    expect(await within(form).findByText("Saved.")).toBeVisible();
    expect(sent.map(s => s.body?.expected_revision)).toEqual(["0", "2"]);
  });
});

describe("Store limits", () => {
  const LIMITS = { documents: { max_document_bytes: 65_536, max_set_bytes: 1_048_576, max_documents_per_kind: 128, max_name_bytes: 128, max_description_bytes: 2000 }, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 };
  async function openLimits(tab: "roles" | "intelligence" | "execution" = "roles", table = "Roles") {
    await openTab(tab, table);
    await userEvent.click(await screen.findByText("Limits"));
    return screen.findByRole("group", { name: "Limits of roles, levels and execution profiles" });
  }
  test("the limits sit beside the snapshot line on each document tab and are saved as one set at their revision", async () => {
    const form = await openLimits();
    expect(screen.getByText(/^Active snapshot/).parentElement).toContainElement(form);
    expect(within(form).getAllByRole("textbox").map(input => (input as HTMLInputElement).value)).toEqual(["65536", "1048576", "128", "128", "2000", "20", "200", "1000"]);
    expect(within(form).getByRole("button", { name: "Save limits" })).toBeDisabled();
    const one = within(form).getByRole("textbox", { name: "One document (bytes)" });
    expect(one).toHaveAccessibleDescription("The largest a single role, level or execution profile may be.");
    fireEvent.change(one, { target: { value: "131072" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Snapshots kept" }), { target: { value: "30" } });
    await userEvent.click(within(form).getByRole("button", { name: "Save limits" }));
    expect(await within(form).findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ method: "PUT", path: "/api/settings/profiles/limits", search: "", body: { limits: { documents: { ...LIMITS.documents, max_document_bytes: 131_072 }, snapshots_kept: 30, operations_kept: 200, refusals_kept: 1000 }, expected_revision: "0", operation_id: expect.any(String) } }]);
    expect(one).toHaveValue("131072");
    // The editor's byte count follows the saved limit.
    const editor = await edit("Fixture developer");
    expect(await within(editor).findByText(/\/ 131,072 bytes$/)).toBeVisible();
  });
  test("an entry that is not a whole number is not sent, and Discard returns to the saved limits", async () => {
    const form = await openLimits("execution", "Execution profiles");
    const name = within(form).getByRole("textbox", { name: "A name (bytes)" });
    fireEvent.change(name, { target: { value: "12.5" } });
    expect(name).toBeInvalid();
    await userEvent.click(within(form).getByRole("button", { name: "Save limits" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Enter every limit as a whole number.");
    expect(sent).toEqual([]);
    await userEvent.click(within(form).getByRole("button", { name: "Discard changes" }));
    expect(name).toHaveValue("128");
  });
  test("a refusal is shown in AQ's words, and limits changed elsewhere are reloaded without losing the entries", async () => {
    const form = await openLimits("intelligence", "Levels");
    const kept = within(form).getByRole("textbox", { name: "Documents of one kind" });
    server.use(http.put("/api/settings/profiles/limits", () => HttpResponse.json({ error: "bad_request", message: "2 roles exist; the limit of documents of one kind cannot be 1", problems: [] }, { status: 400 })));
    fireEvent.change(kept, { target: { value: "1" } });
    await userEvent.click(within(form).getByRole("button", { name: "Save limits" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("2 roles exist; the limit of documents of one kind cannot be 1");
    expect(kept).toHaveValue("1");
    server.use(http.put("/api/settings/profiles/limits", () => HttpResponse.json({ error: "conflict", message: "changed" }, { status: 409 })));
    await userEvent.click(within(form).getByRole("button", { name: "Save limits" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("The limits changed since you opened them. Your entries are kept.");
    expect(kept).toHaveValue("1");
  });
});

test("the page Save saves open documents, and the three document tabs keep their drafts while another tab is shown", async () => {
  await openTab("roles", "Roles");
  const editor = await edit("Fixture reviewer");
  const changed = `${markdown(editor).value}- Extra.\n`;
  type(editor, changed);
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeEnabled();
  await userEvent.click(screen.getByRole("tab", { name: "Execution" }));
  expect(await screen.findByRole("table", { name: "Execution profiles" })).toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Roles" }));
  expect(markdown(screen.getByRole("region", { name: "Edit Fixture reviewer" }))).toHaveValue(changed);
  await userEvent.click(save);
  expect(await screen.findByRole("status", { name: "Settings save status" })).toHaveTextContent("Saved.");
  expect(sent).toEqual([{ method: "PUT", path: "/api/settings/roles/reviewer", search: "", body: { markdown: changed, expected_revision: "1", operation_id: expect.any(String) } }]);
  expect(save).toBeDisabled();
});
