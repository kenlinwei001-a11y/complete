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

const consoleErrors = [];
const pageErrors = [];
const failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ url: page.url(), text: m.text().slice(0, 300) }); });
page.on('pageerror', (e) => pageErrors.push({ url: page.url(), text: String(e).slice(0, 300) }));
page.on('requestfailed', (r) => failedReqs.push({ url: r.url(), err: r.failure()?.errorText }));
page.on('response', (r) => { if (r.status() >= 500) failedReqs.push({ url: r.url(), status: r.status() }); });

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  console.log('LOGIN -> url', page.url());
}

await login();

const report = [];
for (const v of VIEWS) {
  consoleErrors.length = 0; pageErrors.length = 0; failedReqs.length = 0;
  const path = v.startsWith('admin/') ? `/${v}` : (v.startsWith('/') ? v : `/v/${v}`);
  let nav = path;
  try {
    await page.goto(`${BASE}${nav}`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    report.push({ view: v, error: 'goto failed: ' + String(e).slice(0,120) });
    continue;
  }
  await page.waitForTimeout(2500);
  const url = page.url();
  const bodyText = (await page.evaluate(() => document.body.innerText || '')).slice(0, 1200);
  // dead button detection: buttons present
  const btnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return { count: btns.length, disabled: btns.filter(b => b.disabled).length };
  });
  const emptyMarkers = await page.evaluate(() => {
    const t = document.body.innerText || '';
    const markers = ['暂无','暂不支持','无数据','加载中','出错了','出了点问题','Something went wrong','FEATURE_NOT_FOUND','404','未找到','Not Found','TypeError','undefined is not'];
    return markers.filter(m => t.includes(m));
  });
  const file = `${OUT}/${v.replace(/\//g,'_')}.png`;
  await page.screenshot({ path: file, fullPage: false });
  const redirectedToLogin = url.includes('/login');
  report.push({
    view: v, navTo: nav, url, redirectedToLogin,
    buttons: btnInfo, emptyMarkers,
    consoleErrors: consoleErrors.slice(0, 6),
    pageErrors: pageErrors.slice(0, 6),
    failedReqs: failedReqs.slice(0, 8),
    bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 400),
    screenshot: file,
  });
  console.log(`[${v}] url=${url} login=${redirectedToLogin} btns=${btnInfo.count} cerr=${consoleErrors.length} perr=${pageErrors.length} 5xx/fail=${failedReqs.length} empty=${JSON.stringify(emptyMarkers)}`);
}

fs.writeFileSync(`${OUT}/report-${process.env.TAG||'x'}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log('DONE', OUT);
