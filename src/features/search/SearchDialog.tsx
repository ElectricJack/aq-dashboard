import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { adaptSearch, type SearchView } from "../../api/adapters/inspection";
import type { SearchResults } from "../../api/wire/proposed";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { scopeSearch, useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { subjectPath } from "../../app/subjects";
import { useRead } from "../../app/useRead";
import styles from "./SearchDialog.module.css";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

const GROUP_LABEL: Record<string, string> = {
  task: "Tasks",
  session: "Sessions",
  result: "Results",
  playbook: "Playbooks",
  knowledge: "Knowledge",
};

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Results({ q, onChoose }: { q: string; onChoose(): void }) {
  const [scope] = useScope();
  const search = scopeSearch(scope);
  const query = useRead<SearchResults, SearchView>({
    resource: "search",
    path: "/api/v1/search",
    scope,
    params: { q },
    adapt: adaptSearch,
  });
  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="search results"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { view, coverage } = query.data;
  const complete = coverage.state === "complete";
  if (view.groups.length === 0) {
    return complete ? (
      <p className={styles.muted} role="status">
        No matches for “{q}”
      </p>
    ) : (
      <p className={styles.warning} role="status">
        No matches in the projects that responded; results may be incomplete.
      </p>
    );
  }
  const count = view.groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <div className={styles.results}>
      <p className="visually-hidden" role="status">
        {count} result{count === 1 ? "" : "s"}
      </p>
      {!complete && <p className={styles.warning}>Some projects didn't respond; results may be incomplete.</p>}
      {view.groups.map((g) => {
        const label = GROUP_LABEL[g.type] ?? "Other results";
        return (
          <section key={g.type} className={styles.group}>
            <h3 id={`search-group-${g.type}`}>{label}</h3>
            <ul aria-labelledby={`search-group-${g.type}`}>
              {g.hits.map((h) => {
                const path = subjectPath(h.ref);
                const body = (
                  <>
                    <span className={styles.hitTitle}>{h.title}</span>
                    <span className={styles.muted}>
                      {h.project?.label}
                      {h.project && h.excerpt && " · "}
                      {h.excerpt}
                    </span>
                  </>
                );
                return (
                  <li key={`${h.ref.type}:${h.ref.id}`}>
                    {path ? (
                      <Link to={{ pathname: path, search }} className={styles.hit} onClick={onChoose} data-search-result>
                        {body}
                      </Link>
                    ) : (
                      <span className={styles.hit}>{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {g.hasMore && <p className={styles.muted}>More {label.toLowerCase()} match. Refine your search.</p>}
          </section>
        );
      })}
    </div>
  );
}

/** One search surface for the button, Ctrl/⌘+K and touch (docs/specs/0002 §3). */
export function SearchDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), DEBOUNCE_MS);
  const { bootstrap } = useSession();
  const capability = bootstrap.capability("dashboard.inspect");

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    input.current?.focus();
    const closed = () => onClose();
    el.addEventListener("close", closed);
    return () => el.removeEventListener("close", closed);
  }, [onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [
      input.current,
      ...(dialog.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []),
    ].filter((x): x is HTMLInputElement | HTMLAnchorElement => !!x);
    const index = items.indexOf(document.activeElement as HTMLInputElement | HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    items[next]?.focus();
    e.preventDefault();
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="search-title" onKeyDown={onKeyDown}>
      <div className={styles.header}>
        <h2 id="search-title" className="visually-hidden">
          Search
        </h2>
        <input
          ref={input}
          type="search"
          aria-label="Search"
          placeholder="Search tasks and sessions…"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>
          Close search
        </button>
      </div>
      <div className={styles.body}>
        {!capability.enabled ? (
          <p className={styles.muted}>{capability.reason}</p>
        ) : q.length < MIN_CHARS ? (
          <p className={styles.muted}>Type at least {MIN_CHARS} characters to search.</p>
        ) : (
          <Results q={q} onChoose={() => dialog.current?.close()} />
        )}
      </div>
    </dialog>
  );
}
