import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5173';

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1600 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERR: ' + e.message));

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');
console.log('AFTER LOGIN URL:', page.url());

await page.goto(BASE + '/admin/object-types', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
console.log('OBJECT-TYPES URL:', page.url());

const pageMarker = await page.locator('[data-testid="object-types-page"]').count();
console.log('object-types-page present:', pageMarker);

const domGroups = await page.locator('[data-testid^="ot-domain-"]').evaluateAll(els =>
  els.map(el => el.getAttribute('data-testid')).filter(t => t && t.startsWith('ot-domain-') && !t.startsWith('ot-domain-avg') && t !== 'ot-domain-filter')
);
console.log('RENDERED DOMAIN GROUPS:', JSON.stringify(domGroups));

const fullText = await page.locator('[data-testid="object-types-page"]').innerText();
const probes = ['CONN_GARBAGE_XYZ_NOT_A_REAL_DOMAIN', 'conn_garbage_xyz_not_a_real_domain', 'FdeProbeBogusDomain', 'NOT_A_DOMAIN_123', 'FdeReproLine', 'ghost_domain_verify', 'FdeVerifyType', 'FdeProbeBase', 'FdeProbeSeg', 'conn_s7fan684pj4jzzmm'];
console.log('=== VISIBLE PROBE STRINGS IN RENDERED TEXT ===');
for (const p of probes) {
  console.log(`  ${p}: ${fullText.includes(p) ? 'VISIBLE' : 'absent'}`);
}

const ddOptions = await page.locator('[data-testid="ot-domain-filter"] option').evaluateAll(els => els.map(e => e.textContent));
console.log('=== DOMAIN FILTER DROPDOWN OPTIONS ===');
console.log(JSON.stringify(ddOptions));

const otCount = await page.locator('[data-testid="ot-count"]').textContent().catch(()=>null);
console.log('ot-count badge:', otCount);

console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors.slice(0,10)));

await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/object-types.png', fullPage: true });
console.log('screenshot saved');

await browser.close();
