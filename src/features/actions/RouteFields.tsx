import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { readIntelligence, readIntelligenceStructure } from "../../api/intelligenceSettings";
import { INTELLIGENCE_EFFORTS, INTELLIGENCE_PARENTS } from "../../api/intelligenceStructure";
import { queryKey } from "../../api/queryKeys";
import { classLabel } from "../work/inspector/TaskRoute";
import styles from "./RecordActions.module.css";

/** What the "Set route" dialog submits: a class, and optional harness and provider limits (an empty list limits nothing). */
export type RouteChoice = { class: string; harnesses: string[]; providers: string[] };
export const NO_ROUTE: RouteChoice = { class: "", harnesses: [], providers: [] };

const toggle = (values: string[], value: string, on: boolean) => on ? [...values, value] : values.filter(v => v !== value);

/**
 * The class select lists only classes Settings → Intelligence assigns a profile to (value `standard-high`, shown as
 * "Standard · High"). The harness and provider checkboxes offer what that profile's candidates use.
 */
export function RouteFields({ value, onChange }: { value: RouteChoice; onChange: (next: RouteChoice) => void }) {
  const { queryContext } = useSession();
  const structure = useQuery({ queryKey: queryKey(queryContext, "intelligence-structure", {}), queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const catalog = useQuery({ queryKey: queryKey(queryContext, "intelligence-settings", {}), queryFn: ({ signal }) => readIntelligence(signal), retry: false });
  if (structure.isError || catalog.isError) return <p role="alert">The assigned intelligence classes could not be read. Try again later.</p>;
  if (!structure.data || !catalog.data) return <p className={styles.meta} role="status">Reading the intelligence classes…</p>;
  const profiles = new Map(catalog.data.profiles.map(p => [p.id, p]));
  const order = (a: { parent_id: string; effort: string }) => INTELLIGENCE_PARENTS.indexOf(a.parent_id as never) * 10 + INTELLIGENCE_EFFORTS.indexOf(a.effort as never);
  const classes = structure.data.assignments.filter(a => profiles.has(a.profile_id)).sort((a, b) => order(a) - order(b))
    .map(a => ({ value: `${a.parent_id}-${a.effort}`, profile: profiles.get(a.profile_id)! }));
  if (!classes.length) return <p role="note">No intelligence class has an assigned profile yet. Assign one in Settings first.</p>;
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
      <p className={styles.meta}>Leave a list empty to allow any. AQ refuses a class that has no assigned profile.</p></>}
  </>;
}
