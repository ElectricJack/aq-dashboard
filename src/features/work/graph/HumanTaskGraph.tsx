import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, type To } from "react-router";
import { ArrowLeft, Maximize, Minimize, Minus, Plus, Shrink, X } from "lucide-react";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import type { EdgeCategory } from "../../../api/adapters/inspection";
import { ActionButton, Panel } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, MAX_NODES, NODE_H, NODE_W, type GraphLayout } from "./layout";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { nodeLabel, type GraphEdge, type GraphNode } from "../../../api/adapters/humanGraph";
import styles from "./TaskGraph.module.css";

export type GraphTask = { id: string; title: string; state: string | null };
export type GraphRelation = { id: string; from: string; to: string; type: string };

const ZOOM_MIN = 0.25, ZOOM_MAX = 2, ZOOM_STEP = 0.25, FIT_MIN = 0.05, PAN_STEP = 48;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const edgeCategory = (type: string): EdgeCategory =>
  type === "blocks" ? "dependency" : type === "parent-child" ? "hierarchy" : "informational";
const LEGEND: Record<EdgeCategory, string> = {
  dependency: "prerequisite to dependent",
  hierarchy: "parent to child task",
  informational: "related link",
};
const PHRASE: Record<string, string> = { blocks: "must finish before", "parent-child": "contains", references: "references", supersedes: "supersedes" };
const phrase = (type: string) => PHRASE[type] ?? `is linked (${type.replace(/[-_]+/g, " ")}) to`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
  const g=query.data?.data;
  const layout=useMemo(()=>g?layoutGraph({rootId:root,
    nodes:g.nodes.map(n=>({id:n.id,revision:n.content_revision,title:n.title,state:"active",readiness:{state:"unsupported",explanation:"Readiness not evaluated"}})),
    edges:g.edges.map(e=>({from:e.source,to:e.target,type:e.edge_type,category:edgeCategory(e.edge_type)})),
    omitted:{nodes:0,edges:0,reason:null}}):null,[g,root]);
  // Wide and phone selection stays in the graph; tablet opens the task detail instead.
  const linkTo=useCallback((id:string):To=>({pathname:`/work/${encodeURIComponent(id)}`,
    search:withParams(search,p=>{if(wide||phone){p.set("view","graph");p.set("root",root);}else{p.delete("view");p.delete("root");}})}),[search,wide,phone,root]);
  const listTo=graphListTarget(search);
  if(!g||!layout||query.isError){
    const status=<QueryStatus status={query.isError?"error":"pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/>;
    return phone?<PhoneGraphView backTo={listTo}><div className={styles.phoneStatus}>{status}</div></PhoneGraphView>:<Panel title="Dependency graph">{status}</Panel>;
  }
  // Re-rooting keeps graph view on every width: the user asked to expand the graph.
  const expand=layout.clientOmitted>0&&selected&&selected!==root?{pathname:`/work/${encodeURIComponent(selected)}`,search:withParams(search,p=>{p.set("view","graph");p.set("root",selected);})}:undefined;
  const graph=<TaskGraphCanvas layout={layout} tasks={g.nodes.map(n=>({id:n.id,title:n.title,state:n.task_state}))}
    relations={g.edges.map(e=>({id:e.id,from:e.source,to:e.target,type:e.edge_type}))} truncated={g.truncated} root={root} selected={selected} linkTo={linkTo} expandTo={expand} phone={phone}/>;
  if(phone){
    const nodes=new Map(g.nodes.map(n=>[n.id,n]));
    return <PhoneGraphView backTo={listTo}>
      {graph}
      {selected&&<TaskSheet node={nodes.get(selected)} edges={g.edges} nodes={nodes} search={search} closeTo={{pathname:"/work",search:withParams(search,p=>{p.set("view","graph");p.set("root",root);})}}/>}
    </PhoneGraphView>;
  }
  return <Panel title="Dependency graph">{graph}</Panel>;
}

/** Graph region: summary, zoomable canvas, legend/controls footer and the textual relationship list. */
export function TaskGraphCanvas({layout,tasks,relations,truncated,root,selected,linkTo,expandTo,phone=false}:{
  layout:GraphLayout; tasks:GraphTask[]; relations:GraphRelation[]; truncated:boolean; root:string; selected?:string;
  linkTo:(id:string)=>To; expandTo?:To;
  /** Phone (WK-F): the region fills the dedicated view and the relationship list collapses below it. */
  phone?:boolean;
}) {
  const uid=useId().replace(/[^a-zA-Z0-9_-]/g,"");
  const region=useRef<HTMLDivElement>(null), canvas=useRef<HTMLDivElement>(null);
  const [scale,setScale]=useState(1);
  const [nativeFull,setNativeFull]=useState(false), [pageFull,setPageFull]=useState(false);
  const byId=useMemo(()=>new Map(tasks.map(t=>[t.id,t])),[tasks]);
  const focus=selected??root;

  // Selection stays in view: after zoom or selection changes, scroll the focused task into the canvas.
  useLayoutEffect(()=>{
    const el=canvas.current, n=layout.nodes.find(n=>n.id===focus);
    if(!el||!n)return;
    const x=n.x*scale,y=n.y*scale,w=NODE_W*scale,h=NODE_H*scale;
    if(x<el.scrollLeft||x+w>el.scrollLeft+el.clientWidth)el.scrollLeft=Math.max(0,x+w/2-el.clientWidth/2);
    if(y<el.scrollTop||y+h>el.scrollTop+el.clientHeight)el.scrollTop=Math.max(0,y+h/2-el.clientHeight/2);
  },[focus,scale,layout,nativeFull,pageFull]);

  useEffect(()=>{
    const on=()=>setNativeFull(!!region.current&&document.fullscreenElement===region.current);
    document.addEventListener("fullscreenchange",on);return()=>document.removeEventListener("fullscreenchange",on);
  },[]);
  useEffect(()=>{
    if(!pageFull)return;
    const onKey=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape")setPageFull(false);};
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[pageFull]);

  const zoomIn=()=>setScale(s=>clamp((Math.floor(s/ZOOM_STEP+1e-6)+1)*ZOOM_STEP,ZOOM_MIN,ZOOM_MAX));
  const zoomOut=()=>setScale(s=>clamp((Math.ceil(s/ZOOM_STEP-1e-6)-1)*ZOOM_STEP,ZOOM_MIN,ZOOM_MAX));
  const fit=()=>{
    const el=canvas.current;if(!el)return;
    const maxH=parseFloat(getComputedStyle(el).maxBlockSize);
    const availH=Number.isFinite(maxH)?maxH:el.clientHeight;
    setScale(clamp(Math.floor(Math.min(el.clientWidth/layout.width,availH/layout.height,1)*100)/100,FIT_MIN,1));
    el.scrollLeft=0;el.scrollTop=0;
    region.current?.scrollIntoView?.({block:"nearest"});
  };
  // Entering full screen fits the graph to the larger canvas; leaving restores the previous zoom.
  const full=nativeFull||pageFull, before=useRef<number|null>(null);
  useLayoutEffect(()=>{
    if(full&&before.current===null){before.current=scale;fit();}
    else if(!full&&before.current!==null){setScale(before.current);before.current=null;}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on full-screen transitions only
  },[full]);
  const toggleFull=async()=>{
    if(nativeFull){await document.exitFullscreen?.().catch(()=>{});return;}
    if(pageFull){setPageFull(false);return;}
    const el=region.current;
    if(el?.requestFullscreen&&document.fullscreenEnabled){try{await el.requestFullscreen();return;}catch{/* fall back to the in-page view */}}
    setPageFull(true);
  };
  const onKeyDown=(e:KeyboardEvent<HTMLDivElement>)=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const el=e.currentTarget;
    const pan:Record<string,[number,number]>={ArrowLeft:[-PAN_STEP,0],ArrowRight:[PAN_STEP,0],ArrowUp:[0,-PAN_STEP],ArrowDown:[0,PAN_STEP]};
    if(e.key in pan){const [dx,dy]=pan[e.key]!;el.scrollLeft+=dx;el.scrollTop+=dy;}
    else if(e.key==="+"||e.key==="=")zoomIn();
    else if(e.key==="-"||e.key==="_")zoomOut();
    else if(e.key==="0")setScale(1);
    else return;
    e.preventDefault();
  };

  const shown=layout.nodes.length;
  const summary=[`${shown} of ${plural(tasks.length,"task")} shown`,
    layout.clientOmitted>0?`${plural(layout.clientOmittedEdges,"relationship")} hidden by the ${MAX_NODES}-node limit`:"one-hop neighborhood",
    ...(truncated?["More relationships exist on the server"]:[])].join(" · ");
  const categories=(["dependency","hierarchy","informational"] as EdgeCategory[]).filter(c=>c==="dependency"||layout.edges.some(e=>e.category===c));
  const marker=(c:EdgeCategory)=>`${uid}-arrow-${c}`;
  const title=(id:string)=>byId.get(id)?.title??"Unavailable task";

  const graphRegion=<div ref={region} className={phone?`${styles.graphRegion} ${styles.phoneCanvas}`:styles.graphRegion} data-fullscreen={nativeFull?"native":pageFull?"page":undefined}>
    <div className={styles.summaryRow}>
      <p className={styles.summary}>{summary}</p>
      {expandTo&&<Link className={styles.expand} to={expandTo}>Expand around selected task</Link>}
    </div>
    <p className={styles.muted}>Task states shown · execution readiness unavailable</p>
    <div ref={canvas} className={styles.canvas} tabIndex={0} role="region" aria-label="Scrollable task graph" aria-describedby={`${uid}-keys`} onKeyDown={onKeyDown}>
      <div className={styles.sizer} style={{inlineSize:layout.width*scale,blockSize:layout.height*scale}}>
        <div className={styles.stage} data-scale={scale} style={{inlineSize:layout.width,blockSize:layout.height,transform:`scale(${scale})`}}>
          <svg width={layout.width} height={layout.height} aria-hidden className={styles.edges}>
            <defs>{(["dependency","hierarchy","informational"] as EdgeCategory[]).map(c=><marker key={c} id={marker(c)} data-category={c} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>)}</defs>
            {layout.edges.map((e,i)=><path key={i} d={e.path} data-category={e.category} data-edge-type={e.type} markerEnd={`url(#${marker(e.category)})`}><title>{`${title(e.from)} ${phrase(e.type)} ${title(e.to)}`}</title></path>)}
          </svg>
          {layout.nodes.map(n=><Link key={n.id} to={linkTo(n.id)} className={`${styles.node} ${styles.humanNode}`} title={n.title} aria-current={n.id===focus?"page":undefined} style={{position:"absolute",left:n.x,top:n.y,width:NODE_W,height:NODE_H}}><strong>{n.title}</strong><span>{nodeLabel(byId.get(n.id)?.state??null)}</span></Link>)}
        </div>
      </div>
    </div>
    <p id={`${uid}-keys`} className="visually-hidden">Arrow keys pan. Plus and minus zoom. Zero resets to 100%.</p>
    <div className={styles.footer}>
      <ul className={styles.legend} aria-label="Edge types">{categories.map(c=><li key={c} data-category={c}>
        <svg width="28" height="10" aria-hidden><line x1="0" y1="5" x2="20" y2="5"/><path d="M19,1 L27,5 L19,9 z"/></svg>{LEGEND[c]}</li>)}
      </ul>
      <span className={styles.keepInView}>Selection stays in view</span>
      <div className={styles.controls} role="group" aria-label="Graph controls">
        <ActionButton onClick={fit}><Shrink size={16} aria-hidden/><span className={styles.fitLabel}>Fit graph</span></ActionButton>
        <span className={styles.zoom}>
          <ActionButton aria-label="Zoom out" disabled={scale<=ZOOM_MIN} onClick={zoomOut}><Minus size={16} aria-hidden/></ActionButton>
          <output className={styles.zoomLevel} aria-label="Zoom level">{Math.round(scale*100)}%</output>
          <ActionButton aria-label="Zoom in" disabled={scale>=ZOOM_MAX} onClick={zoomIn}><Plus size={16} aria-hidden/></ActionButton>
        </span>
        <ActionButton aria-label={full?"Exit full screen":"Full screen"} onClick={()=>void toggleFull()}>{full?<Minimize size={16} aria-hidden/>:<Maximize size={16} aria-hidden/>}</ActionButton>
      </div>
    </div>
  </div>;
  const relationList=relations.length?<ul className={styles.relations}>{relations.map(e=><li key={e.id}>
    <Link to={linkTo(e.from)}>{title(e.from)}</Link> {phrase(e.type)} <Link to={linkTo(e.to)}>{title(e.to)}</Link>
  </li>)}</ul>:<p>No relationships among the shown tasks.</p>;
  if(phone)return <>{graphRegion}<details className={styles.phoneRelations}><summary>Recorded relationships ({relations.length})</summary>{relationList}</details></>;
  return <div className={`${styles.graph} ${styles.humanGraph}`}>{graphRegion}<h3>Recorded relationships</h3>{relationList}</div>;
}
