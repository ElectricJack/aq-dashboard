import { useState, type ReactNode } from "react";
import type { IntelligenceProfile } from "../../api/intelligenceSettings";
import styles from "./Intelligence.module.css";

export const PARENT_NAMES = { simple: "Simple", standard: "Standard", complex: "Complex", deep: "Deep" } as const;
export const VARIATIONS = ["low", "medium", "high", "max"] as const;
export type ParentId = keyof typeof PARENT_NAMES;
export type ProfileAssignment = { profile_id: string; parent_id: ParentId; effort: typeof VARIATIONS[number] };
export const variationName = (variation: string) => variation[0]!.toUpperCase() + variation.slice(1);

/** Only explicit persisted assignments determine grouping; names are never guessed. */
export function IntelligenceGroups({ profiles, assignments, renderParent, renderRow, renderMissing, otherTable }: {
  profiles: IntelligenceProfile[];
  assignments: ProfileAssignment[];
  renderParent(parent: ParentId): ReactNode;
  renderRow(profile: IntelligenceProfile, variation: string): ReactNode;
  renderMissing?(parent: ParentId, effort: typeof VARIATIONS[number]): ReactNode;
  otherTable(profiles: IntelligenceProfile[]): ReactNode;
}) {
  const [selectedSlot, setSelectedSlot] = useState("");
  const assignedIds = new Set(assignments.map(assignment => assignment.profile_id));
  const other = profiles.filter(profile => !assignedIds.has(profile.id));
  const slots = (Object.keys(PARENT_NAMES) as ParentId[]).flatMap(parent => VARIATIONS.map(effort => {
    const assignment = assignments.find(item => item.parent_id === parent && item.effort === effort);
    return { parent, effort, key: `${parent}:${effort}`, profile: assignment && profiles.find(item => item.id === assignment.profile_id) };
  }));
  const missing = slots.filter(slot => !slot.profile);
  const selected = missing.find(slot => slot.key === selectedSlot) ?? missing[0];
  return <>
    <section className={styles.descriptions} aria-labelledby="intelligence-type-descriptions">
      <h3 id="intelligence-type-descriptions">Type descriptions</h3>
      <div className={styles.descriptionRows}>{(Object.keys(PARENT_NAMES) as ParentId[]).map(parent =>
        <section key={parent} aria-label={`${PARENT_NAMES[parent]} intelligence`}>{renderParent(parent)}</section>)}
      </div>
    </section>
    <section className={styles.profileRows} aria-label="Intelligence variations">
      {selected && renderMissing && <div className={styles.addVariation}>
        <label>Add variation<select aria-label="Variation to add" value={selected.key} onChange={event => setSelectedSlot(event.target.value)}>
          {missing.map(slot => <option key={slot.key} value={slot.key}>{PARENT_NAMES[slot.parent]} · {variationName(slot.effort)}</option>)}
        </select></label>
        {renderMissing(selected.parent, selected.effort)}
      </div>}
      <p className={styles.scrollHint}>Scroll horizontally to see model, reasoning and max agents.</p>
      <div className={styles.tableWrap} role="region" aria-label="Intelligence variations, scroll horizontally" tabIndex={0}>
        <table className={`${styles.table} ${styles.variationTable}`} aria-label="Intelligence variations">
          <thead><tr><th scope="col">Profile</th><th scope="col">Model</th><th scope="col">Reasoning effort</th><th scope="col">Max agents</th><th scope="col">Actions</th></tr></thead>
          <tbody>{slots.flatMap(slot => slot.profile ? [renderRow(slot.profile, `${PARENT_NAMES[slot.parent]} · ${variationName(slot.effort)}`)] : [])}</tbody>
        </table>
      </div>
      {slots.every(slot => !slot.profile) && <p className={styles.meta}>No variations configured yet.</p>}
    </section>
    <section className={styles.otherProfiles} aria-labelledby="other-intelligence-profiles"><h3 id="other-intelligence-profiles">Other profiles</h3>
      {other.length > 0 ? otherTable(other) : <p className={styles.meta}>No other profiles.</p>}
    </section>
  </>;
}
