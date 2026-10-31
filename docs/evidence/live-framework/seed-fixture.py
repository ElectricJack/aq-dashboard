import json,time,uuid,urllib.request
from pathlib import Path

def post(port,path,body,headers=None):
 request=urllib.request.Request(f'http://127.0.0.1:{port}{path}',json.dumps(body).encode(),{'Content-Type':'application/json',**(headers or {})},method='POST')
 with urllib.request.urlopen(request,timeout=5) as response:return json.load(response)
human={'X-AQ-Request':'1','Origin':'http://127.0.0.1:4188'}
code=post(4188,'/api/enrollments',{},human)['code']
node=post(4189,'/v1/worker/enroll',{'code':code,'name':'Dashboard fixture worker (no agents)','worker_version':'0.3.3','protocol_version':1})
machine={'Authorization':'Bearer '+node['credential']}
post(4189,'/v1/worker/heartbeat',{'worker_version':'0.3.3','protocol_version':1},machine)
identity={'node_id':node['node_id'],'boot_id':str(uuid.uuid4())}
post(4189,'/v2/worker/register',{'identity':identity,'operation_id':str(uuid.uuid4()),'protocol_version':2,'worker_version':'0.3.3','capabilities':['deterministic-agent-v1']},machine)
fixture=json.loads(Path('/home/jkern/dev/agent-q/vendor/aq-worker-protocol-0.2.0/fixtures/conformance-v2.json').read_text())
offer=next(item['body']['offers'][0] for item in fixture['valid'] if item['message']=='poll_response')
offer['offer_id']=str(uuid.uuid4());offer['identity']=identity
offer['attempt']={'attempt_id':str(uuid.uuid4()),'session_id':str(uuid.uuid4()),'generation':1}
offer['offer_expires_at_ms']=int(time.time()*1000)+100_000
post(4188,'/api/execution/fixtures',{'task_id':str(uuid.uuid4()),'offer':offer},human)
Path('/tmp/aq-dashboard-live-20261031/fixture-identity.json').write_text(json.dumps({'node_id':node['node_id'],'session_id':offer['attempt']['session_id'],'attempt_id':offer['attempt']['attempt_id'],'fixture':True}))
print('Created development-only fixture session; no grant or process:',offer['attempt']['session_id'])
