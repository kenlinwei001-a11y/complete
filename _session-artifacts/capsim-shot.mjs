import { chromium } from 'playwright-core';
import fs from 'fs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/capsim-fe-shots';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5237';
const USER = process.env.APP_USER || 'planner';
const PW = process.env.APP_PW || 'demo';
fs.mkdirSync(OUT, { recursive: true });

const net = [];
const logs = [];
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); console.log('shot', name); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1460, height: 1000 } });
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('request', r => { const u = r.url(); if (u.includes('/v1/queries')) net.push(`REQ ${r.method()} ${u.replace(BASE,'')}`); });
page.on('response', async r => { const u = r.url(); if (u.includes('/v1/queries') && !u.includes('/events')) net.push(`RES ${r.status()} ${u.replace(BASE,'')}`); });

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-username', { timeout: 20000 });
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PW);
  await page.click('button[type=submit]');

  // land on scenario launcher → navigate into 产能推演 (risk board) via real nav link
  await page.waitForTimeout(2500);
  const nav = page.getByRole('link', { name: '产能推演' }).first();
  if (await nav.count()) { await nav.click(); }
  else { await page.goto(BASE + '/v/risk', { waitUntil: 'domcontentloaded' }); }
  await page.waitForSelector('[data-testid=risk-kpi]', { timeout: 25000 });
  await page.waitForTimeout(1800);
  await shot(page, '01-board-collapsed');

  // open first risk card → inline detail
  const card = page.locator('[data-testid^=risk-card-]').first();
  await card.click();
  await page.waitForSelector('[data-testid^=risk-detail-]', { timeout: 12000 });
  await page.waitForTimeout(1200);
  // scroll detail into view
  await page.locator('[data-testid^=risk-detail-]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, '02-card-detail');

  // hover a day dot → rich tip (Gap#2)
  const dot = page.locator('[data-testid=risk-dot-4]').first();
  if (await dot.count()) {
    await dot.scrollIntoViewIfNeeded();
    await dot.hover();
    await page.waitForTimeout(700);
    await shot(page, '03-dot-hover');
    const tip = await page.locator('[data-testid=risk-day-tip]').count();
    console.log('day-tip visible:', tip);
  } else { console.log('no risk-dot-4'); }

  // hover a KPI provenance (Gap#4c)
  const kprov = page.locator('[data-testid=risk-kpi-orders-prov]').first();
  if (await kprov.count()) { await kprov.scrollIntoViewIfNeeded(); await kprov.hover(); await page.waitForTimeout(500); await shot(page, '03b-kpi-provenance'); }

  // mitigation compare matrix (Gap#4a)
  const cmp = page.locator('[data-testid=mitigation-compare]').first();
  if (await cmp.count()) { await cmp.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot(page, '03c-mitigation-compare'); console.log('compare-matrix present'); }

  // QA: click a preset → REAL agent path (submitQuery → SSE)
  const chip = page.locator('[data-testid^=qa-chip-]').first();
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.waitForTimeout(1000);
  // wait for a task-run to appear (streaming or answer)
  await page.waitForSelector('[data-testid^=task-run-]', { timeout: 12000 }).catch(() => console.log('no task-run selector'));
  await page.waitForTimeout(4500);
  await page.locator('[data-testid=risk-qa-answer]').scrollIntoViewIfNeeded().catch(()=>{});
  await shot(page, '04-qa-real-agent');
  const answerCard = await page.locator('[data-testid^=answer-card-], [data-testid^=task-run-]').count();
  console.log('qa answer/task-run nodes:', answerCard);

  // order aggregation tab (Gap: order-agg)
  await page.click('[data-testid=risk-tab-order]');
  await page.waitForSelector('[data-testid=risk-order-agg]', { timeout: 12000 });
  await page.waitForTimeout(1400);
  await shot(page, '05-order-agg');

  // missing panel if present (Gap#4b) — back to risk tab
  await page.click('[data-testid=risk-tab-risk]');
  await page.waitForTimeout(800);
  const miss = page.locator('[data-testid=risk-missing-panel]');
  if (await miss.count()) { await miss.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot(page, '06-missing-panel'); console.log('missing-panel present'); }
  else console.log('no missing-panel (all cards LIVE)');
} catch (e) {
  console.error('SCRIPT ERROR', e && e.message);
  await page.screenshot({ path: `${OUT}/ERROR.png`, fullPage: true }).catch(()=>{});
} finally {
  fs.writeFileSync(`${OUT}/network-and-console.txt`, 'NETWORK (/v1/queries):\n' + net.join('\n') + '\n\nCONSOLE (tail 40):\n' + logs.slice(-40).join('\n'));
  console.log('\n=== NETWORK /v1/queries ===\n' + net.join('\n'));
  await browser.close();
}
