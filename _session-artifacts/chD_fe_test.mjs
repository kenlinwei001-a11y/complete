import { withLogin, BASE } from './pwlib.mjs';

const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

await withLogin({ username: 'admin', password: 'demo1234', tenant: 'demo' }, async (page, ctx, logs) => {
  // ---------- Ch26: /admin/evals ----------
  await page.goto(BASE + '/admin/evals', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOT + '/chD_ch26_evals.png', fullPage: true });

  // eval history table header + rows
  const evalHead = await page.$$eval('[data-testid="eval-runs"] thead th', ths => ths.map(t => t.textContent.trim()));
  const evalRows = await page.$$eval('[data-testid="eval-runs"] tbody tr', trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())));
  // page subtitle text (the "维度" description)
  const subtitle = await page.$eval('[data-testid="evals-page"]', el => {
    const m = el.querySelector('.muted');
    return m ? m.textContent.trim() : '';
  }).catch(() => '');
  // capability slice text
  const capSlice = await page.$eval('[data-testid="evals-capability-slice"]', el => el.innerText.trim().slice(0, 500)).catch(() => '(none)');

  console.log('=== CH26 EVALS PAGE ===');
  console.log('SUBTITLE:', subtitle);
  console.log('HISTORY TABLE HEADERS:', JSON.stringify(evalHead));
  console.log('HISTORY ROWS (count ' + evalRows.length + '):');
  evalRows.forEach((r, i) => console.log('  row' + i + ':', JSON.stringify(r)));
  console.log('CAPABILITY SLICE (excerpt):', capSlice.replace(/\n+/g, ' | '));

  // ---------- Ch34: /admin/agents ----------
  await page.goto(BASE + '/admin/agents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOT + '/chD_ch34_agents.png', fullPage: true });

  // agent list buttons (left panel): badge status + name
  const agentBtns = await page.$$eval('.panel button.btn', btns =>
    btns.map(b => b.textContent.trim()).filter(t => t && !t.includes('创建') && !t.includes('新建')));
  // page heading
  const h2 = await page.$$eval('h2', hs => hs.map(h => h.textContent.trim()));

  console.log('');
  console.log('=== CH34 AGENTS PAGE ===');
  console.log('H2:', JSON.stringify(h2));
  console.log('AGENT LIST BUTTONS (count ' + agentBtns.length + '):');
  agentBtns.forEach((t, i) => console.log('  ' + i + ':', JSON.stringify(t)));

  // Look for any multi-agent / handoff / collaboration UI text on the page
  const bodyText = await page.$eval('body', el => el.innerText);
  const kw = ['handoff', '交接', 'A2A', '协作', '多 Agent', '多Agent', 'Chief', '首席', '子 Agent', '子Agent', '通信协议'];
  const found = kw.filter(k => bodyText.includes(k));
  console.log('MULTI-AGENT/COLLAB KEYWORDS FOUND ON /agents:', JSON.stringify(found));

  if (logs.length) { console.log(''); console.log('=== BROWSER LOGS (last 10) ==='); logs.slice(-10).forEach(l => console.log(l)); }
});
