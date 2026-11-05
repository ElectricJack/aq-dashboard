import { useState } from "react";
import type { CatalogActivation, CatalogDefinition } from "../../api/adapters/playbookCatalog";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { PlaybookAction } from "./PlaybookAction";
import { parseInputs, playbookCapability, type InputRow, type InputType } from "./playbookActions";
import { useRefreshRuns } from "./RunActions";
import { useCatalogPage } from "./useCatalogPage";
import { shortDigest } from "./identity";
import styles from "./Playbooks.module.css";

const TYPES: [InputType, string][] = [["text", "Text"], ["number", "Number"], ["boolean", "True or false"]];

/** Starts a run on a current binding; inputs are typed rows, never a raw JSON editor. */
export function StartRun() {
  const { bootstrap } = useSession(); const refresh = useRefreshRuns();
  const offered = bootstrap.capability("dashboard.actions").enabled && bootstrap.capability(playbookCapability("playbook.run.start")).enabled;
  const activations = useCatalogPage("activations", offered), definitions = useCatalogPage("definitions", offered);
  const bindings = (activations.page?.items ?? []).filter((i): i is CatalogActivation => i.kind === "activation");
  const [binding, setBinding] = useState(""), [entry, setEntry] = useState(""), [rows, setRows] = useState<InputRow[]>([]);
  const chosen = bindings.find(b => b.binding === binding) ?? bindings[0];
  const definition = (definitions.page?.items ?? []).find((i): i is CatalogDefinition => i.kind === "definition" && i.artifact === chosen?.artifact);
  const entries = definition?.entries ?? [], entryValue = entries.length ? (entries.includes(entry) ? entry : entries[0]!) : entry;
  const blocked = activations.unavailable ?? (bindings.length === 0 ? "No activations are represented in this namespace" : undefined);
  const project = activations.page?.namespace.projectId ?? "";
  const update = (index: number, patch: Partial<InputRow>) => setRows(old => old.map((row, i) => i === index ? { ...row, ...patch, ...(patch.type ? { value: patch.type === "boolean" ? "true" : "" } : {}) } : row));
  return <PlaybookAction kind="playbook.run.start" project={project} subject={{ type: "playbook_binding", id: chosen?.binding ?? "", ...(chosen ? { revision: chosen.revision } : {}) }} blocked={offered ? blocked : undefined} className={styles.startRun} instance="start"
    intro={<p>Starts a new run pinned to the binding's current definition.</p>}
    fields={locked => <>
      <label>Binding<select value={chosen?.binding ?? ""} onChange={e => setBinding(e.target.value)}>{bindings.map(b => <option key={b.binding} value={b.binding}>{b.binding} · {shortDigest(b.artifact)} · revision {b.revision}</option>)}</select></label>
      {entries.length ? <label>Entry<select value={entryValue} onChange={e => setEntry(e.target.value)}>{entries.map(name => <option key={name}>{name}</option>)}</select></label>
        : <label>Entry<input value={entry} onChange={e => setEntry(e.target.value)} maxLength={200} /><span className={styles.meta}>The bound definition is not represented in the first catalog page; type its entry name.</span></label>}
      <fieldset className={styles.inputRows}><legend>Inputs</legend>
        {rows.length === 0 && <p className={styles.meta}>No inputs. Add one for each value the entry expects.</p>}
        {rows.map((row, i) => <div className={styles.inputRow} key={i}>
          <label>Input {i + 1} name<input value={row.name} onChange={e => update(i, { name: e.target.value })} maxLength={100} /></label>
          <label>Input {i + 1} type<select value={row.type} onChange={e => update(i, { type: e.target.value as InputType })}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {row.type === "boolean" ? <label>Input {i + 1} value<select value={row.value} onChange={e => update(i, { value: e.target.value })}><option value="true">True</option><option value="false">False</option></select></label>
            : <label>Input {i + 1} value<input inputMode={row.type === "number" ? "decimal" : undefined} value={row.value} onChange={e => update(i, { value: e.target.value })} maxLength={4000} /></label>}
          <ActionButton disabled={locked} onClick={() => setRows(old => old.filter((_, j) => j !== i))}>Remove input {i + 1}</ActionButton>
        </div>)}
        <ActionButton disabled={locked || rows.length >= 32} onClick={() => setRows(old => [...old, { name: "", type: "text", value: "" }])}>Add input</ActionButton>
      </fieldset>
    </>}
    build={() => {
      if (!chosen) throw new Error("Choose a binding.");
      if (!entryValue.trim()) throw new Error("Choose an entry.");
      return { payload: { binding: chosen.binding, artifact: chosen.artifact, entry: entryValue.trim(), inputs: parseInputs(rows) } };
    }}
    pendingText="Run start requested — awaiting confirmation." confirmedText="Run start confirmed"
    onConfirmed={refresh} onReload={() => activations.refetch()} onStart={() => { setRows([]); setEntry(""); }} />;
}
