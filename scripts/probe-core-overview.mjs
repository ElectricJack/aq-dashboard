#!/usr/bin/env node
// Actual daemon + Graph contribution + production UI only. No interception/writes.
import {chromium,expect} from "@playwright/test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
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
 const params=new URLSearchParams({project_id:project,project_limit:"4",task_limit:"16"});const response=await page.request.get(new URL(`/api/human/overview/tasks?${params}`,origin).href);expect(response.status()).toBe(200);
 const source=await response.json();expect(source.contract).toBe("human-overview-tasks-1");expect(source.scope.project_id).toBe(project);
 const observed=source.projects.find(p=>p.project.id===project&&p.source_status==="available"&&p.tasks.length>0);expect(observed).toBeTruthy();
 const task=observed.tasks[0];const search=new URLSearchParams({scope:`project:${project}`});const url=new URL(`/overview?${search}`,origin).href;
 await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{level:1,name:"Overview"})).toBeVisible();
 const tasks=page.getByRole("region",{name:"Recorded tasks"});await expect(tasks.getByRole("heading",{name:observed.project.name,exact:true})).toBeVisible();
 const taskLink=tasks.getByRole("link",{name:task.title,exact:true});await expect(taskLink).toBeVisible();await expect(taskLink).toHaveAttribute("href",`/work/${task.id}?scope=project%3A${project}`);
 await expect(tasks).toContainText("Active records do not establish running agents or execution readiness");
 const infrastructure=page.getByRole("complementary",{name:"Infrastructure observations"});await expect(infrastructure.getByRole("heading",{name:"Worker nodes",exact:true})).toBeVisible();
 const left=await tasks.boundingBox(),right=await infrastructure.boundingBox();expect(right.x).toBeGreaterThan(left.x+left.width-1);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,"overview-desktop.png"),fullPage:true});
 await taskLink.click();await expect(page).toHaveURL(new RegExp(`/work/${task.id}\\?scope=project%3A${project}$`));await expect(page.getByRole("heading",{name:task.title,exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.getByRole("region",{name:"Recorded tasks"}).getByRole("link",{name:task.title,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,"overview-mobile.png"),fullPage:true});await page.screenshot({path:join(output,"overview-mobile-viewport.png")});
 expect(errors).toEqual([]);expect(mutations).toEqual([]);
 const result={passed:true,origin:origin.origin,project_id:project,task_id:task.id,contract:source.contract,coverage:source.coverage,count_accuracy:observed.count_accuracy,task_counts:observed.task_counts,served_product:bootstrap.data.product,elapsed_ms:Math.round(performance.now()-started),note:"Actual bounded recorded-task contribution and core layout; no running/readiness/capacity/quota inference."};await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),page_errors:errors,mutations},null,2)+"\n");throw error;}finally{await browser.close();}
