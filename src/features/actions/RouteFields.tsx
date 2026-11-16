import { useDocuments } from "../../api/roleSettings";
import { classLabel } from "../work/inspector/TaskRoute";
import { ROUTE_CLASS } from "../work/taskWork";
import styles from "./RecordActions.module.css";

/** What the "Set route" dialog submits: a class, and optional harness and provider limits (an empty list limits nothing). */
export type RouteChoice = { class: string; harnesses: string[]; providers: string[] };
export const NO_ROUTE: RouteChoice = { class: "", harnesses: [], providers: [] };

/** The order a person expects: easier work first, then lower effort first. */
const PARENTS = ["simple", "standard", "complex", "deep"], EFFORTS = ["low", "medium", "high", "max"];
const rank = (id: string) => { const [parent = "", effort = ""] = id.split("-"); return PARENTS.indexOf(parent) * 10 + EFFORTS.indexOf(effort); };
const toggle = (values: string[], value: string, on: boolean) => on ? [...values, value] : values.filter(v => v !== value);

/**
 * The class select lists the intelligence levels saved in Settings → Intelligence whose id is a class a route can name
 * (value `standard-high`, shown as "Standard · High"). The harness and provider checkboxes offer what that level's candidates use.
 */
export function RouteFields({ value, onChange }: { value: RouteChoice; onChange: (next: RouteChoice) => void }) {
  const levels = useDocuments("intelligence");
  if (!levels.data) return levels.isError ? <p role="alert">The intelligence levels could not be read. Try again later.</p> : <p className={styles.meta} role="status">Reading the intelligence levels…</p>;
  // A level whose text AQ cannot read cannot take work, so it is not offered.
  const classes = levels.data.documents.flatMap(level => level.fields && ROUTE_CLASS.test(level.id) ? [{ value: level.id, profile: level.fields }] : []).sort((a, b) => rank(a.value) - rank(b.value));
  if (!classes.length) return <p role="note">No intelligence level a route can name is saved yet. Add one in Settings first.</p>;
  const chosen = classes.find(c => c.value === value.class)?.profile;
  const harnesses = [...new Set(chosen?.candidates.flatMap(c => c.harnesses))], providers = [...new Set(chosen?.candidates.map(c => c.provider))];
  const group = (legend: string, field: "harnesses" | "providers", options: string[]) => <fieldset className={styles.choices}>
    <legend>{legend} (optional)</legend>
    {options.map(option => <label key={option} className={styles.confirm}><input type="checkbox" checked={value[field].includes(option)} onChange={e => onChange({ ...value, [field]: toggle(value[field], option, e.target.checked) })} />{option}</label>)}
  </fieldset>;
  return <>
    <label>Class<select required value={value.class} onChange={e => onChange({ class: e.target.value, harnesses: [], providers: [] })}>
      <option value="">Choose a class</option>{classes.map(c => <option key={c.value} value={c.value}>{classLabel(c.value)}</option>)}
    </select></label>
    {chosen && <>{harnesses.length > 0 && group("Harnesses", "harnesses", harnesses)}{providers.length > 0 && group("Providers", "providers", providers)}
      <p className={styles.meta}>Leave a list empty to allow any.</p></>}
  </>;
}
