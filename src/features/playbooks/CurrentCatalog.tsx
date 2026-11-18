import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { playbookCatalogJson } from "../../api/playbookCatalogClient";
import { artifactDigest } from "../../api/adapters/loadedDefinitions";
import { adaptCatalog, CATALOG_CAPABILITY, mergeCatalogPages, sameCatalog, type CatalogActivation, type CatalogKind, type CatalogStamp, type CatalogRequest } from "../../api/adapters/playbookCatalog";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { Digest, TechnicalIdentity, shortDigest } from "./identity";
import { Age, useObservedNow } from "./Age";
import { ActivationActions } from "./ActivationActions";
import { DefinitionWorkspace } from "./DefinitionWorkspace";
import { humanize } from "./RunTimeline";
import { useMediaQuery } from "../../components/useMediaQuery";
import styles from "./Playbooks.module.css";

class ExactCatalogConflict extends ApiError {
  constructor(readonly stamp: CatalogStamp) { super("http", "Catalog changed during exact read", { status: 409 }); }
}

export function CurrentCatalog({ kind }: { kind: CatalogKind }) {
  const queryClient = useQueryClient();
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope(); const [params, setParams] = useSearchParams();
  const capability = bootstrap.capability(CATALOG_CAPABILITY), project = scope.kind === "project" ? scope.project_id : null;
  const compact = useMediaQuery("(max-width: 1199px)");
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
  // The same back control as a run: a link to the unselected list, shown on phone detail pages.
  const listSearch = (() => { const next = new URLSearchParams(params); next.delete(parameter); return next.toString(); })();
  const back = (onClick?: () => void) => <Link className={styles.mobileBack} to={{ pathname: "/playbooks", search: listSearch }} onClick={onClick}>{kind === "definitions" ? "All playbooks" : "All deployments"}</Link>;
  const title = kind === "definitions" ? "Playbook library" : "Deployments", singular = kind === "definitions" ? "definition" : "activation";
  const first = !compact && !selected && rows[0]?.kind === "definition" ? rows[0] : null;
  if (!capability.enabled) return <Panel title={title}>{selected && back()}<p role="status">{capability.reason}</p></Panel>;
  if (!pages.data || pages.isError || invalid || knownConflict) return <Panel title={title}>
    {selected && back(refresh)}
    <QueryStatus status={pages.isError || invalid || knownConflict ? "error" : "pending"} error={invalid ?? knownConflict ?? pages.error} label={`current playbook ${kind}`} onRetry={refresh} />
  </Panel>;
  return <div className={kind === "definitions" ? `${styles.workspace} ${styles.libraryWorkspace}` : styles.workspace} data-focused={Boolean(selected)}>
    {selected && back()}
    <Panel title={title} description={kind === "definitions" ? stamp?.namespace.name : "See which versions are used for new runs and manage version changes."} className={styles.roster}>
      {rows.length === 0 && <p>{kind === "definitions" ? "No playbooks are installed here." : "No deployments are configured here."}</p>}
      <ul className={styles.runs} aria-label={`Current playbook ${kind}`}>{rows.map(item => <li key={item.key}>
        <button ref={element => { if (element) buttons.current.set(item.key, element); else buttons.current.delete(item.key); }} className={styles.definitionLink}
          data-selected={item.key === (selected ?? first?.key)} aria-pressed={item.key === (selected ?? first?.key)} onClick={() => select(item.key)}>
          <strong>{item.kind === "definition" ? humanize(item.name) : item.binding}</strong>
          <span>{item.kind === "definition" ? `${item.entries.length} ${item.entries.length === 1 ? "entry point" : "entry points"}` : `Binding revision ${item.revision}`} · <small className={styles.pin} title={item.artifact}>{shortDigest(item.artifact)}</small></span>
        </button></li>)}</ul>
      {pages.hasNextPage && <ActionButton disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>Load more {kind === "definitions" ? "playbooks" : "deployments"}</ActionButton>}
      {pages.data.pages.length === 4 && pages.data.pages.at(-1)!.next && <p className={styles.meta}>Showing {rows.length} of the available items.</p>}
      <div className={styles.catalogFooter}>
        <p ref={rosterSummary} tabIndex={-1} className={styles.meta}>Observed <Age at={stamp!.observedAt} now={now} /></p>
        <ActionButton disabled={pages.isFetching || detail.isFetching} onClick={refresh}>Refresh</ActionButton>
      </div>
    </Panel>
    {!selected ? first ? <DefinitionWorkspace item={first} namespace={stamp!.namespace} heading={heading} />
      : kind === "activations" && rows.length > 0 ? <Panel title="Select a deployment" className={styles.previewOnly}><p>Open a binding to see its active version, start controls, and rollback options.</p></Panel> : null
      : !validSelection ? <Panel title={`Invalid ${singular} selection`}><p>Choose an item from this namespace.</p></Panel>
      : detail.error instanceof ExactCatalogConflict ? <Panel title="Selection changed"><p>The catalog changed while this selection loaded. Choose an item from the current list.</p><ActionButton onClick={refresh}>Refresh selection</ActionButton></Panel>
      : !detail.data || detail.isError ? <Panel title={`${title} inspection`}><QueryStatus status={detail.isError ? "error" : "pending"} error={detail.error} label={`this current ${singular}`} onRetry={refresh} /></Panel>
      : !row ? <Panel title={`${singular === "definition" ? "Definition" : "Activation"} not represented`}><p>This item is not represented in the observed current namespace.</p></Panel>
      : row.kind === "definition" ? <DefinitionWorkspace item={row} namespace={stamp!.namespace} heading={heading} /> : <ActivationDetails item={row} project={stamp!.namespace.projectId} heading={heading} selectDefinition={() => setParams(old => { const next = new URLSearchParams(old); next.set("view", "library"); next.delete("activation"); next.set("definition", row.artifact); return next; })} />}
  </div>;
}
function ActivationDetails({ item, project, heading, selectDefinition }: { item: CatalogActivation; project: string; heading: React.RefObject<HTMLHeadingElement | null>; selectDefinition(): void }) {
  return <section className={styles.inspector} aria-label={`Activation ${item.binding}`}>
    <div className={styles.runHeading}><h2 className={styles.definitionHeading} ref={heading} tabIndex={-1}>{item.binding}</h2></div>
    <Panel title="Active version"><DetailList className={styles.definitionFacts}><dt>Artifact</dt><dd><Digest value={item.artifact} /></dd><dt>Binding revision</dt><dd>{item.revision}</dd></DetailList><ActionButton onClick={selectDefinition}>View workflow</ActionButton>
      <TechnicalIdentity><dt>Artifact</dt><dd className={styles.pin}>{item.artifact}</dd></TechnicalIdentity></Panel>
    <ActivationActions item={item} project={project} />
    <Panel title="Stored controls"><DetailList className={styles.definitionFacts}><dt>New calls</dt><dd>{item.controls.calls ? "Enabled" : "Disabled"}</dd><dt>Event starts</dt><dd>{item.controls.events ? "Enabled" : "Disabled"}</dd><dt>Execution</dt><dd>{item.controls.execution ? "Enabled" : "Disabled"}</dd><dt>Artifact execution denied</dt><dd>{item.executionDenied ? "Yes" : "No"}</dd></DetailList><p className={styles.meta}>These controls do not establish current grant validity or readiness.</p></Panel>
  </section>;
}
