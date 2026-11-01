import type { OverviewTasks } from "../api/adapters/overviewTasks";
export const overviewId=(n:number)=>`00000000-0000-0000-0000-${n.toString().padStart(12,"0")}`;
export function overviewTasks(): OverviewTasks {return {
 contract:"human-overview-tasks-1",observed_at:"2026-11-01T15:00:00.000Z",scope:{project_id:null},coverage:"complete",next_after:null,
 projects:[{project:{id:overviewId(1),name:"Observed project",revision:"2",workspace_id:overviewId(2)},observed_at:"2026-11-01T15:00:00.000Z",source_status:"available",coverage:"complete",count_accuracy:"complete_observation",task_counts:{draft:0,active:1,completed:0,canceled:0},tasks:[{id:overviewId(3),title:"Recorded work item",version:"4",content_revision:"2",task_state:"active",updated_at:"2026-11-01T14:00:00.000Z"}],more_tasks:false,reason:null}]
};}
