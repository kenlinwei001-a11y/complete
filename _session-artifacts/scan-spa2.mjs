import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5173';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

// items: "label|expectPathSubstr"  e.g. "本体建模|/admin/modeling"
const ITEMS = JSON.parse(process.env.ITEMS || '[]');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

let consoleErrors = [], pageErrors = [], failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 280)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 280)));
page.on('requestfailed', (r) => { const u=r.url(); if(/\/(a|b|api)\/v1/.test(u)) failedReqs.push({ url: u.slice(0,110), err: r.failure()?.errorText }); });
page.on('response', (r) => { if (r.status() >= 500 && /\/(a|b|api)\/v1/.test(r.url())) failedReqs.push({ url: r.url().slice(0,110), status: r.status() }); });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1800);
console.log('LOGIN url', page.url());

async function expandAllGroups() {
  // click every collapsed group header so links are clickable
  const toggles = await page.$$('[data-testid^="nav-group-toggle-"]');
  for (const t of toggles) {
    const expanded = await t.getAttribute('aria-expanded');
    if (expanded === 'false') { try { await t.click(); await page.waitForTimeout(60); } catch(e){} }
  }
}

const report = [];
for (const spec of ITEMS) {
  const [label, expect] = spec.split('|');
  consoleErrors = []; pageErrors = []; failedReqs = [];
  await expandAllGroups();
  // click nav link by href substring (most reliable)
  let clicked = false;
  const links = await page.$$('aside a');
  for (const a of links) {
    const href = await a.getAttribute('href');
    if (href && href === expect) { try { await a.click(); clicked = true; break; } catch(e){} }
  }
  if (!clicked) {
    // fallback: match by exact visible text
    const byText = await page.$(`aside a:has-text("${label}")`);
    if (byText) { try { await byText.click(); clicked = true; } catch(e){} }
  }
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2800);
  const url = page.url();
  const main = await page.evaluate(() => { const m=document.querySelector('main'); return (m?m.innerText:document.body.innerText||'').replace(/\s+/g,' ').slice(0,650); });
  const btnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('main button')).filter(b=>b.offsetParent!==null);
    return { count: btns.length, labels: [...new Set(btns.map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean))].slice(0,30) };
  });
  const markers = await page.evaluate(() => {
    const m=document.querySelector('main'); const t=m?m.innerText:'';
    return ['该视图类型暂不支持','暂不支持','出了点问题','Something went wrong','FEATURE_NOT_FOUND','页面不存在','Not Found','TypeError','is not a function','Cannot read','NaN'].filter(x => t.includes(x));
  });
  const empties = await page.evaluate(() => Array.from(document.querySelectorAll('main .empty-state, main [class*="empty"]')).map(e=>e.innerText.trim().slice(0,60)).filter(Boolean).slice(0,8));
  const file = `${OUT}/n_${expect.replace(/\//g,'_')}.png`;
  await page.screenshot({ path: file });
  report.push({ label, expect, clicked, url, reached: url.includes(expect), onLogin: url.includes('/login'), buttons: btnInfo, markers, empties, consoleErrors: consoleErrors.slice(0,5), pageErrors: pageErrors.slice(0,5), failedReqs: failedReqs.slice(0,6), main, screenshot: file });
  console.log(`[${label}] reached=${url.includes(expect)} btns=${btnInfo.count} cerr=${consoleErrors.length} perr=${pageErrors.length} 5xx=${failedReqs.length} mark=${JSON.stringify(markers)} empty=${JSON.stringify(empties)}`);
}
fs.writeFileSync(`${OUT}/n-report-${process.env.TAG||'x'}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log('DONE');
