import { vi } from 'vitest';
import { manualSession } from './sessionHistory';
const id='10000000-0000-4000-8000-000000000001';
const session={id,node_id:id,project_id:id,spec:{project_name:'Fixture',repository_id:id,provider:'openai',model:'model'},status:'stopped',stage:'done',desired_running:false,created_at_ms:1,updated_at_ms:2,worker_seen_at_ms:null};
function response(v:unknown){return new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});}
afterEach(()=>vi.unstubAllGlobals());
test('loads session details without saved output', async () => {
 const fetcher=vi.fn().mockResolvedValue(response(session));
 vi.stubGlobal('fetch',fetcher);
 await expect(manualSession(id,new AbortController().signal)).resolves.toEqual(session);
 expect(fetcher.mock.calls[0]![0]).toBe(`/api/manual-agents/${id}`);
});
test('rejects metadata for a different session', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({...session,id:'20000000-0000-4000-8000-000000000002'})));
 await expect(manualSession(id,new AbortController().signal)).rejects.toThrow(/Invalid manual session/);
});
