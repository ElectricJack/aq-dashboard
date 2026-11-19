import Markdown from "react-markdown";
import { Panel } from "../../components/layout/Workspace";
import styles from "./WorkflowGraph.module.css";

export function PlaybookDescription({ markdown }: { markdown: string }) {
  return <Panel title="Description">
    <div className={styles.markdown}>
      <Markdown skipHtml disallowedElements={["img"]} components={{
        h1: "h3", h2: "h4", h3: "h5", h4: "h6", h5: "h6",
      }}>{markdown}</Markdown>
    </div>
  </Panel>;
}
