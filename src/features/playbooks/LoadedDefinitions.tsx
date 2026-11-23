import { useEffect, useRef, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { apiGet } from "../../api/client";
import { adaptLoadedDefinitions, LOADED_DEFINITIONS_CAPABILITY, type LoadedDefinition } from "../../api/adapters/loadedDefinitions";
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

function useDefinitionFocus(selected: string | null, item: LoadedDefinition | undefined) {
  const heading = useRef<HTMLHeadingElement>(null), previous = useRef<string | null>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (item) heading.current?.focus();
    else if (!selected && previous.current) buttons.current.get(previous.current)?.focus();
    previous.current = selected;
  }, [selected, item]);
  return { heading, buttons };
}

function DefinitionList({ items, buttons, displayed, select }: {
  items: LoadedDefinition[]; buttons: RefObject<Map<string, HTMLButtonElement>>; displayed: string | undefined; select(artifact: string): void;
}) {
  return <ul className={styles.runs} aria-label="Loaded playbook definitions">{items.map(row => <li key={row.artifact}>
        <button ref={element => { if (element) buttons.current.set(row.artifact, element); else buttons.current.delete(row.artifact); }} className={styles.definitionLink}
          data-selected={row.artifact === displayed} aria-pressed={row.artifact === displayed} onClick={() => select(row.artifact)}>
          <strong>{humanize(row.name)}</strong><span>{row.entries.length} {row.entries.length === 1 ? "entry point" : "entry points"} · <small className={styles.pin} title={row.artifact}>{shortDigest(row.artifact)}</small></span>
        </button></li>)}</ul>;
}

function useLoadedLibrary() {
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope();
  const capability = bootstrap.capability(LOADED_DEFINITIONS_CAPABILITY);
  const project = scope.kind === "project" ? scope.project_id : null;
  const query = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-loaded-definitions", {}), enabled: capability.enabled, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptLoadedDefinitions(await apiGet<unknown>(`/api/playbooks/inspection/loaded-definitions${project ? `?project_id=${encodeURIComponent(project)}` : ""}`, signal), project) });
  return { query, capability, project };
}

function useLibrarySelection(items: LoadedDefinition[] | undefined) {
  const [params, setParams] = useSearchParams();
  const compact = useMediaQuery("(max-width: 1199px)");
  const selected = params.get("definition");
  const item = items?.find(row => row.artifact === selected);
  const { heading, buttons } = useDefinitionFocus(selected, item);
  function select(artifact: string | null) { setParams(old => { const next = new URLSearchParams(old); if (artifact) next.set("definition", artifact); else next.delete("definition"); return next; }); }
  const preview = !compact && !selected ? items?.[0] : undefined;
  const displayed = item ?? preview;
  const listParams = new URLSearchParams(params);
  listParams.delete("definition");
  const back = selected && <Link className={styles.mobileBack} to={{ pathname: "/playbooks", search: listParams.toString() }}>All playbooks</Link>;
  return { back, selected, select, buttons, heading, displayed };
}

function SelectedDefinition({ displayed, selected, namespace, heading }: {
  displayed: LoadedDefinition | undefined; selected: string | null;
  namespace: ReturnType<typeof adaptLoadedDefinitions>["namespace"]; heading: RefObject<HTMLHeadingElement | null>;
}) {
  return displayed ? <DefinitionWorkspace item={displayed} namespace={namespace} heading={heading} />
      : selected && <Panel title="Definition not loaded"><p>This version is missing from the startup configuration.</p></Panel>;
}

export function LoadedDefinitions() {
  const { query, capability, project } = useLoadedLibrary();
  const now = useObservedNow(query.data?.observedAt, query.dataUpdatedAt);
  const { back, selected, select, buttons, heading, displayed } = useLibrarySelection(query.data?.items);
  if (!capability.enabled) return <Panel title="Playbook library">{back}<p role="status">{capability.reason}</p></Panel>;
  if (playbookScopeUnavailable(project, query.error)) return <PlaybookScopeUnavailable title="Playbook library" />;
  if (!query.data || query.isError) return <Panel title="Playbook library">{back}<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="loaded playbook definitions" onRetry={() => void query.refetch()} /></Panel>;
  return <div className={`${styles.workspace} ${styles.libraryWorkspace}`} data-focused={Boolean(selected)}>
    {back}
    <Panel title="Playbooks loaded at startup" description={query.data.namespace.name} className={styles.roster}>
      <DefinitionList items={query.data.items} buttons={buttons} displayed={displayed?.artifact} select={select} />
      <div className={styles.catalogFooter}>
        <p className={styles.meta}>Captured <Age at={query.data.capturedAt} now={now} /></p>
        <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</ActionButton>
      </div>
    </Panel>
    <SelectedDefinition displayed={displayed} selected={selected} namespace={query.data.namespace} heading={heading} />
  </div>;
}
