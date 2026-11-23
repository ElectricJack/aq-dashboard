import type {ReactNode} from "react";
import {Circle,List,Network,Search as SearchIcon,Shield,Tag,Workflow,type LucideIcon} from "lucide-react";
import {ActionButton,Toolbar} from "../../components/layout/Workspace";
import {Icon} from "../../components/icons";
import {nodeLabel,type GraphNode} from "../../api/adapters/humanGraph";
import {knowledgeCategoryLabel as categoryLabel} from "../actions/actionClient";
import type {NodeWorkspace} from "./useNodeWorkspace";
import styles from "./HumanNodeWorkspace.module.css";
function FilterSelect({icon,label,value,onChange,children}:{icon:LucideIcon;label:string;value:string;onChange:(value:string)=>void;children:ReactNode}) {
  return <label className={styles.filter}><span className="visually-hidden">{label}</span><Icon icon={icon} size={18} className={styles.filterIcon}/><select value={value} onChange={e=>onChange(e.target.value)}>{children}</select></label>;
}
export function RecordToolbar({model,kind}:{model:NodeWorkspace;kind:GraphNode["kind"]}){
 const {update,draft,setDraft,knowledge,category,setFilter,categories,lifecycle,verification,taskState,setTaskState,graph,phone}=model;
 return <Toolbar className={styles.filters}>
      <form onSubmit={e=>{e.preventDefault();update("q",draft.trim());}} className={styles.search}>
        <label className="visually-hidden" htmlFor={`find-${kind}`}>Search {kind==="task"?"tasks":"knowledge"}</label>
        {knowledge && <Icon icon={SearchIcon} size={18} className={styles.filterIcon}/>}
        <input id={`find-${kind}`} type="search" maxLength={256} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={`Search project ${kind==="task"?"tasks":"knowledge"}…`}/>
        {/* Knowledge submits on Enter, as in reference 07. */}
        {!knowledge && <ActionButton type="submit">Search</ActionButton>}
      </form>
      {knowledge && <>
        <FilterSelect icon={Tag} label="Category" value={category} onChange={v=>setFilter("category",v,"")}><option value="">All categories</option>{categories.map(c=><option key={c} value={c}>{categoryLabel(c)}</option>)}</FilterSelect>
        <FilterSelect icon={Circle} label="Lifecycle" value={lifecycle} onChange={v=>setFilter("lifecycle",v,"active")}><option value="active">Active records</option><option value="retired">Retired records</option><option value="deleted">Deleted records</option><option value="all">Any lifecycle</option></FilterSelect>
        <FilterSelect icon={Shield} label="Verification" value={verification} onChange={v=>setFilter("verification",v,"")}><option value="">Any verification</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option></FilterSelect>
        <div role="group" aria-label="Knowledge view" className={styles.segmented}>
          <button type="button" aria-pressed="true"><Icon icon={List} size={18}/>List</button>
          <button type="button" disabled title="Relationship browsing is not offered by this read contract"><Icon icon={Network} size={18}/>Relationships</button>
        </div>
      </>}
      {kind==="task" && <label><span className="visually-hidden">State of loaded tasks</span><select value={taskState} onChange={e=>setTaskState(e.target.value)}><option value="">{phone?"All states":"All task states loaded"}</option>{["draft","active","completed","canceled"].map(state=><option value={state} key={state}>{nodeLabel(state)}</option>)}</select></label>}
      {kind==="task" && <nav aria-label="Work view" className={styles.views}><ActionButton aria-pressed={!graph} onClick={()=>update("view","")}><List size={18} aria-hidden/>List</ActionButton><ActionButton aria-pressed={graph} onClick={()=>update("view","graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton></nav>}
    </Toolbar>;
}
