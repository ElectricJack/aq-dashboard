import type { MachineView, OwnerAvailabilityView } from "../../../api/adapters/swarm";
import type { FrozenAction } from "../../actions/actionClient";

export type SwarmActionKind = "worker.start" | "worker.stop" | "worker.drain" | "worker.revoke" | "swarm.availability.set";
export const workerLabels = { "worker.start": "Start worker", "worker.stop": "Stop worker", "worker.drain": "Drain", "worker.revoke": "Revoke machine" } as const;

function freeze(kind: SwarmActionKind, subject: { type: string; id: string }, payload: Record<string, unknown>, reason?: string): FrozenAction {
  const id = crypto.randomUUID();
  const bytes = JSON.stringify({ operation_id: id, kind, subject, expected_versions: {}, ...(reason ? { reason } : {}), payload: { operation_id: id, ...payload } });
  if (new TextEncoder().encode(bytes).length > 65536) throw new Error("This request is too large.");
  // No project: these operations are scoped all_authorized.
  return Object.freeze({ id, bytes, kind, subject: Object.freeze({ ...subject }) });
}

export function freezeWorkerAction(kind: "worker.start" | "worker.stop" | "worker.drain", m: Pick<MachineView, "id" | "control">, reason?: string): FrozenAction {
  return freeze(kind, { type: "machine", id: m.id }, { machine: m.id, expected_generation: m.control!.generation }, reason);
}
export function freezeRevoke(m: Pick<MachineView, "id">): FrozenAction {
  return freeze("worker.revoke", { type: "machine", id: m.id }, { machine: m.id });
}
export function freezeAvailability(available: boolean, a: OwnerAvailabilityView): FrozenAction {
  return freeze("swarm.availability.set", { type: "swarm", id: "owner-availability" }, { available, expected_generation: a.generation });
}
