import { useEffect, useId, useRef } from "react";
import { useModelSuggestions, type Candidate, type ModelSuggestions } from "../../api/roleSettings";
import { ActionButton } from "../../components/layout/Workspace";
import { completeCandidate, harnessPatch, modelPatch, moveCandidate, newCandidate, updateCandidate } from "./candidateEditing";
import { HARNESSES, isToken, readCandidates, reasoningChoices, writeCandidates } from "./profileMarkdown";
import styles from "./ProfileDocuments.module.css";

/**
 * The `## Candidates` table of a level as rows to add, remove, reorder and edit. It reads the rows from the Markdown and
 * writes the table back into it on every change, so the Markdown stays the one source.
 *
 * The model field offers the models AQ's host tool discovered for the row's harness (`/api/settings/model-suggestions`).
 * They are suggestions only: any model may be typed, and the editor works the same when none can be read.
 */
export function CandidatesEditor({ markdown, disabled, onChange }: { markdown: string; disabled: boolean; onChange(markdown: string): void }) {
  const { root, focus } = useCandidateFocus();
  const listId = useId();
  const suggestions = useModelSuggestions().data ?? {};
  const anySuggested = Object.values(suggestions).some(models => models.length > 0);
  const read = readCandidates(markdown);
  if (!read) return <p className={styles.note} role="note">The candidates table cannot be read from the Markdown, so it is edited as text below. The table editor returns once “## Candidates” holds a table with the columns provider, model, reasoning and harnesses.</p>;
  const rows: Candidate[] = read;
  const write = (next: Candidate[], then?: string[]) => { focus.current = then ?? null; onChange(writeCandidates(markdown, next)); };
  const change = (index: number, patch: Partial<Candidate>) => write(updateCandidate(rows, index, patch));
  function move(index: number, by: -1 | 1) {
    const to = index + by;
    const next = moveCandidate(rows, index, to);
    write(next, by < 0 ? [`up-${to}`, `down-${to}`] : [`down-${to}`, `up-${to}`]);
  }
  const invalid = !rows.every(completeCandidate);
  return <fieldset ref={root} className={styles.candidates}>
    <legend>Candidates</legend>
    <p className={styles.note}>AQ tries the candidates from the top. Type the model’s name as the harness expects it. {anySuggested ? "The model field suggests the models AQ found for the row’s harness; any other model may be typed." : "AQ has no model suggestions to offer here now."}</p>
    {rows.length === 0 ? <p className={styles.meta}>No candidates yet. A level needs at least one.</p> : <div className={styles.tableWrap} role="region" aria-label="Candidates, scroll horizontally" tabIndex={0}>
      <table className={styles.table} aria-label="Candidates">
        <thead><tr><th scope="col">Order</th><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Reasoning</th><th scope="col">Harness</th><th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map((row, index) => <CandidateRow key={index} row={row} index={index} last={index === rows.length - 1} listId={listId}
          suggestions={suggestions} disabled={disabled} change={patch => change(index, patch)} move={by => move(index, by)}
          remove={() => write(rows.filter((_, i) => i !== index), ["add"])} />)}</tbody>
      </table>
    </div>}
    {invalid && <p className={styles.warning} role="status">Every candidate needs a provider and a model, written with letters, digits and . _ @ / : + - and no spaces.</p>}
    <div className={styles.actions}><ActionButton data-focus="add" disabled={disabled} onClick={() => write([...rows, newCandidate()], [`model-${rows.length}`])}>Add candidate</ActionButton></div>
  </fieldset>;
}

function useCandidateFocus() {
  const root = useRef<HTMLFieldSetElement>(null);
  /** The control to focus once the rewritten table has rendered, so a moved row keeps the keyboard. */
  const focus = useRef<string[] | null>(null);
  useEffect(() => {
    const wanted = focus.current; focus.current = null;
    for (const name of wanted ?? []) {
      const control = root.current?.querySelector<HTMLButtonElement | HTMLInputElement>(`[data-focus="${name}"]`);
      if (control && !control.disabled) { control.focus(); break; }
    }
  });
  return { root, focus };
}

function suggestedModels(suggestions: ModelSuggestions, harnesses: string[]) {
  return harnesses.flatMap(harness => suggestions[harness] ?? [])
    .filter((item, i, all) => all.findIndex(other => other.model === item.model) === i);
}
function CandidateRow({ row, index, last, listId, suggestions, disabled, change, move, remove }: {
  row: Candidate; index: number; last: boolean; listId: string; suggestions: ModelSuggestions; disabled: boolean;
  change(patch: Partial<Candidate>): void; move(by: -1 | 1): void; remove(): void;
}) {
  const n = index + 1, harness = row.harnesses.join(", "), offered = suggestedModels(suggestions, row.harnesses);
  return <tr aria-label={`Candidate ${n}`}>
    <td>{n}</td>
    <td><input aria-label={`Provider of candidate ${n}`} value={row.provider} disabled={disabled} aria-invalid={!isToken(row.provider)} spellCheck={false} autoCapitalize="none" onChange={event => change({ provider: event.target.value })} /></td>
    <td><input aria-label={`Model of candidate ${n}`} data-focus={`model-${index}`} value={row.model} disabled={disabled} aria-invalid={!isToken(row.model)} spellCheck={false} autoCapitalize="none" autoComplete="off" list={offered.length ? `${listId}-models-${index}` : undefined} onChange={event => change(modelPatch(row, event.target.value, offered))} />
      {offered.length > 0 && <datalist id={`${listId}-models-${index}`} data-testid={`model-suggestions-${n}`}>{offered.map(item => <option key={item.model} value={item.model} label={item.source ? `${item.provider} · ${item.source}` : item.provider} />)}</datalist>}</td>
    <td><ReasoningSelect row={row} disabled={disabled} n={n} harness={harness} onChange={reasoning => change({ reasoning })} /></td>
    <td><select aria-label={`Harness of candidate ${n}`} value={harness} disabled={disabled} onChange={event => change(harnessPatch(row, event.target.value))}>
      {!(HARNESSES as readonly string[]).includes(harness) && <option value={harness}>{harness || "Not set"}</option>}
      {HARNESSES.map(value => <option key={value} value={value}>{value}</option>)}
    </select></td>
    <td><div className={styles.rowActions}>
      <ActionButton data-focus={`up-${index}`} aria-label={`Move candidate ${n} up`} disabled={disabled || index === 0} onClick={() => move(-1)}>Up</ActionButton>
      <ActionButton data-focus={`down-${index}`} aria-label={`Move candidate ${n} down`} disabled={disabled || last} onClick={() => move(1)}>Down</ActionButton>
      <ActionButton aria-label={`Remove candidate ${n}`} disabled={disabled} onClick={remove}>Remove</ActionButton>
    </div></td>
  </tr>;
}

function ReasoningSelect({ row, disabled, n, harness, onChange }: { row: Candidate; disabled: boolean; n: number; harness: string; onChange(value: string): void }) {
  const choices = reasoningChoices(row.harnesses);
  return <select aria-label={`Reasoning of candidate ${n}`} value={row.reasoning} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {!choices.includes(row.reasoning) && <option value={row.reasoning}>{row.reasoning || "Not set"} (not accepted by {harness || "this harness"})</option>}
      {choices.map(value => <option key={value} value={value}>{value}</option>)}
    </select>;
}
