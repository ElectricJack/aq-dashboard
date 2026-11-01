import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { apiGet } from "../../api/client";
import { adaptLoadedDefinitions, LOADED_DEFINITIONS_CAPABILITY } from "../../api/adapters/loadedDefinitions";
import { timestamp } from "../../api/adapters/playbooks";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import styles from "./Playbooks.module.css";

export function LoadedDefinitions() {
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope(); const [params, setParams] = useSearchParams();
  const capability = bootstrap.capability(LOADED_DEFINITIONS_CAPABILITY);
  const project = scope.kind === "project" ? scope.project_id : null, selected = params.get("definition");
  const query = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-loaded-definitions", {}), enabled: capability.enabled, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptLoadedDefinitions(await apiGet<unknown>(`/api/playbooks/inspection/loaded-definitions${project ? `?project_id=${encodeURIComponent(project)}` : ""}`, signal), project) });
  const heading = useRef<HTMLHeadingElement>(null), previous = useRef<string | null>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const item = query.data?.items.find(row => row.artifact === selected);
  useEffect(() => {
    if (item) heading.current?.focus();
    else if (!selected && previous.current) buttons.current.get(previous.current)?.focus();
    previous.current = selected;
  }, [selected, item]);
  function select(artifact: string | null) { setParams(old => { const next = new URLSearchParams(old); if (artifact) next.set("definition", artifact); else next.delete("definition"); return next; }); }
  if (!capability.enabled) return <Panel title="Loaded definitions"><p role="status">{capability.reason}</p></Panel>;
  if (!query.data || query.isError) return <Panel title="Loaded definitions"><QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="loaded playbook definitions" onRetry={() => void query.refetch()} /></Panel>;
  return <div className={styles.workspace} data-focused={Boolean(item)}>
    {item && <ActionButton className={styles.mobileBack} onClick={() => select(null)}>All definitions</ActionButton>}
    <Panel title="Loaded definitions" description={query.data.namespace.name} className={styles.roster}>
      <p className={styles.meta}>Runtime startup configuration · captured {timestamp(query.data.capturedAt)}</p>
      <ul className={styles.runs} aria-label="Loaded playbook definitions">{query.data.items.map(row => <li key={row.artifact}>
        <button ref={element => { if (element) buttons.current.set(row.artifact, element); else buttons.current.delete(row.artifact); }} className={styles.definitionLink} data-selected={row.artifact === selected} onClick={() => select(row.artifact)} aria-label={`Inspect definition ${row.name}`}>
          <strong>{row.name}</strong><span>{row.entries.length} {row.entries.length === 1 ? "entry" : "entries"}</span><small>{row.artifact}</small>
        </button></li>)}</ul>
      <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh definitions</ActionButton>
    </Panel>
    {item ? <section className={styles.inspector} aria-label={`Definition ${item.name}`}>
      <div className={styles.runHeading}><h2 className={styles.definitionHeading} ref={heading} tabIndex={-1}>{item.name}</h2><span className={styles.badge}>Loaded configuration</span></div>
      <Panel title="Purpose"><p className={styles.purpose}>{item.purpose || "No purpose text was supplied."}</p>{item.purposeTruncated && <p className={styles.meta}>Showing the first 4096 UTF-8 bytes of purpose text.</p>}</Panel>
      <Panel title="Immutable artifact"><DetailList className={styles.definitionFacts}>
        <dt>Artifact</dt><dd className={styles.pin}>{item.artifact}</dd><dt>Executable fingerprint</dt><dd className={styles.pin}>{item.fingerprint}</dd>
        <dt>Source digest</dt><dd className={styles.pin}>{item.sourceDigest}</dd><dt>Compiler</dt><dd>{item.compiler}</dd>
      </DetailList></Panel>
      <div className={styles.lower}>
        <Panel title="Entry points"><ul className={`${styles.children} ${styles.entryPoints}`}>{item.entries.map(entry => <li key={entry}>{entry}</li>)}</ul></Panel>
        <Panel title="Declared dependencies"><DetailList className={styles.definitionFacts}>{Object.entries(item.dependencies).map(([name, pin]) => <div className={styles.dependency} key={name}><dt>{name}</dt><dd className={styles.pin}>{pin}</dd></div>)}</DetailList>{Object.keys(item.dependencies).length === 0 ? <p>No dependency pins in this artifact.</p> : <p className={styles.meta}>Run dependencies are pinned when admitted.</p>}</Panel>
      </div>
      <p className={styles.meta}>This startup configuration does not report current installation or activation.</p>
    </section> : <Panel title={selected ? "Definition not loaded" : "Select a definition"}><p>{selected ? "This artifact is not in the loaded startup configuration." : "Inspect an artifact's immutable pins, purpose and entry points."}</p><p className={styles.meta}>Current installed catalog and activation discovery are not available in this view.</p></Panel>}
  </div>;
}
