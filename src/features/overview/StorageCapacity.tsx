import { formatBytes, formatStoragePercent, STORAGE_REFUSAL_PERCENT, STORAGE_WARNING_PERCENT, storageLevel, storagePercent, type NodeStorage, type StorageLevel } from "../../api/adapters/nodeStorage";
import styles from "./Overview.module.css";

export type StorageSubject = { id: string; name: string; storage: NodeStorage };

const LEVEL_TEXT: Record<StorageLevel, string | null> = {
  normal: null,
  warning: `Storage pressure · at or above ${STORAGE_WARNING_PERCENT}% used`,
  refusal: `Placement refused · at or above ${STORAGE_REFUSAL_PERCENT}% used`,
  unknown: "Usage percent not reported",
};

const MAX_NODES = 4;

function reported(storage: NodeStorage): boolean {
  return Object.values(storage).some(value => value !== null);
}

function Fact({ label, bytes, total }: { label: string; bytes: number | null; total: number | null }) {
  const percent = storagePercent(bytes, total);
  return <div><dt>{label}</dt><dd>{bytes === null ? "Not reported" : <>{formatBytes(bytes)}{percent !== null && <span className={styles.meta}> · {formatStoragePercent(percent)}</span>}</>}</dd></div>;
}

function StorageRow({ subject }: { subject: StorageSubject }) {
  const { storage } = subject;
  if (!reported(storage)) return <li className={styles.storageRow} data-level="unknown"><strong>{subject.name}</strong><span className={styles.meta}>Not reported</span></li>;
  const usedPercent = storagePercent(storage.used_bytes, storage.total_bytes);
  const level = storageLevel(usedPercent);
  const levelText = LEVEL_TEXT[level];
  return <li className={styles.storageRow} data-level={level}>
    <div className={styles.storageHeading}>
      <strong>{subject.name}</strong>
      {levelText && <span className={styles.storageLevel}>{levelText}</span>}
    </div>
    {usedPercent !== null && <span className={styles.storageBar} aria-hidden="true"><span style={{ inlineSize: `${Math.min(usedPercent, 100)}%` }} /></span>}
    <dl className={styles.storageFacts}>
      <Fact label="Used" bytes={storage.used_bytes} total={storage.total_bytes} />
      <Fact label="Reserved" bytes={storage.reserved_bytes} total={storage.total_bytes} />
      <Fact label="Preserved" bytes={storage.preserved_bytes} total={storage.total_bytes} />
      <Fact label="Free" bytes={storage.free_bytes} total={storage.total_bytes} />
    </dl>
    <span className={styles.meta}>
      {storage.total_bytes === null ? "Total not reported" : `${formatBytes(storage.total_bytes)} total`} · {storage.preserved_count === null ? "Preserved sandboxes not reported" : `${storage.preserved_count} preserved ${storage.preserved_count === 1 ? "sandbox" : "sandboxes"}`}
    </span>
  </li>;
}

function pressure(subject: StorageSubject): number {
  return storagePercent(subject.storage.used_bytes, subject.storage.total_bytes) ?? -1;
}

/** SBX25 disk usage for central storage and each worker node; most pressured nodes first. */
export function StorageCapacity({ central, nodes, nodesUnavailable }: { central: NodeStorage; nodes: StorageSubject[] | null; nodesUnavailable?: string }) {
  const ordered = nodes ? [...nodes].sort((a, b) => pressure(b) - pressure(a)) : [];
  return <section className={styles.infrastructureSection} aria-labelledby="overview-storage-heading">
    <h3 id="overview-storage-heading">Disk storage</h3>
    <ul className={styles.storageList}>
      <StorageRow subject={{ id: "central", name: "Central", storage: central }} />
      {ordered.slice(0, MAX_NODES).map(node => <StorageRow key={node.id} subject={node} />)}
    </ul>
    {nodes === null ? <p className={styles.meta}>{nodesUnavailable ?? "Node storage unavailable."}</p> : nodes.length > MAX_NODES && <p className={styles.meta}>Showing {MAX_NODES} of {nodes.length} nodes, most used first.</p>}
  </section>;
}
