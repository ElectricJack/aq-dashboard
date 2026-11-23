import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { adaptGraphPage, nodeLabel, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { queryKey } from "../../api/queryKeys";
import { graphPath } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import styles from "./Results.module.css";

type TaskQuery = { project: string; query: string };
async function searchTasks({ project, query }: TaskQuery, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "8" });
  if (query) params.set("q", query);
  const raw = await apiGet<unknown>(graphPath(project, "task") + "?" + params, signal);
  return adaptGraphPage(raw, project, "task").data.items.filter(node => !node.deleted);
}

type PickerInput = { project: string; value: string; open: boolean };
function useTaskOptions({ project, value, open }: PickerInput) {
  const { queryContext } = useSession();
  const [query, setQuery] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  const pasted = validGraphId(value.trim());
  const search = useQuery({
    queryKey: queryKey(queryContext, "result-feedback-task-search", { project, q: query }),
    enabled: open && !pasted && validGraphId(project),
    retry: false, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => searchTasks({ project, query }, signal),
  });
  const options = open && !pasted ? search.data ?? [] : [];
  return { options, pasted, failed: search.isError, loading: search.isPending || search.isFetching };
}

function statusMessage(search: ReturnType<typeof useTaskOptions>, open: boolean, selected: GraphNode | null, value: string) {
  if (search.pasted) return selected?.id === value.trim() ? `Selected: ${selected.title}` : "Task ID will be linked as entered.";
  if (!open) return null;
  if (search.failed) return "Task search unavailable. Paste a task ID.";
  if (search.loading) return "Searching tasks…";
  const count = search.options.length;
  if (!count) return "No matching tasks. Paste a task ID.";
  return `${count} matching task${count === 1 ? "" : "s"}`;
}

function nextOption(current: number, length: number, step: number) {
  if (step < 0 && current <= 0) return length - 1;
  return (current + step) % length;
}

/** Searches the result's project or accepts a pasted task ID. */
export function FeedbackTaskPicker({ project, value, onChange }: { project: string; value: string; onChange(id: string): void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<GraphNode | null>(null);
  const search = useTaskOptions({ project, value, open });
  const { options } = search;
  const expanded = options.length > 0;
  const status = statusMessage(search, open, picked, value);

  function choose(node: GraphNode) {
    setPicked(node);
    onChange(node.id);
    close();
  }
  function close() {
    setOpen(false);
    setActive(-1);
  }
  function move(step: -1 | 1) {
    setOpen(true);
    if (options.length) setActive(current => nextOption(current, options.length, step));
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown": move(1); break;
      case "ArrowUp": move(-1); break;
      case "Enter": {
        const node = options[active];
        if (!node) return;
        choose(node);
        break;
      }
      case "Escape":
        if (!open) return;
        event.stopPropagation();
        close();
        break;
      default: return;
    }
    event.preventDefault();
  }
 return <div className={styles.taskPicker}>
  <label htmlFor={`${id}-input`}>Existing task ID</label>
  <input id={`${id}-input`} required role="combobox" autoComplete="off" spellCheck={false} aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`} aria-describedby={`${id}-hint ${id}-status`} aria-activedescendant={expanded&&active>=0?`${id}-opt-${active}`:undefined}
   value={value} placeholder="Search tasks or paste an ID" onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}
   onChange={e=>{onChange(e.target.value);setOpen(true);setActive(-1);}}
   onKeyDown={onKeyDown}/>
  <p id={`${id}-hint`} className={styles.meta}>Search by title or paste a task ID.</p>
  <ul id={`${id}-list`} role="listbox" aria-label="Matching tasks" className={styles.taskOptions} hidden={!expanded}>
   {options.map((node,i)=><li key={node.id} id={`${id}-opt-${i}`} role="option" aria-selected={i===active} className={styles.taskOption} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(node)}>
    <span>{node.title}</span><span className={styles.meta}>{node.id.slice(0,8)}… · {nodeLabel(node.task_state)}</span>
   </li>)}
  </ul>
  <p id={`${id}-status`} className={styles.meta} role="status">{status}</p>
 </div>;
}
