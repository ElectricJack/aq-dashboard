import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";

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
    </DestinationPage>
  );
}
