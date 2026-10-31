import type { SessionView } from "../../api/adapters/inspection";

export const OBSERVATION_LABEL: Record<SessionView["observation"]["state"], string> = {
  reported_running: "Running (reported)",
  reported_stopped: "Stopped (reported)",
  unknown: "State unknown",
  unsupported: "Unsupported state",
};

export const AUTHORITY_LABEL: Record<SessionView["authority"], string> = {
  central: "Central",
  remote: "Remote",
  unknown: "Authority unknown",
  unsupported: "Unsupported authority",
};

export function controllerText(c: SessionView["controller"]): string {
  switch (c.state) {
    case "none":
      return "No controller";
    case "held":
      return c.label ? `Controlled by ${c.label}` : "Controlled";
    case "unknown":
      return "Controller unknown";
    case "unsupported":
      return "Unsupported controller state";
  }
}

export function profileText(p: SessionView["profile"]): string {
  return [p.model ?? "model unknown", p.harness ?? "harness unknown"].join(" · ");
}
