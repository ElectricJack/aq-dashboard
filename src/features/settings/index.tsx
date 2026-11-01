import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { ProjectBindings } from "./ProjectBindings";
import { FrameworkStatus } from "./FrameworkStatus";
import { Notifications } from "../notifications/Notifications";

export function Component() {
  const { bootstrap } = useSession();
  return (
    <DestinationPage id="settings">
      <section aria-labelledby="identity-heading">
        <h2 id="identity-heading">Identity</h2>
        <dl>
          <dt>Signed in as</dt>
          <dd>{bootstrap.principal.displayName}</dd>
          <dt>AQ version</dt>
          <dd>{bootstrap.productVersion}</dd>
        </dl>
      </section>
      <FrameworkStatus />
      <Notifications />
      <ProjectBindings />
    </DestinationPage>
  );
}
