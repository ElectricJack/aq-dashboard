import { unavailable, type Cost, type Model, type TaskUsage, type Usage as UsageWire } from "../../api/adapters/performance";
import { count, labelOf, Table, time, UnavailableNotice } from "./shared";
import styles from "./Performance.module.css";

const costFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
function Costs({ costs }: { costs: Cost[] }) {
  if (costs.length === 0) return "Unknown";
  return <ul className={styles.costs}>{costs.map(cost => <li key={`${cost.currency}/${cost.basis}`}>
    {costFormat.format(cost.microunits / 1_000_000)} {cost.currency} · {labelOf(cost.basis)}
  </li>)}</ul>;
}

function Models({ models, label }: { models: Model[]; label: string }) {
  if (models.length === 0) return null;
  return <Table label={label} headings={["Actual model", "Calls", "Input", "Output", "Cache read", "Cache write", "Reasoning", "Cost", "Missing prices", "Incomplete calls"]}>
    {models.map(model => <tr key={JSON.stringify([model.model, model.harness])}>
      <th scope="row">{model.model ?? "Unknown model"}{model.harness && <small>{model.harness}</small>}</th>
      <td>{count(model.calls)}</td><td>{count(model.tokens.input)}</td><td>{count(model.tokens.output)}</td>
      <td>{count(model.tokens.cache_read)}</td><td>{count(model.tokens.cache_write)}</td><td>{count(model.tokens.reasoning)}</td>
      <td><Costs costs={model.costs} /></td><td>{count(model.missing_prices)}</td><td>{count(model.incomplete_calls)}</td>
    </tr>)}
  </Table>;
}

export function Usage({ data }: { data: UsageWire }) {
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  const { coverage } = data;

  return <>
    {data.status === "partial" && <p className={styles.notice}>Usage data incomplete.{data.truncated && " Source records exceeded the report limit."}</p>}
    {data.status === "no_events" ? <p className={styles.notice}>No usage events in this window.</p> : <dl className={styles.metrics}>
      <div><dt>Complete attempts</dt><dd>{count(coverage.complete_attempts)} / {count(coverage.expected_attempts)}</dd></div>
      <div><dt>Priced calls</dt><dd>{count(coverage.priced_calls)} / {count(coverage.canonical_calls)}</dd></div>
      <div><dt>Unresolved events</dt><dd>{count(coverage.unresolved_events)}</dd></div>
      <div><dt>Observed cost</dt><dd><Costs costs={data.costs} /></dd></div>
    </dl>}
    <Models models={data.models} label="Usage by actual model" />
    {data.models.length > 0 && <p className={styles.note}>Token categories can overlap. Costs retain their currency and accounting basis.</p>}
    {data.unassigned && data.unassigned.canonical_calls > 0 && <details>
      <summary>Usage without project attribution · {count(data.unassigned.canonical_calls)} calls</summary>
      <p className={styles.note}>{count(data.unassigned.priced_calls)} priced calls included in the total.</p>
      <Costs costs={data.unassigned.costs} />
    </details>}
    {data.shared_overhead && data.shared_overhead.finished_runs > 0 && <details>
      <summary>Shared internal usage · {count(data.shared_overhead.reported_runs)} / {count(data.shared_overhead.finished_runs)} runs reported</summary>
      <p>{count(data.shared_overhead.input_tokens)} input tokens · {count(data.shared_overhead.output_tokens)} output tokens</p>
    </details>}
  </>;
}

export function TaskAttribution({ data }: { data: TaskUsage }) {
  if (unavailable(data)) return <UnavailableNotice reason={data.reason} />;
  return <>
    <dl className={styles.metrics}>
      <div><dt>First routing candidate</dt><dd>{data.first_route?.candidate ?? "Unknown"}</dd></div>
      <div><dt>First intended model</dt><dd>{data.first_route?.intended_model ?? "Unknown"}</dd></div>
      <div><dt>Routing policy revision</dt><dd>{data.first_route?.policy_revision ?? "Unknown"}</dd></div>
      <div><dt>First route recorded</dt><dd>{time(data.first_route?.recorded_at_ms ?? null)}</dd></div>
    </dl>
    <p className={styles.note}>Delegated calls cannot be identified in the available usage records.</p>
    {data.attempts.map(attempt => {
      const name = attempt.assignment_generation == null
        ? `Attempt …${attempt.attempt_id.slice(-8)}`
        : `Attempt generation ${count(attempt.assignment_generation)}`;
      return <details key={attempt.attempt_id}>
        <summary>{name} · {labelOf(attempt.attempt_status ?? "execution state unknown")}</summary>
        <p className={styles.note}>{attempt.attempt_id}{attempt.attempt_id === data.first_route?.attempt_id && " · First routing decision"}</p>
        <p className={styles.note}>Intended model {attempt.intended_model ?? "unknown"} · Usage {labelOf(attempt.status)} · {count(attempt.unresolved_events)} unresolved events</p>
        <Costs costs={attempt.costs} />
        <Models models={attempt.models} label={`Actual models for ${name}`} />
      </details>;
    })}
    <Usage data={data} />
  </>;
}
