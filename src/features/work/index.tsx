import { CreateTaskAction } from "./CreateTask";
import styles from "./CreateTask.module.css";
import { PageTitle } from "../../app/DestinationPage";
import { DestinationPage } from "../../app/DestinationPage";
import { HumanNodeWorkspace } from "../knowledge/HumanNodeWorkspace";
import { useSession } from "../../app/session";

export function Component() {
  const { bootstrap } = useSession();
  const live = bootstrap.capability("human.graph.read").enabled;
  if (live && bootstrap.capability("tasks.read").enabled) return <><div className={styles.heading}><PageTitle>Work</PageTitle><CreateTaskAction /></div><HumanNodeWorkspace kind="task" /></>;
  return (
    <DestinationPage id="work">
      {live ? <HumanNodeWorkspace kind="task" /> : <p>The server does not offer the task read contract supported by this dashboard.</p>}
    </DestinationPage>
  );
}
