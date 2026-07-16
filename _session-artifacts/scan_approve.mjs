import { makeCtx, attach, login, newSink, BASE, SP } from './driver.mjs';
const { b, ctx } = await makeCtx();
const page = await ctx.newPage();
const sink = newSink();
attach(page, sink);
const decisions = [];
page.on('response', async r => {
  if (r.url().includes('/decision')) { try{ decisions.push(`${r.status()} -> ${(await r.text()).slice(0,500)}`);}catch{} }
});
await login(page,'admin');
async function gotoPending(){
  await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  await page.selectOption('select[aria-label="状态筛选"]','PENDING_APPROVAL').catch(()=>{});
  await page.waitForTimeout(1200);
  return await page.locator('table tbody tr').count();
}
async function approveStep(label){
  const n = await gotoPending();
  console.log(`\n[${label}] pending rows:`, n);
  if (n===0){ console.log('  no pending draft to act on'); return false; }
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(800);
  const chain = (await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ');
  console.log('  chain before:', chain.match(/审批链.*?(批准|驳回|$)/)?.[0]?.slice(0,200) || chain.slice(0,200));
  const disabled = await page.locator('[data-testid=approve-btn]').isDisabled().catch(()=>'n/a');
  console.log('  approve disabled:', disabled);
  if (disabled===true){ console.log('  cannot approve (no permission for this step)'); return false; }
  decisions.length=0;
  await page.locator('[data-testid=approve-btn]').click();
  await page.waitForTimeout(500);
  // confirm modal
  const confirmBtn = page.locator('button:has-text("确定"), button:has-text("确认"), [data-testid=confirm-ok], .modal button.primary');
  const cc = await confirmBtn.count();
  console.log('  confirm buttons:', cc);
  if (cc>0) await confirmBtn.first().click();
  await page.waitForTimeout(1500);
  console.log('  DECISION RESP:', JSON.stringify(decisions));
  return true;
}
await approveStep('STEP1 (planner)');
await approveStep('STEP2 (admin)');
// check final state across statuses
await page.goto(BASE+'/admin/actions',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
for (const st of ['PENDING_APPROVAL','APPROVED','EXECUTED','EXECUTION_FAILED']){
  await page.selectOption('select[aria-label="状态筛选"]',st).catch(()=>{});
  await page.waitForTimeout(900);
  console.log(`final status=${st}: rows=${await page.locator('table tbody tr').count()}`);
}
// open executed draft to see writeback
await page.selectOption('select[aria-label="状态筛选"]','EXECUTED').catch(()=>{});
await page.waitForTimeout(1000);
if (await page.locator('table tbody tr').count()>0){
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1200);
  const d=(await page.locator('[data-testid=draft-detail]').innerText()).replace(/\s+/g,' ').slice(0,700);
  console.log('EXECUTED DETAIL:', d);
  await page.screenshot({path:`${SP}/actions_executed.png`});
}
console.log('CONSOLE_ERR:', JSON.stringify([...new Set(sink.console)].slice(0,6)));
console.log('NET4xx:', JSON.stringify([...new Set(sink.net)]));
await b.close(); console.log('DONE');
