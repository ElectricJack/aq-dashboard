import { useId } from "react";
import { unavailable, type Machine, type MachineSample, type Machines as MachineWire, type Ready, type Scheduling as ScheduleWire } from "../../api/adapters/performance";
import { count, Details, duration, labelOf, percent, Table, TaskLink, time, UnavailableNotice } from "./shared";
import styles from "./Performance.module.css";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });

function slotSummary(sample: MachineSample) {
  return `${labelOf(sample.state)} · ${count(sample.occupied_slots)} occupied · ${count(sample.free_slots)} free · ${count(sample.enabled_slots)} enabled`;
}

function intervals(machine: Machine) {
  const runs: { start: number; end: number; sample: MachineSample }[] = [];
  for (const sample of machine.samples) {
    const last = runs.at(-1);
    const same = last && last.end === sample.minute_ms && last.sample.state === sample.state &&
      last.sample.enabled_slots === sample.enabled_slots && last.sample.occupied_slots === sample.occupied_slots &&
      last.sample.free_slots === sample.free_slots;
    if (same) last.end += MINUTE;
    else runs.push({ start: sample.minute_ms, end: sample.minute_ms + MINUTE, sample });
  }
  return runs;
}

function position(start: number, end: number, cutoff: number) {
  const x = (ms: number) => Math.max(0, Math.min(100, (ms - cutoff + DAY) / DAY * 100));
  return { left: `${x(start)}%`, width: `${x(end) - x(start)}%` };
}

function MachineRow({ machine, cutoff }: { machine: Machine; cutoff: number }) {
  const runs = intervals(machine);
  const latest = machine.samples.at(-1);
  return <div className={styles.machine}>
    <div className={styles.chartRow}>
      <div><strong>{machine.label}</strong><small>{latest ? slotSummary(latest) : machine.detail_complete ? "No observations" : "Timeline detail omitted"}</small></div>
      <div className={styles.track} aria-hidden="true">
        {runs.map(({ start, end, sample }) => <span key={start} className={styles.interval}
          data-state={sample.state} style={position(start, end, cutoff)}>
          {sample.state === "online" && sample.enabled_slots && sample.occupied_slots != null
            ? <i style={{ height: `${sample.occupied_slots / sample.enabled_slots * 100}%` }} /> : null}
        </span>)}
        {machine.idle_with_queue.map(({ start_ms, end_ms }) => <span key={start_ms} className={styles.idle}
          style={position(start_ms, end_ms, cutoff)} />)}
      </div>
    </div>
    <Details summary={`${percent(machine.utilization.value)} utilization · ${count(machine.idle_with_queue.length)} idle intervals with queued work`}>{() => <>
      {latest && <p className={styles.note}>Latest slot observation {time(latest.minute_ms)}</p>}
      <p className={styles.note}>{count(machine.utilization.occupied_slot_minutes)} / {count(machine.utilization.enabled_slot_minutes)} observed slot-minutes occupied</p>
      {machine.idle_with_queue.length > 0 && <ul>{machine.idle_with_queue.map(({ start_ms, end_ms }) =>
        <li key={start_ms}>{time(start_ms)} to {time(end_ms)} · {duration(end_ms - start_ms)}</li>)}</ul>}
      {runs.length > 0 && <Table label={`${machine.label} observed intervals`} headings={["From", "Until", "State and slots"]}>
        {runs.map(({ start, end, sample }) => <tr key={start}><th scope="row">{time(start)}</th><td>{time(end)}</td><td>{slotSummary(sample)}</td></tr>)}
      </Table>}
    </>}</Details>
  </div>;
}

function ReadyTrend({ ready, cutoff }: { ready: Ready[]; cutoff: number }) {
  const counts = ready.flatMap(sample => sample.count == null ? [] : [sample.count]);
  const peak = counts.length ? Math.max(...counts) : null;
  const scale = Math.max(peak ?? 0, 1);
  return <>
    <div className={styles.chartRow}>
      <div><strong>Fleet ready queue</strong><small>Peak observed count {count(peak)}</small></div>
      <div className={styles.track} aria-hidden="true">
        {ready.map(sample => sample.count != null && <span key={sample.minute_ms} className={styles.queue}
          data-accuracy={sample.accuracy}
          style={{ ...position(sample.minute_ms, sample.minute_ms + MINUTE, cutoff), height: `max(2px, ${sample.count / scale * 100}%)` }} />)}
      </div>
    </div>
    {ready.length > 0 && <Details summary="Ready count observations">{() =>
      <Table label="Fleet ready count observations" headings={["Observed minute", "Ready tasks", "Accuracy"]}>
        {ready.map(sample => <tr key={sample.minute_ms}><th scope="row">{time(sample.minute_ms)}</th><td>{count(sample.count)}</td><td>{labelOf(sample.accuracy)}</td></tr>)}
      </Table>
    }</Details>}
  </>;
}

export function Machines({ data, cutoff }: { data: MachineWire; cutoff: number }) {
  const caption = useId();
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  return <>
    <p className={styles.note}>
      {count(data.coverage.observed_minutes)} / {count(data.coverage.expected_minutes)} minutes observed · Last observation {time(data.observed_at_ms)}
    </p>
    {data.observed_at_ms != null && cutoff - data.observed_at_ms > 2 * MINUTE && <p className={styles.notice}>Latest capacity observation is stale.</p>}
    {data.state === "partial" && <p className={styles.notice}>Capacity data incomplete. {data.reason && labelOf(data.reason)}</p>}
    {data.machines.length === 0 && <p className={styles.notice}>No machines reported in this window.</p>}
    <figure className={styles.figure} aria-labelledby={caption}>
      <figcaption id={caption} className={styles.legend}>
        <span data-state="online">Enabled capacity / occupied</span><span data-state="partial">Partial</span>
        <span data-state="stale">Stale</span><span data-state="offline">Offline</span><span data-state="paused">Paused</span>
        <span data-state="gap">Unobserved</span><span data-state="idle">Idle ≥10 min with queued work</span>
      </figcaption>
      <div className={styles.chartRow} aria-hidden="true"><span /><div className={styles.axis}>
        {[24, 18, 12, 6, 0].map(hours => <span key={hours}>{clock.format(cutoff - hours * 3_600_000)}</span>)}
      </div></div>
      {data.machines.map(machine => <MachineRow key={machine.id} machine={machine} cutoff={cutoff} />)}
      <ReadyTrend ready={data.ready} cutoff={cutoff} />
      <p className={styles.note}>Times in UTC. Hatched queue values are lower bounds.</p>
    </figure>
  </>;
}

export function Scheduling({ data }: { data: ScheduleWire }) {
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  return <>
    <dl className={styles.metrics}>
      <div><dt>First observed eligible to claim</dt><dd>{duration(data.p50_eligible_to_claim_ms)}</dd><dd className={styles.metricDetail}>Median · P95 {duration(data.p95_eligible_to_claim_ms)}</dd></div>
      <div><dt>Claims with timing</dt><dd>{count(data.covered_claims)} / {count(data.claims)}</dd></div>
      <div><dt>Dropped observations</dt><dd>{count(data.dropped_observations)}</dd></div>
    </dl>
    <p className={styles.note}>Timing starts at the final observed eligibility check and ends at durable claim.</p>
    {data.dropped_observations > 0 && <p className={styles.notice}>Scheduling data incomplete.</p>}
    {data.reason_counts.length === 0 ? <p className={styles.notice}>No scheduling decisions observed in this window.</p> :
      <Table label="Observed scheduling decisions" headings={["Reason", "Decisions"]}>
        {data.reason_counts.map(item => <tr key={item.reason}><th scope="row">{labelOf(item.reason)}</th><td>{count(item.count)}</td></tr>)}
      </Table>}
    {data.examples.length > 0 && <details><summary>Task examples</summary>
      <Table label="Scheduling evidence" headings={["Task", "Reason", "Observed at"]}>
        {data.examples.map((example, i) => <tr key={i}>
          <th scope="row"><TaskLink task={example.task_id} /></th><td>{labelOf(example.reason)}</td><td>{time(example.observed_at_ms)}</td>
        </tr>)}
      </Table>
    </details>}
  </>;
}
