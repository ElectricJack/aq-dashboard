import {http,HttpResponse} from "msw";
import {FIXTURE_RUNS,PLAYBOOK_FIXTURE_NAMESPACE,RECEIPTS,EFFECTS,ADMISSIONS,NOW,inspectionPage,definitionGraph,catalogPage,catalogChanged,type CatalogKind} from "./playbookFixtureData";
export {PLAYBOOK_FIXTURE_NAMESPACE,WAITING_RUN_ID,CHILD_RUN_ID,FIXTURE_RUNS} from "./playbookFixtureData";
export {playbookActionHandlers} from "./playbookFixtureActions";
/**
 * Mock-mode playbook fixtures for design reference 06 (Playbooks).
 * Shapes follow `playbooks-inspection-1` (src/test/playbooks.ts) and the
 * current catalog examples (contracts/live/current-playbook-catalog). The
 * namespace name labels every row as fixture data; nothing here is live AQ data.
 */
export const PLAYBOOK_CAPABILITIES = [
  "playbooks.inspect",
  "playbooks.catalog.read",
  "playbooks.definition-graph.read",
  // PROPOSED playbook action capabilities (dashboard-actions-1 kinds); not offered by aq-server main yet.
  "playbooks.runs.start",
  "playbooks.runs.cancel",
  "playbooks.activations.activate",
  "playbooks.activations.rollback",
] as const;
export type PlaybookMode = "ok" | "empty" | "failed" | "unavailable" | "step-inspection";

/** `?scenario=` switches for playbook reads: empty rows, failed reads, or an unconfigured runtime. */
export function playbookMode(name: string | null | undefined): PlaybookMode {
  if (name === "playbook-step-inspection") return "step-inspection";
  if (name === "empty") return "empty";
  if (name === "failed" || name === "reads-failed") return "failed";
  if (name === "unavailable") return "unavailable";
  return "ok";
}

export function playbookCapabilities(mode: PlaybookMode) {
  return PLAYBOOK_CAPABILITIES.map((name) =>
    mode === "unavailable"
      ? { name, version: "1", enabled: false, reason: "Fixture scenario: the playbook runtime is not configured" }
      : { name, version: "1", enabled: true },
  );
}

const failure = (status: number, code: string, message: string) =>
    HttpResponse.json({ request_id: "fixture", code, message, retryable: status >= 500 }, { status });
  /** Shared guards: scenario failure, then a project scope that is not the fixture namespace's project. */
function refuse(mode:PlaybookMode,url: URL) {
    if (mode === "failed") return failure(503, "read_model_unavailable", "Playbook inspection is temporarily unavailable.");
    if (mode === "unavailable") return failure(404, "not_found", "Playbook inspection is not configured.");
    const project = url.searchParams.get("project_id");
    if (project && project !== PLAYBOOK_FIXTURE_NAMESPACE.project_id) return failure(404, "not_found", "No playbook namespace is configured for this project.");
    return null;
}
const limitOf = (url: URL) => Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 25));

function runPage(mode:PlaybookMode,url:URL) {
 const runs=mode==="empty"?[]:FIXTURE_RUNS;
 const after=url.searchParams.get("after"),limit=limitOf(url);
 const rest=runs.filter(run=>!after||run.id>after),items=rest.slice(0,limit);
 return HttpResponse.json(inspectionPage(items,rest.length>limit?items.at(-1)!.id:null));
}
function runDetail(mode:PlaybookMode,id:string,url:URL){
 const found=mode==="empty"?undefined:FIXTURE_RUNS.find(run=>run.id===id);
 if(!found)return failure(404,"not_found","This run does not exist or is not available to you.");
 const after=url.searchParams.get("after");
 const receipts=(RECEIPTS[found.id]??[]).filter(row=>!after||BigInt(row.sequence)>BigInt(after));
 return HttpResponse.json({api_version:"playbooks-inspection-1",namespace:PLAYBOOK_FIXTURE_NAMESPACE,server_time_ms:NOW,observation_is_atomic:false,
   run:found,effects:inspectionPage(EFFECTS[found.id]??[]),receipts:inspectionPage(receipts)});
}
function readCatalog(mode:PlaybookMode,kind:CatalogKind,url:URL){
 if(catalogChanged(kind,url.searchParams))return failure(409,"catalog_changed","The catalog changed since it was observed.");
 return HttpResponse.json(catalogPage(kind,mode,url.searchParams));
}

export function playbookHandlers(mode: PlaybookMode) {
 const base="/api/playbooks/inspection";
 function read(request:Request,reply:(url:URL)=>Response) {
   const url=new URL(request.url);
   return refuse(mode,url)??reply(url);
 }
 return [
   http.get(`${base}/runs`, ({request})=>read(request,url=>runPage(mode,url))),
   http.get(`${base}/runs/:id`,({request,params})=>read(request,url=>runDetail(mode,String(params.id),url))),
   http.get(`${base}/admissions`,({request})=>read(request,()=>HttpResponse.json(inspectionPage(mode==="empty"?[]:ADMISSIONS)))),
   http.get(`${base}/definitions/:artifact/graph`,({request,params})=>read(request,()=>HttpResponse.json(definitionGraph(mode,String(params.artifact))))),
   http.get(`${base}/catalog/:kind`,({request,params})=>{
     const kind=params.kind;
     if(kind!=="definitions"&&kind!=="activations")return failure(404,"not_found","Unknown catalog.");
     return read(request,url=>readCatalog(mode,kind,url));
   }),
 ];
}
