import { adaptOverviewTasks } from "./overviewTasks";
import { overviewId,overviewTasks } from "../../test/overviewTasks";
test("exact contribution contract, scope and project revision are required",()=>{
 const value=overviewTasks();expect(adaptOverviewTasks(value)).toEqual(value);
 expect(()=>adaptOverviewTasks({...value,contract:"future"})).toThrow();expect(()=>adaptOverviewTasks(value,overviewId(9))).toThrow();
 value.projects[0]!.project.revision="0";expect(()=>adaptOverviewTasks(value)).toThrow();
});
test("unavailable source cannot report zero counts or a complete aggregate",()=>{
 const value=overviewTasks();const row=value.projects[0]!;Object.assign(row,{source_status:"unavailable",coverage:"unavailable",count_accuracy:"unknown",observed_at:null,task_counts:null,tasks:[],more_tasks:null,reason:"Source unavailable"});value.coverage="partial";
 expect(adaptOverviewTasks(value).projects[0]!.task_counts).toBeNull();row.task_counts={draft:0,active:0,completed:0,canceled:0};expect(()=>adaptOverviewTasks(value)).toThrow();
});
test("lower-bound observations stay partial; unsupported timestamps and duplicate IDs refuse",()=>{
 const value=overviewTasks();const row=value.projects[0]!;row.more_tasks=true;row.count_accuracy="lower_bound";row.coverage="partial";value.coverage="partial";expect(adaptOverviewTasks(value)).toEqual(value);
 row.count_accuracy="complete_observation";expect(()=>adaptOverviewTasks(value)).toThrow();
 const invalid=overviewTasks();invalid.projects[0]!.tasks[0]!.updated_at="yesterday";expect(()=>adaptOverviewTasks(invalid)).toThrow();
 const duplicate=overviewTasks();duplicate.projects.push(duplicate.projects[0]!);expect(()=>adaptOverviewTasks(duplicate)).toThrow();
});
