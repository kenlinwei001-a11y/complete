import { launch, login, snapLogs, clearLogs, SHOT_DIR, BASE } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});

// ---- QueryHistory ----
await page.goto(`${BASE}/admin/query-history`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
const rows = await page.$$eval('table tbody tr', trs => trs.slice(0,10).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())));
const headers = await page.$$eval('table thead th', ths => ths.map(t=>t.innerText.trim()));
console.log('=== QUERY HISTORY ===');
console.log('HEADERS:', JSON.stringify(headers));
for (const r of rows) console.log('ROW:', JSON.stringify(r));
await page.screenshot({ path:`${SHOT_DIR}/query-history.png` });

// ---- ExternalSignals admin page ----
await page.goto(`${BASE}/admin/external-signals`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(1500);
const sigText = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,600));
console.log('\n=== EXTERNAL SIGNALS ADMIN ===');
console.log(sigText);
await page.screenshot({ path:`${SHOT_DIR}/external-signals-admin.png` });

// ---- ExternalSignalStrip on plan-audit view ----
await page.goto(`${BASE}/v/plan-audit`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
console.log('\n=== EXTERNAL SIGNAL STRIP (plan-audit) ===');
const strip = await page.$('[data-testid=external-signal-strip], [class*=signalStrip], [class*=SignalStrip]');
if (strip) {
  const chips = await strip.$$eval('[title]', els => els.map(e=>({ text:e.innerText.replace(/\s+/g,' ').trim().slice(0,40), title:e.getAttribute('title') })));
  for (const c of chips.slice(0,10)) console.log('CHIP:', JSON.stringify(c));
} else {
  // search whole page for signal chips with 来源 in title
  const chips = await page.$$eval('[title*="来源"]', els => els.slice(0,10).map(e=>({ text:e.innerText.replace(/\s+/g,' ').trim().slice(0,40), title:e.getAttribute('title') })));
  console.log('strip testid not found; title-based chips:', chips.length);
  for (const c of chips) console.log('CHIP:', JSON.stringify(c));
}
await page.screenshot({ path:`${SHOT_DIR}/signal-strip-planaudit.png` });

await browser.close();
console.log('\nDONE histsig');
