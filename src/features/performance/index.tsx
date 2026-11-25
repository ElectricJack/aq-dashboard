import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  adaptPerformance, holdSections, machineSections, summarySections, taskSections, unavailable,
  type HoldData, type MachineData, type SummaryData, type TaskData,
} from "../../api/adapters/performance";
import type { Scope } from "../../api/wire/proposed";
import { DestinationPage } from "../../app/DestinationPage";
import { useDocumentTitle } from "../../app/documentTitle";
import { scopeSearch, useScope } from "../../app/scope";
import { Holds } from "./Holds";
import { Machines, Scheduling } from "./Machines";
import { Outcomes } from "./Outcomes";
import { labelOf, Panel, ReadPanel, TaskLink, time, usePerformance } from "./shared";
import { TaskAttribution, Usage } from "./Usage";
import styles from "./Performance.module.css";

function Fleet({ cutoff }: { cutoff?: number }) {
  const query = usePerformance("machines", adaptPerformance<MachineData>(machineSections, cutoff), undefined, { cutoff });
  return <>
    <Panel title="Machine utilization" detail="Last 24 hours · Fleet">
      <ReadPanel query={query} label="machine capacity">{({ view }) => <Machines data={view.machines} cutoff={view.cutoff_ms} />}</ReadPanel>
    </Panel>
    <Panel title="Queue diagnostics" detail="Last 7 days · Fleet">
      <ReadPanel query={query} label="queue diagnostics">{({ view }) => <Scheduling data={view.scheduling} />}</ReadPanel>
    </Panel>
  </>;
}

function HeldWork({ cutoff, scope }: { cutoff?: number; scope: Scope }) {
  const [pages, setPages] = useState<{ cutoff?: number; cursors: string[] }>({ cursors: [] });
  const cursor = pages.cursors.at(-1);
  const chosenCutoff = pages.cutoff ?? cutoff;
  const query = usePerformance("holds", adaptPerformance<HoldData>(holdSections, chosenCutoff), scope, { cutoff: chosenCutoff, cursor });
  const view = query.data?.view;
  const nextCursor = view && !unavailable(view.holds) ? view.holds.next_cursor : null;
  return <Panel title="Holds" detail="Current observation">
    <ReadPanel query={query} label="holds">{({ view }) => <Holds data={view.holds} />}</ReadPanel>
    <div className={styles.controls}>
      {cursor && <button type="button"
        onClick={() => setPages({ cutoff: chosenCutoff, cursors: pages.cursors.slice(0, -1) })}>Previous holds</button>}
      {!query.isError && view && nextCursor && <button type="button"
        onClick={() => setPages({ cutoff: view.cutoff_ms, cursors: [...pages.cursors, nextCursor] })}>Next holds</button>}
    </div>
  </Panel>;
}

function Performance({ scope }: { scope: Scope }) {
  const summary = usePerformance("summary", adaptPerformance<SummaryData>(summarySections), scope);
  const cutoff = summary.data?.view.cutoff_ms;
  return <>
    {cutoff !== undefined && <p className={styles.asOf}>Snapshot · {time(cutoff)}</p>}
    <Panel title="Delivery and quality" detail="Last 7 days">
      <ReadPanel query={summary} label="delivery and quality metrics">{({ view }) => <Outcomes data={view.outcomes} />}</ReadPanel>
    </Panel>
    {summary.status !== "pending" && <>
      {scope.kind === "all_authorized" && <Fleet cutoff={cutoff} />}
      <HeldWork key={cutoff ?? "independent"} scope={scope} cutoff={cutoff} />
    </>}
    <Panel title="Model efficiency" detail="Last 7 days">
      <ReadPanel query={summary} label="model efficiency">{({ view }) => <Usage data={view.usage} />}</ReadPanel>
    </Panel>
  </>;
}

function TaskPerformance({ scope, taskId }: { scope: Scope; taskId: string }) {
  const query = usePerformance("task", adaptPerformance<TaskData>(taskSections, undefined, "usage"), scope, { path: `tasks/${encodeURIComponent(taskId)}` });
  return <>
    <div className={styles.controls}>
      <Link className={styles.link} to={{ pathname: "/performance", search: scopeSearch(scope) }}>Back to Performance</Link>
    </div>
    <Panel title="Task routing and usage">
      <ReadPanel query={query} label="this task">{({ view }) => <>
        <TaskLink task={taskId} scope={scope}>Open task in Work</TaskLink>
        <p className={styles.note}>First submission · {view.first_pass && !unavailable(view.first_pass) && view.first_pass.first_pass ? labelOf(view.first_pass.first_pass) : "Unknown"}</p>
        {view.usage ? <TaskAttribution data={view.usage} /> : <p className={styles.notice}>No usage recorded for this task.</p>}
      </>}</ReadPanel>
    </Panel>
  </>;
}

export function Component() {
  useDocumentTitle("Performance");
  const { taskId } = useParams();
  const [scope] = useScope();
  return <DestinationPage id="performance"><div className={styles.page}>
    {taskId ? <TaskPerformance taskId={taskId} scope={scope} /> :
      <Performance key={scope.kind === "project" ? scope.project_id : scope.kind} scope={scope} />}
  </div></DestinationPage>;
}
