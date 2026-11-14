import nonempty from '../../../contracts/pinned/dashboard-read/v1/fixtures/overview-nonempty.json';
import empty from '../../../contracts/pinned/dashboard-read/v1/fixtures/overview-empty.json';
import partial from '../../../contracts/pinned/dashboard-read/v1/fixtures/overview-partial.json';
import unknown from '../../../contracts/pinned/dashboard-read/v1/fixtures/overview-unknown.json';
import quota from '../../../contracts/pinned/dashboard-read/v1/fixtures/provider-usage-nonempty.json';
import stale from '../../../contracts/pinned/dashboard-read/v1/fixtures/provider-usage-stale.json';
import search from '../../../contracts/pinned/dashboard-read/v1/fixtures/search-nonempty.json';
import prior from '../../../contracts/live/fixtures/overview.json';
import { adaptOverview, adaptSearch } from './inspection';
import { adaptProviderUsage } from './providerUsage';
import schema from '../../../contracts/pinned/dashboard-read/v1/schema.json';
import { ATTENTION_SOURCE_LABEL } from './overview';
import { subjectPath } from '../../app/subjects';
import type { Overview, SearchResults, Envelope, ProviderUsage } from '../wire/proposed';
const overview = (v: unknown) => adaptOverview(v as Overview);
const usage = (v: unknown) => adaptProviderUsage(v as Envelope<ProviderUsage[]>);
test('G4 typed attention preserves nullable age, worker kind and digest outcome', () => {
 const view = overview(nonempty.data);
 expect(view.attention[0]?.kind).toBe('worker_offline');
 expect(view.attention[0]?.since).toBeNull();
 expect(view.attention[1]?.action).toBeNull();
 expect(view.recentOutcomes[0]?.outcome).toBe('process_failed');
 expect(view).toHaveProperty('sources', nonempty.data.sources);
});
test.each([empty,partial,unknown,prior])('G4 aggregate/prior compatibility preserves unknown counts', fixture => {
 const view=overview(fixture.data); expect(view.counts.ready.value).toBe(fixture.data.counts.ready.value);
});
test('G4 malformed references and collections are rejected', () => {
 const bad=structuredClone(nonempty);bad.data.attention[0]!.subject.revision='sha256:bad';
 expect(()=>overview(bad.data)).toThrow(/contract/i);
 expect(()=>overview({...nonempty.data,attention:{}})).toThrow(/contract/i);
 expect(()=>overview({...nonempty.data,in_motion:[null]})).toThrow(/contract/i);
 expect(()=>overview({...nonempty.data,recent_outcomes:[null]})).toThrow(/contract/i);
 expect(()=>adaptSearch({...search.data,sources:[{observation:{}}]})).toThrow(/contract/i);
});
test('G4 quota preserves account usage and stale observations',()=>{
 expect(usage(quota).providers[0]?.windows[0]?.usedPercent).toBe(25);
 expect(usage(stale).providers[0]?.windows[0]?.freshness).toBe('stale');
 expect(()=>usage({...quota,data:[{...quota.data[0],scope:'project'}]})).toThrow(/contract/i);
});
test('G4 search refs and per-group continuation are adapted',()=>{
 const view=adaptSearch(search.data as unknown as SearchResults);
 expect(view.groups[0]?.hits[0]?.ref.type).toBe('task');
 expect(view.groups[0]).toHaveProperty('nextCursor',search.data.groups[0]!.next_cursor);
});
test('internal work attention is labelled Internal work and opens the affected item, not the run',()=>{
 expect(schema.$defs.AttentionKind.enum).toContain('internal_work');
 const task='6a1f6c64-2b1e-4c8f-9a52-0d6f3c1e7b10';
 const run='0b3c2d4e-5f60-4718-8a9b-c0d1e2f3a4b5';
 const item={id:`internal_work:${run}`,kind:'internal_work',title:'Internal work failed',project:null,reason:'supervisor attempts exhausted',impact:'Review the owning record for current context',since:'2026-11-12T10:00:00.000Z',subject:{type:'task',id:task},action:null};
 const view=overview({...nonempty.data,attention:[item]});
 const adapted=view.attention[0]!;
 expect(adapted.kind).toBe('internal_work');
 expect(ATTENTION_SOURCE_LABEL[adapted.kind]).toBe('Internal work');
 expect(adapted.reason).toBe('supervisor attempts exhausted');
 expect(subjectPath(adapted.subject)).toBe(`/work/${task}`);
});
