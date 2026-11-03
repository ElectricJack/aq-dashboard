#!/usr/bin/env node
// Actual G4 daemon + Graph contribution + production UI only. No interception/writes.
import {chromium,expect} from "@playwright/test";
import {mkdir,mkdtemp,writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
if(!process.env.AQ_LIVE_URL||!process.env.AQ_LIVE_PROJECT_ID)throw new Error("Actual G4 AQ_LIVE_URL and AQ_LIVE_PROJECT_ID are required; fixture preview is not live qualification");
const origin=new URL(process.env.AQ_LIVE_URL??"");
if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error("Explicit AQ_LIVE_URL origin required");
const project=process.env.AQ_LIVE_PROJECT_ID;
if(!project||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(project))throw new Error("Actual AQ_LIVE_PROJECT_ID required");
const output=process.env.AQ_LIVE_OUTPUT_DIR??await mkdtemp(join(tmpdir(),"aq-core-overview-browser-"));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6000);
const errors=[],mutations=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(!["GET","HEAD"].includes(r.method()))mutations.push(r.method()+" "+new URL(r.url()).pathname);});
const started=performance.now();
try{
 const boot=await page.request.get(new URL("/api/v1/bootstrap",origin).href);expect(boot.status()).toBe(200);const bootstrap=await boot.json();
 expect(bootstrap.data.capabilities.some(c=>c.name==="human.overview.tasks.read"&&c.version==="1"&&c.enabled)).toBe(true);
 const manifestResponse=await page.request.get(new URL('/dashboard-manifest.json',origin).href);expect(manifestResponse.status()).toBe(200);
 const bundleBytes=await manifestResponse.body();const bundleDigest=`sha256:${createHash('sha256').update(bundleBytes).digest('hex')}`;
 const localDigest=`sha256:${createHash('sha256').update(await readFile(new URL('../dist/dashboard-manifest.json',import.meta.url))).digest('hex')}`;
 expect(bundleDigest).toBe(localDigest);
 const scoped=new URLSearchParams({scope:`project:${project}`});
 const overviewResponse=await page.request.get(new URL(`/api/v1/overview?${scoped}`,origin).href);expect(overviewResponse.status()).toBe(200);const overview=await overviewResponse.json();
 expect(overview.api_version).toBe('dashboard-read-1');expect(overview.scope.project_id).toBe(project);expect(Array.isArray(overview.data.attention)).toBe(true);expect(Array.isArray(overview.data.in_motion)).toBe(true);expect(Array.isArray(overview.data.recent_outcomes)).toBe(true);expect(overview.data.sources.length).toBeGreaterThan(0);
 for(const count of Object.values(overview.data.counts))expect(count.value===null||typeof count.value==='number').toBe(true);
 const quotaCapability=bootstrap.data.capabilities.find(c=>c.name==='provider.quota');let quota=null;
 if(quotaCapability?.enabled){const response=await page.request.get(new URL('/api/v1/provider-usage',origin).href);expect(response.status()).toBe(200);quota=await response.json();expect(quota.scope.kind).toBe('all_authorized');for(const account of quota.data){expect(account.scope).toBe('provider_account');for(const win of account.windows)expect(win.used_percent==null||typeof win.used_percent==='number'&&win.used_percent>=0&&win.used_percent<=100).toBe(true);}}
 const params=new URLSearchParams({project_id:project,project_limit:"4",task_limit:"16"});const response=await page.request.get(new URL(`/api/human/overview/tasks?${params}`,origin).href);expect(response.status()).toBe(200);
 const source=await response.json();expect(source.contract).toBe("human-overview-tasks-1");expect(source.scope.project_id).toBe(project);
 const observed=source.projects.find(p=>p.project.id===project&&p.source_status==="available"&&p.tasks.length>0);expect(observed).toBeTruthy();
 const task=observed.tasks[0];
 const searchParams=new URLSearchParams({scope:`project:${project}`,q:task.title.slice(0,40),limit:'2'});
 const searchResponse=await page.request.get(new URL(`/api/v1/search?${searchParams}`,origin).href);expect(searchResponse.status()).toBe(200);const searchRead=await searchResponse.json();expect(searchRead.data.groups.map(g=>g.type).sort()).toEqual(['knowledge','playbook','result','session','task']);
 for(const group of searchRead.data.groups){if(!group.next_cursor)continue;const nextParams=new URLSearchParams(searchParams);nextParams.set('types',group.type);nextParams.set('cursor',group.next_cursor);const nextUrl=new URL(`/api/v1/search?${nextParams}`,origin).href;const next=await page.request.get(nextUrl),replay=await page.request.get(nextUrl);expect(next.status()).toBe(200);expect(replay.status()).toBe(200);const nextBody=await next.json();expect(nextBody.data.snapshot_id).toBe(searchRead.data.snapshot_id);expect((await replay.json()).data).toEqual(nextBody.data);}
const search=new URLSearchParams({scope:`project:${project}`});const url=new URL(`/overview?${search}`,origin).href;
 await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{level:1,name:"Overview"})).toBeVisible();
 await page.getByText('Recorded task details',{exact:true}).click();
 const tasks=page.getByRole("region",{name:"Recorded tasks"});await expect(tasks.getByRole("heading",{name:observed.project.name,exact:true})).toBeVisible();
 const taskLink=tasks.getByRole("link",{name:task.title,exact:true});await expect(taskLink).toBeVisible();await expect(taskLink).toHaveAttribute("href",`/work/${task.id}?scope=project%3A${project}`);
 await expect(tasks).toContainText("Active records do not establish running agents or execution readiness");
 const infrastructure=page.getByRole("complementary",{name:"Infrastructure observations"});await expect(infrastructure.getByRole("heading",{name:"Worker nodes",exact:true})).toBeVisible();
 const left=await tasks.boundingBox(),right=await infrastructure.boundingBox();expect(right.x).toBeGreaterThan(left.x+left.width-1);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,"overview-desktop.png"),fullPage:true});
 await taskLink.click();await expect(page).toHaveURL(new RegExp(`/work/${task.id}\\?scope=project%3A${project}$`));await expect(page.getByRole("heading",{name:task.title,exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.goto(url,{waitUntil:"domcontentloaded"});await page.getByText("Recorded task details",{exact:true}).click();await expect(page.getByRole("region",{name:"Recorded tasks"}).getByRole("link",{name:task.title,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,"overview-mobile.png"),fullPage:true});await page.screenshot({path:join(output,"overview-mobile-viewport.png")});
 await page.setViewportSize({width:320,height:740});await page.goto(url,{waitUntil:'networkidle'});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(page.getByRole('navigation',{name:'Primary (compact)',exact:true})).toBeInViewport();await page.screenshot({path:join(output,'overview-320-viewport.png')});
 expect(errors).toEqual([]);expect(mutations).toEqual([]);
 const result={passed:true,bundle_manifest_sha256:bundleDigest,overview_sources:overview.data.sources,quota_coverage:quota?.coverage??null,search_snapshot_id:searchRead.data.snapshot_id,browser_interception:false,origin:origin.origin,project_id:project,task_id:task.id,contract:source.contract,coverage:source.coverage,count_accuracy:observed.count_accuracy,task_counts:observed.task_counts,served_product:bootstrap.data.product,elapsed_ms:Math.round(performance.now()-started),note:"Actual bounded recorded-task contribution and core layout; no running/readiness/capacity/quota inference."};await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),page_errors:errors,mutations},null,2)+"\n");throw error;}finally{await browser.close();}
