export type DestinationId =
  | "overview"
  | "supervisor"
  | "work"
  | "results"
  | "decisions"
  | "agents"
  | "playbooks"
  | "knowledge"
  | "settings";

export type Destination = {
  id: DestinationId;
  label: string;
  /** Capability the server must negotiate before this surface reads data; null needs none. */
  capability: string | null;
  /** Work package in docs/plans/0001 that delivers the surface's content. */
  workPackage: string;
  phone: "primary" | "more";
};

/** Order from docs/specs/0002-product-design.md section 3. */
export const DESTINATIONS: readonly Destination[] = [
  { id: "overview", label: "Overview", capability: "dashboard.inspect", workPackage: "D04", phone: "primary" },
  { id: "supervisor", label: "Supervisor", capability: "supervisor.conversation", workPackage: "D06", phone: "primary" },
  { id: "work", label: "Work", capability: "dashboard.inspect", workPackage: "D04", phone: "more" },
  { id: "results", label: "Results", capability: "results.read", workPackage: "D10", phone: "primary" },
  { id: "decisions", label: "Decisions", capability: "dashboard.inspect", workPackage: "D05", phone: "more" },
  { id: "agents", label: "Agents", capability: "dashboard.inspect", workPackage: "D04/D07", phone: "primary" },
  { id: "playbooks", label: "Playbooks", capability: "playbooks.inspect", workPackage: "D11", phone: "more" },
  { id: "knowledge", label: "Knowledge", capability: "knowledge.read", workPackage: "D11", phone: "more" },
  { id: "settings", label: "Settings", capability: null, workPackage: "D03", phone: "more" },
];

/** Phone bottom bar order: Overview, Results, Supervisor, Agents, then More. */
export const PHONE_PRIMARY: readonly DestinationId[] = ["overview", "results", "supervisor", "agents"];

export function destination(id: DestinationId): Destination {
  const d = DESTINATIONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown destination ${id}`);
  return d;
}
