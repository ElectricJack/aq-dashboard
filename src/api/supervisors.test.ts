import {adaptSupervisors,controlBody} from './supervisors';
import {adaptManualFleet} from '../features/agents/swarm/manualAgents';
// Shapes from aq-server 09ee5e98: crates/aq-supervisor-control/src/api.rs (`list`, `Control`),
// crates/aq-manual-sessions/src/intelligence.rs (`choices`, `Selection`) and tests/it_server/manual_agents.rs.
const id='e0000000-0000-4000-8000-000000000001',actor='e0000000-0000-4000-8000-000000000002';
const choice={snapshot_digest:'sha256:abc',profile_id:'manual-model',candidate_id:'openai:gpt-test:high',name:'Standard',provider:'openai',model:'gpt-test',reasoning:'high',harness:'codex'};
const stored={profile_id:'manual-model',candidate_id:'openai:gpt-test:high',name:'Standard',provider:'openai',model:'gpt-test',reasoning:'high',harness:'codex'};
const control=(extra:Record<string,unknown>={})=>({id,actor_id:actor,project_id:null,label:'Global supervisor',enabled:true,revision:1,profile:stored,phase:'stopped',stage:'Stopped',observed_at_ms:1,generation:1,session_id:null,last_error:null,...extra});
test('level choices without a version or options are read, with the snapshot they came from',()=>{
 const fleet=adaptSupervisors({supervisors:[control()],profiles:[choice],server_time_ms:2});
 expect(fleet.profiles[0]).toEqual(choice);expect(fleet.supervisors[0]!.unavailable_reason).toBeUndefined();
});
test('an enabled supervisor whose level no longer lists its candidate carries the reason',()=>{
 const reason='its level `manual-model` no longer lists gpt-test on codex; choose a level';
 const fleet=adaptSupervisors({supervisors:[control({unavailable_reason:reason})],profiles:[],server_time_ms:2});
 expect(fleet.supervisors[0]).toMatchObject({enabled:true,unavailable_reason:reason,profile:stored});
 expect(()=>adaptSupervisors({supervisors:[control({unavailable_reason:7})],profiles:[],server_time_ms:2})).toThrow();
});
test('a choice carried from the old catalog (other fields) does not blank the controls',()=>{
 expect(adaptSupervisors({supervisors:[control({profile:{profile_id:'engineering',profile_version:3,candidate_id:'codex',options:{}}})],profiles:[choice],server_time_ms:2}).supervisors).toHaveLength(1);
});
test('a non-Codex choice or a malformed one is refused',()=>{
 expect(()=>adaptSupervisors({supervisors:[],profiles:[{...choice,harness:'claude'}],server_time_ms:2})).toThrow();
 expect(()=>adaptSupervisors({supervisors:[],profiles:[{...choice,candidate_id:undefined}],server_time_ms:2})).toThrow();
});
test('the control body holds only what the server accepts',()=>{
 const draft={operation_id:id,expected_revision:0,enabled:true,intelligence_profile:{profile_id:'manual-model',profile_version:1,candidate_id:'openai:gpt-test:high'}} as never;
 expect(controlBody(draft)).toEqual({operation_id:id,expected_revision:0,enabled:true,intelligence_profile:{profile_id:'manual-model',candidate_id:'openai:gpt-test:high'}});
 expect(controlBody({operation_id:id,expected_revision:1,enabled:false})).toEqual({operation_id:id,expected_revision:1,enabled:false});
});
test('manual sessions read launch_profiles as level candidates',()=>{
 const fleet=adaptManualFleet({launch_profiles:[choice,{...choice,candidate_id:'anthropic:fixture-model:medium',provider:'anthropic',model:'fixture-model',reasoning:'medium',harness:'claude'}],sessions:[],workers:[],slots:[],projects:[],server_time_ms:2});
 expect(fleet.launch_profiles).toHaveLength(2);
 expect(()=>adaptManualFleet({launch_profiles:[{...choice,model:3}],sessions:[],workers:[],slots:[],projects:[],server_time_ms:2})).toThrow();
});
