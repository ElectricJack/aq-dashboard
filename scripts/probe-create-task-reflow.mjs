#!/usr/bin/env node
// Read-only final-bundle reflow/focus review of an already-confirmed operation.
import {chromium,expect} from "@playwright/test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
const origin=new URL(process.env.AQ_LIVE_URL??"");
if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error("Explicit AQ_LIVE_URL origin required");
const project=process.env.AQ_LIVE_PROJECT_ID,operation=process.env.AQ_LIVE_OPERATION_ID,uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
if(!uuid.test(project??"")||!uuid.test(operation??""))throw new Error("Existing project and confirmed operation UUIDs required");
const output=process.env.AQ_LIVE_OUTPUT_DIR??await mkdtemp(join(tmpdir(),"aq-create-task-reflow-"));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(6000);const errors=[],mutations=[],viewports=[];
page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(!["GET","HEAD"].includes(r.method()))mutations.push(r.method()+" "+new URL(r.url()).pathname);});
const started=performance.now();
try{
 const bootstrap=await (await page.request.get(new URL("/api/v1/bootstrap",origin).href)).json();
 const current=await page.request.get(new URL(`/api/human/projects/${project}/tasks/${operation}`,origin).href);expect(current.status()).toBe(200);const task=await current.json();expect(task.data.id).toBe(operation);
 for(const [name,width,height] of [["desktop",1440,1100],["mobile",390,844],["narrow",320,740]]){
  await page.setViewportSize({width,height});await page.goto(new URL(`/work?${new URLSearchParams({scope:`project:${project}`,operation})}`,origin).href,{waitUntil:"domcontentloaded"});
  const status=page.getByRole("dialog",{name:"Task operation",exact:true});await expect(status.getByText("Task created and its record verified.",{exact:true})).toBeVisible();await expect(status).toContainText("Creating a task does not start an agent.");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);const bounds=await status.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  await page.keyboard.press("Tab");expect(await page.evaluate(()=>!!document.activeElement?.closest("dialog"))).toBe(true);
  await page.screenshot({path:join(output,`task-created-${name}.png`)});
  await page.keyboard.press("Escape");await expect(status).not.toBeVisible();await page.getByRole("button",{name:"Task operation",exact:true}).click();await expect(status).toBeVisible();
  await status.getByRole("link",{name:"Open created task",exact:true}).click();await expect(page.getByRole("heading",{name:task.data.title,exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toBe(`/work/${operation}`);await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(new URL(`/work?${new URLSearchParams({scope:`project:${project}`,operation})}`,origin).href,{waitUntil:"domcontentloaded"});await expect(status.getByText("Task created and its record verified.",{exact:true})).toBeVisible();
  await status.getByRole("button",{name:"Start another task",exact:true}).click();const composer=page.getByRole("dialog",{name:"Create task",exact:true});await expect(composer).toContainText("Creating a task does not start an agent.");await expect(composer.getByRole("textbox",{name:"Title",exact:true})).toHaveValue("");
  await composer.getByRole("textbox",{name:"Title",exact:true}).fill("Local draft — not submitted");await composer.getByRole("textbox",{name:"Description",exact:true}).fill("Read-only responsive qualification.\nThis draft stays in browser memory.");await composer.getByRole("textbox",{name:"Acceptance criteria",exact:true}).fill("The existing confirmed task is unchanged.");
  await expect(composer.getByRole("button",{name:"Create task",exact:true})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);const formBounds=await composer.boundingBox();expect(formBounds.x).toBeGreaterThanOrEqual(0);expect(formBounds.x+formBounds.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:join(output,`create-task-${name}.png`)});viewports.push({name,width,height,horizontal_overflow:false,modal_focus_contained:true,escape_and_reopen:true});
 }
 expect(errors).toEqual([]);expect(mutations).toEqual([]);
 const result={passed:true,origin:origin.origin,project_id:project,operation_id:operation,served_product:bootstrap.data.product,viewports,mutations,elapsed_ms:Math.round(performance.now()-started),note:"Read-only existing-receipt lookup, scope-picker/form reflow and native modal interaction; all fresh drafts discarded without submission."};await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(output,"failure.png")}).catch(()=>{});await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),page_errors:errors,mutations},null,2)+"\n");throw error;}finally{await browser.close();}
