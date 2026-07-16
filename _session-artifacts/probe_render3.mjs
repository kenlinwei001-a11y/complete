import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5173';

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 2200 } });
const page = await ctx.newPage();

// capture the stats API response the page consumes
let statsBody = null;
page.on('response', async r => {
  if (r.url().includes('/ontology/object-types/stats')) {
    try { statsBody = await r.json(); } catch {}
    console.log('STATS API:', r.status(), r.url());
  }
});

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForURL(BASE + '/', { timeout: 15000 });
console.log('LOGGED IN');

// Click in-app nav link "对象/类型浏览" (SPA nav, preserves in-memory token)
const navLink = page.getByRole('link', { name: '对象/类型浏览' });
await navLink.first().click();
await page.waitForSelector('[data-testid="object-types-page"]', { timeout: 20000 });
await page.waitForTimeout(2500);
console.log('OBJECT-TYPES URL:', page.url());

const headers = await page.locator('[data-testid^="ot-domain-"] .section-title').allInnerTexts().catch(()=>[]);
console.log('=== DOMAIN GROUP HEADER TEXTS (what user sees as domain sections) ===');
headers.forEach((h,i)=>console.log(`  [${i}] ${JSON.stringify(h)}`));

const fullText = await page.locator('[data-testid="object-types-page"]').innerText();
const probes = ['CONN_GARBAGE_XYZ_NOT_A_REAL_DOMAIN','conn_garbage_xyz_not_a_real_domain','FdeProbeBogusDomain','NOT_A_DOMAIN_123','FdeReproLine','ghost_domain_verify','FdeVerifyType','FdeProbeBase','FdeProbeSeg','conn_s7fan684pj4jzzmm','FdeProbeSeg2','Test'];
console.log('=== VISIBLE PROBE STRINGS IN RENDERED PAGE TEXT ===');
for (const p of probes) console.log(`  ${p}: ${fullText.includes(p) ? 'VISIBLE' : 'absent'}`);

const otCount = await page.locator('[data-testid="ot-count"]').textContent().catch(()=>null);
console.log('ot-count badge:', otCount);

if (statsBody) {
  const doms = [...new Set(statsBody.stats.map(s=>s.domain))].sort();
  console.log('STATS API distinct domains count:', doms.length);
}

await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/object-types.png', fullPage: true });
console.log('screenshot saved');
await browser.close();
