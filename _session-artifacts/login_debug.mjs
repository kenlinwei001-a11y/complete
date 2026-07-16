import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5173';

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();

const reqs = [];
page.on('request', r => { if (r.url().includes('/auth/') || r.url().includes('/login')) reqs.push(r.method()+' '+r.url()); });
page.on('response', async r => { if (r.url().includes('/auth/login')) console.log('LOGIN RESP:', r.status(), r.url()); });
page.on('console', m => console.log('CONSOLE['+m.type()+']:', m.text()));
page.on('pageerror', e => console.log('PAGEERR:', e.message));

await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
console.log('login page loaded. title field exists:', await page.locator('#login-tenant').count());

await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('input[type="password"]', 'demo1234');
console.log('filled. clicking submit...');
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);
console.log('URL after 5s:', page.url());
console.log('AUTH REQUESTS:', JSON.stringify(reqs));

// any visible error text on page?
const bodyText = await page.locator('body').innerText();
console.log('BODY TEXT (first 600):', bodyText.slice(0,600));

await browser.close();
