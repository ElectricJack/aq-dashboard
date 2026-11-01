import {createHash,webcrypto} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
import {graphProject} from "../../test/humanGraph";
import {confirmedTaskOperation,taskActor,taskDigest,taskOperation,taskOperationId} from "../../test/taskCreate";
import publicExample from "../../test/task-create.contract.json";
import {adaptTaskOperation,freezeTaskCreate,validateTaskDraft} from "./taskCreate";
afterEach(()=>vi.unstubAllGlobals());
const expected={operationId:taskOperationId,project:graphProject,actor:taskActor,digest:taskDigest};
test("accepts the source-owned published API10 example without remapping identity",()=>{
 expect(adaptTaskOperation(publicExample,{operationId:publicExample.operation_id,project:publicExample.project_id,actor:publicExample.actor_id,digest:publicExample.request_digest}).state).toBe("unknown");
});
test("freezes canonical bytes once and hashes those exact UTF8 bytes",async()=>{
 vi.stubGlobal("crypto",webcrypto);
 const draft={title:"  Unicode 🚀  ",body:"Descripción",acceptance_criteria:"Keep ✓",task_state:"draft" as const};
 const result=await freezeTaskCreate(graphProject,taskActor,"9007199254740993",draft);
 draft.title="Changed after freeze";
 expect(Object.isFrozen(result)).toBe(true);
 expect(JSON.parse(result.bytes)).toEqual({operation_id:result.operationId,expected_project_revision:"9007199254740993",title:"Unicode 🚀",body:"Descripción",acceptance_criteria:"Keep ✓",labels:[],task_state:"draft"});
 expect(result.digest).toBe(`sha256:${createHash("sha256").update(result.bytes,"utf8").digest("hex")}`);
});
test("validates Unicode character and UTF8 byte bounds",()=>{
 const draft={title:"🚀".repeat(512),body:"",acceptance_criteria:"",task_state:"draft" as const};
 expect(validateTaskDraft(draft)).toBeNull();
 expect(validateTaskDraft({...draft,title:draft.title+"x"})).toMatch(/title/);
 expect(validateTaskDraft({...draft,body:"é".repeat(16385)})).toMatch(/Description/);
 expect(validateTaskDraft({...draft,acceptance_criteria:"✓".repeat(2731)})).toMatch(/Acceptance/);
});
test("binds every receipt to the exact owner, project, operation, digest and task",()=>{
 expect(adaptTaskOperation(confirmedTaskOperation(),expected).state).toBe("confirmed");
 for(const patch of [{operation_id:taskActor},{project_id:taskActor},{actor_id:graphProject},{task_id:taskActor},{request_digest:`sha256:${"b".repeat(64)}`},{receipt:null},{effect:"possible"},{recovery:{allowed:true,reason:null}}]){
  expect(()=>adaptTaskOperation({...confirmedTaskOperation(),...patch},expected)).toThrow(/Invalid task operation/);
 }
 expect(()=>adaptTaskOperation(confirmedTaskOperation({receipt:{...confirmedTaskOperation().receipt!,task_id:taskActor}}),expected)).toThrow();
});
test("terminal refusals cannot imply a possible or confirmed effect",()=>{
 expect(adaptTaskOperation(taskOperation({state:"conflict",effect:"not_dispatched",recovery:{allowed:false,reason:"project_binding_changed_before_dispatch"}}),expected).state).toBe("conflict");
 expect(()=>adaptTaskOperation(taskOperation({state:"conflict",effect:"possible"}),expected)).toThrow();
 expect(()=>adaptTaskOperation(taskOperation({state:"unknown",receipt:confirmedTaskOperation().receipt}),expected)).toThrow();
});
