/** Explicit proposed mock fixtures; imported only by the mock harness. */
import { http, HttpResponse } from "msw";
import { decisionDetail, decisionId, decisionPage } from "../test/decisions";
export function decisionHandlers() {
  return [
    http.get("/api/reviews/decisions", ({ request }) => {
      const query = new URL(request.url).searchParams;
      const empty = query.get("state") === "closed" || (query.has("project_id") && query.get("project_id") !== decisionId(3));
      return HttpResponse.json({ ...decisionPage(), items: empty ? [] : decisionPage().items });
    }),
    http.get("/api/reviews/decisions/:id", ({ params }) => params.id === decisionId(1) ? HttpResponse.json(decisionDetail()) : HttpResponse.json({ code: "not_found" }, { status: 404 })),
  ];
}
