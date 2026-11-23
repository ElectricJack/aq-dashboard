import { useId,useMemo } from "react";
import { Link,type To } from "react-router";
import { Maximize,Minimize,Minus,Plus,Shrink } from "lucide-react";
import type { EdgeCategory } from "../../../api/adapters/inspection";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import { ActionButton } from "../../../components/layout/Workspace";
import { MAX_NODES,NODE_H,NODE_W,type GraphLayout } from "./layout";
import styles from "./TaskGraph.module.css";
import { useGraphViewport, ZOOM_MIN, ZOOM_MAX } from "./useGraphViewport";

export type GraphTask = { id: string; title: string; state: string | null };
export type GraphRelation = { id: string; from: string; to: string; type: string };

const LEGEND: Record<EdgeCategory, string> = {
  dependency: "prerequisite to dependent",
  hierarchy: "parent to child task",
  informational: "related link",
};
const PHRASE: Record<string, string> = { blocks: "must finish before", "parent-child": "contains", references: "references", supersedes: "supersedes" };
const phrase = (type: string) => PHRASE[type] ?? `is linked (${type.replace(/[-_]+/g, " ")}) to`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function graphSummary(layout: GraphLayout,tasks:GraphTask[],truncated:boolean) {
  const shown=layout.nodes.length;
  return [`${shown} of ${plural(tasks.length,"task")} shown`,
    layout.clientOmitted>0?`${plural(layout.clientOmittedEdges,"relationship")} hidden by the ${MAX_NODES}-node limit`:"one-hop neighborhood",
    ...(truncated?["More relationships exist on the server"]:[])].join(" · ");
}

function RecordedRelations({relations,title,linkTo}:{relations:GraphRelation[];title(id:string):string;linkTo(id:string):To}) {
  return relations.length?<ul className={styles.relations}>{relations.map(e=><li key={e.id}>
    <Link to={linkTo(e.from)}>{title(e.from)}</Link> {phrase(e.type)} <Link to={linkTo(e.to)}>{title(e.to)}</Link>
  </li>)}</ul>:<p>No relationships among the shown tasks.</p>;
}
function GraphControls({viewport}:{viewport:ReturnType<typeof useGraphViewport>}) {
 const {fit,scale,zoomOut,zoomIn,full,toggleFull}=viewport;
 return <div className={styles.controls} role="group" aria-label="Graph controls">
        <ActionButton onClick={fit}><Shrink size={16} aria-hidden/><span className={styles.fitLabel}>Fit graph</span></ActionButton>
        <span className={styles.zoom}>
          <ActionButton aria-label="Zoom out" disabled={scale<=ZOOM_MIN} onClick={zoomOut}><Minus size={16} aria-hidden/></ActionButton>
          <output className={styles.zoomLevel} aria-label="Zoom level">{Math.round(scale*100)}%</output>
          <ActionButton aria-label="Zoom in" disabled={scale>=ZOOM_MAX} onClick={zoomIn}><Plus size={16} aria-hidden/></ActionButton>
        </span>
        <ActionButton aria-label={full?"Exit full screen":"Full screen"} onClick={()=>void toggleFull()}>{full?<Minimize size={16} aria-hidden/>:<Maximize size={16} aria-hidden/>}</ActionButton>
      </div>;
}
/** Graph region: summary, zoomable canvas, legend/controls footer and the textual relationship list. */
export function TaskGraphCanvas({layout,tasks,relations,truncated,root,selected,linkTo,expandTo,phone=false}:{
  layout:GraphLayout; tasks:GraphTask[]; relations:GraphRelation[]; truncated:boolean; root:string; selected?:string;
  linkTo:(id:string)=>To; expandTo?:To;
  /** Phone (WK-F): the region fills the dedicated view and the relationship list collapses below it. */
  phone?:boolean;
}) {
  const uid=useId().replace(/[^a-zA-Z0-9_-]/g,"");
  const byId=useMemo(()=>new Map(tasks.map(t=>[t.id,t])),[tasks]);
  const focus=selected??root;
  const viewport = useGraphViewport(layout,focus);
  const {region,canvas,scale,nativeFull,pageFull,onKeyDown} = viewport;
  const summary = graphSummary(layout,tasks,truncated);
  const categories=(["dependency","hierarchy","informational"] as EdgeCategory[]).filter(c=>c==="dependency"||layout.edges.some(e=>e.category===c));
  const marker=(c:EdgeCategory)=>`${uid}-arrow-${c}`;
  const title=(id:string)=>byId.get(id)?.title??"Unavailable task";

  const screenMode=nativeFull?"native":pageFull?"page":undefined;
  const graphRegion=<div ref={region} className={phone?`${styles.graphRegion} ${styles.phoneCanvas}`:styles.graphRegion} data-fullscreen={screenMode}>
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
      <GraphControls viewport={viewport}/>
    </div>
  </div>;
  const relationList = <RecordedRelations relations={relations} title={title} linkTo={linkTo}/>;
  if(phone)return <>{graphRegion}<details className={styles.phoneRelations}><summary>Recorded relationships ({relations.length})</summary>{relationList}</details></>;
  return <div className={`${styles.graph} ${styles.humanGraph}`}>{graphRegion}<h3>Recorded relationships</h3>{relationList}</div>;
}
