import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { HumanNodeWorkspace } from "./HumanNodeWorkspace";

export function Component() {
  const { bootstrap } = useSession();
  // The workspace owns the page header so "Add record" can sit on the title row (reference 07).
  if (bootstrap.capability("knowledge.read").enabled && bootstrap.capability("human.graph.read").enabled) return <HumanNodeWorkspace kind="knowledge" />;
  return <DestinationPage id="knowledge">{bootstrap.capability("human.graph.read").enabled ? <HumanNodeWorkspace kind="knowledge" /> : <p>The server does not offer the knowledge read contract supported by this dashboard.</p>}</DestinationPage>;
}
