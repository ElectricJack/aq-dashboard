import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { DetailList, Panel } from "../../components/layout/Workspace";
import { ProjectBindings } from "./ProjectBindings";
import { FrameworkStatus } from "./FrameworkStatus";
import { DisplayPreferences } from "./DisplayPreferences";
import { Notifications } from "../notifications/Notifications";
import styles from "./Settings.module.css";

export function Component() {
  const { bootstrap } = useSession();
  return (
    <DestinationPage id="settings">
      <p className={styles.subtitle}>Your identity, connection, display and project execution settings.</p>
      <div className={styles.grid}>
        <Panel title="Identity" description="The account this dashboard is signed in with.">
          <DetailList>
            <dt>Signed in as</dt>
            <dd>{bootstrap.principal.displayName}</dd>
          </DetailList>
          <details className={styles.technical}>
            <summary>Technical identity</summary>
            <DetailList>
              <dt>AQ version</dt>
              <dd>{bootstrap.productVersion}</dd>
            </DetailList>
          </details>
        </Panel>
        <DisplayPreferences />
        <FrameworkStatus />
        <Notifications />
        <ProjectBindings />
      </div>
    </DestinationPage>
  );
}
