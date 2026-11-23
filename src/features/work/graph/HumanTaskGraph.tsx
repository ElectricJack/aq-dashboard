import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { Link, useNavigate, type To } from "react-router";
import { ArrowLeft, X } from "lucide-react";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import type { EdgeCategory } from "../../../api/adapters/inspection";
import { Panel } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, type GraphLayout } from "./layout";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { nodeLabel, type GraphEdge, type GraphNode } from "../../../api/adapters/humanGraph";
import {TaskGraphCanvas} from "./TaskGraphCanvas";
export {TaskGraphCanvas,type GraphTask,type GraphRelation} from "./TaskGraphCanvas";
import styles from "./TaskGraph.module.css";

export const edgeCategory = (type: string): EdgeCategory =>
  type === "blocks" ? "dependency" : type === "parent-child" ? "hierarchy" : "informational";
/** Phone breakpoint (spec 0002 §9): the graph is a deliberate, dedicated view there. */
export const PHONE_QUERY = "(max-width: 767px)";

function withParams(search: string, change: (p: URLSearchParams) => void) { const p = new URLSearchParams(search); change(p); const value = p.toString(); return value ? `?${value}` : ""; }
/** The phone graph exit: the task list in the same scope and filters, without the graph state. */
export function graphListTarget(search: string): To { return { pathname: "/work", search: withParams(search, p => { p.delete("view"); p.delete("root"); }) }; }

function focusedElement(dialog: HTMLDialogElement | null) {
 const active=document.activeElement;
 return active instanceof HTMLElement && dialog?.contains(active) ? active : null;
}
/** Full-viewport phone graph view. A modal dialog keeps the shell (and bottom nav) inert and covered until Back. */
export function PhoneGraphView({ backTo, children }: { backTo: To; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), kept = useRef<HTMLElement | null>(null), navigate = useNavigate(), heading = useId();
  // showModal() moves focus to the first control (Back). When the dialog is reopened (StrictMode
  // re-runs effects), keep focus where the workspace put it inside the view, e.g. the restored node.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      if (kept.current && element.contains(kept.current)) kept.current.focus();
    }
    return () => {
      kept.current = focusedElement(element);
      if (element?.open) element.close();
    };
  }, []);
  return <dialog ref={dialog} className={styles.phoneView} aria-labelledby={heading} onCancel={e => { e.preventDefault(); void navigate(backTo); }}>
    <section className={styles.phoneRegion} aria-labelledby={heading}>
      <header className={styles.phoneHeader}><Link to={backTo} className={styles.phoneBack}><ArrowLeft size={18} aria-hidden />Back to list</Link><h2 id={heading}>Dependency graph</h2></header>
      {children}
    </section>
  </dialog>;
}

function relationPhrase(edge: GraphEdge, id: string) {
  const outgoing = edge.source === id;
  return edge.edge_type === "blocks" ? outgoing ? "Must finish before" : "Waits for" : edge.edge_type === "parent-child" ? outgoing ? "Contains" : "Part of" : edge.edge_type;
}
/** Bottom sheet for a tapped node: summary from the served neighborhood, plus a route to the full task. */
function TaskSheet({ node, edges, nodes, search, closeTo }: { node?: GraphNode; edges: GraphEdge[]; nodes: Map<string, GraphNode>; search: string; closeTo: To }) {
  const heading = useId();
  if (!node) return <section className={styles.sheet} aria-label="Selected task"><p className={styles.muted}>The selected task is outside this neighborhood.</p><Link className={styles.sheetClose} to={closeTo}><X size={18} aria-hidden />Close</Link></section>;
  const related = edges.filter(e => e.source === node.id || e.target === node.id);
  return <section className={styles.sheet} aria-labelledby={heading}>
    <div className={styles.sheetHead}><div><p className={styles.sheetEyebrow}>Selected task · {nodeLabel(node.task_state)}</p><h3 id={heading}>{node.title}</h3></div><Link className={styles.sheetClose} to={closeTo} aria-label="Close task summary"><X size={18} aria-hidden /></Link></div>
    {node.acceptance_criteria && <p className={styles.sheetText}>{node.acceptance_criteria}</p>}
    <Link className={styles.sheetOpen} to={{ pathname: `/work/${encodeURIComponent(node.id)}`, search: withParams(search, p => { p.delete("view"); p.delete("root"); }) }}>Open task</Link>
    {related.length ? <ul className={styles.sheetRelations}>{related.slice(0, 3).map(e => <li key={e.id}>{relationPhrase(e, node.id)} · {nodes.get(e.source === node.id ? e.target : e.source)?.title}</li>)}{related.length > 3 && <li>+{related.length - 3} more under Recorded relationships</li>}</ul> : <p className={styles.muted}>No relationships among the shown tasks.</p>}
  </section>;
}

type Neighborhood = NonNullable<ReturnType<typeof useGraphNeighborhood>["data"]>["data"];
function neighborhoodLayout(graph: Neighborhood, root: string) {
  const nodes=graph.nodes.map(node=>({id:node.id,revision:node.content_revision,title:node.title,state:"active" as const,readiness:{state:"unsupported" as const,explanation:"Readiness not evaluated"}}));
  const edges=graph.edges.map(edge=>({from:edge.source,to:edge.target,type:edge.edge_type,category:edgeCategory(edge.edge_type)}));
  return layoutGraph({rootId:root,nodes,edges,omitted:{nodes:0,edges:0,reason:null}});
}
function taskTarget(route: {id:string;search:string;root?:string}): To {
  const {id,search,root}=route;
  return {pathname:`/work/${encodeURIComponent(id)}`,search:withParams(search, params => {
    if (root !== undefined) {params.set("view","graph");params.set("root",root);}
    else {params.delete("view");params.delete("root");}
  })};
}
type GraphRoute = {project:string;root:string;selected?:string;search:string};
function expandTarget(layout: GraphLayout, route: GraphRoute) {
  const {selected,root,search}=route;
  if (!selected || selected === root) return;
  if (layout.clientOmitted > 0) return taskTarget({id:selected,search,root:selected});
}
function GraphFrame({phone, search, children}: {phone:boolean;search:string;children:ReactNode}) {
  if (phone) return <PhoneGraphView backTo={graphListTarget(search)}>{children}</PhoneGraphView>;
  return <Panel title="Dependency graph">{children}</Panel>;
}
function SelectedTaskSheet({graph, route}: {graph: Neighborhood;route:GraphRoute}) {
  if (!route.selected) return null;
  const nodes=new Map(graph.nodes.map(node=>[node.id,node]));
  const closeTo={pathname:"/work",search:withParams(route.search,p=>{p.set("view","graph");p.set("root",route.root);})};
  return <TaskSheet node={nodes.get(route.selected)} edges={graph.edges} nodes={nodes} search={route.search} closeTo={closeTo}/>;
}
function NeighborhoodView({graph:g,layout,route,phone,linkTo}:{graph:Neighborhood;layout:GraphLayout;route:GraphRoute;phone:boolean;linkTo(id:string):To}) {
  const {root,selected}=route;
  return <><TaskGraphCanvas layout={layout} tasks={g.nodes.map(n=>({id:n.id,title:n.title,state:n.task_state}))}
      relations={g.edges.map(e=>({id:e.id,from:e.source,to:e.target,type:e.edge_type}))} truncated={g.truncated}
      root={root} selected={selected} linkTo={linkTo} expandTo={expandTarget(layout,route)} phone={phone}/>
      {phone && <SelectedTaskSheet graph={g} route={route}/>}</>;
}
export function HumanTaskGraph(route: GraphRoute) {
  const {project,root,search}=route;
  const query=useGraphNeighborhood(project,root);
  const wide=useMediaQuery("(min-width: 1200px)");
  const phone=useMediaQuery(PHONE_QUERY);
  const g=query.data?.data;
  const graph=useMemo(()=>g ? {data:g,layout:neighborhoodLayout(g,root)} : null,[g,root]);
  const inGraph=wide||phone;
  const linkTo=useCallback((id:string):To=>taskTarget({id,search,root:inGraph?root:undefined}),[search,inGraph,root]);
  let content: ReactNode;
  if (graph && !query.isError) {
    const {data:g,layout}=graph;
    content=<NeighborhoodView graph={g} layout={layout} route={route} phone={phone} linkTo={linkTo}/>;

  } else {
    const status=<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/>;
    content=phone ? <div className={styles.phoneStatus}>{status}</div> : status;
  }
  return <GraphFrame phone={phone} search={search}>{content}</GraphFrame>;
}
