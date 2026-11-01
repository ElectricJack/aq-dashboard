#!/usr/bin/env node
// Actual AQ + Graph + production UI. One intentional task write in a disposable fixture.
import {chromium,expect} from "@playwright/test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
const origin=new URL(process.env.AQ_LIVE_URL??"");
if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error("Explicit AQ_LIVE_URL origin required");
if(!["localhost","127.0.0.1","[::1]"].includes(origin.hostname)||process.env.AQ_LIVE_ALLOW_DISPOSABLE_TASK_CREATE!=="1")throw new Error("Explicit disposable loopback task-write qualification required");
const project=process.env.AQ_LIVE_PROJECT_ID;
if(!project||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(project))throw new Error("Actual disposable AQ_LIVE_PROJECT_ID required");
const output=process.env.AQ_LIVE_OUTPUT_DIR??await mkdtemp(join(tmpdir(),"aq-create-task-browser-"));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6000);
const errors=[],mutations=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(!["GET","HEAD"].includes(r.method()))mutations.push(r.method()+" "+new URL(r.url()).pathname);});
const started=performance.now();
try{
 const boot=await page.request.get(new URL("/api/v1/bootstrap",origin).href);expect(boot.status()).toBe(200);const bootstrap=await boot.json();expect(bootstrap.data.capabilities.some(c=>c.name==="tasks.create"&&c.version==="1"&&c.enabled)).toBe(true);
 const search=new URLSearchParams({scope:`project:${project}`}),url=new URL(`/work?${search}`,origin).href;
 await page.goto(url,{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{level:1,name:"Work",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Create task",exact:true}).click();const dialog=page.getByRole("dialog",{name:"Create task",exact:true});await expect(dialog).toBeVisible();
 const title=`Task creation qualification ${Date.now()}`;await dialog.getByRole("textbox",{name:"Title",exact:true}).fill(title);await dialog.getByRole("textbox",{name:"Description",exact:true}).fill("Disposable actual Graph task created through the AQ dashboard.");await dialog.getByRole("textbox",{name:"Acceptance criteria",exact:true}).fill("Creation returns a retained receipt, then reads this exact task. Reload only looks up the same operation.");
 await expect(dialog.getByRole("button",{name:"Create task",exact:true})).toBeEnabled();await page.screenshot({path:join(output,"create-task-desktop.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
 const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(391);await page.screenshot({path:join(output,"create-task-mobile.png")});
 await page.setViewportSize({width:1440,height:1100});
 const responsePromise=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname===`/api/human/projects/${project}/tasks`);
 await dialog.getByRole("button",{name:"Create task",exact:true}).click();const response=await responsePromise;expect(response.status()).toBe(200);const operation=await response.json(),bytes=response.request().postData(),request=JSON.parse(bytes);
 expect(operation.contract).toBe("human-task-create-1");expect(operation.state).toBe("confirmed");expect(operation.effect).toBe("confirmed");expect(operation.actor_id).toBe(bootstrap.data.principal.id);expect(operation.project_id).toBe(project);expect(operation.task_id).toBe(request.operation_id);expect(operation.operation_id).toBe(request.operation_id);expect(operation.receipt.task_id).toBe(request.operation_id);expect(operation.request_digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);expect(request.title).toBe(title);expect(request.task_state).toBe("draft");
 const statusDialog=page.getByRole("dialog",{name:"Task operation",exact:true});await expect(statusDialog.getByText("Task created and its record verified.",{exact:true})).toBeVisible();
 const operationUrl=page.url();expect(new URL(operationUrl).searchParams.get("operation")).toBe(operation.operation_id);expect(new URL(operationUrl).searchParams.size).toBe(2);await page.screenshot({path:join(output,"task-created-desktop.png"),fullPage:true});
 await page.reload({waitUntil:"domcontentloaded"});const restored=page.getByRole("dialog",{name:"Task operation",exact:true});await expect(restored.getByText("Task created and its record verified.",{exact:true})).toBeVisible();await expect(restored.getByRole("textbox",{name:"Title",exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);await page.screenshot({path:join(output,"task-created-mobile.png")});
 await restored.getByRole("link",{name:"Open created task",exact:true}).click();await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe(`/work/${operation.task_id}`);
 const actual=await page.request.get(new URL(`/api/human/projects/${project}/tasks/${operation.task_id}`,origin).href);expect(actual.status()).toBe(200);const record=await actual.json();expect(record.project.workspace_id).toBe(operation.receipt.workspace_id);expect(record.data.id).toBe(operation.task_id);expect(record.data.title).toBe(title);expect(record.data.task_state).toBe("draft");
 expect(errors).toEqual([]);expect(mutations).toEqual([`POST /api/human/projects/${project}/tasks`]);
 const result={passed:true,origin:origin.origin,project_id:project,operation_id:operation.operation_id,task_id:operation.task_id,request_digest:operation.request_digest,receipt:operation.receipt,served_product:bootstrap.data.product,elapsed_ms:Math.round(performance.now()-started),mutations,note:"Actual disposable Graph create, immutable request digest, retained receipt, current record read, reload lookup and desktop/phone composer. No provider calls or agent execution."};await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),page_errors:errors,mutations},null,2)+"\n");throw error;}finally{await browser.close();}
