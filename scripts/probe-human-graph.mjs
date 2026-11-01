#!/usr/bin/env node
// Actual AQ human API -> actual configured Graph only. No interception or writes.
import { createHash } from "node:crypto";
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
async function expectDocumentBody(container, body) {
  const preview=container.locator("[data-document-body]").first();
  for(const line of body.split(/\r?\n/).filter(line=>line.trim()&&!/^\s*```/.test(line))) {
    const readable=line.replace(/^#{1,6}\s+/,"").replace(/^\s*(?:[-+*]|\d+\.)\s+/,"");
    await expect(preview).toContainText(readable);
  }
}
const scope=new URLSearchParams({scope:`project:${project}`}).toString();
const human=`/api/human/projects/${project}`;
const screenshot=async (name,target=page)=>{
  await target.evaluate(()=>window.scrollTo(0,0));
  await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const bounds=await target.locator("h2").evaluateAll(elements=>elements.map(element=>{
    const container=element.closest("section");const text=element.firstChild;
    if(!container||!text)return null;
    const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(1,text.textContent.length));
    const first=range.getBoundingClientRect(),outer=container.getBoundingClientRect();
    return {title:element.textContent,first_left:first.left,first_right:first.right,container_left:outer.left,container_right:outer.right};
  }).filter(Boolean));
  for(const value of bounds){expect(value.first_left).toBeGreaterThanOrEqual(value.container_left);expect(value.first_right).toBeLessThanOrEqual(value.container_right);}
  await writeFile(join(output,name+".bounds.json"),JSON.stringify(bounds,null,2)+"\n");
  await target.screenshot({path:join(output,name),fullPage:!name.includes("mobile"),animations:"disabled"});
};
try {
  const bootstrap=await read("/api/v1/bootstrap");
  let servedBundleDigest=bootstrap.data.product.dashboard_digest;
  if(process.env.AQ_LIVE_CANDIDATE_MANIFEST) {
    const bytes=await readFile(process.env.AQ_LIVE_CANDIDATE_MANIFEST);
    const manifestResponse=await page.request.get(new URL("/dashboard-manifest.json",origin).href);
    expect(manifestResponse.status()).toBe(200);
    const served=await manifestResponse.body();
    expect(createHash("sha256").update(served).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    servedBundleDigest=`sha256:${createHash("sha256").update(served).digest("hex")}`;
  }
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
  await expect(taskDetail).toBeVisible();await expectDocumentBody(taskDetail,task.body);
  await expect(taskDetail.getByText(`Current revision ${task.content_revision}`,{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get("scope")).toBe(`project:${project}`);
  await screenshot("work-detail-desktop.png");
  await page.getByRole("navigation",{name:"Work view"}).getByRole("button",{name:"Graph",exact:true}).click();
  const neighborhood=page.getByRole("region",{name:"Dependency graph",exact:true});
  await expect(neighborhood.getByText(/one-hop neighborhood/)).toBeVisible();
  for(const node of graph.nodes) await expect(neighborhood.getByRole("link").filter({hasText:node.title})).toBeVisible();
  const desktopCanvas=neighborhood.getByRole("region",{name:"Scrollable task graph",exact:true});
  const graphBox=await neighborhood.boundingBox(), inspectorBox=await taskDetail.boundingBox();
  expect(graphBox.width).toBeGreaterThan(inspectorBox.width);
  const desktopFit=await desktopCanvas.evaluate(element=>element.scrollWidth<=element.clientWidth+1);
  if(graph.nodes.length<=2) expect(desktopFit,"bounded fixture graph fits the desktop workspace without reducing label size").toBe(true);
  await screenshot("work-graph-desktop.png");
  const neighbor=graph.nodes.find(node=>node.id!==taskId);
  if(neighbor) {
    const link=neighborhood.getByRole("link").filter({hasText:neighbor.title});
    await link.click();
    await expect(page.getByRole("region",{name:neighbor.title,exact:true})).toBeVisible();
    await expect(neighborhood).toBeVisible();await expect(link).toHaveAttribute("aria-current","page");
    expect(new URL(page.url()).searchParams.get("view")).toBe("graph");
    expect(new URL(page.url()).searchParams.get("root")).toBe(taskId);
    await screenshot("work-graph-selection-desktop.png");
    await page.goBack();await expect(taskDetail).toBeVisible();
  }
  await page.goBack();await expect(taskDetail).toBeVisible();
  await page.reload();await expect(taskDetail.getByText(`Current revision ${task.content_revision}`,{exact:true})).toBeVisible();
  await page.goto(new URL(`/knowledge/${knowledgeId}?${scope}`,origin).href);
  const document=page.getByRole("region",{name:knowledge.title,exact:true});
  await expectDocumentBody(document,knowledge.body);
  await expect(document.getByText(`Current revision ${knowledge.content_revision}`,{exact:true})).toBeVisible();
  await screenshot("knowledge-content-desktop.png");
  await document.getByRole("button",{name:`Sources (${knowledge.provenance.length})`,exact:true}).click();
  if(knowledge.provenance.length) await expect(document.getByRole("list",{name:"Recorded sources"}).getByRole("listitem")).toHaveCount(knowledge.provenance.length);
  await document.getByRole("button",{name:"History",exact:true}).click();
  await document.getByText("Record details",{exact:true}).click();
  await expect(document.getByText("Record version",{exact:true}).locator("xpath=following-sibling::dd[1]")).toHaveText(knowledge.version);
  await document.getByLabel("Exact content revision").fill(knowledge.content_revision);
  await document.getByRole("button",{name:"View revision",exact:true}).click();
  await expect(document.getByText(`Pinned revision ${pinned.content_revision}`,{exact:true})).toBeVisible();
  await screenshot("knowledge-pinned-desktop.png");
  await page.reload();await expect(document.getByText(`Pinned revision ${pinned.content_revision}`,{exact:true})).toBeVisible();
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
  // Use a fresh phone viewport: resizing one browser page between widths can
  // retain stale compositor text clips in full-page screenshots despite valid DOM bounds.
  const phone=await browser.newPage({viewport:{width:390,height:844}});
  phone.on("pageerror",e=>errors.push(e.message));
  phone.on("request",r=>{if(!["GET","HEAD"].includes(r.method()))mutations.push({method:r.method(),path:new URL(r.url()).pathname});});
  await phone.goto(new URL(`/work/${taskId}?${scope}`,origin).href);
  const phoneTask=phone.getByRole("region",{name:task.title,exact:true});
  await expect(phoneTask.getByRole("link",{name:"All tasks",exact:true})).toBeVisible();
  expect(await phone.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await screenshot("work-detail-mobile.png",phone);
  await phone.getByRole("navigation",{name:"Work view"}).getByRole("button",{name:"Graph",exact:true}).click();
  const phoneGraph=phone.getByRole("region",{name:"Dependency graph",exact:true});
  await expect(phoneGraph.getByText(/one-hop neighborhood/)).toBeVisible();
  const canvas=phoneGraph.getByRole("region",{name:"Scrollable task graph",exact:true});
  if(graph.nodes.length>1) {
    await expect(phoneGraph.getByRole("button",{name:"Pan right",exact:true})).toBeVisible();
    await phoneGraph.getByRole("button",{name:"Pan right",exact:true}).click();
    await expect.poll(()=>canvas.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  }
  await expect.poll(()=>canvas.evaluate(element=>{
    const clip=element.getBoundingClientRect();
    return [...element.querySelectorAll("a")].filter(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=clip.left-1&&bounds.right<=clip.right+1;}).length;
  }),{message:"phone smooth-pan settles with a complete readable node"}).toBeGreaterThan(0);
  const visibleNodes=await canvas.evaluate(element=>{
    const clip=element.getBoundingClientRect();
    return [...element.querySelectorAll("a")].map(node=>node.getBoundingClientRect().toJSON()).filter(bounds=>bounds.left>=clip.left-1&&bounds.right<=clip.right+1);
  });
  expect(visibleNodes.length,"phone graph has a horizontally readable node after panning").toBeGreaterThan(0);
  const graphPhoneNav=await phone.getByRole("navigation",{name:"Primary (compact)",exact:true}).boundingBox();
  expect(visibleNodes[0].top,"phone graph exposes actual nodes within the first viewport").toBeLessThan(844*.85);
  expect(visibleNodes[0].bottom,"phone graph node is readable above fixed phone navigation").toBeLessThanOrEqual(graphPhoneNav.y);
  await screenshot("work-graph-mobile.png",phone);
  await phone.getByRole("navigation",{name:"Work view"}).getByRole("button",{name:"List",exact:true}).click();
  await phoneTask.getByRole("link",{name:"All tasks",exact:true}).click();await expect(phone.getByRole("list",{name:"Tasks",exact:true})).toBeVisible();
  await phone.goto(new URL(`/knowledge/${knowledgeId}?${scope}&revision=${encodeURIComponent(knowledge.content_revision)}`,origin).href);
  const phoneDocument=phone.getByRole("region",{name:knowledge.title,exact:true});
  await expect(phoneDocument.getByText(`Pinned revision ${pinned.content_revision}`,{exact:true})).toBeVisible();
  expect(await phone.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  const phoneBody=phoneDocument.locator("[data-document-body]").first();
  const firstParagraph=await phoneBody.locator("p").first().boundingBox();
  const phoneNav=await phone.getByRole("navigation",{name:"Primary (compact)",exact:true}).boundingBox();
  expect(firstParagraph.y,"document body begins within the first phone viewport").toBeLessThan(844*.8);
  expect((firstParagraph.y+firstParagraph.height),"first document paragraph is readable above fixed phone navigation").toBeLessThanOrEqual(phoneNav.y);
  await screenshot("knowledge-pinned-mobile.png",phone);
  await phoneDocument.getByRole("button",{name:"History",exact:true}).click();
  await phoneDocument.getByText("Record details",{exact:true}).click();
  await expect(phoneDocument.getByText("Record version",{exact:true}).locator("xpath=following-sibling::dd[1]")).toHaveText(knowledge.version);
  await phoneDocument.getByRole("link",{name:"All records",exact:true}).click();await expect(phone.getByRole("list",{name:"Knowledge records",exact:true})).toBeVisible();
  await phone.close();
  await expect(page.getByText(/Mock data/)).toHaveCount(0);expect(mutations).toEqual([]);expect(errors).toEqual([]);
  const result={passed:true,visual_measurements:{desktop_graph_width:graphBox.width,desktop_inspector_width:inspectorBox.width,desktop_graph_fits:desktopFit,phone_graph_node_top:visibleNodes[0].top,phone_graph_node_bottom:visibleNodes[0].bottom,phone_navigation_top:graphPhoneNav.y,phone_document_paragraph_top:firstParagraph.y,phone_document_paragraph_bottom:(firstParagraph.y+firstParagraph.height)},references:["02-work-explorer-v3.png","07-knowledge-v2.png"],visual_subset:"task workspace with readable dependency graph and contextual inspector; document library with first-viewport phone reading",origin:origin.origin,served_bundle_digest:servedBundleDigest,api_product_bundle_digest:bootstrap.data.product.dashboard_digest,project_id:project,task_id:taskId,task_revision:task.content_revision,knowledge_id:knowledgeId,knowledge_revision:knowledge.content_revision,task_rows:tasks.data.items.length,knowledge_rows:knowledgePage.data.items.length,graph_nodes:graph.nodes.length,graph_edges:graph.edges.length,human_reads:humanReads.length,mutations:mutations.length,page_errors:errors.length,elapsed_ms:Math.round(performance.now()-started),output,note:"Actual AQ human API and actual configured Graph; labelled local fixture, no interception or domain mutations. Current and exact pinned revision inspected; no older-history claim."};
  await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
} catch(error) {
  await screenshot("failure.png").catch(()=>{});
  await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),url:page.url(),human_reads:humanReads,mutations,page_errors:errors},null,2)+"\n");
  throw error;
} finally {await browser.close();}
