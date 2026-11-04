import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, type To } from "react-router";
import { ArrowLeft, X } from "lucide-react";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import { ActionButton, Panel, Toolbar } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, NODE_H, NODE_W } from "./layout";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { nodeLabel, type GraphEdge, type GraphNode } from "../../../api/adapters/humanGraph";
import styles from "./TaskGraph.module.css";

/** Phone breakpoint (spec 0002 §9): the graph is a deliberate, dedicated view there. */
export const PHONE_QUERY = "(max-width: 767px)";

function withParams(search: string, change: (p: URLSearchParams) => void) { const p = new URLSearchParams(search); change(p); const value = p.toString(); return value ? `?${value}` : ""; }
/** The phone graph exit: the task list in the same scope and filters, without the graph state. */
export function graphListTarget(search: string): To { return { pathname: "/work", search: withParams(search, p => { p.delete("view"); p.delete("root"); }) }; }

/** Full-viewport phone graph view. A modal dialog keeps the shell (and bottom nav) inert and covered until Back. */
export function PhoneGraphView({ backTo, children }: { backTo: To; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), kept = useRef<HTMLElement | null>(null), navigate = useNavigate(), heading = useId();
  // showModal() moves focus to the first control (Back). When the dialog is reopened (StrictMode
  // re-runs effects), keep focus where the workspace put it inside the view, e.g. the restored node.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) { element.showModal(); if (kept.current && element.contains(kept.current)) kept.current.focus(); }
    return () => { const active = document.activeElement; kept.current = element && active instanceof HTMLElement && element.contains(active) ? active : null; if (element?.open) element.close(); };
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

export function HumanTaskGraph({project,root,selected,search}:{project:string;root:string;selected?:string;search:string}) {
  const query=useGraphNeighborhood(project,root);
  const wide=useMediaQuery("(min-width: 1200px)");
  const phone=useMediaQuery(PHONE_QUERY);
  const canvas = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const layout=useMemo(()=>{
    const g=query.data?.data;if(!g)return null;
    return layoutGraph({rootId:root,nodes:g.nodes.map(n=>({id:n.id,revision:n.content_revision,title:n.title,state:"active",readiness:{state:"unsupported",explanation:"Readiness not evaluated"}})),edges:g.edges.map(e=>({from:e.source,to:e.target,type:e.edge_type,category:e.edge_type==="blocks"?"dependency":e.edge_type==="parent-child"?"hierarchy":"informational"})),omitted:{nodes:0,edges:0,reason:null}});
  },[query.data,root]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !layout) return;
    const measure = () => { setOverflow(element.scrollWidth > element.clientWidth + 1); setScrollLeft(element.scrollLeft); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [layout]);
  // Phone: keep the tapped/current node inside the canvas when the sheet opens or the root changes.
  const current=selected??root;
  useEffect(() => {
    if (!phone || !layout) return;
    const element = canvas.current, node = layout.nodes.find(n => n.id === current);
    if (!element || !node) return;
    const left = Math.max(0, node.x - (element.clientWidth - NODE_W) / 2), top = Math.max(0, node.y - (element.clientHeight - NODE_H) / 2);
    if (node.x < element.scrollLeft || node.x + NODE_W > element.scrollLeft + element.clientWidth || node.y < element.scrollTop || node.y + NODE_H > element.scrollTop + element.clientHeight) element.scrollTo?.({ left, top });
  }, [phone, layout, current]);
  const listTo=graphListTarget(search);
  if(!query.data||!layout||query.isError){
    const status=<QueryStatus status={query.isError?"error":"pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/>;
    return phone?<PhoneGraphView backTo={listTo}><div className={styles.phoneStatus}>{status}</div></PhoneGraphView>:<Panel title="Dependency graph">{status}</Panel>;
  }
  const g=query.data.data,nodes=new Map(g.nodes.map(n=>[n.id,n]));
  // Wide and phone selection stays in the graph; tablet opens the task detail instead.
  const nodeSearch=withParams(search,p=>{if(wide||phone){p.set("view","graph");p.set("root",root);}else p.delete("view");});
  const summary=<p className={styles.summary}>{g.nodes.length} tasks shown · one-hop neighborhood{g.truncated?" · Some relationships omitted":""}</p>;
  const muted=<p className={styles.muted}>Task states shown · execution readiness unavailable</p>;
  const pan=overflow && <Toolbar aria-label="Graph navigation"><ActionButton disabled={scrollLeft<=0} onClick={()=>canvas.current?.scrollBy({left:-280,behavior:"smooth"})}>Pan left</ActionButton><ActionButton onClick={()=>canvas.current?.scrollBy({left:280,behavior:"smooth"})}>Pan right</ActionButton><span className={styles.panHint}>Pan or use arrow keys.</span></Toolbar>;
  const graphCanvas=<div ref={canvas} className={styles.canvas} tabIndex={0} role="region" aria-label="Scrollable task graph" onScroll={e=>setScrollLeft(e.currentTarget.scrollLeft)}><div className={styles.stage} style={{inlineSize:layout.width,blockSize:layout.height}}><svg width={layout.width} height={layout.height} aria-hidden className={styles.edges}>{layout.edges.map((e,i)=><path key={i} d={e.path} data-category={e.category} data-edge-type={e.type}/>)}</svg>{layout.nodes.map(n=><Link key={n.id} to={{pathname:`/work/${encodeURIComponent(n.id)}`,search:nodeSearch}} className={`${styles.node} ${styles.humanNode}`} title={n.title} aria-current={n.id===current?"page":undefined} style={{position:"absolute",left:n.x,top:n.y,width:NODE_W,height:NODE_H}}><strong>{n.title}</strong><span>{nodeLabel(nodes.get(n.id)?.task_state??null)}</span></Link>)}</div></div>;
  const relationships=g.edges.length?<ul>{g.edges.map(e=><li key={e.id}>{nodes.get(e.source)?.title} → {e.edge_type} → {nodes.get(e.target)?.title}</li>)}</ul>:<p>No relationships among the shown tasks.</p>;
  if(phone)return <PhoneGraphView backTo={listTo}>
    <div className={styles.phoneMeta}>{summary}{muted}</div>
    <div className={styles.phoneCanvas}>{pan}{graphCanvas}</div>
    <details className={styles.phoneRelations}><summary>Recorded relationships ({g.edges.length})</summary>{relationships}</details>
    {selected&&<TaskSheet node={nodes.get(selected)} edges={g.edges} nodes={nodes} search={search} closeTo={{pathname:"/work",search:withParams(search,p=>{p.set("view","graph");p.set("root",root);})}}/>}
  </PhoneGraphView>;
  return <Panel title="Dependency graph"><div className={`${styles.graph} ${styles.humanGraph}`}>{summary}{muted}{pan}{graphCanvas}<h3>Recorded relationships</h3>{relationships}</div></Panel>;
}
