import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const origin='http://localhost:4204', expected='sha256:2b3d3d6ee8be801288f2f7c95446ac18e73e80e8010c18d905885e9d4b077689';
const output='/tmp/aq-shell-responsive-production',started=performance.now();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6000);
const errors=[],mutations=[],foreign=[],results=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))mutations.push({method:r.method(),path:new URL(r.url()).pathname});if(new URL(r.url()).origin!==origin)foreign.push(r.url());});
try {
 const response=await page.request.get(origin+'/api/v1/bootstrap');expect(response.status()).toBe(200);const bootstrap=await response.json();expect(bootstrap.api_version).toBe('dashboard-read-1');expect(bootstrap.data.product.dashboard_digest).toBe(expected);
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:width===1440?1100:844});await page.goto(origin+'/overview',{waitUntil:'networkidle'});
  const header=page.getByRole('banner');await expect(header.getByRole('status')).toHaveText('Connected');const rect=await header.boundingBox();expect(rect.height).toBe(width===1440?69:114);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({path:`${output}/shell-${width}.png`});const record={width,header_height:rect.height,overflow:false};
  if(width<768) {
   const summary=header.locator('summary'),picker=header.getByRole('combobox',{name:'Scope'}),search=header.getByRole('button',{name:'Search',exact:true});await expect(summary).toHaveText('Usage unavailable');
   for(const target of [summary,picker,search]) {const box=await target.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);}
   expect((await search.boundingBox()).width).toBeGreaterThanOrEqual(44);
   await summary.click();await expect(header.getByText('Provider account usage is unavailable',{exact:true})).toBeVisible();expect((await header.boundingBox()).height).toBe(rect.height);
   const close=header.getByRole('button',{name:'Close usage details'}),panel=await close.locator('..').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
   await page.screenshot({path:`${output}/usage-reason-${width}.png`});await close.click();await expect(summary).toBeFocused();await summary.click();await page.keyboard.press('Escape');await expect(summary).toBeFocused();await expect(close).toBeHidden();
   await search.click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close search',exact:true}).click();await expect(search).toBeFocused();
   const options=await picker.locator('option').evaluateAll(rows=>rows.filter(r=>r.value!=='all').map(r=>r.value));expect(options.length).toBeGreaterThan(0);await picker.focus();await picker.selectOption(options[0]);expect(new URL(page.url()).searchParams.get('scope')).toBe(options[0]);await expect(picker).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);await page.screenshot({path:`${output}/scope-${width}.png`});
   record.overlay_does_not_resize_header=true;record.reason_panel=panel;record.close_escape_search_scope_focus=true;
  }
  results.push(record);
 }
 for(const width of [390,320]) {
  await page.setViewportSize({width,height:844});await page.goto(origin+'/agents/9767942b-b7f8-5ae4-be04-136f81509cce',{waitUntil:'networkidle'});const header=page.getByRole('banner');await expect(header.locator('summary')).toHaveText('Usage unavailable');expect((await header.boundingBox()).height).toBe(62);await expect(header.getByRole('combobox',{name:'Scope'})).toBeHidden();await expect(header.getByRole('button',{name:'Search',exact:true})).toBeHidden();await expect(page.getByRole('navigation',{name:'Primary (compact)'})).toBeHidden();await expect(page.getByRole('link',{name:'All sessions',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);await page.screenshot({path:`${output}/agents-${width}.png`});
  await header.locator('summary').click();expect((await header.boundingBox()).height).toBe(62);await page.keyboard.press('Escape');await expect(header.locator('summary')).toBeFocused();results.push({width,page:'focused_agents',header_height:62,back_visible:true,bottom_nav_hidden:true});
 }
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:width===1440?1100:844});await page.goto(origin+'/supervisor',{waitUntil:'networkidle'});await expect(page.getByRole('textbox',{name:'Message the global supervisor'})).toBeVisible();const send=page.getByRole('button',{name:'Send message',exact:true}),sendBox=await send.boundingBox();await expect(send).toBeVisible();if(width<768){const nav=await page.getByRole('navigation',{name:'Primary (compact)'}).boundingBox();expect(sendBox.y+sendBox.height).toBeLessThanOrEqual(nav.y);expect(sendBox.height).toBeGreaterThanOrEqual(44);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);await page.screenshot({path:`${output}/supervisor-${width}.png`});results.push({width,page:'supervisor',send_bounds:sendBox,read_only_inspection:true});
 }
 expect(errors).toEqual([]);expect(mutations).toEqual([]);expect(foreign).toEqual([]);await writeFile(output+'/result.json',JSON.stringify({passed:true,origin,served_dashboard_digest:bootstrap.data.product.dashboard_digest,expected_dashboard_digest:expected,source_commit:'3715f36',elapsed_ms:Math.round(performance.now()-started),production_bundle_acceptance:true,provider_quota:bootstrap.data.capabilities.find(c=>c.name==='provider.quota'),results,errors,mutations,foreign_requests:foreign,note:'Actual cloned owner/Graph state, read-only browser; no Supervisor typing/enqueue, Watch, provider quota or live reply claim.'},null,2)+'\n');
} catch(error) {await page.screenshot({path:output+'/failure.png'}).catch(()=>{});await writeFile(output+'/failure.json',JSON.stringify({passed:false,error:String(error),results,errors,mutations,foreign},null,2)+'\n');throw error;} finally {await browser.close();}
