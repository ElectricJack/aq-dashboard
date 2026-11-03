import { http, HttpResponse } from 'msw';
import requirements from '../app/bundle-requirements.json';
import bootstrap from '../../contracts/pinned/dashboard-read/v1/fixtures/bootstrap.json';
import overview from '../../contracts/pinned/dashboard-read/v1/fixtures/overview-nonempty.json';
import quota from '../../contracts/pinned/dashboard-read/v1/fixtures/provider-usage-nonempty.json';
import projects from '../../contracts/pinned/dashboard-read/v1/fixtures/projects.json';
import sessions from '../../contracts/pinned/dashboard-read/v1/fixtures/sessions.json';
import search from '../../contracts/pinned/dashboard-read/v1/fixtures/search-nonempty.json';
/** Owner-produced synthetic fixtures, not live resource handles. */
export function g4Handlers() {
 return [http.get('/api/workers',()=>HttpResponse.json([])),http.get('/api/v1/bootstrap',()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:requirements.required_capabilities.map(name=>({name,version:'1',enabled:['dashboard.overview','projects.read','sessions.read','search.read','provider.quota','workers.read'].includes(name),reason:'Unavailable in labelled G5 UI fixture'}))}})),http.get('/api/v1/overview',()=>HttpResponse.json(overview)),http.get('/api/v1/provider-usage',()=>HttpResponse.json(quota)),http.get('/api/v1/projects',()=>HttpResponse.json(projects)),http.get('/api/v1/sessions',()=>HttpResponse.json(sessions)),http.get('/api/v1/search',()=>HttpResponse.json(search))];
}
