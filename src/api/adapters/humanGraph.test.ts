import { adaptGraphDetail,adaptGraphPage,adaptGraphNeighborhood,mergeGraphPages } from "./humanGraph";
import {graphEnvelope,graphNode,graphId,graphProject} from "../../test/humanGraph";

test("retains exact revision strings beyond safe JS integers",()=>{
 const n=graphNode();expect(adaptGraphDetail(graphEnvelope(n),graphProject,"knowledge",n.id).data.version).toBe("9007199254740993");
 expect(()=>adaptGraphDetail(graphEnvelope({...n,version:9007199254740992}),graphProject,"knowledge",n.id)).toThrow();
});
test("refuses foreign project, different record identity and wrong pinned revision",()=>{
 const n=graphNode();expect(()=>adaptGraphDetail(graphEnvelope(n),graphId(3),"knowledge",n.id)).toThrow();
 expect(()=>adaptGraphDetail(graphEnvelope(n),graphProject,"knowledge",graphId(20))).toThrow();
 expect(()=>adaptGraphDetail(graphEnvelope(n),graphProject,"knowledge",n.id,"3")).toThrow();
});
test("bounds record body and page size, rejects duplicate nodes",()=>{
 const n=graphNode();for(const items of [[n,n],Array.from({length:26},(_,i)=>graphNode("knowledge",i+10))])expect(()=>adaptGraphPage(graphEnvelope({items,next_cursor:null}),graphProject,"knowledge")).toThrow();
 expect(()=>adaptGraphDetail(graphEnvelope({...n,body:"x".repeat(262145)}),graphProject,"knowledge",n.id)).toThrow();
});
test("rejects binding drift and duplicates across pages",()=>{
 const a=adaptGraphPage(graphEnvelope({items:[graphNode()],next_cursor:"next"}),graphProject,"knowledge");
 const b=adaptGraphPage(graphEnvelope({items:[graphNode("knowledge",11)],next_cursor:null},"2"),graphProject,"knowledge");
 expect(()=>mergeGraphPages([a,b])).toThrow();expect(()=>mergeGraphPages([a,a])).toThrow();
});
test("keeps explicit graph truncation and rejects edges to omitted records",()=>{
 const root=graphNode("task"),n=graphNode("task",11),edge={id:graphId(50),source:root.id,target:n.id,edge_type:"blocks",description:"must precede",version:"1",source_revision:"4",target_revision:"4"};
 const valid={root_id:root.id,nodes:[root,n],edges:[edge],truncated:true};
 expect(adaptGraphNeighborhood(graphEnvelope(valid),graphProject,root.id).data.truncated).toBe(true);
 expect(()=>adaptGraphNeighborhood(graphEnvelope({...valid,nodes:[root]}),graphProject,root.id)).toThrow();
});

test.each(["task", "knowledge"] as const)("%s titles accept 512 Unicode scalars including supplementary emoji", kind => {
 const n=graphNode(kind);
 for (const title of ["😀".repeat(512), "a".repeat(511)+"😀"]) {
  expect(adaptGraphDetail(graphEnvelope({...n,title}),graphProject,kind,n.id).data.title).toBe(title);
 }
 for (const title of ["😀".repeat(513), "a".repeat(512)+"😀"]) {
  expect(()=>adaptGraphDetail(graphEnvelope({...n,title}),graphProject,kind,n.id)).toThrow();
 }
});
test.each(["\0", "valid\0title", "\ud800", "\udfff", "a\ud800b", "a\udfffb", "  "])("rejects malformed or empty Graph title %j", title => {
 const n=graphNode("task");
 expect(()=>adaptGraphDetail(graphEnvelope({...n,title}),graphProject,"task",n.id)).toThrow();
});

test("accepts a dependency action edge without an optional description",()=>{
 const root=graphNode("task"),blocker=graphNode("task",11);
 const edge={id:graphId(50),source:blocker.id,target:root.id,edge_type:"blocks",description:null,version:"1",source_revision:null,target_revision:null};
 expect(adaptGraphNeighborhood(graphEnvelope({root_id:root.id,nodes:[root,blocker],edges:[edge],truncated:false}),graphProject,root.id).data.edges[0]?.description).toBeNull();
});
