import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5173';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = (process.env.VIEWS || '').split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

let consoleErrors = [], pageErrors = [], failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 280)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 280)));
page.on('requestfailed', (r) => { const u=r.url(); if(!u.includes('5173')||/\/(a|b|api)\/v1/.test(u)) failedReqs.push({ url: u.slice(0,120), err: r.failure()?.errorText }); });
page.on('response', (r) => { if (r.status() >= 500) failedReqs.push({ url: r.url().slice(0,120), status: r.status() }); });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1800);
console.log('LOGIN url', page.url());

const report = [];
for (const v of VIEWS) {
  consoleErrors = []; pageErrors = []; failedReqs = [];
  const path = v.startsWith('admin/') ? `/${v}` : `/v/${v}`;
  // SPA navigation: use history.pushState via in-app router by clicking? Simpler: use page.evaluate to call router — but easiest reliable: set location.hash won't work. Use goto BUT re-inject token first.
  // We navigate via the app's history by dispatching a click on a synthetic link is unreliable; instead use page.goto then if bounced, the token survived? No.
  // Strategy: keep SPA alive — navigate using window.history + popstate won't trigger react-router data load. Use the app: evaluate router navigate through a global isn't exposed.
  // Pragmatic: re-login is heavy. Instead, before each goto, capture token from memory is impossible. So: navigate by clicking nav links when present, else use in-page fetch to confirm endpoint, else mark.
  let navMethod = 'spa';
  const linkSel = `a[href="${path}"]`;
  const hasLink = await page.$(linkSel);
  if (hasLink) {
    try { await hasLink.click(); } catch(e){}
  } else {
    // expand collapsed nav groups then retry
    const toggles = await page.$$('[data-testid^="nav-group-toggle-"]');
    for (const t of toggles) { try { await t.click(); } catch(e){} }
    await page.waitForTimeout(200);
    const l2 = await page.$(linkSel);
    if (l2) { try { await l2.click(); } catch(e){} }
    else { navMethod = 'no-nav-link'; }
  }
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2600);
  const url = page.url();
  const bodyText = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g,' ').slice(0, 700);
  const btnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent!==null);
    return { count: btns.length, labels: btns.slice(0,25).map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,18)).filter(Boolean) };
  });
  const markers = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return ['暂无','暂不支持','无数据','该视图类型暂不支持','出了点问题','Something went wrong','FEATURE_NOT_FOUND','未找到','页面不存在','Not Found','TypeError','is not a function','Cannot read'].filter(m => t.includes(m));
  });
  const file = `${OUT}/spa_${v.replace(/\//g,'_')}.png`;
  await page.screenshot({ path: file });
  report.push({ view: v, navMethod, url, onLogin: url.includes('/login'), buttons: btnInfo, markers, consoleErrors: consoleErrors.slice(0,5), pageErrors: pageErrors.slice(0,5), failedReqs: failedReqs.slice(0,6), body: bodyText, screenshot: file });
  console.log(`[${v}] nav=${navMethod} login=${url.includes('/login')} btns=${btnInfo.count} cerr=${consoleErrors.length} perr=${pageErrors.length} 5xx=${failedReqs.length} markers=${JSON.stringify(markers)}`);
  // go back to home to have stable nav for next click
  const home = await page.$('a[href="/"], a[data-testid="nav-scenario-launcher"]');
}
fs.writeFileSync(`${OUT}/spa-report-${process.env.TAG||'x'}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log('DONE');
