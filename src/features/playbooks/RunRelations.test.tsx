import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { adaptRunDetail, type Run } from "../../api/adapters/playbooks";
import { runDetail } from "../../test/playbooks";
import { ChildWorkflows, WaitingOn, shortRunId, waitKind } from "./RunRelations";

const detail = adaptRunDetail(runDetail(), null, "run-0000000000000001");
const parent: Run = { ...detail.run, pendingKind: "decision", reason: "Paused for review.", children: ["run-0000000000000002", "run-0000000000000003"] };
const child: Run = { ...detail.run, id: "run-0000000000000002", entry: "validate-inputs", status: "completed", outcome: "ok", parent: parent.id, children: [] };

test("wait kinds have typed labels and unknown kinds keep their words", () => {
  expect(waitKind("decision").label).toBe("Human decision");
  expect(waitKind("child_workflow").label).toBe("Child workflow");
  expect(waitKind("effect").label).toBe("Operation");
  expect(waitKind("external_signal").label).toBe("External signal");
  expect(shortRunId("run-0000000000000285")).toBe("run-285");
  expect(shortRunId("custom-run")).toBe("custom-run");
});

test("waiting on shows the typed kind, reason and pending operations without an invented decision link", () => {
  render(<MemoryRouter><WaitingOn run={parent} effects={detail.effects} /></MemoryRouter>);
  const panel = screen.getByRole("region", { name: "Waiting on" });
  expect(within(panel).getByText("Human decision")).toBeInTheDocument();
  expect(within(panel).getByText("Paused for review.")).toBeInTheDocument();
  expect(within(within(panel).getByRole("list", { name: "Pending operations" })).getByText("decision.request")).toBeInTheDocument();
  expect(within(panel).queryByRole("link")).toBeNull();
});

test("child rows join loaded runs and fall back to an id-only row", () => {
  render(<MemoryRouter><ChildWorkflows run={parent} loaded={[parent, child]} search="" /></MemoryRouter>);
  const rows = within(screen.getByRole("region", { name: "Child workflows" })).getAllByRole("listitem");
  // Entries use the same human label as the run roster; the raw entry id stays in the title (ISSUE-012).
  expect(within(rows[0]!).getByText("Validate inputs")).toHaveAttribute("title", "validate-inputs");
  expect(rows[0]).toHaveTextContent("Owned child · outcome ok");
  expect(within(rows[0]!).getByText("Completed")).toBeInTheDocument();
  expect(within(rows[0]!).getByRole("link", { name: "run-2" })).toHaveAttribute("href", "/playbooks/runs/run-0000000000000002");
  expect(rows[1]).toHaveTextContent("run-3 · status not loaded");
  expect(within(rows[1]!).queryByText("Completed")).toBeNull();
});
