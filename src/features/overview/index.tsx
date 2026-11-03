import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { destination } from "../../app/destinations";
import { Overview } from "./Overview";

/** Overview owns its header (title, summary and Create task); the shared page only covers a disabled destination. */
export function Component() {
  const { bootstrap } = useSession();
  const capability = destination("overview").capability;
  if (capability && !bootstrap.capability(capability).enabled) return <DestinationPage id="overview" />;
  return <Overview />;
}
