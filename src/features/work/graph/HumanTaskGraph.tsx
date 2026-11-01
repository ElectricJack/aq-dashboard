import { useMemo } from "react";
import { Link } from "react-router";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import { Panel } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { layoutGraph, NODE_H, NODE_W } from "./layout";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import styles from "./TaskGraph.module.css";
export function HumanTaskGraph({project,root,search}:{project:string;root:string;search:string}) {
  const query=useGraphNeighborhood(project,root);
  const layout=useMemo(()=>{
    const g=query.data?.data;if(!g)return null;
    return layoutGraph({rootId:root,nodes:g.nodes.map(n=>({id:n.id,revision:n.content_revision,title:n.title,state:"active",readiness:{state:"unsupported",explanation:"Readiness not evaluated"}})),edges:g.edges.map(e=>({from:e.source,to:e.target,type:e.edge_type,category:e.edge_type==="blocks"?"dependency":e.edge_type==="parent-child"?"hierarchy":"informational"})),omitted:{nodes:0,edges:0,reason:null}});
  },[query.data,root]);
  if(!query.data||!layout||query.isError)return <Panel title="Dependency graph"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="task dependencies" onRetry={()=>void query.refetch()}/></Panel>;
  const g=query.data.data,nodes=new Map(g.nodes.map(n=>[n.id,n]));
  return <Panel title="Dependency graph"><div className={styles.graph}><p>{g.nodes.length} tasks shown · one-hop neighborhood{g.truncated?" · Some relationships omitted":""}</p><p>Graph task state is recorded separately from execution readiness.</p><div className={styles.canvas}><div className={styles.stage} style={{inlineSize:layout.width,blockSize:layout.height}}><svg width={layout.width} height={layout.height} aria-hidden className={styles.edges}>{layout.edges.map((e,i)=><path key={i} d={e.path} data-category={e.category}/>)}</svg>{layout.nodes.map(n=><Link key={n.id} to={{pathname:`/work/${encodeURIComponent(n.id)}`,search: (()=>{const p=new URLSearchParams(search);p.delete("view");return `?${p}`;})()}} className={`${styles.node} ${styles.humanNode}`} style={{position:"absolute",left:n.x,top:n.y,width:NODE_W,height:NODE_H}}><strong>{n.title}</strong><span>{nodeLabel(nodes.get(n.id)?.task_state??null)}</span></Link>)}</div></div><h3>Recorded relationships</h3>{g.edges.length?<ul>{g.edges.map(e=><li key={e.id}>{nodes.get(e.source)?.title} → {e.edge_type} → {nodes.get(e.target)?.title}</li>)}</ul>:<p>No relationships among the shown tasks.</p>}</div></Panel>;
}
