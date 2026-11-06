import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const project=process.env.AQ_G3_PROJECT_ID,task=process.env.AQ_G3_TASK_ID,blocker=process.env.AQ_G3_BLOCKER_ID;
const evidence=process.env.AQ_G3_SCREENSHOTS??"/tmp/G3-screenshots";
test.skip(!project||!task||!blocker,"Explicit disposable G3 project, task and blocker required");
async function capture(page:Page,name:string){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});
 if(page.viewportSize()!.width<600)await page.screenshot({path:`${evidence}/${name}-viewport.png`});
}
async function submit(page:Page,dialog:Locator){
 const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/v1/actions");
 await dialog.getByRole("button",{name:"Submit",exact:true}).click();const value=await (await response).json();
 expect(value.api_version).toBe("dashboard-actions-1");expect(value.data.disposition).toBe("confirmed");
 await expect(dialog.getByText("Action confirmed",{exact:true})).toBeVisible();
 return value.data;
}
test("G3 production forms confirm real writes and retain desktop/phone compositions",async({page})=>{
 test.setTimeout(90000);
 mkdirSync(evidence,{recursive:true});const failures:string[]=[];page.on("pageerror",e=>failures.push(e.message));
 await page.setViewportSize({width:1440,height:1000});
 const work=`/work/${task}?scope=project:${project}`,knowledge=`/knowledge?scope=project:${project}`;
 // Restore the disposable dependency precondition after an interrupted earlier run.
 const graphPath=`/api/human/projects/${project}/tasks/${task}/graph`;
 const existing=await (await page.request.get(graphPath)).json();
 for(const edge of existing.data.edges.filter((e:{source:string;target:string})=>e.source===blocker&&e.target===task)){
  const current=await (await page.request.get(`/api/human/projects/${project}/tasks/${task}`)).json(),id=randomUUID(),version=current.data.version;
  const reset=await page.request.post("/api/v1/actions",{headers:{"X-AQ-Request":"1"},data:{operation_id:id,kind:"task.dependency.remove",subject:{type:"task",id:task,revision:version},expected_versions:{task:version},payload:{operation_id:id,project_id:project,expected_version:version,edge_id:edge.id,edge_version:edge.version}}});
  expect((await reset.json()).data.disposition).toBe("confirmed");
 }
 await page.goto(work);await expect(page.getByRole("button",{name:"Edit task",exact:true})).toBeEnabled();
 await page.getByRole("button",{name:"Add dependency",exact:true}).click();let dependency=page.getByRole("dialog",{name:"Add dependency",exact:true});await dependency.getByLabel("Blocker task ID",{exact:true}).fill(blocker!);await submit(page,dependency);await dependency.getByRole("button",{name:"Close action"}).click();await page.reload();
 await page.getByRole("button",{name:"Graph",exact:true}).click();await expect(page.getByRole("region",{name:"Scrollable task graph"})).toBeVisible();await capture(page,"work-desktop");
 await page.getByRole("button",{name:"Edit task",exact:true}).click();let dialog=page.getByRole("dialog",{name:"Edit task",exact:true});
 await dialog.getByLabel("Title",{exact:true}).fill("G3 UI qualification task");await capture(page,"work-edit-desktop");
 const edit=await submit(page,dialog);await dialog.getByText("Operation reference and receipts").click();await expect(dialog.getByText(edit.operation_id,{exact:true})).toBeVisible();await dialog.getByRole("button",{name:"Close action"}).click();
 await page.goto(knowledge);await page.getByRole("button",{name:"Add record",exact:true}).click();dialog=page.getByRole("dialog",{name:"Add record",exact:true});
 await dialog.getByLabel("Title",{exact:true}).fill("G3 UI recovery runbook");await dialog.getByLabel("Description",{exact:true}).fill("# Recover an uncertain action\n\nLook up the original operation before deciding what happened.\n\n## Retry\nKeep the same operation ID and request bytes until the outcome is settled.");await dialog.getByRole("combobox",{name:"Category",exact:true}).selectOption("procedure");
 const author=await submit(page,dialog),node=author.affected_entities.find((r:{type:string;id:string})=>r.type==="knowledge");expect(node).toBeTruthy();
 await dialog.getByRole("button",{name:"Close action"}).click();const document=`/knowledge/${node.id}?scope=project:${project}`;await page.goto(document);await expect(page.getByRole("heading",{name:"G3 UI recovery runbook",exact:true})).toBeVisible();await capture(page,"knowledge-desktop");
 await page.getByRole("button",{name:"Correct record",exact:true}).click();dialog=page.getByRole("dialog",{name:"Correct record",exact:true});await dialog.getByLabel("Title",{exact:true}).fill("G3 UI recovery runbook revised");await submit(page,dialog);await dialog.getByRole("button",{name:"Close action"}).click();
 await page.reload();await expect(page.getByRole("heading",{name:"G3 UI recovery runbook revised",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Verify record",exact:true}).click();dialog=page.getByRole("dialog",{name:"Verify record",exact:true});await dialog.getByLabel("Reason",{exact:true}).fill("Reviewed this disposable qualification revision");await dialog.getByLabel("Evidence URL",{exact:true}).fill("https://example.org/G3-ui");await capture(page,"knowledge-verify-desktop");await submit(page,dialog);await dialog.getByRole("button",{name:"Close action"}).click();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.goto(work);await expect(page.getByRole("link",{name:"All tasks",exact:true})).toBeVisible();await capture(page,`work-${width}`);
  await page.getByRole("button",{name:"Edit task",exact:true}).click();dialog=page.getByRole("dialog",{name:"Edit task",exact:true});await expect(dialog.getByRole("button",{name:"Close action"})).toBeVisible();await capture(page,`work-edit-${width}`);await dialog.getByRole("button",{name:"Close action"}).click();
  await page.getByRole("button",{name:"Graph",exact:true}).click();const graph=page.getByRole("region",{name:"Scrollable task graph"});await expect(graph).toBeVisible();await graph.getByRole("link",{name:/G3 disposable dependency/}).click();await expect(page.getByRole("heading",{name:"G3 disposable dependency",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"All tasks",exact:true})).toBeVisible();
  await page.goto(document);await expect(page.getByRole("link",{name:"All records",exact:true})).toBeVisible();await capture(page,`knowledge-${width}`);await page.getByRole("button",{name:"Correct record",exact:true}).click();dialog=page.getByRole("dialog",{name:"Correct record",exact:true});await expect(dialog.getByRole("button",{name:"Close action"})).toBeVisible();await capture(page,`knowledge-correct-${width}`);await dialog.getByRole("button",{name:"Close action"}).click();
 }
 await page.getByRole("button",{name:"Retire record",exact:true}).click();dialog=page.getByRole("dialog",{name:"Retire record",exact:true});await dialog.getByLabel("Reason",{exact:true}).fill("Disposable UI qualification complete");await dialog.getByRole("checkbox").check();await submit(page,dialog);await dialog.getByRole("button",{name:"Close action"}).click();
 await page.goto(work);await page.getByRole("button",{name:"Remove dependency",exact:true}).click();dependency=page.getByRole("dialog",{name:"Remove dependency",exact:true});const graphRead=await page.request.get(`/api/human/projects/${project}/tasks/${task}/graph`);const edge=(await graphRead.json()).data.edges.find((e:{source:string;target:string})=>e.source===blocker&&e.target===task);expect(edge).toBeTruthy();await dependency.getByRole("combobox",{name:"Dependency",exact:true}).selectOption(edge.id);await submit(page,dependency);await dependency.getByRole("button",{name:"Close action"}).click();
 // No attempt holds the disposable task: Cancel attempt is disabled with AQ's precondition; Retry attempt is refused by AQ.
 await page.reload();await page.getByRole("button",{name:"More actions",exact:true}).click();await expect(page.getByRole("menuitem",{name:/Cancel attempt/})).toHaveAttribute("aria-disabled","true");await expect(page.getByRole("menuitem",{name:/Cancel attempt/})).toContainText("No agent attempt holds this task");
 await page.getByRole("menuitem",{name:/Retry attempt/}).click();dialog=page.getByRole("dialog",{name:"Retry attempt",exact:true});await dialog.getByRole("button",{name:"Submit",exact:true}).click();await expect(dialog.getByText(/Rejected — AQ refused this action/)).toBeVisible();await dialog.getByRole("button",{name:"Close action"}).click();
 expect(failures).toEqual([]);

});
