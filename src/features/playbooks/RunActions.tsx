import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlaybookAction } from "./PlaybookAction";

const FINISHED = new Set(["completed", "failed", "cancelled"]);
const CANCELLING = "cancelling";

/** Refreshes run reads after a confirmed playbook operation; the server's state is the only status shown. */
export function useRefreshRuns() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ predicate: q => q.queryKey[4] === "playbook-run" || q.queryKey[4] === "playbook-runs" });
}

/** Cancel is an intent: neither pending nor confirmed relabels the run; its badge stays the server's state. */
export function CancelRun({ project, run, status, className }: { project: string; run: string; status: string; className?: string }) {
  const [reason, setReason] = useState(""); const refresh = useRefreshRuns();
  const blocked = FINISHED.has(status) ? "This run has finished" : status === CANCELLING ? "Cancellation is already in progress" : undefined;
  return <PlaybookAction kind="playbook.run.cancel" project={project} subject={{ type: "playbook_run", id: run }} blocked={blocked} className={className}
    intro={<p>Requests cancellation of this run. The run keeps its current state until the AQ server records the outcome.</p>}
    confirm="Confirm cancellation request. This does not prove the run stopped."
    fields={() => <label>Reason<textarea rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
    build={() => ({ payload: { run_id: run }, ...(reason.trim() ? { reason: reason.trim() } : {}) })}
    pendingText="Cancellation requested — awaiting confirmation." confirmedText="Cancellation requested"
    onConfirmed={refresh} onReload={refresh} onStart={() => setReason("")} />;
}
