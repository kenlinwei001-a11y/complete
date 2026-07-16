import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5262';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();

// capture every POST to sim/sessions with its request body
const sessionPosts = [];
page.on('request', req => {
  if (req.method()==='POST' && /\/a\/v1\/sim\/sessions$/.test(req.url())) {
    let body=null; try { body = JSON.parse(req.postData()||'{}'); } catch(e){ body={parseErr:String(e)}; }
    const snap = body.baseSnapshot || {};
    sessionPosts.push({ when: Date.now(), keys: Object.keys(snap).length, scope: body.scope||{}, sampleKeys: Object.keys(snap).slice(0,8) });
  }
});

// ---- login ----
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForTimeout(2500);

// ======== FLOW 1: plain sandbox (full world baseline) ========
sessionPosts.length = 0;
await page.goto(BASE + '/v/sim-sandbox', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid=sandbox-view]', {timeout:15000}).catch(()=>{});
await page.waitForTimeout(3000);
const plainPost = sessionPosts[sessionPosts.length-1] || null;
console.log('=== FLOW 1 PLAIN (baseline full world) ===');
console.log('session POST baseSnapshot keys:', plainPost ? plainPost.keys : '<none captured>');
console.log('scope:', JSON.stringify(plainPost?.scope));

// ======== FLOW 2: project-sim -> click 开始推演 (changzhou/常州) ========
sessionPosts.length = 0;
await page.goto(BASE + '/v/project-sim', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
// find all pm-run-sim buttons
const runBtns = await page.locator('[data-testid^=pm-run-sim-]').all();
console.log('\\n=== FLOW 2 PROJECT-SIM ===');
console.log('pm-run-sim buttons found:', runBtns.length);
const btnIds = [];
for (const b of runBtns) { btnIds.push(await b.getAttribute('data-testid')); }
console.log('button testids:', JSON.stringify(btnIds));

// pick changzhou / 常州
const target = page.locator('[data-testid="pm-run-sim-常州"]');
const hasTarget = await target.count();
console.log('has pm-run-sim-常州:', hasTarget);
const clickBtn = hasTarget>0 ? target.first() : (runBtns[0] || null);
const clickedId = hasTarget>0 ? 'pm-run-sim-常州' : btnIds[0];
console.log('clicking:', clickedId, 'disabled?', clickBtn ? await clickBtn.isDisabled() : 'n/a');

if (clickBtn) {
  await clickBtn.click();
  await page.waitForTimeout(4000);
}
console.log('URL after click:', page.url());

// verify whatif badge + subject in sandbox
const whatifCtx = await page.locator('[data-testid=sandbox-whatif-context]').count();
const subjectTxt = (await page.locator('[data-testid=sandbox-whatif-subject]').count())>0 ? (await page.locator('[data-testid=sandbox-whatif-subject]').first().innerText()).trim() : '<absent>';
const badgeTxt = (await page.locator('[data-testid=sandbox-whatif-badge]').count())>0 ? (await page.locator('[data-testid=sandbox-whatif-badge]').first().innerText()).trim() : '<absent>';
const sourceTxt = (await page.locator('[data-testid=sandbox-whatif-source]').count())>0 ? (await page.locator('[data-testid=sandbox-whatif-source]').first().innerText()).trim() : '<absent>';
console.log('whatif-context present:', whatifCtx, '| badge:', badgeTxt, '| subject:', subjectTxt, '| source:', sourceTxt);

const cropPost = sessionPosts[sessionPosts.length-1] || null;
console.log('\\n=== FLOW 2 CROPPED session POST (real request body) ===');
console.log('session POST baseSnapshot keys:', cropPost ? cropPost.keys : '<none captured>');
console.log('scope:', JSON.stringify(cropPost?.scope));
console.log('sample baseSnapshot keys:', JSON.stringify(cropPost?.sampleKeys));

// also read KPI values in cropped view
const readText = async (sel) => { const l=page.locator(sel); return (await l.count())>0 ? (await l.first().innerText()).trim() : '<absent>'; };
console.log('\\ncropped KPIs: global=', await readText('[data-testid=sandbox-kpi-global-val]'), ' util=', await readText('[data-testid=sandbox-kpi-utilization-val]'), ' demandDelta=', await readText('[data-testid=sandbox-kpi-demandDelta-val]'));

await page.screenshot({ path: SHOT + '/cap06-cropped-sandbox.png', fullPage: false });

// summary compare
console.log('\\n=== VERDICT DATA ===');
console.log('plain keys:', plainPost?.keys, '| cropped keys:', cropPost?.keys, '| scope.baseId:', cropPost?.scope?.baseId);
console.log(JSON.stringify({ allSessionPosts: sessionPosts }, null, 0));
await browser.close();
console.log('DONE-CAP06');
