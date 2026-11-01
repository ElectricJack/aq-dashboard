#!/usr/bin/env node
// Actual AQ human API -> actual configured Graph only. No interception or writes.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:","https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Explicit AQ human-listener origin required");
const fixturePath = process.env.AQ_LIVE_GRAPH_FIXTURE;
if (!fixturePath) throw new Error("AQ_LIVE_GRAPH_FIXTURE must name the explicit labelled local fixture metadata");
const fixture = JSON.parse(await readFile(fixturePath,"utf8"));
const project = fixture.project_id, taskId = fixture.nodes?.work, knowledgeId = fixture.nodes?.knowledge;
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
if (![project,taskId,knowledgeId].every(v=>typeof v === "string" && uuid.test(v))) throw new Error("Explicit project/task/document identities required");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-human-graph-browser";
await mkdir(output,{recursive:true});
const started = performance.now(), browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1100}});
page.setDefaultTimeout(7000);
const mutations=[], errors=[], humanReads=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>{
  if (!["GET","HEAD"].includes(r.method())) mutations.push({method:r.method(),path:new URL(r.url()).pathname});
  const path=new URL(r.url()).pathname;
  if(path.startsWith("/api/human/")) humanReads.push(path);
});
async function read(path) {
  const response=await page.request.get(new URL(path,origin).href);
  expect(response.status(),path).toBe(200);
  const value=await response.json();
  if(path.startsWith("/api/human/")) { expect(value.contract).toBe("human-graph-1");expect(value.project.id).toBe(project); }
  return value;
}
const scope=new URLSearchParams({scope:`project:${project}`}).toString();
const human=`/api/human/projects/${project}`;
const screenshot=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name),fullPage:true});};
try {
  const bootstrap=await read("/api/v1/bootstrap");
  for(const name of ["human.graph.read","tasks.read","knowledge.read","search.read"]) expect(bootstrap.data.capabilities.some(c=>c.name===name&&c.version==="1"&&c.enabled===true),name).toBe(true);
  const tasks=await read(`${human}/tasks?limit=25`), task=(await read(`${human}/tasks/${taskId}`)).data;
  expect(tasks.data.items.some(n=>n.id===taskId)).toBe(true);
  const graph=(await read(`${human}/tasks/${taskId}/graph`)).data;
  expect(graph.nodes.some(n=>n.id===taskId)).toBe(true);
  expect(graph.edges.length).toBeGreaterThan(0);
  const knowledgePage=await read(`${human}/knowledge?limit=25`), knowledge=(await read(`${human}/knowledge/${knowledgeId}`)).data;
  expect(knowledgePage.data.items.some(n=>n.id===knowledgeId)).toBe(true);
  const pinned=(await read(`${human}/knowledge/${knowledgeId}?revision=${encodeURIComponent(knowledge.content_revision)}`)).data;
  expect(pinned.content_revision).toBe(knowledge.content_revision);

  await page.goto(new URL(`/work?${scope}`,origin).href);
  const taskList=page.getByRole("list",{name:"Tasks",exact:true});
  await taskList.getByRole("link").filter({hasText:task.title}).click();
  const taskDetail=page.getByRole("region",{name:task.title,exact:true});
  await expect(taskDetail).toBeVisible();await expect(taskDetail.getByText(task.body,{exact:true})).toBeVisible();
  await expect(taskDetail.getByText(`Current revision ${task.content_revision}`,{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get("scope")).toBe(`project:${project}`);
  await screenshot("work-detail-desktop.png");
  await page.getByRole("navigation",{name:"Work view"}).getByRole("button",{name:"Graph",exact:true}).click();
  const neighborhood=page.getByRole("region",{name:"Dependency graph",exact:true});
  await expect(neighborhood.getByText(/one-hop neighborhood/)).toBeVisible();
  for(const node of graph.nodes) await expect(neighborhood.getByRole("link").filter({hasText:node.title})).toBeVisible();
  await screenshot("work-graph-desktop.png");
  await page.goBack();await expect(taskDetail).toBeVisible();
  await page.reload();await expect(taskDetail.getByText(`Current revision ${task.content_revision}`,{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(taskDetail.getByRole("link",{name:"All tasks",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await screenshot("work-detail-mobile.png");
  await taskDetail.getByRole("link",{name:"All tasks",exact:true}).click();await expect(taskList).toBeVisible();

  await page.setViewportSize({width:1440,height:1100});
  await page.goto(new URL(`/knowledge/${knowledgeId}?${scope}`,origin).href);
  const document=page.getByRole("region",{name:knowledge.title,exact:true});
  await expect(document.getByText(knowledge.body,{exact:true})).toBeVisible();
  await expect(document.getByText(`Current revision ${knowledge.content_revision}`,{exact:true})).toBeVisible();
  await screenshot("knowledge-content-desktop.png");
  await document.getByRole("button",{name:`Sources (${knowledge.provenance.length})`,exact:true}).click();
  if(knowledge.provenance.length) await expect(document.getByRole("list",{name:"Recorded sources"}).getByRole("listitem")).toHaveCount(knowledge.provenance.length);
  await document.getByRole("button",{name:"Record & revisions",exact:true}).click();
  await expect(document.getByText("Record version",{exact:true}).locator("xpath=following-sibling::dd[1]")).toHaveText(knowledge.version);
  await document.getByLabel("Exact content revision").fill(knowledge.content_revision);
  await document.getByRole("button",{name:"View revision",exact:true}).click();
  await expect(document.getByText(`Pinned revision ${pinned.content_revision}`,{exact:true})).toBeVisible();
  await screenshot("knowledge-pinned-desktop.png");
  await page.reload();await expect(document.getByText(`Pinned revision ${pinned.content_revision}`,{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(document.getByRole("link",{name:"All records",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await screenshot("knowledge-pinned-mobile.png");
  await document.getByRole("link",{name:"All records",exact:true}).click();
  await expect(page.getByRole("list",{name:"Knowledge records",exact:true})).toBeVisible();

  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole("banner").getByRole("button",{name:"Search",exact:true}).click();
  const search=page.getByRole("dialog",{name:"Search",exact:true});
  const q=task.title.match(/[A-Za-z]{4,}/)?.[0]??task.title;
  await search.getByRole("searchbox",{name:"Search",exact:true}).fill(q);
  await expect(search.getByRole("link").filter({hasText:task.title})).toBeVisible();
  const href=await search.getByRole("link").filter({hasText:task.title}).getAttribute("href");
  expect(new URL(href,origin).searchParams.get("scope")).toBe(`project:${project}`);
  await screenshot("graph-search-desktop.png");
  const knowledgeQuery=knowledge.title.match(/[A-Za-z]{4,}/)?.[0]??knowledge.title;
  await search.getByRole("searchbox",{name:"Search",exact:true}).fill(knowledgeQuery);
  await expect(search.getByRole("link").filter({hasText:knowledge.title})).toBeVisible();
  await search.getByRole("link").filter({hasText:knowledge.title}).click();await expect(document).toBeVisible();
  await expect(page.getByText(/Mock data/)).toHaveCount(0);expect(mutations).toEqual([]);expect(errors).toEqual([]);
  const result={passed:true,origin:origin.origin,project_id:project,task_id:taskId,task_revision:task.content_revision,knowledge_id:knowledgeId,knowledge_revision:knowledge.content_revision,task_rows:tasks.data.items.length,knowledge_rows:knowledgePage.data.items.length,graph_nodes:graph.nodes.length,graph_edges:graph.edges.length,human_reads:humanReads.length,mutations:mutations.length,page_errors:errors.length,elapsed_ms:Math.round(performance.now()-started),output,note:"Actual AQ human API and actual configured Graph; labelled local fixture, no interception or domain mutations. Current and exact pinned revision inspected; no older-history claim."};
  await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
} catch(error) {
  await screenshot("failure.png").catch(()=>{});
  await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),url:page.url(),human_reads:humanReads,mutations,page_errors:errors},null,2)+"\n");
  throw error;
} finally {await browser.close();}
