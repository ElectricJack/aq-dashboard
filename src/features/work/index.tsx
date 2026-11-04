import { CreateTaskAction } from "./CreateTask";
import { DestinationPage } from "../../app/DestinationPage";
import { WorkWorkspace } from "./WorkWorkspace";
import { useSession } from "../../app/session";

export function Component() {
  const { bootstrap } = useSession();
  const live = bootstrap.capability("human.graph.read").enabled;
  if (live && bootstrap.capability("tasks.read").enabled) return <WorkWorkspace action={<CreateTaskAction />} />;
  return (<DestinationPage id="work"><p>The server does not offer the task read contract supported by this dashboard.</p></DestinationPage>);
}
