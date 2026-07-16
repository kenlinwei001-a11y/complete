import pw from '/home/user/complete/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5263';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

const MODEL = process.argv[2] || '4680-NCM';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1400 } });
  const page = await ctx.newPage();

  // Capture the raw capacity_forecast network responses
  const cfResponses = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/solvers/capacity_forecast/run')) {
      try { cfResponses.push({ url: u, status: resp.status(), body: await resp.json() }); } catch (e) { cfResponses.push({ url: u, status: resp.status(), err: String(e) }); }
    }
  });
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', (e) => consoleErrs.push('PAGEERROR: ' + e.message));

  // 1. Login
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await sleep(500);
  // fill fields (tenant defaults to demo)
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'demo1234');
  await page.click('button[type=submit]');
  await sleep(2500);
  console.log('after login URL:', page.url());

  // 2. Go to sandbox
  await page.goto(BASE + '/v/sim-sandbox', { waitUntil: 'networkidle' });
  await sleep(2000);
  console.log('sandbox URL:', page.url());
  await page.screenshot({ path: SHOT + '/cap07-sandbox-landing.png', fullPage: false });

  // 3. Find the model slice
  const sliceExists = await page.locator('[data-testid=sandbox-model-slice]').count();
  console.log('sandbox-model-slice count:', sliceExists);
  if (sliceExists === 0) {
    console.log('BODY TEXT (first 800):', (await page.locator('body').innerText()).slice(0, 800));
    await page.screenshot({ path: SHOT + '/cap07-NOSLICE.png', fullPage: true });
    await browser.close();
    return;
  }
  await page.locator('[data-testid=sandbox-model-slice]').scrollIntoViewIfNeeded();
  await sleep(300);

  // list options in the select
  const options = await page.locator('[data-testid=sandbox-model-select] option').allTextContents().catch(() => []);
  console.log('MODEL SELECT OPTIONS:', JSON.stringify(options));

  // 4. Select the target model
  const hasSelect = await page.locator('[data-testid=sandbox-model-select]').count();
  if (hasSelect) {
    await page.selectOption('[data-testid=sandbox-model-select]', MODEL).catch(async (e) => {
      console.log('selectOption by value failed, trying label:', String(e));
      await page.selectOption('[data-testid=sandbox-model-select]', { label: MODEL }).catch(ee => console.log('label also failed', String(ee)));
    });
  } else {
    console.log('NO SELECT — empty state:', await page.locator('[data-testid=sandbox-model-empty]').innerText().catch(() => '(none)'));
  }
  await sleep(2500); // wait for debounce + solver

  // 5. Read DOM values
  const read = async (tid) => (await page.locator(`[data-testid=${tid}]`).innerText().catch(() => '(missing)')).trim();
  const dom = {
    selectedModel: await page.locator('[data-testid=sandbox-model-select]').inputValue().catch(() => '(n/a)'),
    p50: await read('sandbox-model-p50'),
    p90: await read('sandbox-model-p90'),
    gap: await read('sandbox-model-gap'),
    mainbn: await read('sandbox-model-mainbn'),
    verdict: await read('sandbox-model-verdict'),
    converge: await read('sandbox-model-converge'),
  };
  // base table rows
  const rowLocs = await page.locator('[data-testid^=sandbox-model-base-]').all();
  const baseRows = [];
  for (const r of rowLocs) {
    const tid = await r.getAttribute('data-testid');
    if (tid === 'sandbox-model-base-table') continue;
    const txt = (await r.innerText()).replace(/\n/g, ' | ').trim();
    baseRows.push({ tid, txt });
  }
  const nonprodLocs = await page.locator('[data-testid^=sandbox-model-nonprod-]').all();
  const nonprod = [];
  for (const r of nonprodLocs) nonprod.push((await r.innerText()).replace(/\n/g, ' ').trim());

  console.log('\n===== DOM VALUES =====');
  console.log(JSON.stringify(dom, null, 2));
  console.log('BASE ROWS:'); baseRows.forEach(b => console.log('  ', b.txt));
  console.log('NONPROD ROWS:'); nonprod.forEach(b => console.log('  ', b));

  console.log('\n===== NETWORK capacity_forecast responses (' + cfResponses.length + ') =====');
  const last = cfResponses[cfResponses.length - 1];
  if (last) {
    const d = last.body?.data || last.body;
    console.log('status', last.status, 'url', last.url);
    console.log(JSON.stringify({ p50: d.p50, p90: d.p90, gap: d.gap, ok: d.ok, mainBn: d.mainBn, dataMode: d.dataMode, totalBases: d.totalBases, producibleCount: d.producibleCount,
      perBaseRows: (d.perBaseRows||[]).map(r => ({ base: r.base, bottleneck: r.bottleneck, tightness: r.tightness, live: r.live, weeklyCap: r.weeklyCap })),
      nonProducible: (d.nonProducible||[]).map(r => r.base + ':' + r.reason) }, null, 2));
  }

  await page.screenshot({ path: SHOT + `/cap07-${MODEL}-slice.png`, fullPage: false });
  await page.locator('[data-testid=sandbox-model-slice]').screenshot({ path: SHOT + `/cap07-${MODEL}-sliceonly.png` }).catch(()=>{});

  console.log('\nCONSOLE ERRORS:', consoleErrs.length); consoleErrs.slice(0,10).forEach(e => console.log('  ', e));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
