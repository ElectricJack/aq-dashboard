import { useEffect, useId, useRef } from "react";
import { useModelSuggestions, type Candidate, type ModelSuggestion } from "../../api/roleSettings";
import { ActionButton } from "../../components/layout/Workspace";
import { HARNESS_PROVIDER, HARNESSES, isToken, readCandidates, reasoningChoices, writeCandidates } from "./profileMarkdown";
import styles from "./ProfileDocuments.module.css";

/**
 * The `## Candidates` table of a level as rows to add, remove, reorder and edit. It reads the rows from the Markdown and
 * writes the table back into it on every change, so the Markdown stays the one source.
 *
 * The model field offers the models AQ's host tool discovered for the row's harness (`/api/settings/model-suggestions`).
 * They are suggestions only: any model may be typed, and the editor works the same when none can be read.
 */
export function CandidatesEditor({ markdown, disabled, onChange }: { markdown: string; disabled: boolean; onChange(markdown: string): void }) {
  const root = useRef<HTMLFieldSetElement>(null);
  const listId = useId();
  const suggestions = useModelSuggestions().data ?? {};
  /** The suggestions of every harness a row names, each model once. */
  const suggested = (harnesses: string[]) => harnesses.flatMap(harness => suggestions[harness] ?? []).filter((item, i, all) => all.findIndex(other => other.model === item.model) === i);
  const anySuggested = Object.values(suggestions).some(models => models.length > 0);
  /** The control to focus once the rewritten table has rendered, so a moved row keeps the keyboard. */
  const focus = useRef<string[] | null>(null);
  useEffect(() => {
    const wanted = focus.current; focus.current = null;
    for (const name of wanted ?? []) {
      const control = root.current?.querySelector<HTMLButtonElement | HTMLInputElement>(`[data-focus="${name}"]`);
      if (control && !control.disabled) { control.focus(); break; }
    }
  });
  const read = readCandidates(markdown);
  if (!read) return <p className={styles.note} role="note">The candidates table cannot be read from the Markdown, so it is edited as text below. The table editor returns once “## Candidates” holds a table with the columns provider, model, reasoning and harnesses.</p>;
  const rows: Candidate[] = read;
  const write = (next: Candidate[], then?: string[]) => { focus.current = then ?? null; onChange(writeCandidates(markdown, next)); };
  const change = (index: number, patch: Partial<Candidate>) => write(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  function move(index: number, by: -1 | 1) {
    const next = [...rows], to = index + by;
    [next[index], next[to]] = [next[to]!, next[index]!];
    write(next, by < 0 ? [`up-${to}`, `down-${to}`] : [`down-${to}`, `up-${to}`]);
  }
  function setHarness(index: number, harness: string) {
    const row = rows[index]!, harnesses = harness.split(",").map(item => item.trim()).filter(Boolean);
    change(index, { harnesses, provider: HARNESS_PROVIDER[harness] ?? row.provider, reasoning: reasoningChoices(harnesses).includes(row.reasoning) ? row.reasoning : "default" });
  }
  /** A typed or chosen model. Where the harness does not fix the provider, a model that is suggested for one provider only brings that provider. */
  function setModel(index: number, model: string, offered: ModelSuggestion[]) {
    const row = rows[index]!, providers = [...new Set(offered.filter(item => item.model === model).map(item => item.provider))];
    const fixed = row.harnesses.some(harness => HARNESS_PROVIDER[harness]);
    change(index, { model, ...(!fixed && providers.length === 1 && isToken(providers[0]!) ? { provider: providers[0]! } : {}) });
  }
  const invalid = rows.some(row => !isToken(row.provider) || !isToken(row.model));
  return <fieldset ref={root} className={styles.candidates}>
    <legend>Candidates</legend>
    <p className={styles.note}>AQ tries the candidates from the top. Type the model’s name as the harness expects it. {anySuggested ? "The model field suggests the models AQ found for the row’s harness; any other model may be typed." : "AQ has no model suggestions to offer here now."}</p>
    {rows.length === 0 ? <p className={styles.meta}>No candidates yet. A level needs at least one.</p> : <div className={styles.tableWrap} role="region" aria-label="Candidates, scroll horizontally" tabIndex={0}>
      <table className={styles.table} aria-label="Candidates">
        <thead><tr><th scope="col">Order</th><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Reasoning</th><th scope="col">Harness</th><th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const n = index + 1, harness = row.harnesses.join(", "), choices = reasoningChoices(row.harnesses), offered = suggested(row.harnesses);
          return <tr key={index} aria-label={`Candidate ${n}`}>
            <td>{n}</td>
            <td><input aria-label={`Provider of candidate ${n}`} value={row.provider} disabled={disabled} aria-invalid={!isToken(row.provider)} spellCheck={false} autoCapitalize="none" onChange={event => change(index, { provider: event.target.value })} /></td>
            <td><input aria-label={`Model of candidate ${n}`} data-focus={`model-${index}`} value={row.model} disabled={disabled} aria-invalid={!isToken(row.model)} spellCheck={false} autoCapitalize="none" autoComplete="off" list={offered.length ? `${listId}-models-${index}` : undefined} onChange={event => setModel(index, event.target.value, offered)} />
              {offered.length > 0 && <datalist id={`${listId}-models-${index}`} data-testid={`model-suggestions-${n}`}>{offered.map(item => <option key={item.model} value={item.model} label={item.source ? `${item.provider} · ${item.source}` : item.provider} />)}</datalist>}</td>
            <td><select aria-label={`Reasoning of candidate ${n}`} value={row.reasoning} disabled={disabled} onChange={event => change(index, { reasoning: event.target.value })}>
              {!choices.includes(row.reasoning) && <option value={row.reasoning}>{row.reasoning || "Not set"} (not accepted by {harness || "this harness"})</option>}
              {choices.map(value => <option key={value} value={value}>{value}</option>)}
            </select></td>
            <td><select aria-label={`Harness of candidate ${n}`} value={harness} disabled={disabled} onChange={event => setHarness(index, event.target.value)}>
              {!(HARNESSES as readonly string[]).includes(harness) && <option value={harness}>{harness || "Not set"}</option>}
              {HARNESSES.map(value => <option key={value} value={value}>{value}</option>)}
            </select></td>
            <td><div className={styles.rowActions}>
              <ActionButton data-focus={`up-${index}`} aria-label={`Move candidate ${n} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>Up</ActionButton>
              <ActionButton data-focus={`down-${index}`} aria-label={`Move candidate ${n} down`} disabled={disabled || index === rows.length - 1} onClick={() => move(index, 1)}>Down</ActionButton>
              <ActionButton aria-label={`Remove candidate ${n}`} disabled={disabled} onClick={() => write(rows.filter((_, i) => i !== index), ["add"])}>Remove</ActionButton>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {invalid && <p className={styles.warning} role="status">Every candidate needs a provider and a model, written with letters, digits and . _ @ / : + - and no spaces.</p>}
    <div className={styles.actions}><ActionButton data-focus="add" disabled={disabled} onClick={() => write([...rows, { provider: "anthropic", model: "", reasoning: "default", harnesses: ["claude"] }], [`model-${rows.length}`])}>Add candidate</ActionButton></div>
  </fieldset>;
}
