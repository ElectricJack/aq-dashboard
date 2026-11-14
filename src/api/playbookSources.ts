import { ApiError, apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/**
 * The playbook-authoring sources API (server task C6, spec 0013 §4.4-4.5), written from C6's planned contract before the server exists.
 * Everything the dashboard assumes about that API is in this file, so when the real server differs only this file changes.
 *
 * Planned contract (C6):
 *   GET    /api/playbooks/sources                       -> {items: [SourceView]}
 *   GET    /api/playbooks/sources/{id}                  -> SourceView
 *   POST   /api/playbooks/sources/{id}/runs             -> author again
 *   POST   /api/playbooks/sources/{id}/rollback
 *   DELETE /api/playbooks/sources/{id}                  -> registered sources only
 *   SourceView = {id, kind, binding,
 *     active: {artifact, since_ms, comparison: {change: "none"|"wording"|"behaviour"|"abilities"}, cases: [{name, situation, result, passed}]} | null,
 *     latest: {run, status, question: {question, sentences: [{line, text}]} | null, unable, refusal, internal_task_id, created_at_ms, finished_at_ms} | null}
 *
 * Fixed with the server after review (round 1):
 *   active.can_rollback: boolean; when true, active.previous: {since_ms, summary?} names the playbook a rollback would bring back.
 *   active.comparison is an object when there is a previous playbook and null/absent when there is none. It is never used to decide whether a rollback is offered.
 *   Rollback and a new run answer 200 with the refreshed SourceView; delete answers {deleted: true}.
 *
 * Assumptions where the contract is still silent (each is marked below):
 *   A1 `latest.status` is one of RUN_STATUSES; anything else is kept as "unknown" and shown as such.
 *   A2 `latest.unable` is null, one `{sentence, reason, line?}`, or a list of them; it is normalised to a list.
 *   A3 `latest.refusal` is null or the reason in plain words (a string).
 *   A5 `kind` is a string (the plan names "builtin" and "registered"); other kinds are carried through.
 *   A6 `GET /api/playbooks/sources/routing` answers 404 until the routing source has been saved once; the dashboard shows that as "no playbook yet".
 *   A7 A mutating call may answer an empty or non-JSON 2xx: that is a success. A JSON answer that is a SourceView is used; any other answer is ignored. The view is always read again afterwards.
 *   A8 The routing document is saved through the existing structure endpoint, which starts the run on the server; the dashboard never PUTs markdown.
 *   A9 An ended run keeps the `question`, `unable` or `refusal` that explains it; `internal_task_id` is not shown (the run view finds the run by source id).
 *   A12 `previous.since_ms` is when the previous playbook took effect; `previous.summary` is optional plain words about it.
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
export type QuotedSentence = { line: number; text: string };
export type AuthoringQuestion = { question: string; sentences: QuotedSentence[] };
export type UnableSentence = { sentence: string; reason: string; line: number | null };
export type LatestRun = {
  run: string; status: RunStatus; question: AuthoringQuestion | null; unable: UnableSentence[]; refusal: string | null;
  internal_task_id: string | null; created_at_ms: number; finished_at_ms: number | null;
};
export type SourceView = { id: string; kind: string; binding: string; active: ActivePlaybook | null; latest: LatestRun | null };

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
  if (value === null || value === undefined) return null;
  ensure(isRecord(value) && PLAYBOOK_CHANGES.includes(value.change as PlaybookChange));
  return { change: value.change as PlaybookChange };
}
function playbookCase(value: unknown): PlaybookCase {
  ensure(isRecord(value) && text(value.name, 512) && text(value.situation) && text(value.result) && typeof value.passed === "boolean");
  return { name: value.name, situation: short(value.situation), result: short(value.result), passed: value.passed };
}
function previous(value: unknown): PreviousPlaybook | null {
  if (value === null || value === undefined) return null;
  ensure(isRecord(value) && instant(value.since_ms) && (value.summary === undefined || value.summary === null || text(value.summary)));
  return { since_ms: value.since_ms, summary: typeof value.summary === "string" ? short(value.summary) : null };
}
function active(value: unknown): ActivePlaybook | null {
  if (value === null || value === undefined) return null;
  ensure(isRecord(value) && text(value.artifact, 512) && instant(value.since_ms) && (value.can_rollback === undefined || typeof value.can_rollback === "boolean"));
  return { artifact: value.artifact, since_ms: value.since_ms, comparison: comparison(value.comparison), can_rollback: value.can_rollback === true,
    previous: previous(value.previous), cases: list(value.cases).map(playbookCase) };
}
function question(value: unknown): AuthoringQuestion | null {
  if (value === null || value === undefined) return null;
  ensure(isRecord(value) && text(value.question));
  const sentences = list(value.sentences).map((item): QuotedSentence => {
    ensure(isRecord(item) && count(item.line) && text(item.text));
    return { line: item.line, text: short(item.text) };
  });
  return { question: clip(value.question, PLAYBOOK_DISPLAY_LIMITS.reasonChars), sentences };
}
function unableSentence(value: unknown): UnableSentence {
  ensure(isRecord(value) && text(value.sentence) && text(value.reason) && (value.line === undefined || value.line === null || count(value.line)));
  return { sentence: short(value.sentence), reason: clip(value.reason, PLAYBOOK_DISPLAY_LIMITS.reasonChars), line: (value.line as number | null | undefined) ?? null };
}
function latest(value: unknown): LatestRun | null {
  if (value === null || value === undefined) return null;
  ensure(isRecord(value) && text(value.run, 128) && typeof value.status === "string" && count(value.created_at_ms));
  ensure(value.internal_task_id === null || value.internal_task_id === undefined || text(value.internal_task_id, 64));
  ensure(value.finished_at_ms === null || value.finished_at_ms === undefined || count(value.finished_at_ms));
  ensure(value.refusal === null || value.refusal === undefined || typeof value.refusal === "string");
  const unable = value.unable === null || value.unable === undefined ? [] : Array.isArray(value.unable) ? list(value.unable).map(unableSentence) : [unableSentence(value.unable)];
  return {
    run: value.run, status: RUN_STATUSES.includes(value.status as typeof RUN_STATUSES[number]) ? value.status as RunStatus : "unknown",
    question: question(value.question), unable, refusal: typeof value.refusal === "string" ? clip(value.refusal, PLAYBOOK_DISPLAY_LIMITS.reasonChars) : null,
    internal_task_id: (value.internal_task_id as string | null | undefined) ?? null, created_at_ms: value.created_at_ms, finished_at_ms: (value.finished_at_ms as number | null | undefined) ?? null,
  };
}
export function adaptSourceView(value: unknown): SourceView {
  ensure(isRecord(value) && text(value.id, 128) && text(value.kind, 64) && text(value.binding, 128));
  return { id: value.id, kind: value.kind, binding: value.binding, active: active(value.active), latest: latest(value.latest) };
}
export function adaptSourceList(value: unknown): SourceView[] {
  ensure(isRecord(value) && Array.isArray(value.items) && value.items.length <= 1024);
  return value.items.map(adaptSourceView);
}

const sourcePath = (id: string) => `${PLAYBOOK_SOURCES_PATH}/${encodeURIComponent(id)}`;
export async function listPlaybookSources(signal?: AbortSignal) { return adaptSourceList(await apiGet<unknown>(PLAYBOOK_SOURCES_PATH, signal)); }
export async function readPlaybookSource(id: string, signal?: AbortSignal) { return adaptSourceView(await apiGet<unknown>(sourcePath(id), signal)); }
/** A mutating call: an empty or non-JSON 2xx is a success (A7), and the refreshed view is returned when the server sent one. */
async function change(method: "POST" | "DELETE", path: string): Promise<SourceView | null> {
  let answer: unknown;
  try { answer = await apiSend<unknown>(method, path, undefined); } catch (error) {
    if (error instanceof ApiError && error.kind === "contract" && (error.status ?? 0) >= 200 && (error.status ?? 0) < 300) return null;
    throw error;
  }
  try { return adaptSourceView(answer); } catch { return null; }
}
/** Puts the previous playbook back in effect. The caller reads the source again whatever comes back. */
export const rollBackPlaybookSource = (id: string) => change("POST", `${sourcePath(id)}/rollback`);
/** Starts another authoring run from the saved document. */
export const authorPlaybookSourceAgain = (id: string) => change("POST", `${sourcePath(id)}/runs`);
/** Removes a registered source (never the routing source); its run history stays. */
export async function deletePlaybookSource(id: string): Promise<void> { await change("DELETE", sourcePath(id)); }
