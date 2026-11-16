import { DetailList } from "../../components/layout/Workspace";
import type { Candidate } from "../../api/roleSettings";
import { CandidatesEditor } from "./CandidatesEditor";
import { ProfileDocuments, type DocumentsConfig } from "./ProfileDocuments";
import { newDocument } from "./profileMarkdown";
import styles from "./ProfileDocuments.module.css";

const candidate = (c: Candidate) => [c.provider, c.model, c.reasoning, c.harnesses.join(", ")].join(" · ");
function Candidates({ candidates }: { candidates: Candidate[] }) {
  return candidates.length ? <ol className={styles.ordered}>{candidates.map((c, i) => <li key={i}>{candidate(c)}</li>)}</ol> : <>None</>;
}
const value = (v: unknown) => v === null ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v);
const CONFIG: DocumentsConfig<"intelligence"> = {
  kind: "intelligence", title: "Levels", level: 3, noun: "level", order: 30,
  description: "A level is an intelligence profile: the models a task of that difficulty may run on, in the order AQ tries them. The router assigns each task its level.",
  columns: [
    { header: "Description", cell: level => level.description || "—" },
    { header: "Candidates (provider · model · reasoning · harness)", cell: level => <Candidates candidates={level.candidates} /> },
  ],
  summary: level => <DetailList>
    <dt>Name</dt><dd>{level.name}</dd>
    <dt>Id</dt><dd>{level.id}</dd>
    <dt>Description</dt><dd>{level.description || "None"}</dd>
    <dt>Candidates</dt><dd><Candidates candidates={level.candidates} /></dd>
    <dt>Selection</dt><dd>{Object.keys(level.selection).length ? <ul>{Object.entries(level.selection).map(([key, stated]) => <li key={key}>{key}: {value(stated)}</li>)}</ul> : "Uses the selection defaults"}</dd>
  </DetailList>,
  structured: props => <CandidatesEditor {...props} />,
  template: () => newDocument("intelligence"),
};

export function IntelligenceLevels() { return <ProfileDocuments config={CONFIG} />; }
