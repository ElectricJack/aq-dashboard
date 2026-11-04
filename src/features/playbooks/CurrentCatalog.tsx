import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { playbookCatalogJson } from "../../api/playbookCatalogClient";
import { artifactDigest } from "../../api/adapters/loadedDefinitions";
import { adaptCatalog, CATALOG_CAPABILITY, mergeCatalogPages, sameCatalog, type CatalogActivation, type CatalogDefinition, type CatalogKind, type CatalogStamp, type CatalogRequest } from "../../api/adapters/playbookCatalog";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { Age, useObservedNow } from "./Age";
import styles from "./Playbooks.module.css";

class ExactCatalogConflict extends ApiError {
  constructor(readonly stamp: CatalogStamp) { super("http", "Catalog changed during exact read", { status: 409 }); }
}

export function CurrentCatalog({ kind }: { kind: CatalogKind }) {
  const queryClient = useQueryClient();
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope(); const [params, setParams] = useSearchParams();
  const capability = bootstrap.capability(CATALOG_CAPABILITY), project = scope.kind === "project" ? scope.project_id : null;
  const parameter = kind === "definitions" ? "definition" : "activation", selected = params.get(parameter), validSelection = selected === null || artifactDigest(selected);
  const [epoch, setEpoch] = useState(0);
  const pages = useInfiniteQuery({ queryKey: scopedKey(queryContext, scope, "playbook-current-catalog", { kind, epoch }), initialPageParam: null as CatalogRequest | null, enabled: capability.enabled, retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ pageParam, signal }) => adaptCatalog(await playbookCatalogJson(kind, project, pageParam ?? {}, signal), kind, project, pageParam ?? {}),
    getNextPageParam: (last, all): CatalogRequest | undefined => all.length < 4 && last.next ? { after: last.next, stamp: last } : undefined });
  let rows: ReturnType<typeof mergeCatalogPages> = [], invalid: unknown = null;
  try { if (pages.data) rows = mergeCatalogPages(pages.data.pages); } catch (error) { invalid = error; }
  const stamp = pages.data?.pages[0], detailRequest = { exact: selected, stamp }, refused = useRef<ExactCatalogConflict | null>(null);
  const detail = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-current-catalog-detail", { kind, selected, epoch, namespace: stamp?.namespace.id, generation: stamp?.namespace.generation, incarnation: stamp?.incarnation, metadataRevision: stamp?.metadataRevision }), enabled: capability.enabled && Boolean(selected && validSelection && stamp && !pages.isError && !invalid), retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try { return adaptCatalog(await playbookCatalogJson(kind, project, detailRequest, signal), kind, project, detailRequest); }
      catch (error) { if (error instanceof ApiError && error.status === 409 && stamp) { const failure = new ExactCatalogConflict(stamp); if (!signal.aborted) refused.current = failure; throw failure; } throw error; }
    } });
  useLayoutEffect(() => {
    if (!capability.enabled) {
      // A disabled observer retains data. Clear this feature's source context
      // while hidden, before a later capability gain can paint it as current.
      refused.current = null;
      const predicate = (query: { queryKey: readonly unknown[] }) => query.queryKey.includes("playbook-current-catalog") || query.queryKey.includes("playbook-current-catalog-detail");
      void queryClient.cancelQueries({ predicate }); queryClient.removeQueries({ predicate }); setEpoch(value => value + 1);
    }
  }, [capability.enabled, queryClient]);
  const now = useObservedNow(stamp?.observedAt, pages.dataUpdatedAt);
  const knownConflict = stamp && refused.current && sameCatalog(stamp, refused.current.stamp) ? refused.current : null;
  function refresh() { refused.current = null; setEpoch(value => value + 1); }
  const row = detail.data?.items[0], heading = useRef<HTMLHeadingElement>(null), previous = useRef<string | null>(null), buttons = useRef(new Map<string, HTMLButtonElement>()), rosterSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (row && !detail.isError) heading.current?.focus(); else if (!selected && previous.current) (buttons.current.get(previous.current) ?? rosterSummary.current)?.focus(); previous.current = selected; }, [selected, row, detail.isError]);
  function select(key: string | null) { setParams(old => { const next = new URLSearchParams(old); if (key) next.set(parameter, key); else next.delete(parameter); return next; }); }
  const title = kind === "definitions" ? "Definitions" : "Activations", singular = kind === "definitions" ? "definition" : "activation";
  if (!capability.enabled) return <Panel title={title}><p role="status">{capability.reason}</p></Panel>;
  if (!pages.data || pages.isError || invalid || knownConflict) return <Panel title={title}>
    {selected && <ActionButton className={styles.mobileBack} onClick={() => { select(null); refresh(); }}>All {kind}</ActionButton>}
    <QueryStatus status={pages.isError || invalid || knownConflict ? "error" : "pending"} error={invalid ?? knownConflict ?? pages.error} label={`current playbook ${kind}`} onRetry={refresh} />
  </Panel>;
  return <div className={styles.workspace} data-focused={Boolean(selected)}>
    {selected && <ActionButton className={styles.mobileBack} onClick={() => select(null)}>All {kind}</ActionButton>}
    <Panel title={title} description={stamp?.namespace.name} className={styles.roster}>
      <p ref={rosterSummary} tabIndex={-1} className={styles.meta}>Current namespace metadata · observed <Age at={stamp!.observedAt} now={now} /></p>
      {rows.length === 0 && <p>No {kind} represented in this namespace.</p>}
      <ul className={styles.runs} aria-label={`Current playbook ${kind}`}>{rows.map(item => <li key={item.key}>
        <button ref={element => { if (element) buttons.current.set(item.key, element); else buttons.current.delete(item.key); }} className={styles.definitionLink} data-selected={item.key === selected} onClick={() => select(item.key)}>
          <strong>{item.kind === "definition" ? item.name : item.binding}</strong><span>{item.kind === "definition" ? `${item.entries.length} ${item.entries.length === 1 ? "entry" : "entries"}` : `Binding revision ${item.revision}`}</span><small>{item.artifact}</small>
        </button></li>)}</ul>
      {pages.hasNextPage && <ActionButton disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>Load more {kind}</ActionButton>}
      {pages.data.pages.length === 4 && pages.data.pages.at(-1)!.next && <p className={styles.meta}>Showing {rows.length} {kind} in four bounded pages. More may be available.</p>}
      <ActionButton disabled={pages.isFetching || detail.isFetching} onClick={refresh}>Refresh {kind}</ActionButton>
    </Panel>
    {!selected ? <Panel title={`Select ${kind === "definitions" ? "a definition" : "an activation"}`}><p>{kind === "definitions" ? "Inspect current namespace artifacts, immutable pins, purpose and entry points." : "Inspect current bindings and their stored calls, events and execution controls."}</p></Panel>
      : !validSelection ? <Panel title={`Invalid ${singular} selection`}><p>Choose an item from this namespace.</p></Panel>
      : detail.error instanceof ExactCatalogConflict ? <Panel title="Selection changed"><p>The catalog changed while this selection loaded. Choose an item from the current list.</p><ActionButton onClick={refresh}>Refresh selection</ActionButton></Panel>
      : !detail.data || detail.isError ? <Panel title={`${title} inspection`}><QueryStatus status={detail.isError ? "error" : "pending"} error={detail.error} label={`this current ${singular}`} onRetry={refresh} /></Panel>
      : !row ? <Panel title={`${singular === "definition" ? "Definition" : "Activation"} not represented`}><p>This item is not represented in the observed current namespace.</p></Panel>
      : row.kind === "definition" ? <DefinitionDetails item={row} heading={heading} /> : <ActivationDetails item={row} heading={heading} selectDefinition={() => setParams(old => { const next = new URLSearchParams(old); next.set("view", "definitions"); next.delete("activation"); next.set("definition", row.artifact); return next; })} />}
  </div>;
}
function DefinitionDetails({ item, heading }: { item: CatalogDefinition; heading: React.RefObject<HTMLHeadingElement | null> }) {
  return <section className={styles.inspector} aria-label={`Definition ${item.name}`}>
    <div className={styles.runHeading}><h2 className={styles.definitionHeading} ref={heading} tabIndex={-1}>{item.name}</h2><span className={styles.badge}>Namespace artifact</span></div>
    <Panel title="Purpose"><p className={styles.purpose}>{item.purpose || "No purpose text was supplied."}</p>{item.purposeTruncated && <p className={styles.meta}>Showing the first 4096 UTF-8 bytes of purpose text.</p>}</Panel>
    <Panel title="Immutable artifact"><DetailList className={styles.definitionFacts}><dt>Artifact</dt><dd className={styles.pin}>{item.artifact}</dd><dt>Executable fingerprint</dt><dd className={styles.pin}>{item.fingerprint}</dd><dt>Source digest</dt><dd className={styles.pin}>{item.sourceDigest}</dd><dt>Compiler</dt><dd>{item.compiler}</dd><dt>Scope</dt><dd>{item.scope}</dd></DetailList></Panel>
    <div className={styles.lower}><Panel title="Entry points"><ul className={`${styles.children} ${styles.entryPoints}`}>{item.entries.map(entry => <li key={entry}>{entry}</li>)}</ul></Panel>
      <Panel title="Declared dependencies"><DetailList className={styles.definitionFacts}>{Object.entries(item.dependencies).map(([name, dependency]) => <div className={styles.dependency} key={name}><dt>{name}</dt><dd><span className={styles.pin}>{dependency.artifact}</span><p className={styles.meta}>Binding {dependency.binding} · {dependency.selection === "exact" ? "Exact artifact" : "Catalog-compatible selection"}</p></dd></div>)}</DetailList>{Object.keys(item.dependencies).length === 0 ? <p>No declared dependencies.</p> : <p className={styles.meta}>These references do not relabel dependencies pinned by an existing run.</p>}</Panel></div>
    <p className={styles.meta}>Run artifacts and dependencies remain pinned when admitted.</p>
  </section>;
}
function ActivationDetails({ item, heading, selectDefinition }: { item: CatalogActivation; heading: React.RefObject<HTMLHeadingElement | null>; selectDefinition(): void }) {
  return <section className={styles.inspector} aria-label={`Activation ${item.binding}`}>
    <div className={styles.runHeading}><h2 className={styles.definitionHeading} ref={heading} tabIndex={-1}>{item.binding}</h2><span className={styles.badge}>Current binding</span></div>
    <Panel title="Bound definition"><DetailList className={styles.definitionFacts}><dt>Artifact</dt><dd className={styles.pin}>{item.artifact}</dd><dt>Binding revision</dt><dd>{item.revision}</dd></DetailList><ActionButton onClick={selectDefinition}>Inspect bound definition</ActionButton></Panel>
    <Panel title="Stored controls"><DetailList className={styles.definitionFacts}><dt>New calls</dt><dd>{item.controls.calls ? "Enabled" : "Disabled"}</dd><dt>Event starts</dt><dd>{item.controls.events ? "Enabled" : "Disabled"}</dd><dt>Execution</dt><dd>{item.controls.execution ? "Enabled" : "Disabled"}</dd><dt>Artifact execution denied</dt><dd>{item.executionDenied ? "Yes" : "No"}</dd></DetailList><p className={styles.meta}>These controls do not establish current grant validity or readiness.</p></Panel>
  </section>;
}
