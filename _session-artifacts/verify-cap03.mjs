import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const BASE = 'http://127.0.0.1:5262';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE ERR: '+m.text()); });
page.on('pageerror', e => errors.push('PAGEERR: '+e.message));

// ---- login ----
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
await page.waitForTimeout(2500);
console.log('after login URL:', page.url());

// ---- go to sandbox (plain, no whatif) ----
await page.goto(BASE + '/v/sim-sandbox', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid=sandbox-view]', { timeout: 15000 }).catch(()=>{});
await page.waitForTimeout(3500); // let session init + KPIs compute

const present = await page.locator('[data-testid=sandbox-view]').count();
console.log('sandbox-view present:', present);
const errState = await page.locator('[data-testid=sandbox-config-error]').count();
const loadState = await page.locator('[data-testid=sandbox-loading]').count();
console.log('config-error:', errState, 'loading:', loadState);

// ---- read KPI DOM values ----
const readText = async (sel) => { const l = page.locator(sel); return (await l.count())>0 ? (await l.first().innerText()).trim() : '<absent>'; };

const globalVal = await readText('[data-testid=sandbox-kpi-global-val]');
const curTick = await readText('[data-testid=sandbox-cur-tick]');
console.log('\\n=== WO-CAP-03 KPI DOM (real browser) ===');
console.log('sandbox-kpi-global-val =', globalVal);
console.log('sandbox-cur-tick =', curTick);

const stateVars = ['demandDelta','demandLoad','loadIndex','totalDemand','utilization'];
const kpiDom = {};
for (const v of stateVars) {
  const val = await readText(`[data-testid=sandbox-kpi-${v}-val]`);
  const labelLoc = page.locator(`[data-testid=sandbox-kpi-${v}] span`).first();
  const label = (await labelLoc.count())>0 ? (await labelLoc.innerText()).trim() : '<absent>';
  kpiDom[v] = { val, label };
  console.log(`sandbox-kpi-${v}: label="${label}" val="${val}"`);
}

// ---- config summary ----
const summary = await readText('[data-testid=sandbox-config-summary]');
console.log('config-summary:', summary);

// ---- health radar dim label (cert.knowledge rename check) ----
// The health radar 6-dim includes utilization->建模完整度. Read all axis texts.
const healthTexts = await page.locator('[data-testid=sandbox-health-radar] text').allInnerTexts().catch(()=>[]);
console.log('health-radar axis labels:', JSON.stringify(healthTexts));
const readinessTexts = await page.locator('[data-testid=sandbox-radar] text').allInnerTexts().catch(()=>[]);
console.log('readiness-radar axis labels:', JSON.stringify(readinessTexts));

// check no literal "利用率" mislabel for cert.knowledge in the whole page body (base card 利用率 is legit)
const bodyText = await page.locator('body').innerText();
console.log('page contains "建模完整度":', bodyText.includes('建模完整度'));

await page.screenshot({ path: SHOT + '/cap03-sandbox.png', fullPage: false });
console.log('\\nerrors:', errors.length ? errors.slice(0,8) : 'none');
await browser.close();
console.log('DONE-CAP03');
