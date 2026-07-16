import pkg from '/home/user/complete/.claude/worktrees/agent-a5600e2104f4afcaf/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5213';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const log = (...a) => console.log(...a);

const net = [];          // all /a/v1 & /b/v1 & solver responses
const bodies = {};       // captured JSON bodies by tag
const consoleErrs = [];
const pageErrs = [];

function tagFor(url) {
  if (/\/sim\/view-config/.test(url)) return 'view-config';
  if (/\/sim\/sessions\?/.test(url) || /\/sim\/sessions$/.test(url)) return 'sessions-list';
  if (/\/sim\/sessions\/[^/]+\/certification/.test(url)) return 'certification';
  if (/\/sim\/sessions\/[^/]+\/tick/.test(url)) return 'tick';
  if (/\/sim\/sessions\/[^/]+\/checkpoint/.test(url)) return 'checkpoint';
  if (/\/sim\/sessions\/[^/]+\/branch/.test(url)) return 'branch';
  if (/\/sim\/sessions$/.test(url)) return 'create-session';
  if (/\/sim\/compare/.test(url)) return 'compare';
  if (/\/sim\/propagation-rules/.test(url)) return 'propagation-rules';
  if (/\/solvers\/risk_timeline/.test(url) || /risk_timeline/.test(url)) return 'risk_timeline';
  if (/\/object-types/.test(url)) return 'object-types';
  if (/\/objects\?/.test(url) && /Base/.test(url)) return 'objects-Base';
  if (/\/lineage/.test(url)) return 'lineage';
  if (/\/actions/.test(url)) return 'actions';
  return null;
}

async function toastText(page) {
  try {
    return (await page.locator('[role="status"]').innerText({ timeout: 500 })).replace(/\n+/g, ' | ').trim();
  } catch { return ''; }
}
async function present(page, tid) {
  return (await page.locator(`[data-testid="${tid}"]`).count()) > 0;
}
async function visText(page, tid) {
  try { return (await page.locator(`[data-testid="${tid}"]`).first().innerText({ timeout: 800 })).trim(); }
  catch { return null; }
}

const results = {};
function rec(name, status, evidence) { results[name] = { status, evidence }; log(`[BTN] ${name}: ${status} — ${evidence}`); }

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => pageErrs.push(String(e).slice(0, 300)));
page.on('response', async r => {
  const u = r.url();
  if (!/\/(a|b)\/v1\//.test(u)) return;
  const entry = { method: r.request().method(), url: u.replace(BASE, '').replace('http://127.0.0.1:4013', '').replace('http://127.0.0.1:4113', ''), status: r.status() };
  net.push(entry);
  const tag = tagFor(u);
  if (tag && r.request().method() !== 'OPTIONS') {
    try { const j = await r.json(); bodies[tag] = { status: r.status(), body: j }; } catch {}
  }
});

// ---- LOGIN ----
log('=== LOGIN ===');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
// tenant default demo; fill username/password
const tenant = page.locator('#login-tenant');
if (await tenant.count()) { await tenant.fill('demo'); }
// username input: find the first text input that's not tenant, or by label
const inputs = page.locator('input');
// Heuristic: username = input after tenant (id login-user?), password = type=password
const pw = page.locator('input[type="password"]');
// find username field
let userField = page.locator('#login-user, #login-username, input[name="username"]');
if (!(await userField.count())) {
  // fallback: the text input that isn't tenant
  userField = page.locator('input:not([type="password"])').nth(1);
}
await userField.first().fill('admin');
await pw.first().fill('demo1234');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);
log('after login url:', page.url());
await page.screenshot({ path: `${SHOT}/01-after-login.png` });

// ---- NAV to sandbox ----
log('=== NAV to sandbox ===');
const navLink = page.locator('[data-testid="nav-sim-sandbox"]');
const navCount = await navLink.count();
log('nav-sim-sandbox present:', navCount);
if (navCount) { await navLink.first().click(); }
else { await page.goto(BASE + '/v/sim-sandbox', { waitUntil: 'domcontentloaded' }); }
await page.waitForTimeout(3500);
log('sandbox url:', page.url());
log('sandbox-view present:', await present(page, 'sandbox-view'));
log('sandbox-loading present:', await present(page, 'sandbox-loading'));
log('sandbox-config-error present:', await present(page, 'sandbox-config-error'));
log('config-summary:', await visText(page, 'sandbox-config-summary'));
await page.screenshot({ path: `${SHOT}/02-sandbox-initial.png`, fullPage: true });

// capture KPI / global state values
const kpiGlobal = await visText(page, 'sandbox-kpi-global-val');
log('KPI global val:', kpiGlobal);

// ---- BUTTON: tick ----
log('=== TICK ===');
const beforeTickGlobal = kpiGlobal;
const tickBtn = page.locator('[data-testid="sandbox-tick-btn"]');
const tickDisabled = await tickBtn.isDisabled();
if (!tickDisabled) {
  await tickBtn.click();
  await page.waitForTimeout(2000);
  const afterTickGlobal = await visText(page, 'sandbox-kpi-global-val');
  const tickBody = bodies['tick'];
  rec('sandbox-tick-btn', tickBody && tickBody.status === 200 ? 'WORK' : 'CHECK',
    `tick HTTP ${tickBody?.status}; curTick=${tickBody?.body?.curTick}; global ${beforeTickGlobal}→${afterTickGlobal}; toast="${await toastText(page)}"`);
} else { rec('sandbox-tick-btn', 'BROKEN', 'button disabled (sessionId null?)'); }

// ---- BUTTON: checkpoint ----
log('=== CHECKPOINT ===');
const cpBtn = page.locator('[data-testid="sandbox-checkpoint-btn"]');
if (!(await cpBtn.isDisabled())) {
  await cpBtn.click();
  await page.waitForTimeout(1500);
  const t = await toastText(page);
  rec('sandbox-checkpoint-btn', bodies['checkpoint']?.status === 201 ? 'WORK' : 'CHECK',
    `checkpoint HTTP ${bodies['checkpoint']?.status}; toast="${t}"`);
} else { rec('sandbox-checkpoint-btn', 'BROKEN', 'disabled'); }
await page.waitForTimeout(800);

// ---- BUTTON: BRANCH (THE COMPLAINT) ----
log('=== BRANCH (KEY) ===');
delete bodies['checkpoint']; delete bodies['branch']; delete bodies['compare'];
const brBtn = page.locator('[data-testid="sandbox-branch-btn"]');
const brDisabled = await brBtn.isDisabled();
log('branch btn disabled:', brDisabled);
if (!brDisabled) {
  await brBtn.click();
  await page.waitForTimeout(3500);
  const t = await toastText(page);
  const compareCardPresent = await present(page, 'sandbox-compare-card');
  const comparePanelPresent = await present(page, 'sandbox-compare');
  // Is the compare card visible in viewport?
  let inViewport = false, boundingBox = null;
  if (compareCardPresent) {
    try {
      const el = page.locator('[data-testid="sandbox-compare-card"]').first();
      boundingBox = await el.boundingBox();
      inViewport = boundingBox ? (boundingBox.y < 1000 && boundingBox.y > -50) : false;
    } catch {}
  }
  const branchEvidence = `checkpoint HTTP ${bodies['checkpoint']?.status}; branch HTTP ${bodies['branch']?.status}; compare HTTP ${bodies['compare']?.status}; toast="${t}"; compareCard=${compareCardPresent}; comparePanel=${comparePanelPresent}; cardY=${boundingBox?.y}; inViewport=${inViewport}`;
  rec('sandbox-branch-btn', (bodies['branch']?.status === 201 && bodies['compare']?.status === 200) ? 'WORK' : 'BROKEN', branchEvidence);
  log('BRANCH compare body a/b lengths:', JSON.stringify({ a: bodies['compare']?.body?.a?.length, b: bodies['compare']?.body?.b?.length }));
  await page.screenshot({ path: `${SHOT}/03-after-branch-fullpage.png`, fullPage: true });
  // scroll compare card into view and screenshot
  if (compareCardPresent) {
    await page.locator('[data-testid="sandbox-compare-card"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/04-compare-card-scrolled.png` });
    log('compare card innerText:', (await visText(page, 'sandbox-compare-card'))?.slice(0, 400));
  }
} else { rec('sandbox-branch-btn', 'BROKEN', 'button disabled (sessionId null)'); }

// ---- BUTTON: compare refresh ----
if (await present(page, 'sandbox-compare-refresh-btn')) {
  const rBtn = page.locator('[data-testid="sandbox-compare-refresh-btn"]');
  const rDis = await rBtn.isDisabled();
  if (!rDis) { await rBtn.click(); await page.waitForTimeout(1500); rec('sandbox-compare-refresh-btn', bodies['compare']?.status === 200 ? 'WORK' : 'CHECK', `refresh compare HTTP ${bodies['compare']?.status}`); }
  else rec('sandbox-compare-refresh-btn', 'BROKEN', 'disabled (branchId null)');
}

// ---- BUTTON: adopt ----
log('=== ADOPT ===');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
delete bodies['actions'];
const adBtn = page.locator('[data-testid="sandbox-adopt-btn"]');
if (!(await adBtn.isDisabled())) {
  await adBtn.click();
  await page.waitForTimeout(2000);
  const t = await toastText(page);
  const actionResp = net.filter(n => /\/actions/.test(n.url)).slice(-3);
  rec('sandbox-adopt-btn', 'CHECK', `toast="${t}"; action net=${JSON.stringify(actionResp)}`);
} else { rec('sandbox-adopt-btn', 'BROKEN', 'disabled'); }

// ---- DAG density toggle ----
log('=== DAG MODE ===');
const densePresent = await present(page, 'sandbox-dag-density');
log('dag density toggle present:', densePresent);
if (densePresent) {
  const wrapBefore = await page.locator('[data-testid="sandbox-dag-wrap"]').getAttribute('data-layer-count').catch(() => null);
  await page.locator('[data-testid="sandbox-dag-mode-aggregate"]').click();
  await page.waitForTimeout(800);
  const modeAfter = await page.locator('[data-testid="sandbox-dag-wrap"]').getAttribute('data-dag-mode').catch(() => null);
  const layerAfter = await page.locator('[data-testid="sandbox-dag-wrap"]').getAttribute('data-layer-count').catch(() => null);
  await page.locator('[data-testid="sandbox-dag-mode-full"]').click();
  await page.waitForTimeout(600);
  const modeBack = await page.locator('[data-testid="sandbox-dag-wrap"]').getAttribute('data-dag-mode').catch(() => null);
  rec('sandbox-dag-mode-toggle', (modeAfter === 'aggregate' && modeBack === 'full') ? 'WORK' : 'CHECK',
    `layers full=${wrapBefore}; aggregate mode=${modeAfter} layers=${layerAfter}; back mode=${modeBack}`);
} else { rec('sandbox-dag-mode-toggle', 'N/A', 'not dense (<=18 types) → toggle hidden'); }

// ---- DAG node click (R13 lineage) ----
log('=== DAG NODE CLICK ===');
const nodeSel = '[data-testid^="sandbox-dag"] [data-node], [data-testid="sandbox-dag"] g, [data-testid="sandbox-dag"] rect';
// PmDag nodes: try clicking a node inside sandbox-dag
const dagNodes = page.locator('[data-testid="sandbox-dag"]').locator('rect, g[role="button"], [data-node-id]');
const nodeCount = await dagNodes.count();
log('dag clickable node candidates:', nodeCount);
let lineageResult = 'no nodes found';
if (nodeCount > 0) {
  await dagNodes.first().click({ force: true }).catch(e => log('node click err', String(e).slice(0,100)));
  await page.waitForTimeout(1500);
  const popover = await present(page, 'sandbox-lineage-popover');
  const chain = await present(page, 'sandbox-lineage-chain');
  const empty = await present(page, 'sandbox-lineage-empty');
  const errp = await present(page, 'sandbox-lineage-error');
  lineageResult = `popover=${popover} chain=${chain} empty=${empty} error=${errp}; lineage HTTP=${bodies['lineage']?.status}`;
  if (popover) { await page.screenshot({ path: `${SHOT}/05-lineage-popover.png` }); log('lineage popover text:', (await visText(page, 'sandbox-lineage-popover'))?.slice(0,300)); }
  // close popover
  if (await present(page, 'sandbox-lineage-scrim')) await page.locator('[data-testid="sandbox-lineage-scrim"]').click({ force: true }).catch(()=>{});
}
rec('sandbox-dag-node-click', lineageResult.includes('popover=true') ? 'WORK' : 'CHECK', lineageResult);

// ---- AI console ----
log('=== AI CONSOLE ===');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const aiInput = page.locator('[data-testid="sandbox-ai-input"]');
if (await aiInput.count() && !(await aiInput.isDisabled())) {
  const tickBefore = await visText(page, 'sandbox-kpi-global');
  await aiInput.fill('推进 3 个 tick');
  const beforeCount = net.filter(n => /\/tick/.test(n.url)).length;
  await page.locator('[data-testid="sandbox-ai-run"]').click();
  await page.waitForTimeout(3500);
  const echo = await visText(page, 'sandbox-ai-echo');
  const afterCount = net.filter(n => /\/tick/.test(n.url)).length;
  rec('sandbox-ai-run (推进3tick)', afterCount > beforeCount ? 'WORK' : 'CHECK', `echo="${echo}"; tick calls +${afterCount - beforeCount}`);
  // branch intent
  await aiInput.fill('分支对比');
  const brBefore = net.filter(n => /\/branch/.test(n.url)).length;
  await page.locator('[data-testid="sandbox-ai-run"]').click();
  await page.waitForTimeout(3000);
  const echo2 = await visText(page, 'sandbox-ai-echo');
  const brAfter = net.filter(n => /\/branch/.test(n.url)).length;
  rec('sandbox-ai-run (分支对比)', brAfter > brBefore ? 'WORK' : 'CHECK', `echo="${echo2}"; branch calls +${brAfter - brBefore}`);
} else { rec('sandbox-ai-run', 'BROKEN', 'AI input disabled/missing'); }

// ---- Right column collapsible cards ----
log('=== COLLAPSIBLE CARDS ===');
const cards = ['sandbox-readiness-card','sandbox-dual-radar-card','sandbox-runstate-card','sandbox-schema-card','sandbox-console-card','sandbox-run-history-card'];
const cardReport = {};
for (const c of cards) {
  if (!(await present(page, c))) { cardReport[c] = 'ABSENT'; continue; }
  const el = page.locator(`[data-testid="${c}"]`).first();
  await el.scrollIntoViewIfNeeded().catch(()=>{});
  await page.waitForTimeout(200);
  // click header to expand (CollapsibleCard header likely a button/summary)
  try { await el.locator('button, [role="button"], summary, header, > div').first().click({ timeout: 1500 }); } catch {}
  await page.waitForTimeout(700);
  const txt = (await el.innerText().catch(()=> '')).replace(/\n+/g,' | ').slice(0, 500);
  cardReport[c] = txt;
}
log('CARD CONTENTS:'); for (const [k,v] of Object.entries(cardReport)) log(`  ${k}: ${v}`);

// ---- Base cards (data authenticity) ----
log('=== BASE CARDS ===');
const baseCards = await present(page, 'sandbox-base-cards');
const baseEmpty = await present(page, 'sandbox-base-cards-empty');
const baseErr = await present(page, 'sandbox-base-cards-error');
let baseTxt = await visText(page, 'sandbox-base-cards-panel');
log('base-cards present:', baseCards, '| empty:', baseEmpty, '| error:', baseErr);
log('base-cards-panel text:', baseTxt?.slice(0, 600));

// ---- Risk TOP3 (need to expand runstate card first, already done) ----
const riskPresent = await present(page, 'sandbox-risk-top3');
const risk0 = await visText(page, 'sandbox-risk-0');
const riskDataMode = await page.locator('[data-testid="sandbox-risk-datamode-0"]').innerText().catch(()=>null);
log('risk-top3 present:', riskPresent, '| risk-0:', risk0, '| datamode-0:', riskDataMode);

// ---- Schema rules ----
const schemaRules = await visText(page, 'sandbox-schema-rules');
log('schema-rules text:', schemaRules?.slice(0, 400));

await page.screenshot({ path: `${SHOT}/06-final-fullpage.png`, fullPage: true });

// ---- DUMP ----
log('\n=== NETWORK SIM CALLS (status) ===');
for (const n of net.filter(x => /\/sim\/|risk_timeline|object-types|\/objects\?|\/actions/.test(x.url))) log(`  ${n.status} ${n.method} ${n.url}`);
log('\n=== CONSOLE ERRORS ==='); consoleErrs.slice(0,15).forEach(e => log('  ', e));
log('\n=== PAGE ERRORS ==='); pageErrs.slice(0,15).forEach(e => log('  ', e));
log('\n=== KEY BODIES ===');
log('view-config: nodeTypes=' + bodies['view-config']?.body?.nodeTypes?.length + ' stateVars=' + JSON.stringify(bodies['view-config']?.body?.stateVars) + ' propCount=' + bodies['view-config']?.body?.propagationCount);
log('certification: entering=' + bodies['certification']?.body?.worldCompleteness?.entering?.length + ' gaps=' + bodies['certification']?.body?.gaps?.length + ' level=' + bodies['certification']?.body?.level);
log('risk_timeline: dataMode=' + bodies['risk_timeline']?.body?.dataMode + ' cards=' + JSON.stringify((bodies['risk_timeline']?.body?.cards||bodies['risk_timeline']?.body?.data?.cards||[]).map(c=>({b:c.base,f:c.factor,peak:c.peak,dm:c.dataMode,hd:c.hasData}))).slice(0,500));
log('objects-Base: items=' + (bodies['objects-Base']?.body?.items?.length) + ' sample=' + JSON.stringify(bodies['objects-Base']?.body?.items?.[0]?.props).slice(0,300));
log('object-types: count=' + (bodies['object-types']?.body?.length || bodies['object-types']?.body?.items?.length));

log('\n=== RESULTS JSON ===');
log(JSON.stringify(results, null, 2));

await browser.close();
log('DONE');
