import { useSession } from "../../app/session";
import { PageTitle } from "../../app/DestinationPage";
import { SupervisorConversation } from "./SupervisorConversation";

export function Component() {
  const { bootstrap, queryContext: c } = useSession();
  const capability = bootstrap.capability("supervisor.history.read");
  return capability.enabled ? <SupervisorConversation key={`${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} /> : <>
    <PageTitle>Global supervisor</PageTitle><p role="status">Supervisor history is unavailable. {capability.reason}</p>
  </>;
}
