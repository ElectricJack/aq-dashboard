#!/usr/bin/env node
// Compiled G7 UI with explicitly labelled deterministic fixture APIs.
// This does not qualify a live AQ owner or real retained uploads.
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const origin = new URL(process.env.AQ_G7_VISUAL_URL ?? "http://127.0.0.1:4211");
const output = process.env.AQ_G7_VISUAL_OUTPUT ?? "/tmp/aq-results-feedback-visual";
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => value && typeof value === "object" && !Array.isArray(value) ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), raster = await browser.newPage();
async function pixels(width, height, name) {
  return raster.evaluate(({ width, height, name }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const c = canvas.getContext("2d");
    c.fillStyle = "#10151c"; c.fillRect(6, 6, width - 12, height - 12); c.fillStyle = "#b4a9ff"; c.fillRect(28, 28, width - 56, 66);
    c.fillStyle = "#121523"; c.font = "bold 25px sans-serif"; c.fillText("SYNTHETIC SOURCE UI", 44, 69);
    c.fillStyle = "#edf2ff"; c.font = "bold 28px sans-serif"; c.fillText(name, 30, 144);
    c.fillStyle = "#aebbd0"; c.font = "18px sans-serif"; c.fillText("Illustrative media fixture — no live AQ data", 30, 183);
    const count = height > width ? 4 : 2, gap = 22, cardHeight = Math.floor((height - 260 - gap * count) / count);
    for (let n = 0; n < count; n++) { const y = 215 + n * (cardHeight + gap); c.fillStyle = "#202a37"; c.fillRect(30, y, width - 60, cardHeight); c.fillStyle = "#b4a9ff"; c.fillRect(46, y + 18, 8, cardHeight - 36); c.fillStyle = "#edf2ff"; c.font = "bold 21px sans-serif"; c.fillText(`Example panel ${n + 1}`, 76, y + 43); c.fillStyle = "#aebbd0"; c.font = "17px sans-serif"; c.fillText("Preview rendering only", 76, y + 75); }
    return [...c.getImageData(0, 0, width, height).data];
  }, { width, height, name });
}
function chunk(kind, bytes) {
  const body = Buffer.concat([Buffer.from(kind), Buffer.from(bytes)]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([length, body, checksum]);
}
function png(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("sRGB", [0]), chunk("IDAT", deflateSync(rows)), chunk("IEND", [])]);
}
const files = [];
for (const [index, dims] of [[960, 600, "Desktop layout"], [600, 960, "Phone layout"]].entries()) {
  const [width, height, name] = dims, rgba = await pixels(width, height, name), longest = Math.max(width, height), pw = Math.floor(width * 384 / longest), ph = Math.floor(height * 384 / longest), preview = [];
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const offset = (Math.floor(y * height / ph) * width + Math.floor(x * width / pw)) * 4; preview.push(...rgba.slice(offset, offset + 4)); }
  files.push({ id: id(201 + index), filename: index ? "Synthetic phone.png" : "Synthetic desktop.png", preview: { bytes: png(pw, ph, preview), width: pw, height: ph }, render: { bytes: png(width, height, rgba), width, height } });
}
await raster.close();
const originalBootstrap = JSON.parse(await readFile(new URL("../contracts/proposed/bootstrap.json", import.meta.url), "utf8"));
const now = Date.now(), binding = { coverage: "recorded_legacy_native_only", report_id: id(1), report_revision: "a".repeat(64), project_id: id(100), task_id: id(101), attempt_id: id(102), source: { repository_id: id(103), base: { format: "sha1", hex: "b".repeat(40) } } };
const record = { report_id: binding.report_id, revision: binding.report_revision, project_id: binding.project_id, task_id: binding.task_id, attempt_id: binding.attempt_id, recorded_at_ms: now - 60000, conclusion: "Synthetic source UI · Responsive workspace", process_outcome: "unknown", current_report_head: true, head_report_id: binding.report_id, supersedes: null, repository_id: binding.source.repository_id, source_base: binding.source.base, source_receipt_ids: [], pending_effect_ids: [] };
const limits = { max_input_bytes: 1048576, max_render_bytes: 8388608, max_preview_bytes: 786432, max_pixels: 2000000, max_dimension: 4096, max_result_artifacts: 8, upload_ttl_ms: 1800000, retention_ms: 604800000 };
function artifact(file, expiry = false) {
  const receipt = { schema_version: 1, artifact_id: file.id, binding, uploader_id: id(900), input: { digest: hash(file.render.bytes), bytes: file.render.bytes.length, filename: file.filename }, capture: null, rendering_policy: "aq.png.rgba8-srgb-v1", variants: Object.fromEntries(["preview", "render"].map(name => [name, { digest: hash(file[name].bytes), bytes: file[name].bytes.length, mime: "image/png", width: file[name].width, height: file[name].height }])), retained_at_ms: now - 3600000, retain_until_ms: expiry ? now + 900 : now + 86400000 };
  return { receipt, receipt_digest: hash(canonical(receipt)), availability: { state: "available", observed_at_ms: now, reason: null } };
}
const manifestBytes=await readFile(new URL("../dist/dashboard-manifest.json",import.meta.url)),manifest=JSON.parse(manifestBytes);
const valid=JSON.parse(await readFile(new URL("../contracts/pinned/results-feedback/v1/fixtures/valid.json",import.meta.url))),compat=JSON.parse(await readFile(new URL("../contracts/pinned/results-feedback/v1/fixtures/compatibility.json",import.meta.url))),action=JSON.parse(await readFile(new URL("../contracts/pinned/dashboard-actions/v1/fixtures/operation-confirmed.json",import.meta.url)));
const detail=structuredClone(valid.find(v=>v.type==="Detail").value);
detail.result={id:binding.report_id,current_revision:binding.report_revision,project_id:binding.project_id,task_id:binding.task_id,version:"1"};
detail.revision={...detail.revision,report_id:binding.report_id,revision:binding.report_revision,attempt_id:binding.attempt_id,source:binding.source,summary:"Fixture · Responsive agent workspace",submitted_at_ms:now-60000};
detail.assessment.artifacts=files.map(file=>({artifact_id:file.id,digest:hash(file.render.bytes)}));
const requirement=detail.revision.capture_policy.requirements[0];
detail.revision.capture_policy.requirements=files.map((file,index)=>({...requirement,id:`fixture-${index}`,scenario:`Fixture ${index?"phone":"desktop"} layout`,count:1,viewport:{width_css:file.render.width,height_css:file.render.height,dpr_milli:1000}}));
detail.assessment.evidence={satisfied:true,requirements:detail.revision.capture_policy.requirements.map((r,index)=>({requirement_id:r.id,policy_revision:r.policy_revision,required:true,state:"attached",artifact_ids:[files[index].id],waiver_id:null}))};
const comment={id:id(501),position:"1",revision:"1",thread_id:id(502),thread_version:"1",thread_state:"open",body:"Fixture feedback: keep the caption readable on a narrow phone.",author_id:id(900),created_at_ms:now-30000,anchor:{kind:"image_region",artifact_id:files[0].id,digest:hash(files[0].render.bytes),x:.15,y:.2,width:.3,height:.25},history:[]};
function env(data,project=false){return {...compat.read,data,scope:project?{kind:"project",project_id:binding.project_id}:{kind:"all_authorized"}};}
function op(id){return {...action,scope:{kind:"project",project_id:binding.project_id},data:{...action.data,operation_id:id,scope:{kind:"project",project_id:binding.project_id},subject_refs:[{type:"result",id:binding.report_id,revision:"1"}],affected_entities:[{type:"result",id:binding.report_id,revision:"2"}],receipt_refs:[{type:"result_feedback_receipt",id,revision:"1"}]}};}
const sourceFiles=[...new Set(execFileSync("git",["ls-files","-co","--exclude-standard","src","scripts","contracts","package.json","pnpm-lock.yaml","vite.config.ts","tsconfig.json","tsconfig.app.json","tsconfig.node.json"],{encoding:"utf8"}).trim().split("\n"))].sort();
const sourceSnapshot={};for(const file of sourceFiles)sourceSnapshot[file]=hash(await readFile(file));
const captures=[],errors=[],unexpected=[],served=[],mutations=[];
async function pageFor(viewport,state="normal"){
 const page=await browser.newPage({viewport});let comments=[structuredClone(comment)],feedback;
 page.on("pageerror",error=>errors.push(error.message));
 page.on("response",async response=>{const url=new URL(response.url());if(url.origin===origin.origin&&url.pathname.startsWith("/assets/")){const bytes=await response.body();const name=url.pathname.slice(1);const expected=manifest.files[name]?.sha256;const actual=createHash("sha256").update(bytes).digest("hex");if(!expected||expected!==actual)errors.push(`Served asset mismatch ${name}`);served.push({name,sha256:actual});}});
 await page.route(`${origin.origin}/api/**`,async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==="/api/v1/bootstrap")return route.fulfill({json:{...originalBootstrap,api_version:"dashboard-read-1",data:{...originalBootstrap.data,contracts:[{name:"dashboard-read",version:"dashboard-read-1",digest:"sha256:"+"a".repeat(64)},{name:"dashboard-actions",version:"dashboard-actions-1",digest:"sha256:97fdea9aa4aeae795415d53bb3a4081684416bafd6f1b44e598a8e70a51df9ce"}],principal:{id:id(900),display_name:"G7 labelled fixtures",authorization_revision:"1"},product:{version:"G7-fixture-preview",dashboard_digest:hash(manifestBytes)},capabilities:[...manifest.required_capabilities.map(name=>({name,version:"1",enabled:["results.read","results.comment","results.feedback","results.media.read"].includes(name)&&state!=="disabled",reason:"Unavailable in labelled fixture preview"})),...[]],global_supervisor:{status:"unconfigured",conversation_id:null}}}});
  if(path==="/api/projects")return route.fulfill({json:{items:[],next_cursor:null}});
  if(path==="/api/v1/results")return state==="unavailable"?route.fulfill({status:503,json:{message:"Fixture unavailable"}}):route.fulfill({json:env({items:state==="empty"?[]:[detail],next_cursor:null})});
  if(path===`/api/v1/results/${binding.report_id}/revisions/${binding.report_revision}`)return route.fulfill({json:env(detail,true)});
  if(path.endsWith("/comments")){
   if(req.method()==="POST"){const body=req.postDataJSON();mutations.push({kind:"comment",body});comments=[...comments,{...comment,id:body.operation_id,position:"2",body:body.body,anchor:body.anchor}];return route.fulfill({json:op(body.operation_id)});}
   return route.fulfill({json:env({items:comments,next_cursor:null},true)});
  }
  if(path.endsWith("/media"))return route.fulfill({json:{contract:"human-result-media-1",server_time_ms:now,binding,limits,items:files.map(file=>artifact(file))}});
  if(path.endsWith("/content")){const file=files.find(file=>path.includes(file.id)),variant=url.searchParams.get("variant"),descriptor=artifact(file);return route.fulfill({body:file[variant].bytes,headers:{"Content-Type":"image/png","Content-Length":String(file[variant].bytes.length),"AQ-Media-Digest":hash(file[variant].bytes),"AQ-Media-Receipt-Digest":descriptor.receipt_digest,"Cache-Control":"private, no-store"}});}
  if(path===`/api/human/projects/${binding.project_id}/tasks`)return route.fulfill({json:{contract:"human-graph-1",project:{id:binding.project_id,name:"Fixture project",revision:"1",workspace_id:id(901)},observed_at:new Date(now).toISOString(),data:{items:[],next_cursor:null}}});
  if(path==="/api/v1/feedback-tasks"&&req.method()==="POST"){feedback=req.postDataJSON();mutations.push({kind:"feedback",body:feedback});return route.fulfill({json:op(feedback.operation_id)});}
  if(path.startsWith("/api/v1/feedback-tasks/"))return route.fulfill({json:env({operation_id:feedback.operation_id,task_id:feedback.operation_id,creation_disposition:"confirmed",link_confirmed:true,result_id:binding.report_id,revision:binding.report_revision,origin:feedback},true)});
  unexpected.push(`${req.method()} ${path}`);return route.fulfill({status:503,json:{message:"Unconfigured fixture route"}});
 });return page;
}
async function capture(page,name){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);const path=join(output,name);await page.screenshot({path});captures.push(path);}
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740},{width:900,height:1000}]){
  const page=await pageFor(viewport);await page.goto(new URL("/results",origin).href);await expect(page.getByRole("heading",{name:detail.revision.summary,exact:true})).toBeVisible();
  const gallery=page.getByRole("region",{name:"Human supplemental images"}).first();await expect(gallery.getByRole("img")).toBeVisible();await expect(page.getByRole("button",{name:"Comments 1",exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await capture(page,`${viewport.width}-feed.png`);await page.screenshot({path:join(output,`${viewport.width}-feed-full.png`),fullPage:true});captures.push(join(output,`${viewport.width}-feed-full.png`));
  await page.getByRole("button",{name:"Comments 1",exact:true}).click();const sheet=page.getByRole("dialog",{name:"Result comments",exact:true});await expect(sheet).toBeVisible();await capture(page,`${viewport.width}-comments.png`);
  await sheet.getByRole("combobox",{name:/Anchor/}).selectOption("image");const editor=sheet.getByRole("region",{name:"Image region editor"});
  const view=editor.getByRole("button",{name:"View supplemental images"});if(await view.count())await view.click();await expect(editor.getByRole("img")).toBeVisible();const slider=editor.getByRole("slider",{name:/Region x/});await slider.press("Home");for(let n=0;n<25;n++)await slider.press("ArrowRight");
  await sheet.getByLabel("Comment",{exact:true}).fill("Fixture: adjust this selected image region.");await capture(page,`${viewport.width}-region.png`);await editor.getByRole("slider",{name:/Region height/}).scrollIntoViewIfNeeded();await expect(sheet.getByRole("button",{name:"Close comments",exact:true})).toBeInViewport();await capture(page,`${viewport.width}-region-controls.png`);await sheet.getByRole("button",{name:"Post comment",exact:true}).click();await expect(sheet.getByText("Fixture: adjust this selected image region.",{exact:true})).toBeVisible();
  await sheet.getByRole("button",{name:"Close comments",exact:true}).click();await page.getByRole("button",{name:"Create feedback task",exact:true}).click();const draft=page.getByRole("dialog",{name:"Create feedback task",exact:true});await draft.getByLabel("Title",{exact:true}).fill("Fixture · Repair caption wrapping");await draft.getByLabel("Acceptance criteria",{exact:true}).fill("Caption remains readable at 320 CSS pixels.");await capture(page,`${viewport.width}-draft.png`);await draft.getByRole("button",{name:"Create linked task",exact:true}).scrollIntoViewIfNeeded();await expect(draft.getByRole("button",{name:"Close draft",exact:true})).toBeInViewport();await capture(page,`${viewport.width}-draft-controls.png`);await draft.getByRole("button",{name:"Create linked task",exact:true}).click();await expect(draft.getByText("Feedback task created and linked. Thread remains open.",{exact:true})).toBeVisible();await draft.getByText("Feedback task created and linked. Thread remains open.",{exact:true}).scrollIntoViewIfNeeded();await expect(draft.getByRole("button",{name:"Close draft",exact:true})).toBeInViewport();await capture(page,`${viewport.width}-linked.png`);await draft.getByRole("button",{name:"Close draft",exact:true}).click();
  await page.getByRole("link",{name:"Review result",exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole("link",{name:"Review result",exact:true})).toHaveAttribute("href",/\/decisions.*revision=/);await capture(page,`${viewport.width}-actions.png`);await page.close();
 }
 for(const state of ["empty","unavailable","disabled"]){const page=await pageFor({width:390,height:844},state);await page.goto(new URL("/results",origin).href);await expect(page.getByText(state==="empty"?"No results in this scope and filter.":state==="disabled"?"Unavailable in labelled fixture preview":"Couldn't load results. Nothing is shown rather than possibly incomplete data.",{exact:true})).toBeVisible();await capture(page,`390-${state}.png`);await page.close();}
 expect(errors).toEqual([]);expect(unexpected).toEqual([]);expect(mutations.filter(m=>m.kind==="feedback")).toHaveLength(4);expect(mutations.filter(m=>m.kind==="comment").every(m=>m.body.anchor.kind==="image_region"&&m.body.anchor.x===.25)).toBe(true);
 await writeFile(join(output,"result.json"),JSON.stringify({passed:true,qualification:"Compiled production-mode bundle; intercepted labelled fixtures, no live-owner qualification",manifest_sha256:hash(manifestBytes),source:manifest.source,source_snapshot:sourceSnapshot,served:[...new Map(served.map(a=>[a.name,a])).values()],references:["10-results-desktop-v2.png","13-results-mobile-v2.png"],captures,errors,unexpected,mutation_counts:{comments:mutations.filter(m=>m.kind==="comment").length,feedback:4}},null,2)+"\n");console.log(`G7 visual checks passed: ${captures.length} captures in ${output}`);
}catch(error){for(const [index,page]of browser.contexts().flatMap(c=>c.pages()).entries())if(!page.isClosed())await page.screenshot({path:join(output,`failure-${index}.png`)}).catch(()=>{});await writeFile(join(output,"result.json"),JSON.stringify({passed:false,error:String(error),errors,unexpected},null,2));throw error;}finally{await browser.close();}
