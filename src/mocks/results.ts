import { http, HttpResponse } from "msw";
import valid from "../../contracts/pinned/results-feedback/v1/fixtures/valid.json";
import compat from "../../contracts/pinned/results-feedback/v1/fixtures/compatibility.json";
import action from "../../contracts/pinned/dashboard-actions/v1/fixtures/operation-confirmed.json";
import type { CommentProjection, Detail, FeedbackDraft } from "../api/wire/resultsFeedback";
import { MEDIA_MAX } from "../api/adapters/resultMedia";
import { mediaBinding } from "../api/adapters/resultsFeedback";

/**
 * Mock-only Results fixtures built from the pinned results-feedback contract.
 * Every summary and comment is labelled "Fixture"; nothing claims to be a real result.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (valid.find((f) => f.type === "Detail")!.value as unknown) as Detail;
const project = base.result.project_id;
/** A fixed anchor keeps fixture ages stable relative to the mock clock. */
const NOW_MS = Date.parse("2026-10-31T12:00:00.000Z");
const ARTIFACT = { artifact_id: id(40), digest: `sha256:${"d".repeat(64)}` };

function detail(n: number, summary: string, agoMs: number, unresolvedReview = false): Detail {
  const report = id(n), revision = n.toString(16).padStart(2, "0").repeat(32);
  return {
    result: { ...base.result, id: report, current_revision: revision },
    revision: { ...structuredClone(base.revision), report_id: report, revision, artifacts: [ARTIFACT], summary: `Fixture · ${summary}`, submitted_at_ms: NOW_MS - agoMs },
    assessment: { ...structuredClone(base.assessment), result_revision: revision, artifacts: [ARTIFACT], unresolved_review: unresolvedReview },
  };
}

/** Newest first, as the feed contract requires. */
export const FIXTURE_RESULTS: Detail[] = [
  detail(30, "Replay reconciliation now merges duplicate ledger entries", 10 * 60_000, true),
  detail(31, "Mobile navigation keeps focus after route change", 60 * 60_000),
  detail(32, "Capacity panel reports central disk usage", 150 * 60_000),
];

const fixtureComments = (d: Detail): CommentProjection[] => [
  { id: id(50), position: "1", revision: "1", thread_id: id(51), thread_version: "1", thread_state: "open", author_id: id(52),
    body: "Fixture comment: the summary should name which ledger entries were merged.", created_at_ms: d.revision.submitted_at_ms + 60_000, anchor: { kind: "result" }, history: [] },
  { id: id(53), position: "2", revision: "1", thread_id: id(54), thread_version: "1", thread_state: "open", author_id: id(55),
    body: "Fixture comment: the caption wraps over the image in this region.", created_at_ms: d.revision.submitted_at_ms + 120_000,
    anchor: { kind: "image_region", ...ARTIFACT, x: 0.1, y: 0.2, width: 0.4, height: 0.25 }, history: [] },
];

/** Fixture server time is the same anchor, so card ages read 10m / 1h / 2h. */
const envelope = <T,>(data: T, scoped = false) => ({ ...compat.read, server_time: new Date(NOW_MS).toISOString(), data, scope: scoped ? { kind: "project" as const, project_id: project } : { kind: "all_authorized" as const } });
const operation = (operationId: string) => ({
  ...action,
  scope: { kind: "project", project_id: project },
  data: { ...action.data, operation_id: operationId, disposition: "confirmed", scope: { kind: "project", project_id: project } },
});
const find = (report: string, revision: string) => FIXTURE_RESULTS.find((d) => d.result.id === report && d.revision.revision === revision);
const notFound = () => HttpResponse.json({ request_id: "mock", code: "not_found", message: "This item does not exist or is not available to you.", retryable: false }, { status: 404 });

/** Results feed, exact revision, comments, writes and (optionally) an empty media listing. */
export function resultsHandlers({ media }: { media: boolean }) {
  const posted = new Map<string, CommentProjection[]>();
  const feedback = new Map<string, FeedbackDraft>();
  return [
    http.get("/api/v1/results", () => HttpResponse.json(envelope({ items: FIXTURE_RESULTS, next_cursor: null }))),
    http.get("/api/v1/results/:id/revisions/:revision", ({ params }) => {
      const d = find(String(params.id), String(params.revision));
      return d ? HttpResponse.json(envelope(d, true)) : notFound();
    }),
    http.get("/api/v1/results/:id/revisions/:revision/comments", ({ params }) => {
      const d = find(String(params.id), String(params.revision));
      if (!d) return notFound();
      return HttpResponse.json(envelope({ items: [...fixtureComments(d), ...(posted.get(d.result.id) ?? [])], next_cursor: null }, true));
    }),
    http.post("/api/v1/results/:id/revisions/:revision/comments", async ({ params, request }) => {
      const d = find(String(params.id), String(params.revision));
      if (!d) return notFound();
      const body = (await request.json()) as { operation_id: string; body: string; anchor: CommentProjection["anchor"] };
      const list = posted.get(d.result.id) ?? [];
      const n = 60 + list.length * 3;
      list.push({ id: id(n), position: String(3 + list.length), revision: "1", thread_id: id(n + 1), thread_version: "1", thread_state: "open", author_id: id(n + 2),
        body: body.body, created_at_ms: Date.now(), anchor: body.anchor, history: [] });
      posted.set(d.result.id, list);
      return HttpResponse.json(operation(body.operation_id));
    }),
    http.put("/api/v1/results/:id/follow", async ({ request }) => HttpResponse.json(operation(((await request.json()) as { operation_id: string }).operation_id))),
    http.post("/api/v1/feedback-tasks", async ({ request }) => {
      const body = (await request.json()) as FeedbackDraft;
      feedback.set(body.operation_id, body);
      return HttpResponse.json(operation(body.operation_id));
    }),
    http.post("/api/v1/feedback-links", async ({ request }) => HttpResponse.json(operation(((await request.json()) as { operation_id: string }).operation_id))),
    http.get("/api/v1/feedback-tasks/:operation", ({ params }) => {
      const op = String(params.operation), origin = feedback.get(op);
      if (!origin) return notFound();
      return HttpResponse.json(envelope({ creation_disposition: "confirmed", link_confirmed: true, operation_id: op, origin, result_id: origin.result_id, revision: origin.revision, task_id: op }, true));
    }),
    ...(media
      ? [http.get("/api/human/results/:id/revisions/:revision/media", ({ params }) => {
          const d = find(String(params.id), String(params.revision));
          if (!d) return notFound();
          // Media is enabled but no fixture image is retained: render the honest empty listing.
          return HttpResponse.json({ contract: "human-result-media-1", server_time_ms: Date.now(), binding: mediaBinding(d), limits: { ...MEDIA_MAX }, items: [] });
        })]
      : []),
  ];
}
