import pkg from '/home/user/complete/.claude/worktrees/agent-a68324b55fd879041/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5292';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';

export async function launch() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`.slice(0,300)));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`.slice(0,300)));
  return { browser, ctx, page, logs };
}

export async function login(page, user='admin') {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  // already logged in? login form present?
  const hasForm = await page.locator('#login-username').count();
  if (hasForm) {
    await page.fill('#login-tenant', 'demo');
    await page.fill('#login-username', user);
    await page.fill('#login-password', 'demo1234');
    await page.click('button[type=submit]');
    await page.waitForTimeout(2500);
  }
  return page.url();
}

// Run standalone: node pw.mjs <shotname>
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] || 'landing';
  const { browser, page, logs } = await launch();
  const url = await login(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false });
  console.log('URL after login:', url);
  const bodyText = (await page.locator('body').innerText().catch(()=> '')).slice(0, 1200);
  console.log('--- BODY TEXT (1200) ---\n', bodyText);
  console.log('--- CONSOLE LOGS ---\n', logs.slice(-20).join('\n'));
  await browser.close();
}
