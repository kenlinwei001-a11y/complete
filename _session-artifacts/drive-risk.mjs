import pw from '/home/user/complete/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5263';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
  await page.click('button[type=submit]'); await sleep(2500);

  // 1. /v/risk — is there a model dimension?
  await page.goto(BASE + '/v/risk', { waitUntil: 'networkidle' }); await sleep(2500);
  console.log('RISK URL:', page.url());
  const riskModelSlice = await page.locator('[data-testid=sandbox-model-slice]').count();
  const riskModelSelect = await page.locator('[data-testid=sandbox-model-select]').count();
  // any element mentioning 型号 (model) as a filter/select
  const modelText = await page.locator('text=型号').count().catch(()=>0);
  const selects = await page.locator('select').count();
  console.log('RISK PAGE: sandbox-model-slice=', riskModelSlice, '| sandbox-model-select=', riskModelSelect, '| "型号" occurrences=', modelText, '| total selects=', selects);
  await page.screenshot({ path: SHOT + '/risk-page-no-model.png', fullPage: false });

  // 2. Nav: is 推演沙盘 reachable? expand 推演 nav group
  const navToggle = page.locator('[data-testid=nav-group-toggle-推演]');
  if (await navToggle.count()) { await navToggle.click().catch(()=>{}); await sleep(500); }
  const bodyNav = (await page.locator('body').innerText());
  console.log('NAV has 推演沙盘:', bodyNav.includes('推演沙盘'), '| has 产能推演:', bodyNav.includes('产能推演'), '| has 项目沙盘推演:', bodyNav.includes('项目沙盘推演'));

  // 3. project-sim — model dim there?
  await page.goto(BASE + '/v/project-sim', { waitUntil: 'networkidle' }).catch(()=>{}); await sleep(2000);
  console.log('PROJECTSIM URL:', page.url());
  const psModelSlice = await page.locator('[data-testid=sandbox-model-slice]').count();
  const psBody = (await page.locator('body').innerText()).slice(0,200);
  console.log('PROJECT-SIM: sandbox-model-slice=', psModelSlice);
  await page.screenshot({ path: SHOT + '/projectsim-model-check.png', fullPage: false });

  // 4. sandbox — confirm model dim present (control)
  await page.goto(BASE + '/v/sim-sandbox', { waitUntil: 'networkidle' }); await sleep(2500);
  const sbModelSlice = await page.locator('[data-testid=sandbox-model-slice]').count();
  const sbModelSelect = await page.locator('[data-testid=sandbox-model-select]').count();
  console.log('SANDBOX (control): sandbox-model-slice=', sbModelSlice, '| model-select=', sbModelSelect);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
