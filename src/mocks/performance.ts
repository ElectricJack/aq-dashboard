import { http, HttpResponse } from "msw";
import examples from "../../contracts/live/performance/examples.json";
import { PERFORMANCE, PERFORMANCE_PATH } from "../api/adapters/performance";
import type { Scope } from "../api/wire/proposed";
import { envelope } from "./handlers";
import { fixtureProject, FIXTURE_IDS } from "./humanGraphData";

export function performanceCapabilities(name: string | null | undefined) {
  if (name === "performance-old") return [];
  return [{ name: PERFORMANCE, version: "1", enabled: true }];
}

export function performanceHandlers(name: string | null | undefined) {
  const handlers = ["summary", "machines", "holds", "tasks/:taskId"] as const;
  return handlers.map(path => http.get(`${PERFORMANCE_PATH}/${path}`, ({ params, request }) => {
    const query = new URL(request.url).searchParams;
    const projectId = query.get("project_id");
    if (name === "performance-outage") return new HttpResponse(null, { status: 503 });
    if (name === "performance-forbidden" || (projectId && projectId !== fixtureProject.id)) {
      return HttpResponse.json(examples.forbidden, { status: 403 });
    }
    const scope: Scope = projectId ? { kind: "project", project_id: projectId } : { kind: "all_authorized" };
    const report = path.split("/")[0];
    let data: object;
    if (report === "tasks" && params.taskId === FIXTURE_IDS.lease) data = examples.populated.task;
    else if (report === "summary") {
      data = name === "empty" ? examples.empty.summary : name === "partial" ? examples.partial.summary : examples.populated.summary;
    } else if (report === "machines" && !projectId) {
      data = name === "empty" ? examples.empty.machines : name === "stale" ? examples.stale.machines : examples.populated.machines;
    } else if (report === "holds") {
      data = name === "empty" ? examples.empty.holds :
        query.get("cursor") === "fixture-next-hold" ? examples.populated.holds_page_two : examples.populated.holds;
    } else return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(envelope(data, scope));
  }));
}
