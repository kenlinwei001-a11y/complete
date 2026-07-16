import { launch, login, watch, newSink, goto } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');
await goto(page, '/admin/actions');
await page.waitForTimeout(700);
// default filter (PENDING_APPROVAL) row count
const pend = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(r=>r.innerText.replace(/\s+/g,' ').trim()));
console.log('DEFAULT filter rows:', JSON.stringify(pend));
// find filter buttons
const filters = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim()).filter(t=>['PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED','EXECUTION_FAILED'].includes(t)));
console.log('filter buttons:', JSON.stringify(filters));
// click EXECUTED
await page.getByRole('button', { name: 'EXECUTED', exact: true }).click().catch(async()=>{ await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='EXECUTED');b?.click();}); });
await page.waitForTimeout(1200);
const execRows = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(r=>r.innerText.replace(/\s+/g,' ').trim()));
console.log('EXECUTED filter rows:', JSON.stringify(execRows));
if (execRows.length) {
  await page.click('tbody tr');
  await page.waitForTimeout(700);
  const detail = await page.evaluate(() => document.querySelector('[data-testid=draft-detail]')?.innerText?.replace(/\s+/g,' ').trim());
  console.log('EXECUTED detail:', detail);
  // extract writeback target badge + execution result mono
  const wb = await page.evaluate(() => {
    const d = document.querySelector('[data-testid=draft-detail]');
    return { hasExecError: !!d?.querySelector('[data-testid=exec-error]'), badges: Array.from(d?.querySelectorAll('.badge')||[]).map(b=>b.textContent.trim()) };
  });
  console.log('badges:', JSON.stringify(wb));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_action_executed_final.png' });
}
if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http));
await ctx.close(); await browser.close(); console.log('DONE');
