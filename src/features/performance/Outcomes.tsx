import { unavailable, type Outcomes as OutcomeData } from "../../api/adapters/performance";
import { count, duration, labelOf, percent, Table, TaskLink, time, UnavailableNotice } from "./shared";
import styles from "./Performance.module.css";

type TimingData = { median_ms: number | null; p90_ms: number | null; covered: number; total: number };
function Timing({ name, timing }: { name: string; timing: TimingData }) {
  return <tr>
    <th scope="row">{name}</th>
    <td>{duration(timing.median_ms)}</td><td>{duration(timing.p90_ms)}</td>
    <td>{count(timing.covered)} / {count(timing.total)}</td>
  </tr>;
}

export function Outcomes({ data }: { data: OutcomeData }) {
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  const { delivery, first_pass_acceptance: acceptance } = data;
  return <>
    <dl className={styles.metrics}>
      <div><dt>Confirmed task completions</dt><dd>{count(data.confirmed_completions)}</dd></div>
      <div><dt>Verified target-branch merges</dt><dd>{count(data.verified_merges)}</dd></div>
      <div><dt>First-pass acceptance</dt><dd>{acceptance.denominator > 0 ? percent(acceptance.value) : "—"}</dd>
        <dd className={styles.metricDetail}>{count(acceptance.numerator)} / {count(acceptance.denominator)} adjudicated · {count(acceptance.unknown)} unknown</dd></div>
      <div><dt>Configured task deliveries</dt><dd>{delivery.state === "not_tracked" ? "Not tracked" : count(delivery.delivered_tasks)}</dd>
        {delivery.definitions.length > 0 && <dd className={styles.metricDetail}>{delivery.definitions.map(labelOf).join(", ")}</dd>}</div>
    </dl>
    {data.completions_with_unknown_date > 0 && <p className={styles.notice}>{count(data.completions_with_unknown_date)} confirmed completions have an unknown completion date.</p>}
    {delivery.state === "partial" && <p className={styles.notice}>
      Delivery data incomplete.
      {delivery.unknown_definitions > 0 && ` ${count(delivery.unknown_definitions)} tasks have an unknown delivery definition.`}
      {(delivery.unknown_required_pr_sets ?? 0) > 0 && ` ${count(delivery.unknown_required_pr_sets ?? 0)} tasks have an unknown required pull request set.`}
    </p>}
    {data.confirmed_completions === 0 && data.verified_merges === 0 && data.tasks.length === 0 &&
      <p className={styles.notice}>No outcome events in this window.</p>}
    <Table label="First ready to outcome" headings={["First ready to", "Median", "P90", "Timing coverage"]}>
      <Timing name="Confirmed completion" timing={data.completion_timing} />
      <Timing name="Merge verification" timing={data.merge_timing} />
      {delivery.state !== "not_tracked" && <Timing name="Configured delivery" timing={delivery.timing} />}
    </Table>
    {data.tasks.length > 0 && <details>
      <summary>Task evidence · Up to 50 recent tasks</summary>
      <Table label="Outcome task evidence" headings={["Task", "First ready", "Completion", "Merge verification", "Delivery", "First pass", "Disposition", "Usage"]}>
        {data.tasks.map(task => {
          const scope = { kind: "project" as const, project_id: task.project_id };
          return <tr key={task.task_id}>
            <th scope="row"><TaskLink task={task.task_id} scope={scope} /></th>
            <td>{time(task.first_ready_at_ms)}</td><td>{time(task.completion_at_ms)}</td><td>{time(task.merge_at_ms)}</td>
            <td>{task.delivery_evidence === "required_pr_set_unknown" ? "Required pull requests unknown" : time(task.delivery_at_ms)}</td><td>{task.first_pass !== null ? labelOf(task.first_pass) : "Unknown"}</td>
            <td>{labelOf(task.disposition)}</td><td><TaskLink task={task.task_id} scope={scope} usage>View usage</TaskLink></td>
          </tr>;
        })}
      </Table>
    </details>}
  </>;
}
