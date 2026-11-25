import { unavailable, type Holds as HoldsWire } from "../../api/adapters/performance";
import { count, duration, labelOf, Table, TaskLink, time, UnavailableNotice } from "./shared";
import styles from "./Performance.module.css";

export function Holds({ data }: { data: HoldsWire }) {
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  return <>
    <p className={styles.note}>Observed {time(data.observed_at_ms)}</p>
    {data.state === "partial" && <p className={styles.notice}>Hold data incomplete. {data.reason && labelOf(data.reason)}</p>}
    <dl className={styles.metrics}>
      <div><dt>Held tasks</dt><dd>{count(data.count)}</dd></div>
      <div><dt>Oldest hold</dt><dd>{data.count === 0 ? "—" : duration(data.oldest_age_ms)}</dd></div>
      <div><dt>Missed scheduled checks</dt><dd>{count(data.missed_checks)}</dd></div>
    </dl>
    {data.rows.length === 0 ? <p className={styles.notice}>No holds observed.</p> :
      <Table label="Held tasks" headings={["Task", "Reason", "Age", "Responsible party", "Next check"]}>
        {data.rows.map(hold => <tr key={hold.task_id}>
          <th scope="row"><TaskLink task={hold.task_id} scope={{ kind: "project", project_id: hold.project_id }} /></th>
          <td>{hold.reason}</td><td title={`Since ${time(hold.since_ms)}`}>{duration(hold.age_ms)}</td>
          <td>{hold.responsible_party ?? "Unknown"}</td><td>{time(hold.next_check_at_ms)}</td>
        </tr>)}
      </Table>}
  </>;
}
