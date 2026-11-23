import type { RefObject } from "react";
import type { SwarmCell, SwarmSettings as SettingsSnapshot } from "../../api/swarmSettings";
import { MAX_LIMIT, key } from "./swarmLimitMatrix";
import styles from "./SwarmSettings.module.css";

function overCapacity(running: number | null | undefined, limit: number | null | undefined) {
  if (running == null || limit == null) return false;
  return running > limit;
}

function CellActivity({ contextId, live }: { contextId: string; live: SettingsSnapshot["cells"][number] | undefined }) {
  const running = live?.running;
  const limit = live?.effective_limit;
  const waiting = live?.waiting;
  const overLimit = overCapacity(running, limit);
  return <span id={contextId} className={styles.context}>
              <span>{running == null ? "Active unknown" : `${running} active`} / {limit == null ? "limit not set" : `limit ${limit}`}</span>
              <span>{waiting == null ? "Waiting unknown" : `${waiting} waiting`}</span>
              {limit === 0 && <span>New starts paused</span>}
              {overLimit && <span>Existing agents finish</span>}
            </span>;
}

type Props = {
  profile: "normal" | "reduced"; base: SwarmCell[]; liveCells: SwarmCell[]; input: Record<string, string>;
  prefix: string; issues: Record<string, string>; editorLocked: boolean; firstReduced: RefObject<HTMLInputElement | null>;
  onChange(id: string, value: string): void;
};

export function SwarmLimitTable({ profile, base, liveCells, input, prefix, issues, editorLocked, firstReduced, onChange }: Props) {
  const providers = [...new Set(base.map(cell => cell.provider))];
  const classes = [...new Map(base.map(cell => [cell.intelligence_class, cell.display_name])).entries()];
  const label = profile === "normal" ? "Normal" : "Reduced usage";
  const hintId = `${prefix}-${profile}-scroll`;
  return <><p id={hintId} className={styles.scrollHint}>Scroll horizontally to see all intelligence classes.</p><div className={styles.tableWrap} role="region" aria-label={`${label} concurrency matrix`} aria-describedby={hintId} tabIndex={0}>
    <table className={styles.table} style={{ minInlineSize: `${Math.max(440, (classes.length + 1) * 170)}px` }}>
      <caption className={styles.srOnly}>{label} concurrency limits</caption>
      <thead><tr><th scope="col">Provider</th>{classes.map(([id, name]) => <th key={id} scope="col">{name}</th>)}</tr></thead>
      <tbody>{providers.map(provider => <tr key={provider}><th scope="row">{provider}</th>{classes.map(([intelligenceClass, name], index) => {
        const cell = base.find(c => c.provider === provider && c.intelligence_class === intelligenceClass);
        if (!cell) return <td key={intelligenceClass}><span className={styles.meta}>Unavailable</span></td>;
        const id = key(cell), contextId = `${prefix}-${profile}-${providers.indexOf(provider)}-${index}`;
        const live = liveCells.find(c => key(c) === id);
        const issue = issues[`${profile}${id}`];
        return <td key={intelligenceClass}>
          <input ref={profile === "reduced" && id === key(base[0]!) ? firstReduced : undefined} type="number" inputMode="numeric" min="0" step="1" max={MAX_LIMIT} required
            aria-label={`${label} ${provider} ${name} limit`} aria-describedby={`${contextId}${issue ? ` ${contextId}-error` : ""}`} aria-invalid={!!issue}
            value={input[id] ?? ""} placeholder="Not set" disabled={editorLocked}
            onChange={event => onChange(id, event.target.value)} />
          <CellActivity contextId={contextId} live={live} />
          {issue && <span id={`${contextId}-error`} className={styles.fieldError}>{issue}</span>}
        </td>;
      })}</tr>)}</tbody>
    </table>
  </div></>;
}
