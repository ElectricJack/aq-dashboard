import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { apiGet } from "../../api/client";
import { adaptLoadedDefinitions, LOADED_DEFINITIONS_CAPABILITY } from "../../api/adapters/loadedDefinitions";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { useMediaQuery } from "../../components/useMediaQuery";
import { DefinitionWorkspace } from "./DefinitionWorkspace";
import { PlaybookScopeUnavailable, playbookScopeUnavailable } from "./PlaybookScope";
import { humanize } from "./RunTimeline";
import { shortDigest } from "./identity";
import { Age, useObservedNow } from "./Age";
import styles from "./Playbooks.module.css";

export function LoadedDefinitions() {
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope(); const [params, setParams] = useSearchParams();
  const compact = useMediaQuery("(max-width: 1199px)");
  const capability = bootstrap.capability(LOADED_DEFINITIONS_CAPABILITY);
  const project = scope.kind === "project" ? scope.project_id : null, selected = params.get("definition");
  const query = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-loaded-definitions", {}), enabled: capability.enabled, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptLoadedDefinitions(await apiGet<unknown>(`/api/playbooks/inspection/loaded-definitions${project ? `?project_id=${encodeURIComponent(project)}` : ""}`, signal), project) });
  const heading = useRef<HTMLHeadingElement>(null), previous = useRef<string | null>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const now = useObservedNow(query.data?.observedAt, query.dataUpdatedAt);
  const item = query.data?.items.find(row => row.artifact === selected);
  useEffect(() => {
    if (item) heading.current?.focus();
    else if (!selected && previous.current) buttons.current.get(previous.current)?.focus();
    previous.current = selected;
  }, [selected, item]);
  function select(artifact: string | null) { setParams(old => { const next = new URLSearchParams(old); if (artifact) next.set("definition", artifact); else next.delete("definition"); return next; }); }
  const preview = !compact && !selected ? query.data?.items[0] : undefined;
  const displayed = item ?? preview;
  const listParams = new URLSearchParams(params);
  listParams.delete("definition");
  const back = selected && <Link className={styles.mobileBack} to={{ pathname: "/playbooks", search: listParams.toString() }}>All playbooks</Link>;
  if (!capability.enabled) return <Panel title="Playbook library">{back}<p role="status">{capability.reason}</p></Panel>;
  if (playbookScopeUnavailable(project, query.error)) return <PlaybookScopeUnavailable title="Playbook library" />;
  if (!query.data || query.isError) return <Panel title="Playbook library">{back}<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="loaded playbook definitions" onRetry={() => void query.refetch()} /></Panel>;
  return <div className={`${styles.workspace} ${styles.libraryWorkspace}`} data-focused={Boolean(selected)}>
    {back}
    <Panel title="Playbooks loaded at startup" description={query.data.namespace.name} className={styles.roster}>
      <ul className={styles.runs} aria-label="Loaded playbook definitions">{query.data.items.map(row => <li key={row.artifact}>
        <button ref={element => { if (element) buttons.current.set(row.artifact, element); else buttons.current.delete(row.artifact); }} className={styles.definitionLink}
          data-selected={row.artifact === displayed?.artifact} aria-pressed={row.artifact === displayed?.artifact} onClick={() => select(row.artifact)}>
          <strong>{humanize(row.name)}</strong><span>{row.entries.length} {row.entries.length === 1 ? "entry point" : "entry points"} · <small className={styles.pin} title={row.artifact}>{shortDigest(row.artifact)}</small></span>
        </button></li>)}</ul>
      <div className={styles.catalogFooter}>
        <p className={styles.meta}>Captured <Age at={query.data.capturedAt} now={now} /></p>
        <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</ActionButton>
      </div>
    </Panel>
    {displayed ? <DefinitionWorkspace item={displayed} namespace={query.data.namespace} heading={heading} />
      : selected && <Panel title="Definition not loaded"><p>This version is missing from the startup configuration.</p></Panel>}
  </div>;
}
