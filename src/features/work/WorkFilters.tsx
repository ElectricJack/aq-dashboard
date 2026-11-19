import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { WORK_STATE_FILTERS, WORK_STATE_LABEL, type WorkStateFilter } from "./labels";
import styles from "./WorkWorkspace.module.css";

export function WorkFilters({ q, state, allProjects, gantt, onChange }: {
  q: string;
  state?: WorkStateFilter;
  allProjects?: boolean;
  gantt?: boolean;
  onChange(key: "q" | "state", value: string): void;
}) {
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  return <>
    <form role="search" className={styles.search} onSubmit={event => {
      event.preventDefault();
      onChange("q", draft.trim());
    }}>
      <label className="visually-hidden" htmlFor="find-task">Search tasks</label>
      <Search size={18} aria-hidden className={styles.searchIcon}/>
      <input id="find-task" type="search" enterKeyHint="search" maxLength={256} value={draft}
        placeholder={gantt ? "Find tasks in the tracks…" : allProjects ? "Find tasks across projects…" : "Find tasks in this project…"}
        onChange={event => {
          const value = event.target.value;
          setDraft(value);
          if (!value && q) onChange("q", "");
        }}/>
    </form>
    {!gantt && <div role="group" aria-label="Task state" className={styles.chips}>
      {WORK_STATE_FILTERS.map(option => <button key={option} type="button" className={styles.chip}
        data-state={option} aria-pressed={state === option}
        onClick={() => onChange("state", state === option ? "" : option)}>{WORK_STATE_LABEL[option]}</button>)}
    </div>}
  </>;
}
