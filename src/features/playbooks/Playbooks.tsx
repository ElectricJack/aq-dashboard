import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { scopedKey } from "../../api/queryKeys";
import { adaptAdmissions, adaptRunDetail, adaptRuns, mergeRunPages, statusLabel, timestamp, type Run } from "../../api/adapters/playbooks";
import { useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { Panel, Toolbar, ActionButton, DetailList } from "../../components/layout/Workspace";
import { CATALOG_CAPABILITY } from "../../api/adapters/playbookCatalog";
import { CurrentCatalog } from "./CurrentCatalog";
import { LoadedDefinitions } from "./LoadedDefinitions";
import { InspectorTabs, RecentEvidence, RunTimeline, type InspectorTab } from "./RunTimeline";
import styles from "./Playbooks.module.css";

const BASE = "/api/playbooks/inspection";
const MAX_PAGES = 4;
function url(path: string, project: string | null, after?: string | null) {
  const q = new URLSearchParams({ limit: "25" }); if (project) q.set("project_id", project); if (after) q.set("after", after);
  return `${BASE}${path}?${q}`;
}
export function Playbooks() {
  const { runId } = useParams<{ runId: string }>();
  const [scope] = useScope(); const search = scopeSearch(scope);
  const project = scope.kind === "project" ? scope.project_id : null;
  const { bootstrap, queryContext } = useSession();
  const [params, setParams] = useSearchParams(); const navigate = useNavigate();
  const tab = params.get("view") === "definitions" ? "definitions" : params.get("view") === "admissions" ? "admissions" : params.get("view") === "activations" ? "activations" : "runs";
  const [filter, setFilter] = useState("all");
  const runs = useInfiniteQuery({ queryKey: scopedKey(queryContext, scope, "playbook-runs", {}), initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => adaptRuns(await apiGet<unknown>(url("/runs", project, pageParam), signal), project, pageParam),
    getNextPageParam: (last, all) => all.length < MAX_PAGES ? last.next ?? undefined : undefined, retry: false, staleTime: 5000, enabled: tab === "runs", refetchOnWindowFocus: false });
  const admissions = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-admissions", {}), queryFn: async ({ signal }) => adaptAdmissions(await apiGet<unknown>(url("/admissions", project), signal), project), enabled: tab === "admissions", retry: false });
  let rows: Run[] = []; let invalid: unknown = null;
  try { rows = runs.data ? mergeRunPages(runs.data.pages) : []; } catch (e) { invalid = e; }
  const shown = filter === "all" ? rows : rows.filter(r => r.status === filter);
  function selectTab(next: string) { const p = new URLSearchParams(params); p.delete("definition"); p.delete("activation"); if (next === "runs") p.delete("view"); else p.set("view", next); if (next === "definitions" || next === "activations") navigate({ pathname: "/playbooks", search: p.toString() }); else setParams(p); }
  return <div className={styles.page}>
    <p className={styles.intro}>Inspect policy and follow each execution.</p>
    <Toolbar aria-label="Playbook views">
      <div className={styles.tabs}>
        <ActionButton aria-pressed={tab === "runs"} onClick={() => selectTab("runs")}>Runs</ActionButton>
        <ActionButton aria-pressed={tab === "definitions"} onClick={() => selectTab("definitions")}>Definitions</ActionButton>
        <ActionButton aria-pressed={tab === "activations"} onClick={() => selectTab("activations")}>Activations</ActionButton>
        <ActionButton aria-pressed={tab === "admissions"} onClick={() => selectTab("admissions")}>Admissions</ActionButton>
      </div>
      {tab === "runs" && <label className={styles.filter}>Loaded run states <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Loaded run states">
        <option value="all">All states</option>{["admitted", "running", "waiting", "finishing", "cancelling", "blocked", "completed", "failed", "cancelled"].map(v => <option value={v} key={v}>{statusLabel(v)}</option>)}
      </select></label>}
      {(tab === "runs" || tab === "admissions") && <ActionButton onClick={() => { if (tab === "runs") void runs.refetch(); else void admissions.refetch(); }} disabled={runs.isFetching || admissions.isFetching}>Refresh</ActionButton>}
    </Toolbar>
    {tab === "definitions" ? bootstrap.capability(CATALOG_CAPABILITY).enabled ? <CurrentCatalog key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:definitions`} kind="definitions" /> : <LoadedDefinitions key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}`} /> : tab === "activations" ? <CurrentCatalog key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:activations`} kind="activations" /> : tab === "runs" ? <div className={styles.workspace} data-focused={Boolean(runId)}>
      {runId && <Link className={styles.mobileBack} to={{ pathname: "/playbooks", search }}>All runs</Link>}
      <Panel title="Recent runs" description={runs.data?.pages[0] ? `${runs.data.pages[0].namespace.name} · bounded run discovery` : undefined} className={styles.roster}>
        {!runs.data || runs.isError || invalid ? <QueryStatus status={runs.isError || invalid ? "error" : "pending"} error={invalid ?? runs.error} label="playbook runs" onRetry={() => void runs.refetch()} /> : <>
          {rows.length === 0 && <p>No runs recorded in this configured namespace.</p>}
          {rows.length > 0 && shown.length === 0 && <p>No loaded runs match this state.</p>}
          <ul className={styles.runs} aria-label="Playbook runs">{shown.map(r => <li key={r.id}>
            <Link className={styles.runLink} data-selected={r.id === runId} to={{ pathname: `/playbooks/runs/${encodeURIComponent(r.id)}`, search }}>
              <strong>{r.entry}</strong><span className={styles.badge} data-state={r.status}>{statusLabel(r.status)}</span><small>{r.id}</small><small>Admitted {timestamp(r.admittedAt)}</small>
            </Link></li>)}</ul>
          {runs.hasNextPage && <ActionButton disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>Load more runs</ActionButton>}
          {runs.data.pages.length === MAX_PAGES && runs.data.pages[MAX_PAGES - 1]?.next && <p>Showing the first 100 loaded runs.</p>}
          {runs.data.pages[0] && <p className={styles.meta}>Observed {timestamp(runs.data.pages[0].observedAt)} · key order</p>}
        </>}
      </Panel>
      {runId ? <RunInspector key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project}:${runId}`} id={runId} project={project} /> : <Panel title="Select a run" description="Open a run to inspect its pinned artifact, execution state and transition receipts."><p className={styles.meta}>Run pins remain unchanged when definitions change.</p></Panel>}
    </div> : <Panel title="Admissions" description="Retained requests and their engine admission status.">
      {!admissions.data || admissions.isError ? <QueryStatus status={admissions.isError ? "error" : "pending"} error={admissions.error} label="playbook admissions" onRetry={() => void admissions.refetch()} /> : <>
        {admissions.data.items.length === 0 ? <p>No admissions recorded.</p> : <ul className={styles.admissions} aria-label="Playbook admissions">{admissions.data.items.map(a => <li key={a.requestId}><strong>{a.status.replaceAll("_", " ")}</strong> · {a.requestId}<p className={styles.meta}>{timestamp(a.createdAt)}</p>{a.runId ? <Link to={{ pathname: `/playbooks/runs/${encodeURIComponent(a.runId)}`, search }}>Inspect admitted run</Link> : <span>Engine run not confirmed</span>}</li>)}</ul>}
        {admissions.data.next && <p>Showing the first 25 admissions. More are retained.</p>}
      </>}
    </Panel>}
  </div>;
}
function RunInspector({ id, project }: { id: string; project: string | null }) {
  const { queryContext } = useSession(); const [scope] = useScope(); const search = scopeSearch(scope);
  const [after, setAfter] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-run", { id, after }), queryFn: async ({ signal }) => adaptRunDetail(await apiGet<unknown>(url(`/runs/${encodeURIComponent(id)}`, project, after), signal), project, id, after), retry: false });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (query.data) heading.current?.focus(); }, [id, Boolean(query.data)]);
  const [tab, setTab] = useState<InspectorTab>("execution");
  const receivedAt = useMemo(() => performance.now(), [query.dataUpdatedAt]);
  if (!query.data || query.isError) return <Panel title="Run inspection"><QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this playbook run" onRetry={() => void query.refetch()} /></Panel>;
  const { run: r, effects, receipts } = query.data;
  const definitionSearch = (() => { const p = new URLSearchParams(search); p.set("view", "definitions"); p.set("definition", r.artifact); return `?${p}`; })();
  return <section className={styles.inspector} aria-label={`Run ${r.id}`}>
    <div className={styles.runHeading}><h2 ref={heading} tabIndex={-1}>{r.entry}</h2><span className={styles.badge} data-state={r.status}>{statusLabel(r.status)}</span><p className={styles.meta}>{r.id}</p><ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh run</ActionButton></div>
    <Panel title="Pinned execution">
      <DetailList><dt>Artifact</dt><dd className={styles.pin}>{r.artifact}</dd><dt>Entry</dt><dd>{r.entry}</dd><dt>Current step</dt><dd>{r.step}</dd><dt>Admitted</dt><dd>{timestamp(r.admittedAt)}</dd><dt>Outcome</dt><dd>{r.outcome ?? "Not recorded"}</dd></DetailList>
      <details className={styles.details}><summary>Pinned dependencies ({Object.keys(r.dependencies).length})</summary><DetailList>{Object.entries(r.dependencies).map(([name, pin]) => <div className={styles.dependency} key={name}><dt>{name}</dt><dd className={styles.pin}>{pin}</dd></div>)}</DetailList></details>
    </Panel>
    <InspectorTabs id="run-inspector" tab={tab} setTab={setTab}>{tab === "execution" ? <>
    <Panel title="Recorded execution" description="Steps from the loaded transition receipts, then the current step.">
      <RunTimeline receipts={receipts.items} run={r} />
    </Panel>
    <div className={styles.lower}>
      <Panel title="Waiting on"><p>{r.pendingKind ? `${r.pendingKind.replaceAll("_", " ")} pending` : "No pending wait recorded"}</p>{r.reason && <p>{r.reason}</p>}
        {effects.items.length > 0 && <ul className={styles.effects}>{effects.items.map(e => <li key={e.id}><strong>{e.command}</strong><span>{e.step} · {e.status.replaceAll("_", " ")}</span>{e.cancelRequested && <span>Cancellation requested</span>}</li>)}</ul>}{effects.next && <p>Additional operations are not shown in this bounded view.</p>}
      </Panel>
      <Panel title="Child workflows"><ul className={styles.children}>{r.children.map(child => <li key={child}><Link to={{ pathname: `/playbooks/runs/${encodeURIComponent(child)}`, search }}>{child}</Link></li>)}</ul>{r.children.length === 0 && <p>No child workflows recorded.</p>}{r.parent && <Link to={{ pathname: `/playbooks/runs/${encodeURIComponent(r.parent)}`, search }}>Parent workflow</Link>}</Panel>
    </div>
    </> : tab === "events" ? <RecentEvidence receipts={receipts.items} next={receipts.next} paged={after !== null} observedAt={receipts.observedAt} receivedAt={receivedAt} onFirst={() => setAfter(null)} onNext={setAfter} />
    : <Panel title="Pinned definition" description="The definition artifact this run was admitted with. Run pins remain unchanged when definitions change.">
      <DetailList><dt>Artifact</dt><dd className={styles.pin}>{r.artifact}</dd><dt>Entry</dt><dd>{r.entry}</dd><dt>Dependencies</dt><dd>{Object.keys(r.dependencies).length}</dd></DetailList>
      <Link className={styles.definitionOpen} to={{ pathname: "/playbooks", search: definitionSearch }}>Open in Definitions</Link>
    </Panel>}</InspectorTabs>
    <p className={styles.meta}>Observed {timestamp(query.data.observedAt)}. Run, operations and receipt pages are separate observations.</p>
  </section>;
}
