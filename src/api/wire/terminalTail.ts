/** AQ-server-local read-only tail. This is not a renderer snapshot. */
export type TerminalIdentity = {
  terminal_id: string;
  epoch: number;
  session: { kind: "remote"; node_id: string; boot_id: string; attempt_id: string; assignment_generation: number; session_id: string }
    | { kind: "central"; authority_id: string; session_id: string; generation: number };
};
export type TailFrame = { terminal: TerminalIdentity; sequence: number; byte_length: number; bytes: number[]; digest: string };
export type TailGap = { terminal: TerminalIdentity; first_missing: number; last_missing: number };
export type TerminalTail = {
  terminal: TerminalIdentity;
  subscription_id: string;
  session_revision: number;
  expires_at_ms: number;
  server_time_ms: number;
  last_observed_at_ms: number | null;
  availability: "resident_tail" | "not_retained";
  disconnected: boolean;
  initial_incomplete: true;
  frames: TailFrame[];
  gaps: TailGap[];
  next_sequence: number;
  more: boolean;
};
