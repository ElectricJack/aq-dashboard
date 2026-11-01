import {graphId,graphProject} from "./humanGraph";
import type {TaskOperation} from "../api/adapters/taskCreate";
/** Synthetic UI fixture for human-task-create-1. Never a production operation. */
export const taskActor=graphId(90),taskOperationId=graphId(91);
export const taskDigest=`sha256:${"a".repeat(64)}`;
export function taskOperation(overrides:Partial<TaskOperation>={}):TaskOperation{
 return {contract:"human-task-create-1",operation_id:taskOperationId,project_id:graphProject,actor_id:taskActor,task_id:taskOperationId,request_digest:taskDigest,state:"pending",effect:"not_dispatched",receipt:null,recovery:{allowed:true,reason:null},created_at_ms:1793534400000,...overrides};
}
export function confirmedTaskOperation(overrides:Partial<TaskOperation>={}):TaskOperation{
 return taskOperation({state:"confirmed",effect:"confirmed",receipt:{workspace_id:graphId(2),change_set_id:graphId(92),task_id:taskOperationId,version:"1",content_revision:"1"},recovery:{allowed:false,reason:null},...overrides});
}
