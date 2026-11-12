import type { ReactNode } from "react";
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
  const assignedIds = new Set(assignments.map(assignment => assignment.profile_id));
  const other = profiles.filter(profile => !assignedIds.has(profile.id));
  return <>
    {(Object.keys(PARENT_NAMES) as ParentId[]).map(parent => <section className={styles.parent} key={parent} aria-label={`${PARENT_NAMES[parent]} intelligence`}>
      {renderParent(parent)}
      <details className={styles.variations}>
        <summary>{PARENT_NAMES[parent]} variations <span className={styles.meta}>Low · Medium · High · Max</span></summary>
        <p className={styles.scrollHint}>Scroll horizontally to see model, reasoning, max agents and Save.</p>
        <div className={styles.tableWrap} role="region" aria-label={`${PARENT_NAMES[parent]} variations, scroll horizontally`} tabIndex={0}>
          <table className={`${styles.table} ${styles.variationTable}`} aria-label={`${PARENT_NAMES[parent]} variations`}>
            <thead><tr><th scope="col">Variation</th><th scope="col">Model</th><th scope="col">Reasoning effort</th><th scope="col">Max agents</th><th scope="col">Actions</th></tr></thead>
            <tbody>{VARIATIONS.map(effort => {
              const assignment = assignments.find(item => item.parent_id === parent && item.effort === effort);
              const profile = assignment && profiles.find(item => item.id === assignment.profile_id);
              return profile ? renderRow(profile, variationName(effort)) : <tr key={effort} aria-label={`${PARENT_NAMES[parent]} ${variationName(effort)} not configured`}><td><strong>{variationName(effort)}</strong></td><td colSpan={4}>{renderMissing?.(parent, effort) ?? <span className={styles.meta}>Not configured</span>}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </details>
    </section>)}
    <section className={styles.otherProfiles} aria-labelledby="other-intelligence-profiles"><h3 id="other-intelligence-profiles">Other profiles</h3>
      <p className={styles.meta}>Existing profiles outside these four types keep their own settings and assignments.</p>
      {other.length > 0 ? otherTable(other) : <p className={styles.meta}>No other profiles.</p>}
    </section>
  </>;
}
