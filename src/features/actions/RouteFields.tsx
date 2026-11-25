import { useId } from "react";
import { compareLevelIds, levelLabel, useDocuments } from "../../api/roleSettings";
import { routeHarnessLabel, routeProviderLabel } from "../work/taskRouting";
import styles from "./RecordActions.module.css";

export type RouteChoice = { class: string; preferredHarnesses: string[]; preferredProviders: string[] };
export const NO_ROUTE: RouteChoice = { class: "", preferredHarnesses: [], preferredProviders: [] };

function PreferenceField({ label, choices, selected, format, onChange }: {
  label: string;
  choices: string[];
  selected: string[];
  format(value: string): string;
  onChange(value: string[]): void;
}) {
  const description = useId();
  const first = selected[0] ?? "";
  const values = [...new Set([...choices, ...selected])];
  if (values.length === 0) return null;
  return <div>
    <label>{label}
      <select value={first} aria-describedby={selected.length > 1 ? description : undefined}
        onChange={event => onChange(event.target.value ? [event.target.value] : [])}>
        <option value="">No preference</option>
        {values.map(value => <option key={value} value={value}>{format(value)}</option>)}
      </select>
    </label>
    {selected.length > 1 && <p id={description} className={styles.meta}>Then {selected.slice(1).map(format).join(", ")}</p>}
  </div>;
}

export function RouteFields({ value, canPrefer, onChange }: {
  value: RouteChoice;
  canPrefer: boolean;
  onChange(next: RouteChoice): void;
}) {
  const levels = useDocuments("intelligence");
  if (!levels.data) return levels.isError ? <p role="alert">The intelligence levels could not be read. Try again later.</p> : <p className={styles.meta} role="status">Reading the intelligence levels…</p>;
  const classes = levels.data.documents.flatMap(level => level.fields ? [{ id: level.id, profile: level.fields }] : [])
    .sort((a, b) => compareLevelIds(a.id, b.id));
  if (!classes.length) return <p role="note">No intelligence level is saved yet. Add one in Settings first.</p>;
  const chosen = classes.find(level => level.id === value.class)?.profile;
  return <>
    <label>Level<select required value={value.class} onChange={event => onChange({ ...NO_ROUTE, class: event.target.value })}>
      <option value="">Choose a level</option>
      {classes.map(level => <option key={level.id} value={level.id}>{levelLabel(level.id)}</option>)}
    </select></label>
    {chosen && canPrefer && <>
      <PreferenceField label="Preferred harness" choices={chosen.candidates.flatMap(candidate => candidate.harnesses)}
        selected={value.preferredHarnesses} format={routeHarnessLabel} onChange={preferredHarnesses => onChange({ ...value, preferredHarnesses })} />
      <PreferenceField label="Preferred provider" choices={chosen.candidates.map(candidate => candidate.provider)}
        selected={value.preferredProviders} format={routeProviderLabel} onChange={preferredProviders => onChange({ ...value, preferredProviders })} />
      <p className={styles.meta}>AQ may use another eligible candidate when a preference can’t be met.</p>
    </>}
  </>;
}
