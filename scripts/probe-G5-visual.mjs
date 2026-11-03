#!/usr/bin/env node
// Deterministic G4 fixtures against served production assets. This is not a live API probe.
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const origin=process.env.AQ_PREVIEW_URL??'http://127.0.0.1:4195';
const output=process.env.AQ_VISUAL_OUTPUT??'docs/implementation/evidence/G5/visual';
const fixture=async name=>JSON.parse(await readFile(new URL(`../contracts/pinned/dashboard-read/v1/fixtures/${name}.json`,import.meta.url),'utf8'));
const contractSource=JSON.parse(await readFile(new URL('../contracts/pinned/dashboard-read/source.json',import.meta.url),'utf8'));
const bootstrap=await fixture('bootstrap');
const requirements=JSON.parse(await readFile(new URL('../src/app/bundle-requirements.json',import.meta.url),'utf8'));
bootstrap.data.capabilities=requirements.required_capabilities.map(name=>({name,version:'1',enabled:['dashboard.overview','projects.read','sessions.read','search.read','provider.quota','workers.read'].includes(name),reason:'Unavailable in labelled G5 UI fixture'}));
const manifest=await readFile(new URL('../dist/dashboard-manifest.json',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=`sha256:${sha(manifest)}`;const built=JSON.parse(manifest);
const browser=await chromium.launch({headless:true});await mkdir(output,{recursive:true});
const errors=[],writes=[],captures=[];
try{
 const request=await browser.newContext();
 const served=await request.request.get(`${origin}/dashboard-manifest.json`);expect(served.status()).toBe(200);expect(sha(await served.body())).toBe(sha(manifest));
 for(const [path,entry] of Object.entries(built.files)){
  const asset=await request.request.get(`${origin}/${path}`);expect(asset.status()).toBe(200);expect(sha(await asset.body())).toBe(entry.sha256);
 }
 await request.close();
 for(const [caseName,width,height] of [['nonempty',1440,1100],['nonempty',900,1000],['nonempty',390,844],['nonempty',320,740],['unknown',390,844],['partial',1440,1100],['empty',390,844],['failed',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:503,json:{}});}
   let body;
   if(path==='/api/v1/bootstrap')body={...bootstrap,data:{...bootstrap.data,principal:{...bootstrap.data.principal,display_name:'G5 synthetic fixture'},product:{...bootstrap.data.product,dashboard_digest:digest}}};
   else if(path==='/api/v1/overview'){if(caseName==='failed')return route.fulfill({status:503,json:{}});body=await fixture(`overview-${caseName}`);}
   else if(path==='/api/v1/provider-usage'){if(caseName==='failed')return route.fulfill({status:503,json:{}});body=await fixture(`provider-usage-${caseName==='nonempty'?'nonempty':caseName}`);}
   else if(path==='/api/v1/projects')body=await fixture('projects');
   else if(path==='/api/v1/sessions')body=await fixture('sessions');
   else if(path==='/api/workers')body=[];
   if(body)return route.fulfill({json:body});
   return route.fulfill({status:503,json:{message:'Unavailable in labelled G5 fixture'}});
  });
  await page.goto(`${origin}/overview`,{waitUntil:'networkidle'});
  await expect(page.getByRole('heading',{level:1,name:'Overview'})).toBeVisible();
  if(caseName==='failed'){
   await expect(page.getByText("Couldn't load the overview.",{exact:false})).toBeVisible({timeout:15000});
   await expect(page.getByText('Project movement unavailable',{exact:true})).toBeVisible();
   await expect(page.getByText('Outcomes unavailable',{exact:true})).toBeVisible();
  }else await expect(page.getByRole('list',{name:'Work counts'})).toBeVisible();
  if(caseName==='nonempty'){
   const attention=page.getByRole('region',{name:'Needs your attention'});
   await expect(attention.getByText('Worker offline',{exact:true})).toBeVisible();
   await attention.getByRole('button',{name:'Inspect: Worker offline'}).click();await expect(attention.getByRole('definition').first()).toBeVisible();
   await attention.getByRole('button',{name:'Inspect: Worker offline'}).click();
   const sessions=page.getByRole('region',{name:'Pinned sessions'});await sessions.getByText('Choose sessions',{exact:true}).click();
   const select=sessions.getByRole('combobox',{name:'Session snapshot'});const option=select.locator('option').nth(1);
   if(await option.count()){await select.selectOption(await option.getAttribute('value'));await sessions.getByRole('button',{name:'Pin session',exact:true}).click();await expect(sessions.getByRole('link',{name:/^(Open|Watch):/})).toBeVisible();}
   await sessions.getByText('Choose sessions',{exact:true}).click();
   const work=await page.getByRole('region',{name:'Work in motion',exact:true}).boundingBox(),infra=await page.getByRole('complementary',{name:'Infrastructure observations'}).boundingBox();
   if(width>=1200)expect(infra.x).toBeGreaterThan(work.x+work.width-1);else expect(infra.y).toBeGreaterThan(work.y);
  }
  if(caseName==='unknown'||caseName==='failed')await expect(page.getByText('Nothing needs your attention',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  if(width<768)await expect(page.getByRole('navigation',{name:'Primary (compact)',exact:true})).toBeInViewport();
  const name=`${caseName}-${width}`;await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:join(output,`${name}.png`),fullPage:true});await page.screenshot({path:join(output,`${name}-viewport.png`)});captures.push(name);
  if(width===320&&caseName==='nonempty'){
   await page.getByRole('banner').locator('summary').getByText('25% used',{exact:true}).click();await expect(page.getByRole('button',{name:'Close usage details'})).toBeInViewport();await page.screenshot({path:join(output,'quota-details-320.png')});await page.getByRole('button',{name:'Close usage details'}).click();
   await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.getByRole('button',{name:'Close search'})).toBeInViewport();await page.screenshot({path:join(output,'search-exit-320.png')});await page.getByRole('button',{name:'Close search'}).click();
  }
  await page.close();
 }
 expect(errors).toEqual([]);expect(writes).toEqual([]);
 const result={passed:true,label:'Owner-produced synthetic G4 fixtures; browser interception; not live qualification',contract_source:contractSource.commit,bundle_manifest_sha256:digest,bundle_source:built.source,captures,errors,writes};await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
