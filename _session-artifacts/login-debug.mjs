import pkg from '/home/user/complete/.claude/worktrees/agent-a5600e2104f4afcaf/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5213';
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('response', async r => {
  if (/auth\/login|me\/workspace/.test(r.url())) {
    let b = ''; try { b = JSON.stringify(await r.json()).slice(0, 200); } catch {}
    console.log('RESP', r.status(), r.url().replace(BASE,''), b);
  }
});
page.on('requestfailed', r => { if (/auth|4013/.test(r.url())) console.log('REQFAIL', r.url(), r.failure()?.errorText); });
console.log('goto /');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('#login-username', { timeout: 10000 });
console.log('login form visible. tenant val:', await page.locator('#login-tenant').inputValue());
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
console.log('filled. user=', await page.locator('#login-username').inputValue(), 'pw len=', (await page.locator('#login-password').inputValue()).length);
await Promise.all([
  page.waitForResponse(r => /auth\/login/.test(r.url()), { timeout: 10000 }).catch(()=>console.log('no login resp within 10s')),
  page.locator('button[type="submit"]').click(),
]);
await page.waitForTimeout(3000);
console.log('url after submit:', page.url());
const err = await page.locator('.badge.red').innerText().catch(()=>null);
console.log('error badge:', err);
// check localStorage/session token
const tok = await page.evaluate(() => Object.keys(localStorage).map(k=>k+'='+localStorage.getItem(k)?.slice(0,20)));
console.log('localStorage:', JSON.stringify(tok));
await browser.close();
console.log('DONE');
