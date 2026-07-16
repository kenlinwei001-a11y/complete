import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const out = { steps: [] };
const P = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const login = async (page) => {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo'); await page.fill('#login-username', 'admin'); await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]'); await page.waitForTimeout(2500);
};
try {
  // ---- C4: in-app nav to o360 (idx>0) → back → navigate(-1) returns ----
  const p1 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await login(p1);
  const landing = p1.url();
  // client-side nav to o360 (builds history idx>0)
  await p1.evaluate(() => { window.history.pushState({}, '', '/o/Base/obj_base_changzhou'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await p1.waitForTimeout(2500);
  const o360back = await p1.$$('[data-testid="o360-back"]');
  const idxC4 = await p1.evaluate(() => window.history.state?.idx ?? 0);
  P('C4 o360 (in-app nav): url=' + p1.url() + ' | o360-back count=' + o360back.length + ' | history.idx=' + idxC4);
  if (o360back.length) { await o360back[0].click(); await p1.waitForTimeout(1500); P('  C4 after back: pathname=' + await p1.evaluate(() => location.pathname) + ' (expect NOT /o/)'); }
  await p1.screenshot({ path: EV + '/gb-c4-o360-back.png' });
  await p1.close();

  // ---- C6: DIRECT-LINK to o360 (fresh load·idx==0) → back → fallbackTo /scenarios ----
  const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await login(p2);
  await p2.goto(BASE + '/o/Base/obj_base_changzhou', { waitUntil: 'domcontentloaded' }); // full reload → idx resets
  await p2.waitForTimeout(3000);
  const idxC6 = await p2.evaluate(() => window.history.state?.idx ?? 0);
  const o360backD = await p2.$$('[data-testid="o360-back"]');
  P('C6 o360 (direct-link): url=' + p2.url() + ' | o360-back count=' + o360backD.length + ' | history.idx=' + idxC6);
  if (o360backD.length) { await o360backD[0].click(); await p2.waitForTimeout(1500); P('  C6 after back: pathname=' + await p2.evaluate(() => location.pathname) + ' (expect /scenarios fallback)'); }
  await p2.close();

  // ---- C5: /v/risk?focus → risk-back count=1 ; /v/risk (no focus) → count=0 ----
  const p3 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await login(p3);
  await p3.evaluate(() => { window.history.pushState({}, '', '/v/risk?focus=%E6%B4%9B%E9%98%B3'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await p3.waitForTimeout(2500);
  const riskBackFocus = await p3.$$('[data-testid="risk-back"]');
  P('C5a /v/risk?focus=洛阳: risk-back count=' + riskBackFocus.length + ' (expect 1)');
  await p3.evaluate(() => { window.history.pushState({}, '', '/v/risk'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await p3.waitForTimeout(2000);
  const riskBackNo = await p3.$$('[data-testid="risk-back"]');
  P('C5b /v/risk (no focus): risk-back count=' + riskBackNo.length + ' (expect 0)');
  await p3.close();
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
