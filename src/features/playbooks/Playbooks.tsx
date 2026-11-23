import { usePlaybookPage, url, MAX_PAGES, RUN_STATES, RANGES, DEFAULT_STATE, DEFAULT_RANGE, type Page } from "./usePlaybookPage";
import { TABS } from "./usePlaybookNavigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { scopedKey } from "../../api/queryKeys";
import { ArrowLeft, ArrowRight, Calendar, ChevronRight, FileText, RefreshCw, Settings2 } from "lucide-react";
import { adaptRunDetail, statusLabel, timestamp, type Run, type Admission } from "../../api/adapters/playbooks";
import { useSession } from "../../app/session";
import { PageHeader } from "../../components/layout/PageHeader";
import { scopeSearch, useScope } from "../../app/scope";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { Panel, Toolbar, ActionButton, DetailList } from "../../components/layout/Workspace";
import { useProjects } from "../../app/useProjects";
import { CurrentCatalog } from "./CurrentCatalog";
import { LoadedDefinitions } from "./LoadedDefinitions";
import { PlaybookScopeUnavailable } from "./PlaybookScope";
import { ChildWorkflows, WaitingOn } from "./RunRelations";
import { Icon, runStatusIcon } from "../../components/icons";
import { Age, useObservedNow } from "./Age";
import { humanize, InspectorTabs, RecentEvidence, RunTimeline, type InspectorTab } from "./RunTimeline";
import { Digest, shortRunId, TechnicalIdentity } from "./identity";
import { CancelRun } from "./RunActions";
import { StartRun } from "./StartRun";
import { WorkflowGraph } from "./WorkflowGraph";
import { retryableReadFailure, retryUnlessMissing } from "./playbookReads";
import styles from "./Playbooks.module.css";

/** Shown while the shared read policy retries a failed playbook read (for example a busy inspection read). */
function Retrying({ query }: { query: { failureCount: number; isFetching: boolean } }) {
  return query.failureCount > 0 && query.isFetching ? <p className={styles.meta}>The last attempt failed. Retrying automatically…</p> : null;
}
function RunFilters({ page: { filter, range, setRunFilter } }: { page: Page }) {
  return <div className={styles.filters}>
    <label className={styles.filter}><span className="visually-hidden">Run state</span><select value={filter} onChange={e => setRunFilter("state", e.target.value, DEFAULT_STATE)}>
      <option value="all">All states</option>{RUN_STATES.map(v => <option value={v} key={v}>{statusLabel(v)}</option>)}
    </select></label>
    <label className={styles.filter}><span className="visually-hidden">Time range</span><Icon icon={Calendar} size={18} className={styles.filterIcon} /><select className={styles.withIcon} value={range} onChange={e => setRunFilter("range", e.target.value, DEFAULT_RANGE)}>
      {RANGES.map(r => <option value={r.key} key={r.key}>{r.label}</option>)}
    </select></label>
  </div>;
}

function RefreshPlaybooks({ page: { showRuns, runs, admissions } }: { page: Page }) {
  const label = showRuns ? "Refresh runs" : "Refresh start requests";
  const query = showRuns ? runs : admissions;
  return <ActionButton className={styles.iconButton} title={label} onClick={() => void query.refetch()} disabled={runs.isFetching || admissions.isFetching}>
    <Icon icon={RefreshCw} size={18} /><span className="visually-hidden">{label}</span>
  </ActionButton>;
}

function PlaybookToolbar({ page }: { page: Page }) {
  const { tab, deployment, showRuns, catalogEnabled, tabRefs, tabKey, selectTab, viewSearch } = page;
  return <Toolbar className={styles.viewBar}>
    <div className={styles.tabs} role="tablist" aria-label="Playbook views" onKeyDown={tabKey}>
      {TABS.map(([id, label]) => <button key={id} id={`playbooks-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={tab === id ? `playbooks-panel-${id}` : undefined} tabIndex={tab === id ? 0 : -1} ref={element => { if (element) tabRefs.current.set(id, element); else tabRefs.current.delete(id); }} onClick={() => selectTab(id)}>{label}</button>)}
    </div>
    {tab === "library" && catalogEnabled && !deployment && <Link className={styles.toolbarLink} to={{ pathname: "/playbooks", search: viewSearch("deployment") }}>
      <Icon icon={Settings2} size={16} />Deployments
    </Link>}
    {showRuns && <RunFilters page={page} />}
    {tab === "runs" && <RefreshPlaybooks page={page} />}
  </Toolbar>;
}

function LibraryPanel({ page }: { page: Page }) {
  const { project, queryContext, deployment, catalogEnabled, detail, viewSearch } = page;
  return deployment ? <>
    {!detail && <Link className={styles.sectionLink} to={{ pathname: "/playbooks", search: viewSearch() }}><Icon icon={ArrowLeft} size={16} />Back to library</Link>}
    <CurrentCatalog key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:activations`} kind="activations" />
  </> : catalogEnabled ? <CurrentCatalog key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:definitions`} kind="definitions" />
    : <LoadedDefinitions key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}`} />;
}

function RunPagination({ runs, runsNow }: Pick<Page, "runs" | "runsNow">) {
  if (!runs.data) return null;
  return <>
    {runs.hasNextPage && <ActionButton disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>Load more runs</ActionButton>}
    {runs.data.pages.length === MAX_PAGES && runs.data.pages[MAX_PAGES - 1]?.next && <p>Showing the first 100 loaded runs.</p>}
    {runs.data.pages[0] && <p className={styles.meta}>{runs.data.pages[0].namespace.name} · observed <Age at={runs.data.pages[0].observedAt} now={runsNow} /> · key order</p>}
  </>;
}

function EmptyRuns({ loaded, visible }: { loaded: number; visible: number }) {
  return <>
    {loaded === 0 && <p>No runs recorded in this configured namespace.</p>}
    {loaded > 0 && visible === 0 && <p>No loaded runs match these filters.</p>}
  </>;
}

function RunRoster({ page }: { page: Page }) {
  const { runId, runs, rows, invalid, shown, filtering, listSearch, rosterFailed, retryRuns, runsNow, viewSearch } = page;
  return <Panel title="Recent runs" className={styles.roster} actions={<div className={styles.rosterActions}>{runs.data && filtering && <span className={styles.meta}>Filtering loaded runs</span>}<StartRun /></div>}>
    <Link className={styles.sectionLink} to={{ pathname: "/playbooks", search: viewSearch("start-requests") }}>Start requests<Icon icon={ArrowRight} size={16} /></Link>
    {!runs.data || runs.isError || invalid ? <><QueryStatus status={rosterFailed ? "error" : "pending"} error={invalid ?? runs.error} label="playbook runs" onRetry={retryRuns} /><Retrying query={runs} /></> : <>
      <EmptyRuns loaded={rows.length} visible={shown.length} />
      <RunRows runs={shown} runId={runId} listSearch={listSearch} runsNow={runsNow} />
      <RunPagination runs={runs} runsNow={runsNow} />
    </>}
  </Panel>;
}

function RunWorkspace({ page }: { page: Page }) {
  const { runId, project, queryContext, rows, rosterFailed, viewSearch } = page;
  return <div className={styles.workspace} data-focused={Boolean(runId)}>
    {runId && <Link className={styles.mobileBack} to={{ pathname: "/playbooks", search: viewSearch("runs") }}>All runs</Link>}
    <RunRoster page={page} />
    {runId ? <RunInspector key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:${runId}`} id={runId} project={project} loaded={rows} retryWithRuns={rosterFailed} /> : <Panel title="Select a run" description="Open a run to inspect its pinned artifact, execution state and transition receipts."><p className={styles.meta}>Run pins remain unchanged when definitions change.</p></Panel>}
  </div>;
}

function StartRequests({ page }: { page: Page }) {
  const { admissions, listSearch, admissionsNow, viewSearch } = page;
  return <>
    <Link className={styles.sectionLink} to={{ pathname: "/playbooks", search: viewSearch("runs") }}><Icon icon={ArrowLeft} size={16} />Back to run history</Link>
    <Panel title="Start requests" description="See whether a request to start a playbook created a run.">
      {!admissions.data || admissions.isError ? <><QueryStatus status={admissions.isError ? "error" : "pending"} error={admissions.error} label="playbook start requests" onRetry={() => void admissions.refetch()} /><Retrying query={admissions} /></> : <>
        <AdmissionRows items={admissions.data.items} admissionsNow={admissionsNow} listSearch={listSearch} />
        {admissions.data.next && <p>Showing the first 25 recorded requests.</p>}
      </>}
    </Panel>
  </>;
}

function PageContent({ page }: { page: Page }) {
  if (page.tab === "library") return <LibraryPanel page={page} />;
  if (page.scopeUnavailable) return <PlaybookScopeUnavailable title={page.showRuns ? "Recent runs" : "Start requests"} />;
  return page.showRuns ? <RunWorkspace page={page} /> : <StartRequests page={page} />;
}

export function Playbooks() {
  const page = usePlaybookPage();
  return <div className={styles.page} data-detail={page.detail}>
    <PageHeader title="Playbooks" />
    <PlaybookToolbar page={page} />
    <div id={`playbooks-panel-${page.tab}`} role="tabpanel" aria-labelledby={`playbooks-tab-${page.tab}`} className={styles.viewPanel}>
      <PageContent page={page} />
    </div>
  </div>;
}

function RunRows({ runs, runId, listSearch, runsNow }: { runs: Run[]; runId?: string; listSearch: string; runsNow: string | null }) {
  return <ul className={styles.runs} aria-label="Playbook runs">{runs.map(r => <li key={r.id}>
    <Link className={styles.runLink} data-selected={r.id === runId} aria-current={r.id === runId ? "page" : undefined} to={{ pathname: `/playbooks/runs/${encodeURIComponent(r.id)}`, search: listSearch }}>
      <Icon icon={runStatusIcon(r.status)} size={24} className={styles.runGlyph} data-state={r.status} />
      <strong className={styles.runTitle} title={r.entry}>{humanize(r.entry)}</strong>
      <span className={styles.runMeta}><span title={r.id} aria-hidden="true">{shortRunId(r.id)}</span><span className="visually-hidden">{r.id}</span> · <Age at={r.admittedAt} now={runsNow} /></span>
      <span className={styles.chip} data-state={r.status}><span className={styles.dot} aria-hidden="true" />{statusLabel(r.status)}</span>
      <Icon icon={ChevronRight} size={16} className={styles.chevron} />
    </Link></li>)}</ul>;
}

function AdmissionRows({ items, admissionsNow, listSearch }: { items: Admission[]; admissionsNow: string | null; listSearch: string }) {
  return items.length === 0 ? <p>No start requests recorded.</p> : <ul className={styles.admissions} aria-label="Playbook start requests">{items.map(a => <li key={a.requestId}>
    <strong>{a.runId ? "Run created" : humanize(a.status)}</strong>
    <p className={styles.meta}><Age at={a.createdAt} now={admissionsNow} /> · <span className={styles.pin}>{a.requestId}</span></p>
    {a.runId ? <Link to={{ pathname: `/playbooks/runs/${encodeURIComponent(a.runId)}`, search: listSearch }}>Open run</Link> : <span>No run confirmed</span>}
  </li>)}</ul>;
}

function RunIdentity({ run: r }: { run: Run }) {
  const admittedIso = new Date(r.admittedAt).toISOString();
  return <TechnicalIdentity className={styles.runIdentity}>
    <dt>Run</dt><dd className={styles.pin}>{r.id}</dd>
    <dt>Artifact</dt><dd className={styles.pin}>{r.artifact}</dd>
    <dt>Admitted</dt><dd><time dateTime={admittedIso}>{timestamp(r.admittedAt)}</time></dd>
    <dt>Outcome</dt><dd>{r.outcome ?? "Not recorded"}</dd>
    {Object.entries(r.dependencies).map(([name, pin]) => <div className={styles.dependency} key={name}><dt>Pinned dependency: {name}</dt><dd className={styles.pin}>{pin}</dd></div>)}
    {Object.keys(r.dependencies).length === 0 && <><dt>Pinned dependencies</dt><dd>None recorded</dd></>}
  </TechnicalIdentity>;
}

function InspectionReadStatus({ query, retryWithRuns }: { query: { isError: boolean; failureCount: number; isFetching: boolean; error: Error | null; refetch(): Promise<unknown> }; retryWithRuns: boolean }) {
  return <Panel title="Run inspection">
    {query.isError && retryWithRuns && retryableReadFailure(query.error)
      ? <p role="alert">Couldn't load this playbook run either. Try again under Recent runs retries both.</p>
      : <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this playbook run" onRetry={() => void query.refetch()} />}
    <Retrying query={query} />
  </Panel>;
}

function useRunDetail(id: string, after: string | null, project: string | null) {
  const { queryContext } = useSession(); const [scope] = useScope(); const client = useQueryClient();
  return useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-run", { id, after }), queryFn: async ({ signal }) => adaptRunDetail(await apiGet<unknown>(url(`/runs/${encodeURIComponent(id)}`, project, after), signal), project, id, after), retry: retryUnlessMissing(client) });
}

function useInspectorHeading(id: string, loaded: boolean) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (loaded) heading.current?.focus(); }, [id, loaded]);
  return heading;
}

function RunInspector({ id, project, loaded, retryWithRuns }: { id: string; project: string | null; loaded: readonly Run[]; retryWithRuns: boolean }) {
  const [scope] = useScope(); const search = scopeSearch(scope);
  const [after, setAfter] = useState<string | null>(null);
  const query = useRunDetail(id, after, project);
  const projects = useProjects();
  const heading = useInspectorHeading(id, Boolean(query.data));
  const [tab, setTab] = useState<InspectorTab>("execution");
  const receivedAt = useMemo(() => performance.now(), [query.dataUpdatedAt]);
  const now = useObservedNow(query.data?.observedAt, query.dataUpdatedAt);
  if (!query.data || query.isError) return <InspectionReadStatus query={query} retryWithRuns={retryWithRuns} />;
  const { run: r, effects, receipts, namespace } = query.data;
  const projectLabel = projects.data?.view.find(p => p.id === namespace.projectId)?.label;
  return <section className={styles.inspector} aria-label={`Run ${r.id}`}>
    <header className={styles.inspectorHeader}>
      <h2 ref={heading} tabIndex={-1} title={r.entry}>{humanize(r.entry)}</h2>
      <span className={styles.badge} data-state={r.status}>{statusLabel(r.status)}</span>
      <ActionButton className={styles.iconButton} aria-label="Refresh run" title="Refresh run" disabled={query.isFetching} onClick={() => void query.refetch()}><Icon icon={RefreshCw} size={18} /></ActionButton>
      <p className={styles.meta}><span title={r.id}>{shortRunId(r.id)}</span>{projectLabel && <> · <span>{projectLabel}</span></>} · Started <Age at={r.admittedAt} now={now} /></p>
      <CancelRun className={styles.runAction} project={namespace.projectId} run={r.id} status={r.status} />
    </header>
    <div className={styles.pinStrip}>
      <p><Icon icon={FileText} size={18} /><span>This run: <strong title={r.entry}>{humanize(r.entry)}</strong> · <Digest value={r.artifact} /></span></p>
      <p className={styles.meta}>Current step: {humanize(r.step)}</p>
    </div>
    <RunIdentity run={r} />
    <InspectorTabs id="run-inspector" tab={tab} setTab={setTab}>{tab === "execution" ? <>
    <Panel title="Recorded execution" description="Steps from the loaded transition receipts, then the current step.">
      <RunTimeline receipts={receipts.items} run={r} />
    </Panel>
    <div className={styles.lower}>
      <WaitingOn run={r} effects={effects} />
      <ChildWorkflows run={r} loaded={loaded} search={search} />
    </div>
    </> : tab === "events" ? <RecentEvidence receipts={receipts.items} next={receipts.next} paged={after !== null} observedAt={receipts.observedAt} receivedAt={receivedAt} onFirst={() => setAfter(null)} onNext={setAfter} />
    : <PinnedDefinition run={r} namespace={namespace} search={search} />}</InspectorTabs>
    <p className={styles.meta}>Observed <Age at={query.data.observedAt} now={now} />. Run, operations and receipt pages are separate observations.</p>
  </section>;
}

function PinnedDefinition({ run, namespace, search }: { run: Run; namespace: ReturnType<typeof adaptRunDetail>["namespace"]; search: string }) {
  const definitionSearch = new URLSearchParams(search);
  definitionSearch.set("definition", run.artifact);
  return <>
    <WorkflowGraph key={run.artifact} artifact={run.artifact} namespace={namespace} entry={run.entry} />
    <Panel title="Pinned definition" description="The playbook version used by this run.">
      <DetailList><dt>Artifact</dt><dd><Digest value={run.artifact} /></dd><dt>Entry</dt><dd>{run.entry}</dd><dt>Dependencies</dt><dd>{Object.keys(run.dependencies).length}</dd></DetailList>
      <Link className={styles.definitionOpen} to={{ pathname: "/playbooks", search: `?${definitionSearch}` }}>Open in library</Link>
    </Panel>
  </>;
}
