import type { RefObject } from "react";
import { ArrowRight, X } from "lucide-react";
import type { GraphStep } from "../../api/adapters/playbookGraph";
import { ActionButton } from "../../components/layout/Workspace";
import { humanize } from "./RunTimeline";
import styles from "./WorkflowGraph.module.css";

const descriptions = {
  invoke: "Runs a command and follows the path for its result.",
  decide: "Checks a condition and follows the path for its result.",
  wait: "Pauses the workflow until the expected event or deadline.",
  for_each: "Runs the loop body for each item, then continues to the next step.",
  call: "Starts a run at an entry point in another playbook.",
  join: "Waits for results from earlier work before the workflow continues.",
  return: "Finishes this run and returns its outcome.",
};
const commands = new Map([
  ["work.read", "Reads the task details used to make a routing decision."],
  ["judgment.assess", "Requests an assessment from an agent. The workflow can collect the assessment in a later step."],
  ["work.route", "Records the routing decision so scheduling can choose an eligible worker."],
]);

export function StepInspector({ step, kind, headingRef, onClose, onNavigate }: {
  step: GraphStep;
  kind: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const commandDescription = step.kind === "invoke" && step.target ? commands.get(step.target) : undefined;
  const description = step.kind === "wait" && !step.target
    ? "Pauses the workflow until the deadline."
    : commandDescription ?? descriptions[step.kind];
  const targetLabel = step.kind === "wait" ? "Event" : step.kind === "call" ? "Playbook entry" : "Command";
  return <aside className={styles.stepDetail} aria-label="Step details">
    <header className={styles.stepHeader}>
      <div>
        <span className={styles.stepKind}>{kind}</span>
        <h3 ref={headingRef} tabIndex={-1}>{humanize(step.id)}</h3>
      </div>
      <ActionButton className={styles.closeStep} aria-label="Close step details" title="Close step details" onClick={onClose}>
        <X size={16} aria-hidden />
      </ActionButton>
    </header>
    <p className={styles.stepDescription}>{description}</p>
    {(step.target || step.facts.length > 0) && <dl className={styles.facts}>
      {step.target && <div><dt>{targetLabel}</dt><dd><code>{step.target}</code></dd></div>}
      {step.facts.map(({ label, value }, index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    {step.transitions.length > 0 && <div className={styles.nextSteps}>
      <h4>Next steps</h4>
      <ul className={styles.transitions} aria-label="Outgoing transitions">
        {step.transitions.map(({ label, to, error }, index) => <li key={index}>
          <button type="button" onClick={() => onNavigate(to)}><span data-error={error}>{humanize(label)}</span><ArrowRight size={14} aria-hidden />{humanize(to)}</button>
        </li>)}
      </ul>
    </div>}
  </aside>;
}
