import { DetailList } from "../../components/layout/Workspace";
import { useId } from "react";
import { compareLevelIds, type Candidate } from "../../api/roleSettings";
import { CandidatesEditor } from "./CandidatesEditor";
import { LevelLimitsFeedback, LevelLimitsProvider, LevelMaxAgents } from "./LevelLimits";
import { ProfileDocuments, type DocumentsConfig } from "./ProfileDocuments";
import { frontmatterText, newDocument, setFrontmatterText } from "./profileMarkdown";
import styles from "./ProfileDocuments.module.css";

const candidate = (c: Candidate) => [c.provider, c.model, c.reasoning, c.harnesses.join(", ")].join(" · ");
function Candidates({ candidates }: { candidates: Candidate[] }) {
  return candidates.length ? <ol className={styles.ordered}>{candidates.map((c, i) => <li key={i}>{candidate(c)}</li>)}</ol> : <>None</>;
}
const value = (v: unknown) => v === null ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v);
/**
 * The level's description, edited in place: it is the `description` line of the document, and the text the router reads
 * when it chooses a level for a task.
 */
function DescriptionField({ markdown, disabled, onChange }: { markdown: string; disabled: boolean; onChange(markdown: string): void }) {
  const id = useId(), text = frontmatterText(markdown, "description");
  if (text === null) return null;
  return <div className={styles.describe}>
    <label htmlFor={id}>Description</label>
    <textarea id={id} rows={3} value={text} disabled={disabled} aria-describedby={`${id}-hint`} onChange={event => { const next = setFrontmatterText(markdown, "description", event.target.value); if (next !== null) onChange(next); }} />
    <p id={`${id}-hint`} className={styles.note}>The router reads this text when it chooses a level for a task. Say what kind of work belongs on this level.</p>
  </div>;
}
const CONFIG: DocumentsConfig<"intelligence"> = {
  kind: "intelligence", title: "Levels", level: 3, noun: "level", order: 30, compare: compareLevelIds, belowList: <LevelLimitsFeedback />,
  description: "A level is an intelligence profile: the models a task of that difficulty may run on, in the order AQ tries them. The router assigns each task its level, and a level's id is the name the router uses for it.",
  columns: [
    { header: "Description", cell: level => level.description || "—" },
    { header: "Candidates (provider · model · reasoning · harness)", cell: level => <Candidates candidates={level.candidates} /> },
    { header: "Max agents", cell: level => <LevelMaxAgents level={level} /> },
  ],
  summary: level => <DetailList>
    <dt>Name</dt><dd>{level.name}</dd>
    <dt>Id</dt><dd>{level.id}</dd>
    <dt>Description</dt><dd>{level.description || "None"}</dd>
    <dt>Candidates</dt><dd><Candidates candidates={level.candidates} /></dd>
    <dt>Selection</dt><dd>{Object.keys(level.selection).length ? <ul>{Object.entries(level.selection).map(([key, stated]) => <li key={key}>{key}: {value(stated)}</li>)}</ul> : "Uses the selection defaults"}</dd>
  </DetailList>,
  structured: props => <><DescriptionField {...props} /><CandidatesEditor {...props} /></>,
  template: () => newDocument("intelligence"),
};

export function IntelligenceLevels() { return <LevelLimitsProvider><ProfileDocuments config={CONFIG} /></LevelLimitsProvider>; }
