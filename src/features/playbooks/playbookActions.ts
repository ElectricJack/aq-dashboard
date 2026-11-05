import type { FrozenAction } from "../actions/actionClient";

/**
 * Proposed `dashboard-actions-1` playbook kinds. aq-server main does not yet
 * register them (cross-repo request routed to D9), so live bootstraps leave
 * their capabilities absent and the controls render the server's reason.
 */
export const playbookLabels = {
  "playbook.run.start": "Start run",
  "playbook.run.cancel": "Cancel run",
  "playbook.activation.activate": "Activate definition",
  "playbook.activation.rollback": "Roll back activation",
} as const;
export type PlaybookKind = keyof typeof playbookLabels;
const CAPABILITIES: Record<PlaybookKind, string> = {
  "playbook.run.start": "playbooks.runs.start",
  "playbook.run.cancel": "playbooks.runs.cancel",
  "playbook.activation.activate": "playbooks.activations.activate",
  "playbook.activation.rollback": "playbooks.activations.rollback",
};
export const playbookCapability = (kind: PlaybookKind) => CAPABILITIES[kind];
export type PlaybookSubject = { type: "playbook_run" | "playbook_binding"; id: string; revision?: string };

export function freezePlaybookAction(kind: PlaybookKind, project: string, subject: PlaybookSubject, payload: Record<string, unknown>, reason?: string): FrozenAction {
  const id = crypto.randomUUID(), versioned = subject.revision !== undefined;
  const body = { operation_id: id, kind, subject, expected_versions: versioned ? { [subject.type]: subject.revision } : {}, ...(reason ? { reason } : {}),
    payload: { ...payload, operation_id: id, project_id: project, ...(versioned ? { expected_version: subject.revision } : {}) } };
  const bytes = JSON.stringify(body);
  if (new TextEncoder().encode(bytes).length > 65536) throw new Error("This request is too large. Shorten the inputs.");
  return Object.freeze({ id, bytes, kind, subject: Object.freeze({ ...subject }) });
}

export type InputType = "text" | "number" | "boolean";
export type InputRow = { name: string; type: InputType; value: string };
/** Typed start inputs: one named value per row, never a raw JSON document. */
export function parseInputs(rows: readonly InputRow[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) throw new Error("Name every input.");
    if (Object.hasOwn(out, name)) throw new Error(`Input ${name} is listed twice.`);
    if (row.type === "number") { const n = Number(row.value); if (!row.value.trim() || !Number.isFinite(n)) throw new Error(`Input ${name} must be a number.`); out[name] = n; }
    else if (row.type === "boolean") out[name] = row.value === "true";
    else out[name] = row.value;
  }
  return out;
}
