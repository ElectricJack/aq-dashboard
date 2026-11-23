import { compareLevelIds, useDocuments, type SettingsDocument } from "../../api/roleSettings";
import { classLabel } from "../work/inspector/TaskRoute";
import styles from "./RecordActions.module.css";

/** What the "Set route" dialog submits: a class, and optional harness and provider limits (an empty list limits nothing). */
export type RouteChoice = { class: string; harnesses: string[]; providers: string[] };
export const NO_ROUTE: RouteChoice = { class: "", harnesses: [], providers: [] };

const toggle = (values: string[], value: string, on: boolean) => on ? [...values, value] : values.filter(v => v !== value);

function availableClasses(documents: SettingsDocument<"intelligence">[]) {
  return documents.flatMap(level => level.fields ? [{ value: level.id, profile: level.fields }] : [])
    .sort((a, b) => compareLevelIds(a.value, b.value));
}

function LimitOptions({ legend, field, options, value, onChange }: {
  legend: string; field: "harnesses" | "providers"; options: string[]; value: RouteChoice; onChange: (next: RouteChoice) => void;
}) {
  if (!options.length) return null;
  return <fieldset className={styles.choices}>
    <legend>{legend} (optional)</legend>
    {options.map(option => <label key={option} className={styles.confirm}><input type="checkbox" checked={value[field].includes(option)} onChange={e => onChange({ ...value, [field]: toggle(value[field], option, e.target.checked) })} />{option}</label>)}
  </fieldset>;
}

/**
 * The class select lists every intelligence level saved in Settings → Intelligence by its id: a route's class is a level's id
 * (value `standard-high`, shown as "Standard · High"). The harness and provider checkboxes offer what that level's candidates use.
 */
export function RouteFields({ value, onChange }: { value: RouteChoice; onChange: (next: RouteChoice) => void }) {
  const levels = useDocuments("intelligence");
  if (!levels.data) return levels.isError ? <p role="alert">The intelligence levels could not be read. Try again later.</p> : <p className={styles.meta} role="status">Reading the intelligence levels…</p>;
  // A level whose text AQ cannot read cannot take work, so it is not offered.
  const classes = availableClasses(levels.data.documents);
  if (!classes.length) return <p role="note">No intelligence level is saved yet. Add one in Settings first.</p>;
  const chosen = classes.find(c => c.value === value.class)?.profile;
  const harnesses = [...new Set(chosen?.candidates.flatMap(c => c.harnesses))], providers = [...new Set(chosen?.candidates.map(c => c.provider))];
  return <>
    <label>Level<select required value={value.class} onChange={e => onChange({ class: e.target.value, harnesses: [], providers: [] })}>
      <option value="">Choose a level</option>{classes.map(c => <option key={c.value} value={c.value}>{classLabel(c.value)}</option>)}
    </select></label>
    {chosen && <><LimitOptions legend="Harnesses" field="harnesses" options={harnesses} value={value} onChange={onChange} /><LimitOptions legend="Providers" field="providers" options={providers} value={value} onChange={onChange} />
      <p className={styles.meta}>Leave a list empty to allow any.</p></>}
  </>;
}
