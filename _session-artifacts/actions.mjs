import { launch, login, watch, newSink, goto, BASE } from './lib.mjs';

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink();
watch(page, sink);
await login(page, 'admin');
await goto(page, '/admin/actions');
await page.waitForTimeout(700);

const shots = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots';

// find the pending draft row
const rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
console.log('actions table rows:', rowCount);
const rowText = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(r => r.innerText.replace(/\s+/g,' ').trim()));
console.log('rows:', JSON.stringify(rowText));

// click first draft row
await page.click('tbody tr');
await page.waitForTimeout(500);
const detail1 = await page.evaluate(() => document.querySelector('[data-testid=draft-detail]')?.innerText?.replace(/\s+/g,' ').trim().slice(0,500));
console.log('\nDETAIL (initial):', detail1);
await page.screenshot({ path: `${shots}_action_1_pending.png` });

// APPROVE step 1
async function approveOnce(label) {
  const canApprove = await page.evaluate(() => {
    const b = document.querySelector('[data-testid=approve-btn]');
    return b ? !b.disabled : null;
  });
  console.log(`\n[${label}] approve-btn enabled:`, canApprove);
  if (!canApprove) return false;
  await page.click('[data-testid=approve-btn]');
  // wait for confirm modal backdrop
  await page.waitForSelector('div[class*="backdrop"] button.primary', { timeout: 5000 });
  await page.click('div[class*="backdrop"] button.primary');
  // wait for backdrop to disappear
  await page.waitForSelector('div[class*="backdrop"]', { state: 'detached', timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(1000);
  return true;
}

await approveOnce('step1');
// re-open the draft (list may have re-rendered)
await page.waitForTimeout(500);
let stillPending = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
console.log('rows after step1 approve:', stillPending);
// click row again if detail closed
const hasDetail = await page.evaluate(() => !!document.querySelector('[data-testid=draft-detail]'));
if (!hasDetail && stillPending > 0) { await page.click('tbody tr'); await page.waitForTimeout(500); }
const detail2 = await page.evaluate(() => document.querySelector('[data-testid=draft-detail]')?.innerText?.replace(/\s+/g,' ').trim().slice(0,500));
console.log('DETAIL (after step1):', detail2);
await page.screenshot({ path: `${shots}_action_2_afterstep1.png` });

await approveOnce('step2');
await page.waitForTimeout(1000);

// Now switch to EXECUTED filter to find it
await goto(page, '/admin/actions');
await page.waitForTimeout(600);
// click EXECUTED filter button
await page.evaluate(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='EXECUTED'); b?.click(); });
await page.waitForTimeout(700);
const execRows = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map(r=>r.innerText.replace(/\s+/g,' ').trim()));
console.log('\nEXECUTED rows:', JSON.stringify(execRows));
if (execRows.length) {
  await page.click('tbody tr');
  await page.waitForTimeout(600);
  const detailFinal = await page.evaluate(() => document.querySelector('[data-testid=draft-detail]')?.innerText?.replace(/\s+/g,' ').trim().slice(0,700));
  console.log('DETAIL (final/executed):', detailFinal);
  await page.screenshot({ path: `${shots}_action_3_executed.png` });
}

if (sink.http.length) console.log('\nHTTP>=400:', JSON.stringify(sink.http));
if (sink.pageerrors.length) console.log('PAGEERR:', JSON.stringify(sink.pageerrors));
await ctx.close();
await browser.close();
console.log('\nDONE');
