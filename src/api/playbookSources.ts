import { ApiError, apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/**
 * The playbook-authoring sources API (spec 0013 §4.4-4.5), as the server serializes it
 * (`crates/aq-playbook-authoring/src/view.rs` and `http.rs`, server commit 857908e6).
 *
 *   GET    /api/playbooks/sources                 -> {items: [SourceView]}
 *   GET    /api/playbooks/sources/{id}            -> SourceView; 404 until the source exists
 *   POST   /api/playbooks/sources/{id}/runs       -> SourceView; starts no run when nothing changed or one is already running
 *   POST   /api/playbooks/sources/{id}/rollback   -> SourceView; 409 with a sentence when there is no earlier playbook
 *   DELETE /api/playbooks/sources/{id}            -> {deleted: true}; registered sources only
 *   SourceView = {id, kind: "builtin"|"registered", binding, purpose, revision,
 *     active: {artifact, since_ms, comparison: {change} | null, can_rollback, previous: {since_ms, summary?} | null, cases: [{name, situation, result, passed}]} | null,
 *     latest: {run, status, question: {question, sentences: [{line, end_line?, text}]} | null,
 *       unable: {reason, sentence, line} | {reason, sentence, host_fault: true} | null,
 *       refusal: string | null (the sentence for a `refused` or a `failed` run), internal_task_id, created_at_ms, finished_at_ms, elapsed_ms} | null}
 *
 * While the playbook engine is not open every `/api/playbooks/*` call answers 503 `playbooks_unavailable`.
 * The routing document is saved through the structure endpoint, which starts the run on the server: a built-in source refuses `PUT …/markdown`.
 * A status the dashboard does not know is kept as "unknown" and shown as such.
 */
export const PLAYBOOK_SOURCES_PATH = "/api/playbooks/sources";
export const PLAYBOOK_CHANGES = ["none", "wording", "behaviour", "abilities"] as const;
export type PlaybookChange = typeof PLAYBOOK_CHANGES[number];
export const RUN_STATUSES = ["running", "saved", "question", "unable", "refused", "superseded", "failed"] as const;
export type RunStatus = typeof RUN_STATUSES[number] | "unknown";
/** One situation the server ran against the saved playbook, and what came out, as the server worded them. */
export type PlaybookCase = { name: string; situation: string; result: string; passed: boolean };
export type PlaybookComparison = { change: PlaybookChange };
/** What a rollback would bring back. */
export type PreviousPlaybook = { since_ms: number; summary: string | null };
export type ActivePlaybook = { artifact: string; since_ms: number; comparison: PlaybookComparison | null; can_rollback: boolean; previous: PreviousPlaybook | null; cases: PlaybookCase[] };
/** A sentence of the document: its first line, its last line when it spans several, and those lines as the server holds them. */
export type QuotedSentence = { line: number; end_line: number | null; text: string };
export type AuthoringQuestion = { question: string; sentences: QuotedSentence[] };
/** What could not be carried out. With `host_fault` the fault is in what the server gave the agent, not in the document, and there is no line. */
export type UnableSentence = { sentence: string; reason: string; line: number | null; host_fault: boolean };
export type LatestRun = {
  run: string; status: RunStatus; question: AuthoringQuestion | null; unable: UnableSentence | null; refusal: string | null;
  internal_task_id: string | null; created_at_ms: number; finished_at_ms: number | null;
  /** How long the run has taken, by the server's clock: up to now while it runs, to its end afterwards. */
  elapsed_ms: number;
};
export type SourceView = { id: string; kind: string; binding: string; purpose: string; revision: number; active: ActivePlaybook | null; latest: LatestRun | null };

/** How much of a source's report is kept for display. A larger report is shortened, never refused, so it cannot hide the rest of the panel. */
export const PLAYBOOK_DISPLAY_LIMITS = { items: 100, textChars: 1024, reasonChars: 4096 } as const;
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid playbook source response"); }
const text = (value: unknown, max = Infinity): value is string => typeof value === "string" && value.length <= max;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
/** A time that `Date` can show: later values would throw when formatted. */
const MAX_TIME_MS = 8.64e15;
const instant = (value: unknown): value is number => count(value) && value <= MAX_TIME_MS;
/** `value` within `max` characters, ending in "…" when shortened. */
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1)}…`;
const short = (value: string) => clip(value, PLAYBOOK_DISPLAY_LIMITS.textChars);
const list = (value: unknown) => { ensure(Array.isArray(value)); return value.slice(0, PLAYBOOK_DISPLAY_LIMITS.items) as unknown[]; };

function comparison(value: unknown): PlaybookComparison | null {
  if (value == null) return null;
  ensure(isRecord(value) && PLAYBOOK_CHANGES.includes(value.change as PlaybookChange));
  return { change: value.change as PlaybookChange };
}
function playbookCase(value: unknown): PlaybookCase {
  ensure(isRecord(value));
  ensure(text(value.name, 512));
  ensure(text(value.situation));
  ensure(text(value.result));
  ensure(typeof value.passed === "boolean");
  return { name: value.name, situation: short(value.situation), result: short(value.result), passed: value.passed };
}
function previous(value: unknown): PreviousPlaybook | null {
  if (value == null) return null;
  ensure(isRecord(value));
  ensure(instant(value.since_ms));
  ensure(value.summary == null || text(value.summary));
  return { since_ms: value.since_ms, summary: typeof value.summary === "string" ? short(value.summary) : null };
}
function active(value: unknown): ActivePlaybook | null {
  if (value == null) return null;
  ensure(isRecord(value));
  ensure(text(value.artifact, 512));
  ensure(instant(value.since_ms));
  ensure(value.can_rollback === undefined || typeof value.can_rollback === "boolean");
  return { artifact: value.artifact, since_ms: value.since_ms, comparison: comparison(value.comparison), can_rollback: value.can_rollback === true,
    previous: previous(value.previous), cases: list(value.cases).map(playbookCase) };
}
function question(value: unknown): AuthoringQuestion | null {
  if (value == null) return null;
  ensure(isRecord(value) && text(value.question));
  const sentences = list(value.sentences).map((item): QuotedSentence => {
    ensure(isRecord(item));
    ensure(count(item.line));
    ensure(item.end_line == null || count(item.end_line));
    ensure(text(item.text));
    return { line: item.line, end_line: (item.end_line as number | null | undefined) ?? null, text: short(item.text) };
  });
  return { question: clip(value.question, PLAYBOOK_DISPLAY_LIMITS.reasonChars), sentences };
}
function unable(value: unknown): UnableSentence | null {
  if (value == null) return null;
  ensure(isRecord(value));
  ensure(text(value.sentence));
  ensure(text(value.reason));
  ensure(value.line == null || count(value.line));
  ensure(value.host_fault === undefined || typeof value.host_fault === "boolean");
  return { sentence: short(value.sentence), reason: clip(value.reason, PLAYBOOK_DISPLAY_LIMITS.reasonChars), line: (value.line as number | null | undefined) ?? null, host_fault: value.host_fault === true };
}
function latest(value: unknown): LatestRun | null {
  if (value == null) return null;
  ensure(isRecord(value));
  ensure(text(value.run, 128));
  ensure(typeof value.status === "string");
  ensure(count(value.created_at_ms));
  ensure(count(value.elapsed_ms));
  ensure(value.internal_task_id == null || text(value.internal_task_id, 64));
  ensure(value.finished_at_ms == null || count(value.finished_at_ms));
  ensure(value.refusal == null || typeof value.refusal === "string");
  return {
    run: value.run, status: RUN_STATUSES.includes(value.status as typeof RUN_STATUSES[number]) ? value.status as RunStatus : "unknown",
    question: question(value.question), unable: unable(value.unable), refusal: typeof value.refusal === "string" ? clip(value.refusal, PLAYBOOK_DISPLAY_LIMITS.reasonChars) : null,
    internal_task_id: (value.internal_task_id as string | null | undefined) ?? null, created_at_ms: value.created_at_ms, finished_at_ms: (value.finished_at_ms as number | null | undefined) ?? null,
    elapsed_ms: value.elapsed_ms,
  };
}
export function adaptSourceView(value: unknown): SourceView {
  ensure(isRecord(value));
  ensure(text(value.id, 128));
  ensure(text(value.kind, 64));
  ensure(text(value.binding, 128));
  ensure(text(value.purpose));
  ensure(count(value.revision));
  return { id: value.id, kind: value.kind, binding: value.binding, purpose: short(value.purpose), revision: value.revision, active: active(value.active), latest: latest(value.latest) };
}
export function adaptSourceList(value: unknown): SourceView[] {
  ensure(isRecord(value) && Array.isArray(value.items) && value.items.length <= 1024);
  return value.items.map(adaptSourceView);
}

const sourcePath = (id: string) => `${PLAYBOOK_SOURCES_PATH}/${encodeURIComponent(id)}`;
export async function listPlaybookSources(signal?: AbortSignal) { return adaptSourceList(await apiGet<unknown>(PLAYBOOK_SOURCES_PATH, signal)); }
export async function readPlaybookSource(id: string, signal?: AbortSignal) { return adaptSourceView(await apiGet<unknown>(sourcePath(id), signal)); }
/** Puts the previous playbook back in effect; answers the refreshed view. */
export async function rollBackPlaybookSource(id: string) { return adaptSourceView(await apiSend<unknown>("POST", `${sourcePath(id)}/rollback`, undefined)); }
/** Authors the saved document again; answers the refreshed view. The server starts no run when nothing changed since the playbook in effect was written. */
export async function authorPlaybookSourceAgain(id: string) { return adaptSourceView(await apiSend<unknown>("POST", `${sourcePath(id)}/runs`, undefined)); }
/** Removes a registered source (never the routing source). */
export async function deletePlaybookSource(id: string): Promise<void> { await apiSend<unknown>("DELETE", sourcePath(id), undefined); }

/** Why a source cannot be shown or changed, when the reason is the server's state and not a fault: no such source yet (404), or the playbook engine is not open (503 `playbooks_unavailable`). */
export type SourceGap = "missing" | "unavailable";
export function sourceGap(error: unknown): SourceGap | null {
  if (!(error instanceof ApiError)) return null;
  return error.status === 404 ? "missing" : error.status === 503 ? "unavailable" : null;
}
/** Each gap as a sentence for the owner. The server's 503 message carries the engine's own failure text, so it is never shown. */
export const SOURCE_GAP_SENTENCES: Record<SourceGap, string> = {
  missing: "This server has not set up the routing playbook yet, so there is nothing to show.",
  unavailable: "Playbooks are not running on this server right now. The routing playbook will show here once they are.",
};
/** A failed call in the owner's words: a gap sentence, else the server's own sentence, else `fallback`. */
export function sourceFailure(error: unknown, fallback: string) {
  const gap = sourceGap(error);
  return gap ? SOURCE_GAP_SENTENCES[gap] : error instanceof ApiError && error.serverMessage ? error.serverMessage : fallback;
}
