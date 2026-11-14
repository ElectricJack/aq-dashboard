import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "../../api/client";
import type { ActivePlaybook, LatestRun, PlaybookCase, SourceView } from "../../api/playbookSources";
import { PlaybookSourceStatus } from "./PlaybookSourceStatus";

vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
let asked: URLSearchParams | undefined;
const server = setupServer(http.get("/api/internal-work/runs", ({ request }) => { asked = new URL(request.url).searchParams; return HttpResponse.json({ runs: [], next_cursor: null }); }));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.resetHandlers(); asked = undefined; });
afterAll(() => server.close());

const kase = (situation: string, result: string, passed = true): PlaybookCase => ({ name: "steps.classify", situation, result, passed });
const cases = [kase("a bug fix that failed once", "class: complex\neffort: high"), kase("a documentation fix", "class: simple\neffort: low")];
const active = (extra: Partial<ActivePlaybook> = {}): ActivePlaybook => ({ artifact: `sha256:${"a".repeat(64)}`, since_ms: Date.UTC(2026, 10, 12, 9, 0, 0), comparison: { change: "behaviour" }, cases, ...extra });
const run = (status: LatestRun["status"], extra: Partial<LatestRun> = {}): LatestRun => ({ run: "r1", status, question: null, unable: [], refusal: null, internal_task_id: null, created_at_ms: Date.now() - 125_000, finished_at_ms: null, ...extra });
const source = (extra: Partial<SourceView> = {}): SourceView => ({ id: "routing", kind: "builtin", binding: "aq.routing", active: null, latest: null, ...extra });
function open(view: SourceView, onRollback: () => Promise<unknown> = async () => {}, showQuestion?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlaybookSourceStatus source={view} onRollback={onRollback} {...(showQuestion === undefined ? {} : { showQuestion })} /></QueryClientProvider>);
}

describe("shows each state in plain words", () => {
  test("no playbook yet", () => {
    open(source());
    expect(screen.getByText("There is no playbook yet. Save the document and an agent will write one from it.")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("authoring in progress shows the elapsed time and the run, and says the newest save wins", async () => {
    open(source({ latest: run("running") }));
    expect(screen.getByText("Writing the playbook…")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/Running for 2 min \d+ s\./);
    expect(screen.getByRole("status")).toHaveTextContent("the newest save wins");
    await vi.waitFor(() => expect(asked?.get("affected_kind")).toBe("playbook_source"));
    expect(asked?.get("affected_id")).toBe("routing");
  });

  test("authoring in progress with a playbook in effect keeps it working meanwhile", () => {
    open(source({ active: active(), latest: run("running") }));
    expect(screen.getByRole("status")).toHaveTextContent("The current playbook keeps working meanwhile.");
    expect(screen.getByRole("heading", { name: "What the playbook does" })).toBeVisible();
  });

  test("needs an answer: the question and each sentence with its line number", () => {
    const question = { question: "Which of these wins for research?", sentences: [{ line: 3, text: "Research is Standard." }, { line: 9, text: "Research is always Complex." }] };
    open(source({ active: active(), latest: run("question", { question }) }));
    const region = screen.getByRole("region", { name: "The playbook needs an answer" });
    expect(region).toHaveTextContent("Which of these wins for research?");
    const items = within(screen.getByRole("list", { name: "Sentences in question" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Line 3Research is Standard.");
    expect(items[1]).toHaveTextContent("Line 9Research is always Complex.");
    expect(screen.getByText("The previous playbook is still in effect.")).toBeVisible();
  });

  test("the caller can show the question itself", () => {
    open(source({ latest: run("question", { question: { question: "Which?", sentences: [{ line: 1, text: "A." }] } }) }), undefined, false);
    expect(screen.queryByRole("region", { name: "The playbook needs an answer" })).toBeNull();
    expect(screen.queryByText("Which?")).toBeNull();
    expect(screen.getByText("No playbook is in effect yet.")).toBeVisible();
  });

  test("could not be authored: the sentence and the reason", () => {
    open(source({ latest: run("unable", { unable: [{ sentence: "Art goes to the plotter.", line: 12, reason: "There is no plotter among the abilities." }] }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("This sentence cannot be carried out");
    const item = within(screen.getByRole("list", { name: "Sentences that cannot be carried out" })).getByRole("listitem");
    expect(item).toHaveTextContent("Line 12Art goes to the plotter.");
    expect(item).toHaveTextContent("There is no plotter among the abilities.");
    expect(screen.getByText("No playbook is in effect yet.")).toBeVisible();
  });

  test("refused: the reason, and the previous playbook still in effect", () => {
    open(source({ active: active(), latest: run("refused", { refusal: "The document asks for something routing may not do." }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("The document asks for something routing may not do.");
    expect(screen.getByText("The previous playbook is still in effect.")).toBeVisible();
  });

  test("superseded: a newer save replaced the run and it never took effect", () => {
    open(source({ active: active(), latest: run("superseded") }));
    expect(screen.getByRole("status")).toHaveTextContent("A newer save replaced this run. It did not take effect.");
  });

  test("an ended run without a playbook, and a state the page does not know", () => {
    const { unmount } = open(source({ latest: run("failed") }));
    expect(screen.getByRole("alert")).toHaveTextContent("The run ended without a playbook");
    unmount();
    open(source({ latest: run("unknown") }));
    expect(screen.getByRole("status")).toHaveTextContent("a state this page does not recognise");
  });

  test("active: when it took effect, the change and the cases", () => {
    open(source({ active: active(), latest: run("saved", { finished_at_ms: 5 }) }));
    const section = screen.getByRole("region", { name: "What the playbook does" });
    expect(section).toHaveTextContent("In effect since");
    expect(section).toHaveTextContent("Behaviour changed.");
    expect(section).toHaveTextContent("2 of 2 passed");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test.each([
    ["none", "No change"], ["wording", "Wording only"], ["behaviour", "Behaviour changed"], ["abilities", "Abilities changed"],
  ] as const)("the diff against the previous playbook: %s", (change, label) => {
    open(source({ active: active({ comparison: { change } }) }));
    expect(screen.getByText(`${label}.`)).toBeVisible();
  });
});

describe("the cases table renders situation and result", () => {
  test("situation on the left, result on the right, with a pass mark", () => {
    open(source({ active: active() }));
    const table = screen.getByRole("table", { name: "What the playbook does in each situation" });
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Situation", "Result", "Check"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const cells = within(rows[0]!).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("a bug fix that failed once");
    expect(cells[1]).toHaveTextContent("class: complex effort: high");
    expect(cells[2]).toHaveTextContent("Passed");
  });

  test("a case that did not pass is marked in words and comes first", () => {
    open(source({ active: active({ cases: [kase("fine", "class: simple"), kase("a failure", "class: deep", false)] }) }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("a failure");
    expect(rows[0]).toHaveTextContent("Did not pass");
    expect(screen.getByText(/1 of 2 passed/)).toBeVisible();
  });

  test("many cases are grouped by result, each result named once", () => {
    const many = Array.from({ length: 40 }, (_, i) => kase(`situation ${i}`, i % 2 ? "class: complex" : "class: simple", i !== 7));
    open(source({ active: active({ cases: many }) }));
    expect(screen.queryByRole("table")).toBeNull();
    const groups = within(screen.getByRole("group", { name: "What the playbook does in each situation" })).getAllByRole("region");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent("class: complex (20 situations)");
    expect(within(groups[0]!).getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText(/39 of 40 passed/)).toBeVisible();
    expect(screen.getByText("Did not pass")).toBeVisible();
  });
});

describe("rollback", () => {
  test("rollback calls the API and refreshes", async () => {
    const onRollback = vi.fn(async () => {});
    open(source({ active: active() }), onRollback);
    await userEvent.click(screen.getByRole("button", { name: "Roll back to the previous playbook" }));
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Roll back to the previous playbook" })).toBeEnabled();
  });

  test("it is disabled while the rollback is in progress and says why when it fails", async () => {
    let fail!: (error: unknown) => void;
    const onRollback = vi.fn(() => new Promise<void>((_, reject) => { fail = reject; }));
    open(source({ active: active() }), onRollback);
    await userEvent.click(screen.getByRole("button", { name: "Roll back to the previous playbook" }));
    expect(screen.getByRole("button", { name: "Roll back to the previous playbook" })).toBeDisabled();
    fail(new ApiError("http", "x", { status: 409, serverMessage: "There is no previous playbook to roll back to." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no previous playbook to roll back to.");
    expect(screen.getByRole("button", { name: "Roll back to the previous playbook" })).toBeEnabled();
  });

  test("a failed rollback without a server message says it in plain words", async () => {
    open(source({ active: active() }), async () => { throw new Error("network"); });
    await userEvent.click(screen.getByRole("button", { name: "Roll back to the previous playbook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The previous playbook could not be put back.");
  });

  test("it is not offered when there is no previous playbook", () => {
    open(source({ active: active({ comparison: null }) }));
    expect(screen.queryByRole("button", { name: /Roll back/ })).toBeNull();
    expect(screen.getByText("There is no earlier playbook to compare it with.")).toBeVisible();
  });
});

test("never shows a step id or a sha256 to the owner", () => {
  const view = source({ active: active({ artifact: `sha256:${"b".repeat(64)}`, cases: [{ name: "steps.classify.assess", situation: "a bug fix", result: "class: complex", passed: true }] }),
    latest: run("saved", { run: "run-0001", internal_task_id: "00000000-0000-4000-8000-000000000001", finished_at_ms: 5 }) });
  const { container } = open(view);
  const shown = container.textContent ?? "";
  expect(shown).not.toMatch(/sha256:/);
  expect(shown).not.toMatch(/steps\./);
  expect(shown).not.toMatch(/run-0001|00000000-0000/);
  expect(shown).not.toMatch(/aq\.routing|[{}]/);
});

test("everything from a run is shown as text, never as markup or a link", () => {
  const html = '<img src=x onerror="alert(1)"> <a href="https://example.test">go</a> **bold** [link](https://example.test)';
  const view = source({ active: active({ cases: [kase(html, html, false)] }), latest: run("unable", { refusal: html, unable: [{ sentence: html, reason: html, line: 1 }] }) });
  const { container } = open(view);
  expect(screen.getAllByText(html, { exact: false }).length).toBeGreaterThanOrEqual(3);
  expect(container.querySelector("img, a, strong > strong")).toBeNull();
  expect(container.querySelectorAll("a")).toHaveLength(0);
});

test("a question is shown as text too", () => {
  const html = "<b>Which</b> one? https://example.test";
  const { container } = open(source({ latest: run("question", { question: { question: html, sentences: [{ line: 2, text: html }] } }) }));
  expect(container.querySelector("b, a")).toBeNull();
  expect(container).toHaveTextContent(html);
});
