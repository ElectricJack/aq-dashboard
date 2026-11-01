import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import { ActionButton, Panel, Toolbar } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, NODE_H, NODE_W } from "./layout";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import styles from "./TaskGraph.module.css";
export function HumanTaskGraph({project,root,selected,search}:{project:string;root:string;selected?:string;search:string}) {
  const query=useGraphNeighborhood(project,root);
  const wide=useMediaQuery("(min-width: 1200px)");
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
  if(!query.data||!layout||query.isError)return <Panel title="Dependency graph"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/></Panel>;
  const g=query.data.data,nodes=new Map(g.nodes.map(n=>[n.id,n]));
  return <Panel title="Dependency graph"><div className={`${styles.graph} ${styles.humanGraph}`}><p className={styles.summary}>{g.nodes.length} tasks shown · one-hop neighborhood{g.truncated?" · Some relationships omitted":""}</p><p className={styles.muted}>Task states shown · execution readiness unavailable</p>{overflow && <Toolbar aria-label="Graph navigation"><ActionButton disabled={scrollLeft<=0} onClick={()=>canvas.current?.scrollBy({left:-280,behavior:"smooth"})}>Pan left</ActionButton><ActionButton onClick={()=>canvas.current?.scrollBy({left:280,behavior:"smooth"})}>Pan right</ActionButton><span className={styles.panHint}>Pan or use arrow keys.</span></Toolbar>}<div ref={canvas} className={styles.canvas} tabIndex={0} role="region" aria-label="Scrollable task graph" onScroll={e=>setScrollLeft(e.currentTarget.scrollLeft)}><div className={styles.stage} style={{inlineSize:layout.width,blockSize:layout.height}}><svg width={layout.width} height={layout.height} aria-hidden className={styles.edges}>{layout.edges.map((e,i)=><path key={i} d={e.path} data-category={e.category}/>)}</svg>{layout.nodes.map(n=><Link key={n.id} to={{pathname:`/work/${encodeURIComponent(n.id)}`,search: (()=>{const p=new URLSearchParams(search);if(wide){p.set("view","graph");p.set("root",root);}else p.delete("view");return `?${p}`;})()}} className={`${styles.node} ${styles.humanNode}`} title={n.title} aria-current={n.id===(selected??root)?"page":undefined} style={{position:"absolute",left:n.x,top:n.y,width:NODE_W,height:NODE_H}}><strong>{n.title}</strong><span>{nodeLabel(nodes.get(n.id)?.task_state??null)}</span></Link>)}</div></div><h3>Recorded relationships</h3>{g.edges.length?<ul>{g.edges.map(e=><li key={e.id}>{nodes.get(e.source)?.title} → {e.edge_type} → {nodes.get(e.target)?.title}</li>)}</ul>:<p>No relationships among the shown tasks.</p>}</div></Panel>;
}
