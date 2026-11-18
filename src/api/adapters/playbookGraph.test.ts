import { adaptDefinitionGraph } from "./playbookGraph";
import { PLAYBOOK_NAMESPACE } from "../../test/playbooks";

const namespace = { ...PLAYBOOK_NAMESPACE, projectId: PLAYBOOK_NAMESPACE.project_id };
const artifact = `sha256:${"a".repeat(64)}`;
const raw = {
  api_version: "playbooks-definition-graph-1",
  artifact,
  namespace: PLAYBOOK_NAMESPACE,
  graph: {
    entries: { main: "read" },
    steps: {
      read: {
        id: "read", kind: "invoke", target: "work.read", edges: [{ label: "observed", to: "next" }], on_error: "next",
      },
      next: { id: "next", kind: "return", target: null, edges: [], on_error: null },
    },
  },
};

test("step metadata cannot replace a compiled graph transition", () => {
  const { graph } = adaptDefinitionGraph({
    ...raw,
    step_inspection: {
      read: {
        summary: "Reads the task details.",
        branches: [
          { label: "observed", to: "next", error: false, reason: "Task details are available." },
          { label: "observed", to: "next", error: true, reason: "Wrong error marker." },
          { label: "observed", to: "missing", error: false, reason: "Unknown destination." },
          { label: "On error", to: "next", error: true, reason: "The step could not proceed." },
        ],
      },
    },
  }, artifact, namespace);
  expect(graph?.steps.get("read")?.transitions).toEqual([
    { label: "observed", to: "next", error: false, reason: "Task details are available." },
    { label: "On error", to: "next", error: true, reason: "The step could not proceed." },
  ]);
  expect(graph?.steps.get("read")?.inspection?.summary).toBe("Reads the task details.");
});

test("step data links need known, distinct endpoints and field paths", () => {
  const use = { producer: "read", consumer: "next", paths: ["task.facts.route"], purpose: "Checks the saved route." };
  const { graph } = adaptDefinitionGraph({
    ...raw,
    step_inspection: {
      read: { uses: [use, { ...use, consumer: "missing" }, { ...use, paths: [" "] }, { ...use, consumer: "read" }] },
      next: { uses: [use] },
    },
  }, artifact, namespace);
  expect(graph?.steps.get("read")?.inspection?.uses).toEqual([use]);
  expect(graph?.steps.get("next")?.inspection?.uses).toEqual([use]);
});

test.each([undefined, false, { read: 7 }, { read: { summary: "x".repeat(24_577) } }])(
  "the workflow is still available without usable inspection metadata (%#)",
  metadata => {
    const { graph } = adaptDefinitionGraph({ ...raw, step_inspection: metadata }, artifact, namespace);
    expect(graph?.entries.get("main")).toBe("read");
    expect(graph?.steps.get("read")?.transitions).toHaveLength(2);
  },
);
