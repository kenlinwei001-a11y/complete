import { withLogin } from './pwlib.mjs';
const SS = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const TASK = 'task_01KX899B55Q6DNKNDAMDR3PEWH';
const P50_PROV = 'prov_01KX899B6GJ9QTJ1TXM6P1TWBE';

await withLogin({ username: 'admin', password: 'demo1234', tenant: 'demo' }, async (page, ctx, logs) => {
  const out = {};

  // ===================== Ch21: /tasks/:taskId answer + evidence popover =====================
  await page.goto('http://127.0.0.1:5296/tasks/' + TASK, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // wait for answer card
  await page.waitForSelector('[data-testid="answer-card"]', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: SS + '/chA_ch21_task.png', fullPage: true });

  // trust badge
  out.trustBadge = await page.locator('[data-testid="trust-badge"]').first().innerText().catch(() => 'N/A');
  // KPI values (read the rendered kpi values)
  out.kpis = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-testid^="kpi-"]'));
    return els.map(e => ({ testid: e.getAttribute('data-testid'), text: e.innerText.replace(/\s+/g, ' ').trim() }));
  });

  // Click the P50 KPI to open evidence popover
  const kpiSel = `[data-testid="kpi-${P50_PROV}"]`;
  const kpiEl = page.locator(kpiSel).first();
  out.p50KpiFound = await kpiEl.count();
  if (out.p50KpiFound > 0) {
    await kpiEl.click();
    await page.waitForSelector('[data-testid="prov-popover"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: SS + '/chA_ch21_popover.png', fullPage: true });
    out.popoverText = await page.locator('[data-testid="prov-popover"]').first().innerText().catch(() => 'NO POPOVER');
  }

  // ===================== Ch35: /admin/decisions =====================
  await page.goto('http://127.0.0.1:5296/admin/decisions', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SS + '/chA_ch35_decisions_list.png', fullPage: true });
  // read the decision table rows
  out.decisionRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-testid^="decision-"]'));
    return rows.map(r => r.innerText.replace(/\t/g, ' | ').replace(/\s+/g, ' ').trim());
  });
  // click first decision row to open detail
  const row = page.locator('tr[data-testid^="decision-"]').first();
  out.decisionRowFound = await row.count();
  if (out.decisionRowFound > 0) {
    await row.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: SS + '/chA_ch35_decision_detail.png', fullPage: true });
    // read the detail panel (2nd .panel)
    out.detailText = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.panel'));
      const p = panels[panels.length - 1];
      return p ? p.innerText.replace(/\s+\n/g, '\n').trim() : 'NO DETAIL';
    });
  }

  out.consoleErrors = logs.filter(l => l.includes('pageerror') || l.includes('error:')).slice(0, 10);

  console.log(JSON.stringify(out, null, 2));
});
