import type { RefObject } from "react";
import type { CatalogDefinition } from "../../api/adapters/playbookCatalog";
import type { LoadedDefinition } from "../../api/adapters/loadedDefinitions";
import type { Namespace } from "../../api/adapters/playbooks";
import { Digest, TechnicalIdentity } from "./identity";
import { humanize } from "./RunTimeline";
import { WorkflowGraph } from "./WorkflowGraph";
import styles from "./Playbooks.module.css";

export function DefinitionWorkspace({ item, namespace, heading }: {
  item: CatalogDefinition | LoadedDefinition;
  namespace: Namespace;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  return <section className={styles.inspector} aria-label={`Definition ${item.name}`}>
    <header className={styles.definitionHeader}>
      <div className={styles.runHeading}>
        <h2 className={styles.definitionHeading} ref={heading} tabIndex={-1} title={item.name}>{humanize(item.name)}</h2>
        <Digest value={item.artifact} />
      </div>
      {item.purpose && <p className={styles.purpose}>{item.purpose}</p>}
      {item.purposeTruncated && <p className={styles.meta}>Showing the first 4096 UTF-8 bytes of purpose text.</p>}
    </header>
    <WorkflowGraph artifact={item.artifact} namespace={namespace} showDescription />
    <TechnicalIdentity>
      <dt>Artifact</dt><dd className={styles.pin}>{item.artifact}</dd>
      <dt>Executable fingerprint</dt><dd className={styles.pin}>{item.fingerprint}</dd>
      <dt>Source digest</dt><dd className={styles.pin}>{item.sourceDigest}</dd>
      <dt>Compiler</dt><dd>{item.compiler}</dd>
      {"scope" in item && <><dt>Scope</dt><dd>{item.scope}</dd></>}
      <dt>Entry points</dt><dd>{item.entries.join(", ")}</dd>
      <dt>Declared dependencies</dt>
      <dd>{Object.keys(item.dependencies).length === 0 ? "None" : <ul className={styles.dependencyPins}>
        {Object.entries(item.dependencies).map(([alias, dependency]) => <li key={alias}>
          <strong>{alias}</strong> · <span className={styles.pin}>{typeof dependency === "string" ? dependency : dependency.artifact}</span>
          {typeof dependency !== "string" && <span> · {dependency.binding} · {dependency.selection === "exact" ? "Exact artifact" : "Catalog-compatible"}</span>}
        </li>)}
      </ul>}</dd>
    </TechnicalIdentity>
  </section>;
}
