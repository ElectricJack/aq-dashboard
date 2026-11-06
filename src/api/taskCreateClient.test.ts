import {afterEach,expect,test,vi} from "vitest";
import {taskOperationRequest} from "./taskCreateClient";
import {taskOperation} from "../test/taskCreate";
afterEach(()=>vi.unstubAllGlobals());
test("retains typed conflict status and sends exact frozen bytes without serialization or retry",async()=>{
 const value=taskOperation({state:"conflict",effect:"not_dispatched",recovery:{allowed:false,reason:null}});
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(value),{status:409,headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetcher);
 const bytes=' { "exact": "bytes" } ';
 expect(await taskOperationRequest("POST","/api/human/projects/example/tasks",bytes)).toEqual(value);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![1]).toMatchObject({method:"POST",credentials:"same-origin",body:bytes,headers:{"X-AQ-Request":"1"}});
});
test("lookup404 is an error and never proof of no previous effect",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response('{"error":"not_found"}',{status:404,headers:{"Content-Type":"application/json"}})));
 await expect(taskOperationRequest("GET","/api/human/operations/example")).rejects.toMatchObject({status:404});
});
test("transport loss is not retried and preserves unknown POST effect",async()=>{
 const fetcher=vi.fn().mockRejectedValue(new TypeError("Connection lost"));vi.stubGlobal("fetch",fetcher);
 await expect(taskOperationRequest("POST","/api/human/projects/example/tasks","{}")).rejects.toMatchObject({effectUnknown:true});expect(fetcher).toHaveBeenCalledTimes(1);
});
test("rejects oversized and invalid responses and preserves nonJSON access denial",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response("x".repeat(65537),{headers:{"Content-Type":"application/json"}})).mockResolvedValueOnce(new Response("<html>denied</html>",{status:403}));vi.stubGlobal("fetch",fetcher);
 await expect(taskOperationRequest("GET","/api/human/operations/example")).rejects.toThrow(/bound/);
 await expect(taskOperationRequest("POST","/api/human/projects/example/tasks","{}")).rejects.toMatchObject({status:403,effectUnknown:true});
});
test("WD-06: a 404 lookup keeps the server's explanation for the dialog",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"not_found",message:"operation not found; prior submission may still be in flight"}),{status:404,headers:{"Content-Type":"application/json"}})));
 await expect(taskOperationRequest("GET","/api/human/operations/x")).rejects.toMatchObject({status:404,serverMessage:"operation not found; prior submission may still be in flight"});
});
