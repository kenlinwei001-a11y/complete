import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5173';

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 2000 } });
const page = await ctx.newPage();

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForURL(BASE + '/', { timeout: 15000 });
console.log('LOGGED IN, url:', page.url());

// Navigate via SPA to object-types
await page.goto(BASE + '/admin/object-types', { waitUntil: 'networkidle' });
// wait for the page marker
await page.waitForSelector('[data-testid="object-types-page"]', { timeout: 15000 });
await page.waitForTimeout(2000); // react-query settle

console.log('OBJECT-TYPES URL:', page.url());

const domGroups = await page.locator('[data-testid^="ot-domain-"]').evaluateAll(els =>
  els.map(el => el.getAttribute('data-testid')).filter(t => t && t.startsWith('ot-domain-') && !t.includes('ot-domain-avg') && t !== 'ot-domain-filter')
);
console.log('RENDERED DOMAIN GROUP testids:', JSON.stringify(domGroups));

// section-title text per domain group
const headers = await page.locator('[data-testid^="ot-domain-"] .section-title').allInnerTexts().catch(()=>[]);
console.log('DOMAIN GROUP HEADER TEXTS:', JSON.stringify(headers));

const fullText = await page.locator('[data-testid="object-types-page"]').innerText();
const probes = ['CONN_GARBAGE_XYZ_NOT_A_REAL_DOMAIN','conn_garbage_xyz_not_a_real_domain','FdeProbeBogusDomain','NOT_A_DOMAIN_123','FdeReproLine','ghost_domain_verify','FdeVerifyType','FdeProbeBase','FdeProbeSeg','conn_s7fan684pj4jzzmm','FdeProbeSeg2'];
console.log('=== VISIBLE PROBE STRINGS ===');
for (const p of probes) console.log(`  ${p}: ${fullText.includes(p) ? 'VISIBLE' : 'absent'}`);

const otCount = await page.locator('[data-testid="ot-count"]').textContent().catch(()=>null);
console.log('ot-count badge:', otCount);

await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/object-types.png', fullPage: true });
console.log('screenshot saved');
await browser.close();
