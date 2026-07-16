import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const out = { steps: [] };
const P = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const clickFirstListItem = async () => {
  // agent/skill list buttons carry a status badge (PUBLISHED/DRAFT) — click the first
  const btns = await page.$$('button:has(span.badge)');
  for (const el of btns) {
    const t = (await el.textContent()) || '';
    if (/PUBLISHED|DRAFT|草稿|已发布/.test(t)) { await el.click().catch(() => {}); await page.waitForTimeout(1100); return true; }
  }
  // fallback: any left-column btn
  const any = await page.$('.btn');
  if (any) { await any.click().catch(() => {}); await page.waitForTimeout(1100); return true; }
  return false;
};
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2200);

  // ---- C5: /admin/agents rule binding = picker (not free-text) ----
  await page.goto(BASE + '/admin/agents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  let picker = await page.$('[data-testid="agent-rulebindings-select"]');
  if (!picker) { await clickFirstListItem(); picker = await page.$('[data-testid="agent-rulebindings-select"]'); }
  const freeText = await page.$('input[aria-label="规则 keys"]');
  const pickAll = await page.$('[data-testid="agent-rulebindings-select-all"]');
  const pickPick = await page.$('[data-testid="agent-rulebindings-select-pick"]');
  const ruleOpts = await page.$$('[data-testid^="agent-rulebindings-select-opt-"]');
  P('C5 agent rule picker present: ' + !!picker + ' | old free-text input present: ' + !!freeText + ' | radios(all/pick): ' + !!pickAll + '/' + !!pickPick + ' | rule options: ' + ruleOpts.length);
  await page.screenshot({ path: EV + '/rr-c5-agent-picker.png', fullPage: true });

  // ---- C6a: /admin/mcp built-in solver section ----
  await page.goto(BASE + '/admin/mcp', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const builtinSection = await page.$('[data-testid="mcp-builtin-section"]');
  const builtinSolvers = await page.$('[data-testid="mcp-builtin-solvers"]');
  const bodyText1 = await page.evaluate(() => document.body.innerText);
  P('C6a MCP builtin section: ' + !!builtinSection + ' | builtin-solvers item: ' + !!builtinSolvers + ' | 求解器/内置 text: ' + /求解器/.test(bodyText1) + '/' + /内置/.test(bodyText1));
  if (builtinSolvers) { await builtinSolvers.click().catch(() => {}); await page.waitForTimeout(1000); const t2 = await page.evaluate(() => document.body.innerText); P('  after click builtin-solvers: mcp__solvers__ tools visible = ' + /mcp__solvers__/.test(t2)); }
  await page.screenshot({ path: EV + '/rr-c6-mcp-builtin.png', fullPage: true });

  // ---- C6b: /admin/skills two ref sections ----
  await page.goto(BASE + '/admin/skills', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  let ruleRefs = await page.$('[data-testid="skill-rule-refs"]');
  if (!ruleRefs) { await clickFirstListItem(); ruleRefs = await page.$('[data-testid="skill-rule-refs"]'); }
  const mcpRefs = await page.$('[data-testid="skill-mcp-refs"]');
  const bodyText3 = await page.evaluate(() => document.body.innerText);
  P('C6b skill rule-refs section: ' + !!ruleRefs + ' | mcp-refs section: ' + !!mcpRefs + ' | 规则引用/MCP 引用 text: ' + /规则引用/.test(bodyText3) + '/' + /MCP 引用/.test(bodyText3));
  await page.screenshot({ path: EV + '/rr-c6-skill-refs.png', fullPage: true });
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
