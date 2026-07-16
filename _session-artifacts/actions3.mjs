import { launch, login, watch, newSink, goto } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');
await goto(page, '/admin/actions');
await page.waitForTimeout(600);
await page.selectOption('select[aria-label="状态筛选"]', 'EXECUTED');
await page.waitForTimeout(1200);
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(r=>r.innerText.replace(/\s+/g,' ').trim()));
console.log('EXECUTED rows:', JSON.stringify(rows));
if (rows.length) {
  await page.click('tbody tr');
  await page.waitForTimeout(800);
  const detail = await page.evaluate(() => document.querySelector('[data-testid=draft-detail]')?.innerText?.replace(/\s+/g,' ').trim());
  console.log('DETAIL:', detail);
  const badges = await page.evaluate(() => Array.from(document.querySelector('[data-testid=draft-detail]')?.querySelectorAll('.badge')||[]).map(b=>b.textContent.trim()));
  console.log('badges:', JSON.stringify(badges));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_action_executed_final.png' });
}
if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http));
await ctx.close(); await browser.close(); console.log('DONE');
