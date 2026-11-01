import { adaptResults } from "./results";
import { resultId, resultPage, resultRecord } from "../../test/results";
test("only exact supported result version, project and revision are accepted", () => {
 const page=resultPage();expect(adaptResults(page,resultId(100),{id:resultId(1),revision:"a".repeat(64)})).toEqual(page);
 expect(()=>adaptResults({...page,schema_version:2})).toThrow();expect(()=>adaptResults(page,resultId(999))).toThrow();expect(()=>adaptResults(page,undefined,{id:resultId(1),revision:"b".repeat(64)})).toThrow();
});
test("malformed correction identity, evidence, timestamps and object IDs refuse", () => {
 for(const patch of [{current_report_head:false},{source_receipt_ids:["invalid"]},{recorded_at_ms:Infinity},{source_base:{format:"sha1",hex:"b".repeat(64)}},{supersedes:resultId(1)},{process_outcome:"accepted"}]) expect(()=>adaptResults(resultPage([{...resultRecord(),...patch} as never]))).toThrow();
});
test("duplicates and foreign cursor cannot advance the result list",()=>{
 expect(()=>adaptResults(resultPage([resultRecord(),resultRecord()]))).toThrow();expect(()=>adaptResults(resultPage([resultRecord()],resultId(2)))).toThrow();expect(()=>adaptResults(resultPage([],resultId(1)))).toThrow();
});
test("head is explicitly distinct from an old retained report",()=>{
 const old={...resultRecord(),current_report_head:false,head_report_id:resultId(2)};
 expect(adaptResults(resultPage([old])).items[0]?.current_report_head).toBe(false);
});

test("backwards rows and stale cursor boundaries refuse",()=>{
 expect(()=>adaptResults(resultPage([resultRecord(2),resultRecord(1)]))).toThrow();
 expect(()=>adaptResults(resultPage([resultRecord(1)]),undefined,undefined,resultId(2))).toThrow();
});
