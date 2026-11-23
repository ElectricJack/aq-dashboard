import {useRef,useState} from "react";
import {useSearchParams} from "react-router";
import {useGraphList} from "../../api/humanGraphReads";
import {mergeGraphPages,validGraphId,type GraphNode} from "../../api/adapters/humanGraph";
import {useMediaQuery} from "../../components/useMediaQuery";
import {PHONE_QUERY} from "../work/graph/HumanTaskGraph";
import {useNodeFocus} from "../work/useSelectionFocus";
type Lifecycle = "active"|"retired"|"deleted";
export const lifecycleOf=(n:GraphNode):Lifecycle=>n.deleted?"deleted":n.retired?"retired":"active";
export const LIFECYCLE_LABEL:Record<Lifecycle,string>={active:"Active",retired:"Retired",deleted:"Deleted"};
const LIFECYCLES=["active","retired","deleted","all"],VERIFICATIONS=["verified","unverified","disputed"],SORTS=["updated","title"];
/** Knowledge list filters live in the URL (spec 0002 §3); defaults are omitted and unknown values fall back to them. */
function knowledgeFilters(params:URLSearchParams) {
  const pick=(key:string,allowed:string[],fallback:string)=>{const v=params.get(key);return v&&allowed.includes(v)?v:fallback;};
  const category=params.get("category")??"";
  return {category:category.length<=64?category:"",lifecycle:pick("lifecycle",LIFECYCLES,"active"),verification:pick("verification",VERIFICATIONS,""),sort:pick("sort",SORTS,"updated")};
}
const updated=(n:GraphNode)=>Date.parse(n.updated_at);

function matchesState(node:GraphNode,state:string) {return !state || node.task_state===state;}
function matchesRecord(node:GraphNode,{category,lifecycle,verification}:Pick<ReturnType<typeof knowledgeFilters>,"category"|"lifecycle"|"verification">) {
  if (category && node.content_type!==category) return false;
  if (lifecycle!=="all" && lifecycleOf(node)!==lifecycle) return false;
  return !verification || node.verification===verification;
}
function filterRecords(rows:GraphNode[], filters:ReturnType<typeof knowledgeFilters>&{knowledge:boolean;taskState:string}) {
  const {taskState,knowledge,category,lifecycle,verification,sort}=filters;
  const filtered=rows.filter(node=>matchesState(node,taskState)&&(!knowledge||matchesRecord(node,{category,lifecycle,verification})));
  if(knowledge)filtered.sort(sort==="title"?(a,b)=>a.title.localeCompare(b.title):(a,b)=>updated(b)-updated(a));
  return filtered;
}
type ReadState = "error"|"pending"|undefined;
function recordsTitle({kind,state,shown,total}:{kind:GraphNode["kind"];state:ReadState;shown:number;total:number}) {
  const label=kind==="task"?"Tasks":"Records";
  if(state==="error") return label+" unavailable";
  if(state==="pending")return label;
  if(kind==="knowledge" && shown!==total)return `${shown} of ${total} loaded ${total===1?"record":"records"}`;
  const noun=kind==="task"?"task":"record";
  return `${shown} ${noun}${shown===1?"":"s"} loaded`;
}
function emptyMessage(rows:GraphNode[],knowledge:boolean,q:string) {
 if(rows.length)return "No loaded records match these filters.";
 if(!knowledge)return "No records returned for this search.";
 return q?"No knowledge records match this search.":"No knowledge records in this project yet.";
}
export type NodeLocation={project:string;kind:GraphNode["kind"];id?:string};
function preserveRoot(params:URLSearchParams,id?:string) {
 if (id && !params.has("root")) params.set("root",id);
}
function useRecordFilters(id?:string){
  const [params,setParams]=useSearchParams();
  const [draft,setDraft]=useState(params.get("q")??"");const q=(params.get("q")??"").slice(0,256);
  const [taskState,setTaskState]=useState("");
  const {category,lifecycle,verification,sort}=knowledgeFilters(params);
  // Successive changes before a re-render build on each other (the router's functional update reads the last render).
  const latestParams=useRef(params);latestParams.current=params;
  const setFilter=(key:string,value:string,fallback:string)=>{const n=new URLSearchParams(latestParams.current);if(value&&value!==fallback)n.set(key,value);else n.delete(key);latestParams.current=n;setParams(n,{replace:true});};
  // Build on latestParams, not the router's functional update: that reads the last committed render and would drop a filter change still pending (e.g. lifecycle reset, then Enter in search).
  const update=(key:string,value:string)=>{const n=new URLSearchParams(latestParams.current);if(value)n.set(key,value);else n.delete(key);if(key==="view" && value==="graph") preserveRoot(n,id);latestParams.current=n;setParams(n);};
  return {params,q,draft,setDraft,taskState,setTaskState,category,lifecycle,verification,sort,setFilter,update};
}
function recordCategories(rows:GraphNode[],selected:string) {
  // Keep a deep-linked filter available while its records load.
  const categories = new Set(rows.map(node=>node.content_type).filter((value):value is string=>!!value));
  if (selected) categories.add(selected);
  return [...categories].sort();
}
function useLoadedRecords(project:string,kind:GraphNode["kind"],q:string) {
  const query=useGraphList(project,kind,q);let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const state:ReadState=query.isError||mergeError?"error":!query.data?"pending":undefined;
  return {query,rows,mergeError,state,projectName:query.data?.pages[0]?.project.name};
}
export function useNodeWorkspace({project,kind,id}:NodeLocation) {
  const filters=useRecordFilters(id);
  const {params,q,taskState,category,lifecycle,verification,sort}=filters;
  const {query,rows,mergeError,state,projectName}=useLoadedRecords(project,kind,q);
  const search=params.toString()?`?${params}`:"";const graph=kind === "task" && params.get("view")==="graph";const phone=useMediaQuery(PHONE_QUERY);
  const workspace=useNodeFocus({id,graph,phone},kind);
  const graphRoot=validGraphId(params.get("root"))?params.get("root")!:id;
  const knowledge=kind==="knowledge";
  const filtered=filterRecords(rows,{knowledge,taskState,category,lifecycle,verification,sort});
  const categories=recordCategories(rows,category);
  const listTitle=recordsTitle({kind,state,shown:filtered.length,total:rows.length});
  const emptyText=emptyMessage(rows,knowledge,q);
  return {...filters,query,mergeError,search,graph,phone,workspace,graphRoot,knowledge,filtered,categories,projectName,listTitle,emptyText,state};
}
export type NodeWorkspace=ReturnType<typeof useNodeWorkspace>;
