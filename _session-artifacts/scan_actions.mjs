import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink();
attach(page, sink);
let draftBodies = [];
page.on('response', async r => {
  if (r.url().includes('/a/v1/action-drafts')) {
    try { const t = await r.text(); draftBodies.push(`${r.status()} ${r.url().replace('http://127.0.0.1:4085','')} -> ${t.slice(0,400)}`); } catch{}
  }
});
await login(page,'admin');
await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(2500);
console.log('=== PENDING_APPROVAL view ===');
console.log('rows:', await page.locator('table tbody tr').count());
console.log('draft responses:', JSON.stringify(draftBodies,null,1));
// try each status
for (const st of ['APPROVED','REJECTED','EXECUTED','EXECUTION_FAILED','PENDING_APPROVAL']) {
  draftBodies=[];
  await page.selectOption('select[aria-label="状态筛选"]', st).catch(e=>console.log('select err',e.message));
  await page.waitForTimeout(1200);
  const rows = await page.locator('table tbody tr').count();
  console.log(`status=${st}: rows=${rows}`);
}
// Now on PENDING_APPROVAL, if a row exists, click it
await page.selectOption('select[aria-label="状态筛选"]','PENDING_APPROVAL').catch(()=>{});
await page.waitForTimeout(1500);
const nrows = await page.locator('table tbody tr').count();
console.log('\n=== Final PENDING rows:', nrows);
if (nrows>0) {
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1000);
  const detail = await page.locator('[data-testid=draft-detail]').count();
  console.log('detail panel present:', detail);
  if (detail>0) {
    const dtext = (await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ').slice(0,600);
    console.log('DETAIL TEXT:', dtext);
    const approveDisabled = await page.locator('[data-testid=approve-btn]').isDisabled().catch(()=>'n/a');
    console.log('approve-btn disabled:', approveDisabled);
    await page.screenshot({path:`${SP}/actions_detail.png`});
  }
}
await page.screenshot({path:`${SP}/actions_final.png`});
console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,6)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close();
console.log('DONE');
