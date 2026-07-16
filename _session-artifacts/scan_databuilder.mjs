import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink(); attach(page,sink);
const owNet=[];
page.on('response', async r=>{ const u=r.url(); if(u.includes('/a/v1/ontology-workflows')){ const m=r.request().method(); try{const t=await r.text(); owNet.push(`${r.status()} ${m} ${u.split('/a/v1/')[1].split('?')[0]} -> ${t.slice(0,140)}`);}catch{owNet.push(`${r.status()} ${m}`);} } });
await login(page,'admin');
async function openStudio(){
  await page.goto(BASE+'/admin/data-builder',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
  await page.locator('button:has-text("本体建模工作流")').first().click(); await page.waitForTimeout(1800);
}
await openStudio();
console.log('=== studio initial ===');
console.log('wf-select present:', await page.locator('[data-testid=wf-select]').count());
let wfOpts = await page.locator('[data-testid=wf-select] option').evaluateAll(o=>o.map(x=>x.textContent.trim())).catch(()=>[]);
console.log('existing workflows:', JSON.stringify(wfOpts));
let canvas = await page.locator('[data-testid=wf-canvas]').count();
console.log('canvas present:', canvas, '| empty-create present:', await page.locator('[data-testid=wf-empty-create]').count());
// create a workflow (DATA_FIRST)
owNet.length=0;
if (await page.locator('[data-testid=wf-empty-create]').count()>0){
  await page.locator('[data-testid=wf-empty-create]').click();
} else {
  await page.locator('[data-testid=wf-new-data]').click();
}
await page.waitForTimeout(2200);
console.log('after create, net:', JSON.stringify(owNet));
canvas = await page.locator('[data-testid=wf-canvas]').count();
let nodeCount = await page.locator('[data-node-id]').count();
console.log('canvas present:', canvas, '| node count:', nodeCount);
const palette = await page.locator('[data-testid=wf-palette] button').evaluateAll(b=>b.map(x=>x.getAttribute('data-testid')).filter(Boolean));
console.log('palette add buttons:', JSON.stringify(palette));
await page.screenshot({path:`${SP}/db_canvas_initial.png`});
// capture current wf id from select
const curWf = await page.locator('[data-testid=wf-select]').inputValue().catch(()=>'?');
console.log('current wf id:', curWf);
// ADD a node
owNet.length=0;
const addBtn = page.locator('[data-testid=wf-palette] button[data-testid^="wf-add-"]').first();
const addKind = await addBtn.getAttribute('data-testid');
await addBtn.click();
await page.waitForTimeout(2000);
const nodeCount2 = await page.locator('[data-node-id]').count();
console.log(`added node via ${addKind}: nodeCount ${nodeCount} -> ${nodeCount2}`);
console.log('PUT persist net:', JSON.stringify(owNet.filter(x=>x.includes('PUT'))));
// RELOAD to verify persistence (真落库往返)
await openStudio();
await page.waitForTimeout(1500);
// select same wf
const nodeCountReload = await page.locator('[data-node-id]').count();
console.log('after RELOAD, node count on first wf:', nodeCountReload, '(expect >=', nodeCount2, 'if persisted)');
await page.screenshot({path:`${SP}/db_canvas_reload.png`});
// run readiness + validate
owNet.length=0;
console.log('\n=== run actions ===');
if (await page.locator('[data-testid=act-readiness]').count()>0){
  await page.locator('[data-testid=act-readiness]').click(); await page.waitForTimeout(2500);
  console.log('readiness net:', JSON.stringify(owNet.filter(x=>x.includes('readiness')||x.includes('PUT'))));
  const rtext=(await page.locator('main').innerText()).replace(/\s+/g,' ');
  console.log('readiness result snippet:', (rtext.match(/准备度[\s\S]{0,150}/)||[''])[0].slice(0,180));
}
owNet.length=0;
if (await page.locator('[data-testid=act-validate]').count()>0){
  await page.locator('[data-testid=act-validate]').click(); await page.waitForTimeout(2500);
  console.log('validate net:', JSON.stringify(owNet.filter(x=>x.includes('validate'))));
}
await page.screenshot({path:`${SP}/db_actions.png`});
console.log('\nCONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,6)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
