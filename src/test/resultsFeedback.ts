import valid from "../../contracts/pinned/results-feedback/v1/fixtures/valid.json";
import compat from "../../contracts/pinned/results-feedback/v1/fixtures/compatibility.json";
import action from "../../contracts/pinned/dashboard-actions/v1/fixtures/operation-confirmed.json";
import type { Detail, CommentProjection } from "../api/wire/resultsFeedback";
export const feedbackId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function feedbackDetail():Detail { return structuredClone(valid.find(f=>f.type==="Detail")!.value) as Detail; }
export function feedbackEnvelope<T>(data:T,project?:string) {return {...compat.read,data,scope:project?{kind:"project" as const,project_id:project}:{kind:"all_authorized" as const}};}
export function feedbackComment():CommentProjection {return {id:feedbackId(20),position:"1",revision:"1",thread_id:feedbackId(21),thread_version:"1",thread_state:"open",body:"The caption wraps over the image.",author_id:feedbackId(22),created_at_ms:1000000,anchor:{kind:"result"},history:[]};}
export function feedbackOperation(id:string,disposition="confirmed") {return {...action,scope:{kind:"project",project_id:feedbackDetail().result.project_id},data:{...action.data,operation_id:id,disposition,recovery:["unknown","pending"].includes(disposition)?"lookup_original":action.data.recovery,scope:{kind:"project",project_id:feedbackDetail().result.project_id}}};}
// The media suite keeps its existing exact native bindings while exercising G6 reads.
import {resultRecord} from "./results";
import type {ResultMetadata} from "../api/adapters/results";
export function mediaResultDetail(row:ResultMetadata=resultRecord()):Detail {
 const d=feedbackDetail();return {...d,result:{id:row.report_id,current_revision:row.revision,project_id:row.project_id,task_id:row.task_id,version:"1"},revision:{...d.revision,report_id:row.report_id,revision:row.revision,attempt_id:row.attempt_id,source:{repository_id:row.repository_id,base:row.source_base},summary:row.conclusion,submitted_at_ms:row.recorded_at_ms,capture_policy:{revision:"0",requirements:[]}},assessment:{...d.assessment,result_revision:row.revision,evidence:{satisfied:true,requirements:[]}}};
}
export function resultFeedbackPage(rows=[resultRecord()],cursor:string|null=null,project?:string){return feedbackEnvelope({items:rows.map(mediaResultDetail).sort((a,b)=>b.revision.submitted_at_ms-a.revision.submitted_at_ms||b.revision.report_id.localeCompare(a.revision.report_id)),next_cursor:cursor},project);}
