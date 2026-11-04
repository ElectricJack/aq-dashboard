import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, type To } from "react-router";
import { Maximize, Minimize, Minus, Plus, Shrink } from "lucide-react";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import type { EdgeCategory } from "../../../api/adapters/inspection";
import { ActionButton, Panel } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, MAX_NODES, NODE_H, NODE_W, type GraphLayout } from "./layout";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { nodeLabel } from "../../../api/adapters/humanGraph";
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

export function HumanTaskGraph({project,root,selected,search}:{project:string;root:string;selected?:string;search:string}) {
  const query=useGraphNeighborhood(project,root);
  const wide=useMediaQuery("(min-width: 1200px)");
  const g=query.data?.data;
  const layout=useMemo(()=>g?layoutGraph({rootId:root,
    nodes:g.nodes.map(n=>({id:n.id,revision:n.content_revision,title:n.title,state:"active",readiness:{state:"unsupported",explanation:"Readiness not evaluated"}})),
    edges:g.edges.map(e=>({from:e.source,to:e.target,type:e.edge_type,category:edgeCategory(e.edge_type)})),
    omitted:{nodes:0,edges:0,reason:null}}):null,[g,root]);
  const linkTo=useCallback((id:string,nextRoot=root):To=>{
    const p=new URLSearchParams(search);
    if(wide){p.set("view","graph");p.set("root",nextRoot);}else p.delete("view");
    return {pathname:`/work/${encodeURIComponent(id)}`,search:`?${p}`};
  },[search,wide,root]);
  if(!g||!layout||query.isError)return <Panel title="Dependency graph"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/></Panel>;
  // Re-rooting keeps graph view on every width: the user asked to expand the graph.
  const expand=layout.clientOmitted>0&&selected&&selected!==root?(()=>{const p=new URLSearchParams(search);p.set("view","graph");p.set("root",selected);return {pathname:`/work/${encodeURIComponent(selected)}`,search:`?${p}`};})():undefined;
  return <Panel title="Dependency graph"><TaskGraphCanvas layout={layout} tasks={g.nodes.map(n=>({id:n.id,title:n.title,state:n.task_state}))}
    relations={g.edges.map(e=>({id:e.id,from:e.source,to:e.target,type:e.edge_type}))} truncated={g.truncated} root={root} selected={selected} linkTo={linkTo} expandTo={expand}/></Panel>;
}

/** Graph region: summary, zoomable canvas, legend/controls footer and the textual relationship list. */
export function TaskGraphCanvas({layout,tasks,relations,truncated,root,selected,linkTo,expandTo}:{
  layout:GraphLayout; tasks:GraphTask[]; relations:GraphRelation[]; truncated:boolean; root:string; selected?:string;
  linkTo:(id:string)=>To; expandTo?:To;
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

  return <div className={`${styles.graph} ${styles.humanGraph}`}>
    <div ref={region} className={styles.graphRegion} data-fullscreen={nativeFull?"native":pageFull?"page":undefined}>
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
    </div>
    <h3>Recorded relationships</h3>
    {relations.length?<ul className={styles.relations}>{relations.map(e=><li key={e.id}>
      <Link to={linkTo(e.from)}>{title(e.from)}</Link> {phrase(e.type)} <Link to={linkTo(e.to)}>{title(e.to)}</Link>
    </li>)}</ul>:<p>No relationships among the shown tasks.</p>}
  </div>;
}
