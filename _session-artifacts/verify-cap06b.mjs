import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5262';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport:{width:1600,height:1300} })).newPage();

const sessionPosts = [];
page.on('request', req => {
  if (req.method()==='POST' && /\/a\/v1\/sim\/sessions$/.test(req.url())) {
    let body=null; try { body = JSON.parse(req.postData()||'{}'); } catch(e){ body={parseErr:String(e)}; }
    const snap = body.baseSnapshot || {};
    sessionPosts.push({ keys: Object.keys(snap).length, scope: body.scope||{}, sampleKeys: Object.keys(snap).slice(0,10) });
  }
});
const readText = async (sel) => { const l=page.locator(sel); return (await l.count())>0 ? (await l.first().innerText()).trim() : '<absent>'; };

await page.goto(BASE+'/', {waitUntil:'networkidle'});
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForTimeout(2500);

// ========= FLOW A: RISK BOARD (/v/risk) "开推演对策" =========
console.log('========= FLOW A: RISK BOARD =========');
await page.goto(BASE+'/v/risk', {waitUntil:'networkidle'});
await page.waitForTimeout(4000);
const riskBtns = await page.locator('[data-testid^=risk-card-whatif-]').all();
const riskIds = [];
for (const b of riskBtns) riskIds.push(await b.getAttribute('data-testid'));
console.log('risk-card-whatif buttons:', JSON.stringify(riskIds));
if (riskBtns.length>0) {
  const firstBase = riskIds[0].replace('risk-card-whatif-','');
  console.log('clicking base:', firstBase, 'disabled?', await riskBtns[0].isDisabled());
  sessionPosts.length = 0;
  await riskBtns[0].click();
  await page.waitForTimeout(4000);
  console.log('URL after:', page.url());
  console.log('whatif badge:', await readText('[data-testid=sandbox-whatif-badge]'), '| subject:', await readText('[data-testid=sandbox-whatif-subject]'), '| source:', await readText('[data-testid=sandbox-whatif-source]'));
  const post = sessionPosts[sessionPosts.length-1];
  console.log('SESSION POST keys:', post?.keys, '| scope:', JSON.stringify(post?.scope));
  console.log('sample keys:', JSON.stringify(post?.sampleKeys));
  console.log('cropped KPIs: global=', await readText('[data-testid=sandbox-kpi-global-val]'), 'util=', await readText('[data-testid=sandbox-kpi-utilization-val]'));
  await page.screenshot({ path: SHOT+'/cap06-risk-cropped.png' });
}

// ========= FLOW B: PROJECT-SIM stepper -> base table "开始推演" =========
console.log('\\n========= FLOW B: PROJECT-SIM STEPPER =========');
await page.goto(BASE+'/v/project-sim', {waitUntil:'networkidle'});
await page.waitForTimeout(4000);
// advance stepper until pm-run-sim appears (click pm-next up to 6x)
let found = false;
for (let i=0;i<7;i++){
  const cnt = await page.locator('[data-testid^=pm-run-sim-]').count();
  if (cnt>0){ found=true; break; }
  const next = page.locator('[data-testid=pm-next]');
  if (await next.count()===0 || await next.first().isDisabled()) { console.log('step',i,'no next / disabled'); break; }
  await next.first().click();
  await page.waitForTimeout(1800);
}
const stepChip = await readText('[data-testid=pm-step-counter]');
console.log('after advancing, step-counter:', stepChip, '| pm-run-sim found:', found);
const pmBtns = await page.locator('[data-testid^=pm-run-sim-]').all();
const pmIds = [];
for (const b of pmBtns) pmIds.push(await b.getAttribute('data-testid'));
console.log('pm-run-sim buttons:', JSON.stringify(pmIds));
if (pmBtns.length>0){
  const b0 = pmBtns[0]; const id0 = pmIds[0]; const base0 = id0.replace('pm-run-sim-','');
  console.log('clicking:', id0, 'disabled?', await b0.isDisabled());
  sessionPosts.length = 0;
  await b0.click();
  await page.waitForTimeout(4000);
  console.log('URL after:', page.url());
  console.log('whatif badge:', await readText('[data-testid=sandbox-whatif-badge]'), '| subject:', await readText('[data-testid=sandbox-whatif-subject]'), '| source:', await readText('[data-testid=sandbox-whatif-source]'));
  const post = sessionPosts[sessionPosts.length-1];
  console.log('SESSION POST keys:', post?.keys, '| scope:', JSON.stringify(post?.scope));
  console.log('sample keys:', JSON.stringify(post?.sampleKeys));
  await page.screenshot({ path: SHOT+'/cap06-projsim-cropped.png' });
} else {
  await page.screenshot({ path: SHOT+'/cap06-projsim-nobtn.png', fullPage:true });
  const bt = await page.locator('body').innerText();
  console.log('body text tail:', bt.slice(-1200));
}
await browser.close();
console.log('DONE');
