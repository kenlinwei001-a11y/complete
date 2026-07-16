import pkg from '/home/user/complete/node_modules/playwright-core/index.js'; const { chromium } = pkg;
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.goto('http://127.0.0.1:5211/login', { waitUntil: 'networkidle' });
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  console.log('AFTER_LOGIN_URL', page.url());
  await page.goto('http://127.0.0.1:5211/v/risk', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const conf = await page.locator('[data-testid=risk-confidence-banner]').textContent().catch(()=>null);
  console.log('RISK_CONFIDENCE_BANNER:', (conf||'').replace(/\s+/g,' ').trim().slice(0,160));
  const sumRed = await page.locator('[data-testid=risk-summary-red]').textContent().catch(()=>null);
  const sumYel = await page.locator('[data-testid=risk-summary-yellow]').textContent().catch(()=>null);
  console.log('SUMMARY red:', (sumRed||'').replace(/\s+/g,' ').trim(), '| yellow:', (sumYel||'').replace(/\s+/g,' ').trim());
  const cardCount = await page.locator('[data-testid^=risk-card-]').count().catch(()=>0);
  console.log('RISK_CARD_ELEMENTS:', cardCount);
  await page.screenshot({ path: SHOT+'/shot_risk_board.png', fullPage: true });
  const cz = page.locator('text=常州').first();
  if (await cz.count()) {
    await cz.click();
    await page.waitForTimeout(1500);
    const bars = await page.locator('[data-testid^=risk-day-]').evaluateAll(els =>
      els.slice(0,30).map(e => ({ t: e.getAttribute('title'), bg: getComputedStyle(e).backgroundColor }))
    ).catch(()=>[]);
    const redCount = bars.filter(b => /224, 98, 108/i.test(b.bg)).length;
    console.log('CZ_DAYSTRIP bars:', bars.length, 'redBars:', redCount);
    console.log('CZ_DAYSTRIP first5:', JSON.stringify(bars.slice(0,5)));
    const nodata = await page.locator('[data-testid=risk-detail-nodata]').count().catch(()=>0);
    console.log('CZ_DETAIL_NODATA_EMPTY_STATE_PRESENT:', nodata);
    await page.screenshot({ path: SHOT+'/shot_cz_detail.png' });
    await page.keyboard.press('Escape').catch(()=>{});
  } else { console.log('CZ card not found'); }
  await page.goto('http://127.0.0.1:5211/v/sim-sandbox', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  for (const v of ['demandDelta','demandLoad','loadIndex','totalDemand','utilization']) {
    const val = await page.locator('[data-testid=sandbox-kpi-'+v+'-val]').textContent().catch(()=>null);
    const lbl = await page.locator('[data-testid=sandbox-kpi-'+v+'] span').first().textContent().catch(()=>null);
    console.log('SANDBOX_KPI '+v+': label="'+(lbl||'').trim()+'" value="'+(val||'').trim()+'"');
  }
  const glob = await page.locator('[data-testid=sandbox-kpi-global-val]').textContent().catch(()=>null);
  console.log('SANDBOX_GLOBAL:', (glob||'').trim());
  await page.screenshot({ path: SHOT+'/shot_sandbox.png', fullPage: true });
  console.log('CONSOLE_ERRORS:', errs.length, errs.slice(0,3).join(' || '));
} catch (e) { console.log('SCRIPT_ERROR', e.message); }
finally { await browser.close(); }
