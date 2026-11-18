import { useEffect, useId, useRef, type RefObject } from "react";
import { ArrowRight, ArrowUpRight, X } from "lucide-react";
import type { GraphStep, StepUse, Transition } from "../../api/adapters/playbookGraph";
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

function RelatedSteps({ uses, direction, onNavigate }: {
  uses: StepUse[];
  direction: "incoming" | "outgoing";
  onNavigate: (id: string) => void;
}) {
  const titleId = useId();
  if (uses.length === 0) return null;
  const incoming = direction === "incoming";
  return <div className={styles.detailSection}>
    <h4 id={titleId}>{incoming ? "Uses from earlier steps" : "Used by later steps"}</h4>
    {!incoming && <p className={styles.useHint}>If the workflow reaches these steps.</p>}
    <ul className={styles.relatedSteps} aria-labelledby={titleId}>
      {uses.map(({ producer, consumer, paths, purpose }, index) => {
        const related = incoming ? producer : consumer;
        return <li key={index}>
          <button type="button" className={styles.relatedStep} onClick={() => onNavigate(related)}>
            {humanize(related)}<ArrowUpRight size={14} aria-hidden />
          </button>
          {purpose && <p className={styles.usePurpose}>{purpose}</p>}
          <ul className={styles.usedPaths} aria-label="Fields">
            {paths.map((path, index) => <li key={index}><code>{path}</code></li>)}
          </ul>
        </li>;
      })}
    </ul>
  </div>;
}

function NextStep({ transition: { label, to, error, reason }, onNavigate }: {
  transition: Transition;
  onNavigate: (id: string) => void;
}) {
  const reasonId = useId();
  return <li>
    <button type="button" aria-describedby={reason ? reasonId : undefined} onClick={() => onNavigate(to)}>
      <span className={styles.transitionOutcome} data-error={error}>{humanize(label)}</span>
      <ArrowRight size={14} aria-hidden />
      <span>{humanize(to)}</span>
    </button>
    {reason && <p id={reasonId} className={styles.transitionReason}>{reason}</p>}
  </li>;
}

export function StepInspector({ step, kind, reachable, headingRef, onClose, onNavigate }: {
  step: GraphStep;
  kind: string;
  reachable: ReadonlySet<string>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [step.id]);
  const commandDescription = step.kind === "invoke" && step.target ? commands.get(step.target) : undefined;
  const fallbackDescription = step.kind === "wait" && !step.target
    ? "Pauses the workflow until the deadline."
    : commandDescription ?? descriptions[step.kind];
  const uses = step.inspection?.uses.filter(use => reachable.has(use.producer) && reachable.has(use.consumer)) ?? [];
  const explained = step.inspection?.summary || uses.length > 0 || step.transitions.some(transition => transition.reason);
  const targetLabel = step.kind === "wait" ? "Event" : step.kind === "call" ? "Playbook entry" : "Command";
  const facts = (step.target || step.facts.length > 0) && <dl className={styles.facts}>
    {step.target && <div><dt>{targetLabel}</dt><dd><code>{step.target}</code></dd></div>}
    {step.facts.map(({ label, value }, index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
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
    <div ref={body} className={styles.stepBody}>
      <p className={styles.stepDescription}>{step.inspection?.summary ?? fallbackDescription}</p>
      {!explained && facts}
      <RelatedSteps direction="incoming" uses={uses.filter(use => use.consumer === step.id)} onNavigate={onNavigate} />
      <RelatedSteps direction="outgoing" uses={uses.filter(use => use.producer === step.id)} onNavigate={onNavigate} />
      {step.transitions.length > 0 && <div className={styles.detailSection}>
        <h4>Next steps</h4>
        <ul className={styles.transitions} aria-label="Outgoing transitions">
          {step.transitions.map((transition, index) => <NextStep key={index} transition={transition} onNavigate={onNavigate} />)}
        </ul>
      </div>}
      {explained && facts && <details className={styles.technicalDetails} key={step.id}>
        <summary>Details</summary>
        {facts}
      </details>}
    </div>
  </aside>;
}
