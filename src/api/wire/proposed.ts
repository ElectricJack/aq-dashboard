/**
 * PROPOSED wire types transcribed from docs/specs/0003-dashboard-api.md.
 * API-02 has not published these schemas; replace this file with generated
 * bindings once it does. Nothing here describes a live AQ route.
 */

export type Id = string;
/** Positive decimal string. Never convert to Number. */
export type Revision = string;
/** UTC RFC3339 with milliseconds. */
export type Timestamp = string;
export type Digest = string;

export type Scope = { kind: "all_authorized" } | { kind: "project"; project_id: Id };

export type Observation = {
  observed_at: Timestamp;
  fresh_until: Timestamp;
  source: string;
  quality: "reported" | "estimated" | "unknown";
  coverage: "complete" | "partial" | "unknown";
};

export type Coverage = {
  state: "complete" | "partial" | "unknown";
  omitted_count?: number;
  reason?: string;
};

export type Envelope<T> = {
  api_version: string;
  request_id: string;
  server_time: Timestamp;
  scope: Scope;
  data: T;
  observation: Observation;
  pending_operations: Id[];
  coverage: Coverage;
};

export type ErrorEnvelope = {
  request_id: string;
  code: string;
  message: string;
  retryable: boolean;
  operation_id?: Id;
  field_errors?: { field: string; message: string }[];
  current_versions?: Record<string, Revision>;
  retry_after_ms?: number;
};

export type Capability = { name: string; version: string; enabled: boolean; reason?: string };

export type Bootstrap = {
  principal: { id: Id; display_name: string; authorization_revision: Revision };
  product: { version: string; dashboard_digest: Digest };
  contracts: { name: string; version: string; digest: Digest }[];
  capabilities: Capability[];
  limits: { page_size: number };
  default_scope: Scope;
  global_supervisor: {
    status: "available" | "unconfigured" | "unavailable";
    conversation_id: Id | null;
    reason?: string;
  };
};

export type QuotaWindow = {
  id: Id;
  label: string;
  starts_at: Timestamp | null;
  resets_at: Timestamp | null;
  used_percent: number | null;
  used: number | null;
  limit: number | null;
  unit: string | null;
  state: "known" | "unknown" | "unavailable";
  observation: Observation;
};

export type ProviderUsage = {
  provider_id: Id;
  account_ref: Id;
  account_label: string;
  scope: "provider_account";
  windows: QuotaWindow[];
  preferred_window_id: Id | null;
  availability_ref: { type: string; id: Id; revision?: Revision } | null;
};
