import { http, HttpResponse } from "msw";
import { DOCUMENT_PATHS, EXECUTION_LIMIT_KEYS, FALLBACK_REASONS, type DocumentKind, type ProfileLimits, type Problem, type SelectionDefaults } from "../api/roleSettings";
import { HARNESS_PROVIDER, HARNESS_REASONING, isDocumentId, isToken } from "../features/settings/profileMarkdown";

/**
 * Labelled fixtures for the role and profile Settings routes. The reader below follows the server's document grammar
 * (aq-server `crates/aq-profiles/README.md`) closely enough for the pages to be exercised; the server is the authority.
 */
type Stored = { kind: DocumentKind; id: string; markdown: string; revision: number; updated_at_ms: number };
type State = { revision: number; documents: Stored[]; defaults: SelectionDefaults; defaultsRevision: number; limits: ProfileLimits; limitsRevision: number };
type Fields = Record<string, unknown>;
class Refusal extends Error { constructor(readonly line: number, message: string) { super(message); } }
const refuse = (line: number, message: string): never => { throw new Refusal(line, message); };

const LABELS: Record<DocumentKind, string> = { role: "role", intelligence: "intelligence profile", execution: "execution profile" };
const KEYS: Record<DocumentKind, string[]> = {
  role: ["id", "name", "description", "execution", "operations", "enabled"],
  intelligence: ["id", "name", "description"],
  execution: ["id", "name", "description", "harnesses", "environment", "confinement"],
};
const HEADINGS: Record<DocumentKind, string[]> = { role: ["Role", "Rules"], intelligence: ["Candidates", "Selection"], execution: ["Credentials", "Limits"] };
const OPERATIONS = ["task.read", "task.create_subtask", "task.edit", "comment.read", "comment.write", "knowledge.read", "knowledge.author", "question.ask", "question.read", "wait.register", "wait.read", "wait.ack", "message.send", "message.read", "message.ack", "result.read", "source.write"];
const CONFINEMENTS = ["container", "container-permitted", "native", "native-required"];
const SELECTION_KEYS = ["max_attempts", "fallback_on", "max_lineage_elapsed_ms", "observation_max_age_ms", "allow_unknown_availability", "unknown_cost", "require_complete_accounting", "require_hard_cost_enforcement", "max_cost_microunits", "currency"];

type Entries = Map<string, { line: number; value: string }>;
function entry(entries: Entries, line: number, text: string, allowed: string[] | null, place: string) {
  const at = text.indexOf(":");
  if (at < 0) refuse(line, `expected \`key: value\` in ${place}, found \`${text}\``);
  const key = text.slice(0, at).trim();
  if (allowed && !allowed.includes(key)) refuse(line, `unknown key \`${key}\` in ${place}`);
  if (entries.has(key)) refuse(line, `duplicate key \`${key}\` in ${place}`);
  entries.set(key, { line, value: text.slice(at + 1).trim() });
}
function split(kind: DocumentKind, source: string) {
  const lines = source.split("\n").map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
  if (lines[0]?.trimEnd() !== "---") refuse(1, "a document starts with a `---` line");
  const front: Entries = new Map();
  let at = 1;
  for (;; at++) {
    if (at >= lines.length) refuse(0, "frontmatter is not closed by a `---` line");
    if (lines[at]!.trimEnd() === "---") break;
    if (lines[at]!.trim()) entry(front, at + 1, lines[at]!, KEYS[kind], "frontmatter");
  }
  const sections = new Map<string, { line: number; lines: { line: number; text: string }[] }>();
  let current: string | null = null, fenced = false;
  for (at++; at < lines.length; at++) {
    const text = lines[at]!;
    if (/^\s*(```|~~~)/.test(text)) fenced = !fenced;
    if (!fenced && (text.startsWith("## ") || text.trimEnd() === "##")) {
      const title = text.slice(2).trim();
      if (!HEADINGS[kind].includes(title)) refuse(at + 1, `unknown heading \`## ${title}\`; this document takes ${HEADINGS[kind].map(h => `\`## ${h}\``).join(" and ")}`);
      if (sections.has(title)) refuse(at + 1, `duplicate heading \`## ${title}\``);
      sections.set(title, { line: at + 1, lines: [] }); current = title;
    } else if (current) sections.get(current)!.lines.push({ line: at + 1, text });
    else if (text.trim()) refuse(at + 1, `text before the first heading: \`${text}\``);
  }
  return { front, sections };
}
const required = (entries: Entries, key: string, place = "frontmatter") => entries.get(key) ?? refuse(0, `${place} has no \`${key}\``);
function words(line: number, key: string, value: string): string {
  if (!value) refuse(line, `\`${key}\` is empty`);
  if (value.startsWith("\"")) { try { return JSON.parse(value) as string; } catch { refuse(line, `\`${key}\` has malformed quoted text`); } }
  if (value.startsWith("[")) refuse(line, `\`${key}\` expects text, not a list; quote text that starts with \`[\``);
  return value;
}
function list(line: number, key: string, value: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) refuse(line, `\`${key}\` expects a list such as \`[a, b]\``);
  const inner = value.slice(1, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map(item => isToken(item.trim()) ? item.trim() : refuse(line, `\`${key}\` has a malformed list item \`${item.trim()}\``));
}
const flag = (line: number, key: string, value: string) => value === "true" ? true : value === "false" ? false : refuse(line, `\`${key}\` expects \`true\` or \`false\``);
const number = (line: number, key: string, value: string) => /^\d+$/.test(value) ? Number(value) : refuse(line, `\`${key}\` expects a whole number`);
function items(section: { line: number; lines: { line: number; text: string }[] }, heading: string, allowed: string[] | null): Entries {
  const out: Entries = new Map();
  for (const { line, text } of section.lines) {
    if (!text.trim()) continue;
    if (!text.trimStart().startsWith("- ")) refuse(line, `\`## ${heading}\` expects \`- key: value\` items, found \`${text}\``);
    entry(out, line, text.trimStart().slice(2), allowed, `\`## ${heading}\``);
  }
  return out;
}
const prose = (section: { lines: { text: string }[] } | undefined) => (section?.lines.map(l => l.text).join("\n") ?? "").trim();
function cells(text: string) { const t = text.trim(); return t.length >= 2 && t.startsWith("|") && t.endsWith("|") ? t.slice(1, -1).split("|").map(c => c.trim()) : null; }

/** The fields the server would answer for one document. Throws a `Refusal` naming the line when it does not parse. */
function parse(kind: DocumentKind, markdown: string): Fields {
  const { front, sections } = split(kind, markdown);
  const of = (key: string) => { const e = required(front, key); return words(e.line, key, e.value); };
  const description = front.get("description");
  const identity = { id: of("id"), name: of("name"), description: description ? words(description.line, "description", description.value) : "" };
  if (!isDocumentId(identity.id)) refuse(required(front, "id").line, "`id` is a lowercase letter followed by lowercase letters, digits or `-`");
  if (kind === "role") {
    const operations = required(front, "operations"), enabled = front.get("enabled"), role = prose(sections.get("Role"));
    if (!sections.has("Role") || !role) refuse(sections.get("Role")?.line ?? 0, "`## Role` is required and cannot be empty");
    return { ...identity, execution: of("execution"), operations: list(operations.line, "operations", operations.value), enabled: enabled ? flag(enabled.line, "enabled", enabled.value) : true, role_md: role, rules_md: prose(sections.get("Rules")) };
  }
  if (kind === "intelligence") {
    const table = sections.get("Candidates") ?? refuse(0, "the document has no `## Candidates`");
    const rows = table.lines.filter(l => l.text.trim());
    if (cells(rows[0]?.text ?? "")?.join("|") !== "provider|model|reasoning|harnesses") refuse(table.line, "`## Candidates` expects a table that starts with `| provider | model | reasoning | harnesses |`");
    const rule = cells(rows[1]?.text ?? "");
    if (rule?.length !== 4 || !rule.every(c => /^:?-+:?$/.test(c))) refuse(table.line, "`## Candidates` expects `|---|---|---|---|` under the table header");
    const candidates = rows.slice(2).map(({ line, text }) => {
      const row = cells(text);
      if (row?.length !== 4) return refuse(line, `a candidate row has four cells, as \`| provider | model | reasoning | harnesses |\`; found \`${text}\``);
      ["provider", "model", "reasoning"].forEach((column, i) => { if (!isToken(row[i]!)) refuse(line, `candidate \`${column}\` is malformed: \`${row[i]}\``); });
      return { provider: row[0]!, model: row[1]!, reasoning: row[2]!, harnesses: list(line, "harnesses", `[${row[3]}]`) };
    });
    const selection: Fields = {};
    const stated = sections.get("Selection");
    for (const [key, { line, value }] of stated ? items(stated, "Selection", SELECTION_KEYS) : []) {
      selection[key] = key === "fallback_on" ? list(line, key, value) : key === "unknown_cost" ? value : key === "currency" ? (value === "none" ? null : words(line, key, value))
        : key === "max_cost_microunits" ? (value === "none" ? null : number(line, key, value)) : key.startsWith("allow_") || key.startsWith("require_") ? flag(line, key, value) : number(line, key, value);
    }
    return { ...identity, candidates, ...(Object.keys(selection).length ? { selection } : {}) };
  }
  const harnesses = required(front, "harnesses"), confinement = of("confinement");
  if (!CONFINEMENTS.includes(confinement)) refuse(required(front, "confinement").line, `\`confinement\` has an unknown value \`${confinement}\``);
  const credentials: Record<string, string> = {};
  for (const [harness, { line, value }] of items(sections.get("Credentials") ?? refuse(0, "the document has no `## Credentials`"), "Credentials", null)) credentials[harness] = words(line, harness, value);
  const stated = items(sections.get("Limits") ?? refuse(0, "the document has no `## Limits`"), "Limits", [...EXECUTION_LIMIT_KEYS]);
  const limits = Object.fromEntries(EXECUTION_LIMIT_KEYS.map(key => { const e = required(stated, key, "`## Limits`"); return [key, number(e.line, key, e.value)]; }));
  return { ...identity, harnesses: list(harnesses.line, "harnesses", harnesses.value), environment: of("environment"), confinement, credentials, limits };
}
function read(kind: DocumentKind, markdown: string): { fields: Fields; problem: null } | { fields: null; problem: string } {
  try { return { fields: parse(kind, markdown), problem: null }; } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { fields: null, problem: error.line ? `line ${error.line}: ${error.message}` : error.message };
  }
}
/** Every problem of the whole set, as the server reports them. */
function validate(state: State): Problem[] {
  const problems: Problem[] = [];
  const parsed = state.documents.flatMap(document => {
    try { return [{ document, fields: parse(document.kind, document.markdown) }]; } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      problems.push({ document: `${LABELS[document.kind]} document \`${document.id}\``, field: error.line ? `line ${error.line}` : "", message: error.message });
      return [];
    }
  });
  const ids = (kind: DocumentKind) => parsed.filter(p => p.document.kind === kind).map(p => p.fields.id);
  for (const { document, fields } of parsed) {
    const say = (field: string, message: string) => problems.push({ document: `${LABELS[document.kind]} \`${String(fields.id)}\``, field, message });
    if (document.kind === "role") {
      if (!ids("execution").includes(fields.execution)) say("execution", `no execution profile \`${String(fields.execution)}\` exists`);
      for (const operation of fields.operations as string[]) if (!OPERATIONS.includes(operation)) say("operations", `\`${operation}\` is not an AQ operation a role can hold`);
    } else if (document.kind === "intelligence") {
      const seen = new Set<string>();
      for (const c of fields.candidates as { provider: string; model: string; reasoning: string; harnesses: string[] }[]) {
        const id = `${c.provider}:${c.model}:${c.reasoning}`;
        if (seen.has(id)) say("candidates", `\`${id}\` is listed twice`);
        seen.add(id);
        if (!c.harnesses.length) say("candidates", `\`${id}\` names no harness`);
        for (const harness of c.harnesses) {
          if (!HARNESS_REASONING[harness]) say("candidates", `\`${harness}\` is not a harness`);
          else if (!HARNESS_REASONING[harness].includes(c.reasoning)) say("candidates", `the \`${harness}\` harness does not accept reasoning \`${c.reasoning}\``);
          else if (HARNESS_PROVIDER[harness] && HARNESS_PROVIDER[harness] !== c.provider) say("candidates", `the \`${harness}\` harness takes provider \`${HARNESS_PROVIDER[harness]}\`, not \`${c.provider}\``);
        }
      }
      if (!(fields.candidates as unknown[]).length) say("candidates", "a profile needs at least one candidate");
    } else {
      const harnesses = fields.harnesses as string[], credentials = Object.keys(fields.credentials as object);
      for (const harness of harnesses) if (!credentials.includes(harness)) say("credentials", `no credential profile is given for \`${harness}\``);
      for (const harness of credentials) if (!harnesses.includes(harness)) say("credentials", `\`${harness}\` is not one of this profile's harnesses`);
    }
  }
  const roles = parsed.filter(p => p.document.kind === "role");
  if (roles.length > 0 && roles.every(p => p.fields.enabled === false)) problems.push({ document: "roles", field: "", message: "at least one role must be enabled" });
  const d = state.defaults;
  if (d.max_attempts < 1 || d.max_attempts > 32 || d.observation_max_age_ms < 1000 || d.observation_max_age_ms > 3_600_000 || d.max_lineage_elapsed_ms < 1 || d.max_lineage_elapsed_ms > 604_800_000) problems.push({ document: "selection defaults", field: "", message: "selection policy bounds" });
  if ((d.max_cost_microunits === null) !== (d.currency === null)) problems.push({ document: "selection defaults", field: "", message: "selection cost basis" });
  return problems;
}

const role = (id: string, name: string, description: string, operations: string) =>
  `---\nid: ${id}\nname: ${name}\ndescription: ${description}\nexecution: fixture-sandbox\noperations: [${operations}]\nenabled: true\n---\n## Role\nFixture: you do the work your task describes, in the workspace you are given.\n\n## Rules\n- Fixture: change only what the task asks for.\n- Fixture: report the exact commands you ran and their outcomes.\n`;
const level = (id: string, name: string, rows: string[]) =>
  `---\nid: ${id}\nname: ${name}\ndescription: Labelled fixture level\n---\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n${rows.join("\n")}\n`;
const FIXTURE_DOCUMENTS: [DocumentKind, string, string][] = [
  ["role", "developer", role("developer", "Fixture developer", "Fixture: makes the change a task asks for and reports evidence.", "task.read, knowledge.read, source.write")],
  ["role", "reviewer", role("reviewer", "Fixture reviewer", "Fixture: reviews a change against its task and gives a verdict.", "task.read, knowledge.read")],
  ["intelligence", "standard-low", level("standard-low", "Fixture standard, low", ["| fixture-provider | fixture-model | low | opencode |"])],
  ["intelligence", "standard-high", level("standard-high", "Fixture standard, high", ["| fixture-provider | fixture-model | high | opencode |", "| anthropic | fixture-model-large | high | claude |"])],
  ["execution", "fixture-sandbox", "---\nid: fixture-sandbox\nname: Fixture sandbox\ndescription: Fixture: a node-owned container, 15 minutes per attempt.\nharnesses: [claude, codex, opencode]\nenvironment: fixture-environment\nconfinement: container\n---\n## Credentials\n- claude: fixture-claude-credential\n- codex: fixture-codex-credential\n- opencode: fixture-opencode-credential\n\n## Limits\n- wall_time_ms: 900000\n- memory_bytes: 4294967296\n- cpu_millis: 2000\n- process_limit: 512\n- startup_context_bytes: 65536\n- max_output_tokens: 32000\n"],
];
/** The level ids the fixture catalog holds at first, for the other fixture handlers that name a level. */
export const FIXTURE_LEVELS = FIXTURE_DOCUMENTS.filter(([kind]) => kind === "intelligence").map(([, id]) => id);
const FIXTURE_AT = Date.UTC(2026, 10, 12, 9, 0, 0);
const initial = (): State => ({
  revision: 1, documents: FIXTURE_DOCUMENTS.map(([kind, id, markdown]) => ({ kind, id, markdown, revision: 1, updated_at_ms: FIXTURE_AT })),
  defaults: { max_attempts: 2, fallback_on: [...FALLBACK_REASONS], max_lineage_elapsed_ms: 3_600_000, observation_max_age_ms: 30_000, allow_unknown_availability: false, unknown_cost: "allow_bounded", require_complete_accounting: false, require_hard_cost_enforcement: false, max_cost_microunits: null, currency: null },
  defaultsRevision: 0,
  limits: { documents: { max_document_bytes: 65_536, max_set_bytes: 1_048_576, max_documents_per_kind: 128, max_name_bytes: 128, max_description_bytes: 2000 }, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 },
  limitsRevision: 0,
});
/** A stand-in for the snapshot digest: 64 hex characters that change with the content. */
function digestOf(state: State): string {
  const content = JSON.stringify([state.documents.map(d => [d.kind, d.id, d.markdown]), state.defaults]);
  let a = 0x811c9dc5, b = 0x1b873593;
  for (let i = 0; i < content.length; i++) { a = Math.imul(a ^ content.charCodeAt(i), 0x01000193); b = Math.imul(b + content.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13); }
  return Array.from({ length: 8 }, (_, i) => ((i % 2 ? b : a) + Math.imul(i + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, "0")).join("");
}

/** Isolated fixture state survives a page reload in the same browser tab. */
export function roleSettingsHandlers() {
  const key = "aq-mock-role-settings";
  let state: State = (() => { try { return JSON.parse(sessionStorage.getItem(key) || "null") || initial(); } catch { return initial(); } })();
  const operations = new Map<string, { request: string; receipt: { revision: string; digest: string } }>();
  const fail = (status: number, error: string, message: string) => HttpResponse.json({ error, message }, { status });
  const shown = (document: Stored) => ({ kind: document.kind, id: document.id, revision: String(document.revision), updated_at_ms: document.updated_at_ms, markdown: document.markdown, ...read(document.kind, document.markdown) });
  /** One change, as the server applies it: replay, fence, whole-set validation, then the new revision and digest. */
  function apply(request: unknown, fence: { expected_revision?: unknown; operation_id?: unknown }, current: number, change: (next: State, revision: number) => Problem[]) {
    if (typeof fence.operation_id !== "string" || typeof fence.expected_revision !== "string" || !/^\d+$/.test(fence.expected_revision)) return fail(400, "bad_request", "Invalid settings request");
    const serialized = JSON.stringify(request), earlier = operations.get(fence.operation_id);
    if (earlier) return earlier.request === serialized ? HttpResponse.json(earlier.receipt) : fail(409, "conflict", "Operation ID already used for another request");
    if (Number(fence.expected_revision) !== current) return fail(409, "conflict", "This changed since it was read; reload before saving");
    const next: State = structuredClone(state), revision = state.revision + 1;
    const problems = [...change(next, revision), ...validate(next)];
    if (problems.length) return HttpResponse.json({ error: "bad_request", message: `The documents are not valid: ${problems.map(p => p.field ? `${p.document}: ${p.field}: ${p.message}` : `${p.document}: ${p.message}`).join("; ")}`, problems }, { status: 400 });
    state = { ...next, revision };
    sessionStorage.setItem(key, JSON.stringify(state));
    const receipt = { revision: String(revision), digest: digestOf(state) };
    operations.set(fence.operation_id, { request: serialized, receipt });
    return HttpResponse.json(receipt);
  }
  return (Object.keys(DOCUMENT_PATHS) as DocumentKind[]).flatMap(kind => {
    const path = `/api/settings/${DOCUMENT_PATHS[kind]}`;
    const find = (id: unknown) => state.documents.find(d => d.kind === kind && d.id === id);
    return [
      http.get(path, () => HttpResponse.json({ revision: String(state.revision), active_digest: digestOf(state), documents: state.documents.filter(d => d.kind === kind).sort((a, b) => a.id < b.id ? -1 : 1).map(shown) })),
      http.get(`${path}/:id`, ({ params }) => { const document = find(params.id); return document ? HttpResponse.json(shown(document)) : fail(404, "not_found", `No ${LABELS[kind]} \`${String(params.id)}\` exists`); }),
      http.put(`${path}/:id`, async ({ params, request }) => {
        const body = await request.json().catch(() => null) as { markdown?: unknown; expected_revision?: unknown; operation_id?: unknown } | null, id = String(params.id);
        if (!body || typeof body.markdown !== "string") return fail(400, "bad_request", "Invalid settings request");
        const markdown = body.markdown;
        return apply(["save", kind, id, body], body, find(id)?.revision ?? 0, (next, revision) => {
          const stated = read(kind, markdown).fields?.id;
          next.documents = [...next.documents.filter(d => !(d.kind === kind && d.id === id)), { kind, id, markdown, revision, updated_at_ms: Date.now() }];
          return stated !== undefined && stated !== id ? [{ document: `${LABELS[kind]} document \`${id}\``, field: "id", message: `is \`${String(stated)}\`; a document saved as \`${id}\` must have that id` }] : [];
        });
      }),
      http.delete(`${path}/:id`, ({ params, request }) => {
        const query = new URL(request.url).searchParams, id = String(params.id), document = find(id);
        const fence = { expected_revision: query.get("expected_revision") ?? undefined, operation_id: query.get("operation_id") ?? undefined };
        if (fence.expected_revision === undefined || fence.operation_id === undefined) return fail(400, "bad_request", "Give expected_revision and operation_id in the query");
        if (!document) return fail(404, "not_found", `No ${LABELS[kind]} \`${id}\` exists`);
        return apply(["delete", kind, id, fence], fence, document.revision, next => { next.documents = next.documents.filter(d => !(d.kind === kind && d.id === id)); return []; });
      }),
    ];
  }).concat([
    http.get("/api/settings/selection-defaults", () => HttpResponse.json({ revision: String(state.defaultsRevision), selection_defaults: state.defaults })),
    http.put("/api/settings/selection-defaults", async ({ request }) => {
      const body = await request.json().catch(() => null) as { selection_defaults?: SelectionDefaults; expected_revision?: unknown; operation_id?: unknown } | null;
      if (!body || typeof body.selection_defaults !== "object" || !body.selection_defaults) return fail(400, "bad_request", "Invalid settings request");
      const defaults = body.selection_defaults;
      return apply(["defaults", body], body, state.defaultsRevision, (next, revision) => { next.defaults = defaults; next.defaultsRevision = revision; return []; });
    }),
    http.get("/api/settings/profiles/limits", () => HttpResponse.json({ revision: String(state.limitsRevision), limits: state.limits })),
    http.put("/api/settings/profiles/limits", async ({ request }) => {
      const body = await request.json().catch(() => null) as { limits?: ProfileLimits; expected_revision?: unknown; operation_id?: unknown } | null;
      if (!body || typeof body.limits !== "object" || !body.limits) return fail(400, "bad_request", "Invalid settings request");
      const limits = body.limits;
      return apply(["limits", body], body, state.limitsRevision, (next, revision) => { next.limits = limits; next.limitsRevision = revision; return []; });
    }),
    // Labelled fixture suggestions, shaped as the server's discovery cache answers them.
    http.get("/api/settings/model-suggestions", () => HttpResponse.json({ harnesses: [
      { harness: "claude", models: [{ provider: "anthropic", model: "fixture-model-large", source: "Fixture discovery", observed_at: "2026-11-12T09:00:00Z" }, { provider: "anthropic", model: "fixture-model-small", source: null, observed_at: null }] },
      { harness: "codex", models: [{ provider: "openai", model: "fixture-codex-model", source: "Fixture discovery", observed_at: "2026-11-12T09:00:00Z" }] },
    ] })),
    http.get("/api/settings/profiles/snapshot", () => HttpResponse.json({ revision: String(state.revision), active_digest: digestOf(state) })),
  ]);
}
