import {chromium,expect} from '/home/jkern/dev/aq-dashboard/node_modules/@playwright/test/index.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:4213',out='/tmp/aq-shell-intrinsics-browser';await mkdir(out,{recursive:true});
const usage=JSON.parse(await readFile('/tmp/aq-shell-intrinsics-v2/contracts/proposed/provider-usage.json','utf8'));
const long='Private UDS inert startup fixture - external status unavailable';
const reason='Provider account usage is unavailable. '+ 'This configured account has no qualified quota observation and its reset information has not been reported. '.repeat(4);
const browser=await chromium.launch({headless:true});const measurements=[],errors=[],mutations=[];
try{
for(const ready of [false,true]){
 const context=await browser.newContext();let label=long;
 await context.route('**/api/v1/bootstrap',async route=>{const response=await route.fetch();const body=await response.json();const cap=body.data.capabilities.find(c=>c.name==='provider.quota');cap.enabled=ready;cap.reason=reason;await route.fulfill({response,json:body});});
 await context.route('**/api/v1/provider-usage',route=>route.fulfill({json:usage}));
 await context.route('**/api/v1/projects*',async route=>{const response=await route.fetch();const body=await response.json();for(const p of body.data.items??body.data??[])p.label=label,p.name=label;await route.fulfill({response,json:body});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))mutations.push(r.method()+' '+r.url());});
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/overview');await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await expect(page.locator('header summary')).toContainText(ready?'42% used':'Usage unavailable');
  // Both selected and unselected long native options must fit the same fixed header.
  const picker=page.getByRole('combobox',{name:'Scope'});await expect(picker.locator('option')).toHaveCount(2);await expect(picker.locator('option').nth(1)).toHaveText(long);const options=await picker.locator('option').allTextContents();
  const option=await picker.locator('option').evaluateAll(items=>items.find(i=>i.value!=='all')?.value);if(option)await picker.selectOption(option);
  await page.waitForTimeout(250);await page.addStyleTag({content:'body::after{content:"Synthetic source UI · intercepted project/quota fixtures";position:fixed;z-index:999;bottom:60px;right:8px;max-width:220px;font:10px sans-serif;padding:4px;background:#302840;color:#fff;pointer-events:none}'});
  const header=page.getByRole('banner');const height=(await header.boundingBox()).height;const before=await header.boundingBox();
  const box=await picker.boundingBox();const search=await page.getByRole('button',{name:'Search',exact:true}).boundingBox();const summary=page.locator('header summary');const summaryBox=await summary.boundingBox();
  const expected=width<768?114:69;expect(Math.abs(height-expected),`${width} ready=${ready} header`).toBeLessThan(1);
  expect(box.height).toBeGreaterThanOrEqual(44);expect(search.width).toBeGreaterThanOrEqual(44);expect(search.height).toBeGreaterThanOrEqual(44);expect(summaryBox.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${out}/${ready?'ready':'unavailable'}-${width}.png`});
  await summary.click();const close=page.getByRole('button',{name:'Close usage details'});await expect(close).toBeVisible();
  const overlay=await close.locator('..').boundingBox();expect(overlay.x).toBeGreaterThanOrEqual(0);expect(overlay.x+overlay.width).toBeLessThanOrEqual(width);expect((await header.boundingBox()).height).toBe(height);
  if(ready){await expect(page.getByRole('region',{name:'Provider usage (account-wide)'})).toContainText('resets');await expect(page.getByRole('button',{name:'Claude: 2 windows'})).toBeVisible();await page.getByRole('button',{name:'Claude: 2 windows'}).click();await expect(page.getByRole('list',{name:'Claude usage windows'})).toContainText('5-hour');}
  else await expect(page.getByRole('region',{name:'Provider usage (account-wide)'})).toContainText(reason);
  if(width===320||width===1440)await page.screenshot({path:`${out}/${ready?'ready':'unavailable'}-overlay-${width}.png`});
  await close.click();await expect(summary).toBeFocused();await summary.click();await page.keyboard.press('Escape');await expect(summary).toBeFocused();await expect(close).toBeHidden();
  measurements.push({width,ready,height,expected,project_box:box,search_box:search,summary_box:summaryBox,overlay,options});
 }
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.goto(origin+'/agents/9767942b-b7f8-5ae4-be04-136f81509cce');await expect(page.locator('[data-focused-session]')).toBeVisible();await expect(page.locator('header summary')).toContainText(ready?'42% used':'Usage unavailable');
  await page.addStyleTag({content:'body::after{content:"Synthetic source UI · intercepted quota fixture";position:fixed;z-index:999;bottom:8px;right:8px;max-width:180px;font:10px sans-serif;padding:4px;background:#302840;color:#fff;pointer-events:none}'});await expect(page.getByRole('link',{name:'All sessions',exact:true})).toBeVisible();expect((await page.getByRole('banner').boundingBox()).height).toBe(62);await expect(page.getByRole('combobox',{name:'Scope'})).toBeHidden();await expect(page.getByRole('navigation',{name:'Primary (compact)'})).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${out}/focused-${ready?'ready':'unavailable'}-${width}.png`});measurements.push({width,ready,focused:true,height:62});
 }
 label='Example project';
 for(const width of [1440,1024,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/overview');const picker=page.getByRole('combobox',{name:'Scope'});await expect(picker.locator('option').nth(1)).toHaveText(label);await expect(page.locator('header summary')).toContainText(ready?'42% used':'Usage unavailable');const height=(await page.getByRole('banner').boundingBox()).height;expect(height).toBe(width<768?114:69);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.addStyleTag({content:'body::after{content:"Synthetic source UI · short project/quota fixtures";position:fixed;z-index:999;bottom:60px;right:8px;max-width:220px;font:10px sans-serif;padding:4px;background:#302840;color:#fff;pointer-events:none}'});await page.screenshot({path:`${out}/short-${ready?'ready':'unavailable'}-${width}.png`});measurements.push({width,ready,short_label:true,height});
 }
 await context.close();
}
expect(errors).toEqual([]);expect(mutations).toEqual([]);await writeFile(out+'/result.json',JSON.stringify({passed:true,scope:'Synthetic source Vite layout with intercepted project/quota fixtures, not canonical qualification',origin,measurements,errors,mutations},null,2)+'\n');
}finally{await browser.close();}
