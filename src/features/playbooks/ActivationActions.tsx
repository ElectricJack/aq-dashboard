import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CatalogActivation, CatalogDefinition } from "../../api/adapters/playbookCatalog";
import { useSession } from "../../app/session";
import { Panel } from "../../components/layout/Workspace";
import { PlaybookAction } from "./PlaybookAction";
import { playbookCapability } from "./playbookActions";
import { useCatalogPage } from "./useCatalogPage";
import { shortDigest } from "./identity";
import styles from "./Playbooks.module.css";

const FUTURE = "Activation affects future runs only. Existing runs keep their pinned definition. Installing and compiling are separate operations.";

/** Activate or roll back a binding for new runs. Neither relabels a run already admitted. */
export function ActivationActions({ item, project }: { item: CatalogActivation; project: string }) {
  const { bootstrap } = useSession(); const client = useQueryClient();
  const offered = bootstrap.capability("dashboard.actions").enabled && bootstrap.capability(playbookCapability("playbook.activation.activate")).enabled;
  const definitions = useCatalogPage("definitions", offered);
  const choices = (definitions.page?.items ?? []).filter((d): d is CatalogDefinition => d.kind === "definition" && d.artifact !== item.artifact);
  const [artifact, setArtifact] = useState(""); const chosen = choices.find(d => d.artifact === artifact) ?? choices[0];
  const subject = { type: "playbook_binding" as const, id: item.binding, revision: item.revision };
  // Conflict review refreshes this binding in place (same keys), so the chosen artifact stays selected.
  const reload = () => Promise.all([client.invalidateQueries({ predicate: q => q.queryKey[4] === "playbook-current-catalog" || q.queryKey[4] === "playbook-current-catalog-detail" }), definitions.refetch()]);
  return <Panel title="Activation for new runs">
    <p>Definition <span className={styles.pin} title={item.artifact}>{shortDigest(item.artifact)}</span> is active for new runs · binding revision {item.revision}.</p>
    <p className={styles.meta}>{FUTURE}</p>
    <div className={styles.activationActions}>
      <PlaybookAction kind="playbook.activation.activate" project={project} subject={subject}
        blocked={definitions.unavailable ?? (choices.length === 0 ? "No other definition is represented in this namespace" : undefined)}
        intro={<p>Binds a different installed definition to <strong>{item.binding}</strong> for new runs. {FUTURE}</p>}
        confirm="Confirm activation for new runs."
        fields={() => <label>Definition<select value={chosen?.artifact ?? ""} onChange={e => setArtifact(e.target.value)}>{choices.map(d => <option key={d.artifact} value={d.artifact}>{d.name} · {shortDigest(d.artifact)}</option>)}</select></label>}
        build={() => { if (!chosen) throw new Error("Choose a definition."); return { payload: { binding: item.binding, artifact: chosen.artifact } }; }}
        draft={chosen?.artifact ?? ""}
        pendingText="Activation requested — awaiting confirmation." confirmedText="Activation confirmed for new runs. Refresh activations to see the new binding revision."
        onReload={reload} />
      <PlaybookAction kind="playbook.activation.rollback" project={project} subject={subject}
        blocked={BigInt(item.revision) <= 1n ? `No earlier activation is recorded for this binding (binding revision ${item.revision})` : undefined}
        intro={<p>Restores the previous activation of <strong>{item.binding}</strong> for new runs, replacing definition {shortDigest(item.artifact)}. If no earlier activation is recorded, the server rejects the rollback. {FUTURE}</p>}
        confirm="Confirm rollback for new runs."
        build={() => ({ payload: { binding: item.binding, artifact: item.artifact } })}
        pendingText="Rollback requested — awaiting confirmation." confirmedText="Rollback confirmed for new runs"
        onReload={reload} />
    </div>
  </Panel>;
}
