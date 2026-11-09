import { DestinationPage } from "../../app/DestinationPage";
import { Link } from "react-router";
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
        <Panel title="Intelligence profiles" description="Models and reasoning settings for future agent launches.">
          <Link to="/settings/intelligence">Manage intelligence profiles →</Link>
        </Panel>
        <FrameworkStatus />
        <ProjectBindings />
        {/* Full width so the inbox list and delivery details each get a readable column (ISSUE-014). */}
        <Notifications className={styles.wide} />
      </div>
    </DestinationPage>
  );
}
