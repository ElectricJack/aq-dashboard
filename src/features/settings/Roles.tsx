import { DetailList } from "../../components/layout/Workspace";
import { useDocuments } from "../../api/roleSettings";
import { ProfileDocuments, type DocumentsConfig } from "./ProfileDocuments";
import { newDocument } from "./profileMarkdown";
import styles from "./ProfileDocuments.module.css";

const list = (values: string[], none: string) => values.length ? values.join(", ") : none;
const BASE: Omit<DocumentsConfig<"role">, "template"> = {
  kind: "role", title: "Roles", level: 2, noun: "role", order: 20, enabledSwitch: true,
  description: "A role is the kind of work an agent does: its prompt, the AQ operations it may use and the execution profile it runs under. A task names its role; the router chooses the intelligence level.",
  columns: [
    { header: "Description", cell: role => role.description || "—" },
    { header: "Execution profile", cell: role => role.execution },
    { header: "Operations", cell: role => list(role.operations, "None") },
  ],
  summary: role => <>
    <DetailList>
      <dt>Name</dt><dd>{role.name}</dd>
      <dt>Id</dt><dd>{role.id}</dd>
      <dt>Description</dt><dd>{role.description || "None"}</dd>
      <dt>Execution profile</dt><dd>{role.execution}</dd>
      <dt>Operations</dt><dd>{list(role.operations, "None")}</dd>
      <dt>New work</dt><dd>{role.enabled ? "Enabled" : "Disabled: this role is handed no new work"}</dd>
    </DetailList>
    <details><summary>Role text</summary><pre className={styles.saved} tabIndex={0}>{role.role_md}</pre></details>
    {role.rules_md ? <details><summary>Rules</summary><pre className={styles.saved} tabIndex={0}>{role.rules_md}</pre></details> : <p className={styles.note}>No rules section.</p>}
  </>,
};

export function Roles() {
  // A new role starts on an execution profile that exists, when one does.
  const execution = useDocuments("execution").data?.documents[0]?.id;
  return <ProfileDocuments config={{ ...BASE, template: () => newDocument("role", { execution }) }} />;
}
