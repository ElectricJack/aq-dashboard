import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { Playbooks } from "./Playbooks";

export function Component() {
  const { bootstrap } = useSession();
  // The page owns its header so the subtitle keeps the Knowledge title rhythm (reference 06).
  if (bootstrap.capability("playbooks.inspect").enabled) return <Playbooks />;
  return <DestinationPage id="playbooks" />;
}
