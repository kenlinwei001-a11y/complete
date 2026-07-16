import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const FE = 'http://127.0.0.1:5173';
const DC = 'http://127.0.0.1:4001';

const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// capture all auth/refresh network calls across the whole context + discover the real datacore base the app uses
const refreshCalls = [];
let loginReqOrigin = null;
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/auth/refresh')) refreshCalls.push({ phase: globalThis.__phase, method: req.method(), url: u });
  if (u.includes('/a/v1/auth/login')) { try { loginReqOrigin = new URL(u).origin; } catch {} }
});

page.on('console', (m) => { if (m.type() === 'error') log('  [console.error]', m.text().slice(0, 200)); });

// ---------- STEP 1: real UI login ----------
globalThis.__phase = 'login';
await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
log('STEP1 login page loaded, url=', page.url());

// fill the login form via the real UI. Inspect inputs first.
const inputs = await page.$$eval('input', (els) => els.map((e) => ({ name: e.name, type: e.type, placeholder: e.placeholder, ph: e.getAttribute('placeholder') })));
log('  login inputs:', JSON.stringify(inputs));
const btns = await page.$$eval('button', (els) => els.map((e) => e.textContent?.trim()).slice(0, 8));
log('  buttons:', JSON.stringify(btns));

// Try to fill by best-effort selectors; tenant/username/password.
async function fillByGuess() {
  const all = await page.$$('input');
  // heuristic: order tenant, username, password OR detect type=password
  let pwFilled = false;
  for (const el of all) {
    const type = await el.getAttribute('type');
    if (type === 'password') { await el.fill('demo1234'); pwFilled = true; }
  }
  return pwFilled;
}
// Fill known fields by placeholder/name where possible
const tryFill = async (selectorList, value) => {
  for (const sel of selectorList) {
    const el = await page.$(sel);
    if (el) { await el.fill(value); return sel; }
  }
  return null;
};
const tF = await tryFill(['#login-tenant', 'input[name="tenantId"]'], 'demo');
const uF = await tryFill(['#login-username', 'input[name="username"]', 'input[autocomplete="username"]'], 'admin');
const pF = await tryFill(['#login-password', 'input[type="password"]'], 'demo1234');
log('  filled tenant via', tF, '| user via', uF, '| pw via', pF);
if (!pF) await fillByGuess();

// click submit
await page.click('button[type="submit"], button:has-text("登录"), button:has-text("登 录")').catch(async () => {
  const b = (await page.$$('button'))[0]; if (b) await b.click();
});

// wait for navigation away from /login
await page.waitForTimeout(2500);
log('STEP1 after submit url=', page.url());

// ---------- check cookie ----------
const cookies = await ctx.cookies();
const refreshCookie = cookies.find((c) => c.name === 'refresh_token');
log('STEP2 refresh_token cookie present?', !!refreshCookie, refreshCookie ? `path=${refreshCookie.path} httpOnly=${refreshCookie.httpOnly}` : '');

// confirm we actually have an in-memory session now (workspace rendered)
const bodyText1 = (await page.textContent('body'))?.slice(0, 120)?.replace(/\s+/g, ' ');
log('  post-login body snippet:', bodyText1);

// ---------- STEP 3: HARD navigation to deep link (full reload) ----------
refreshCalls.length = 0;
globalThis.__phase = 'deeplink';
await page.goto(`${FE}/v/dash`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const finalUrl = page.url();
log('STEP3 after hard goto /v/dash -> finalUrl=', finalUrl);
log('STEP3 refresh calls during deep-link load:', JSON.stringify(refreshCalls));
const bodyText2 = (await page.textContent('body'))?.slice(0, 120)?.replace(/\s+/g, ' ');
log('  deep-link body snippet:', bodyText2);

// ---------- STEP 4: prove cookie+endpoint actually CAN refresh ----------
const appDc = loginReqOrigin || DC;
log('  (app datacore origin observed from login request:', loginReqOrigin, '-> using', appDc, ')');
const refreshResult = await page.evaluate(async (dc) => {
  try {
    const r = await fetch(`${dc}/a/v1/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const txt = await r.text();
    let tokenLen = 0;
    try { tokenLen = (JSON.parse(txt).accessToken || '').length; } catch {}
    return { status: r.status, tokenLen, snippet: txt.slice(0, 80) };
  } catch (e) { return { error: String(e) }; }
}, appDc);
log('STEP4 manual fetch /auth/refresh from page =>', JSON.stringify(refreshResult));

// ---------- VERDICT ----------
const wentToLogin = /\/login$/.test(finalUrl);
const noRefreshAttempted = refreshCalls.length === 0;
log('\n=== VERDICT ===');
log('deep link landed on /login:', wentToLogin);
log('zero refresh attempts on cold load:', noRefreshAttempted);
log('cookie present & refresh works (200+token):', !!refreshCookie && refreshResult.status === 200 && refreshResult.tokenLen > 0);

await browser.close();
