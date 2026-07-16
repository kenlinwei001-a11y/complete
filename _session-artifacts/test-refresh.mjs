import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const reqs = [];
page.on('request', (r) => { if (/auth|workspace/.test(r.url())) reqs.push(`>> ${r.method()} ${r.url()}`); });
page.on('response', async (r) => { if (/auth|workspace/.test(r.url())) reqs.push(`<< ${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
console.log('after login url:', page.url());

// dump cookies in this context
const cookies = await ctx.cookies();
console.log('COOKIES:', JSON.stringify(cookies.map(c=>({name:c.name, domain:c.domain, path:c.path, httpOnly:c.httpOnly, secure:c.secure, sameSite:c.sameSite})), null, 2));

console.log('--- now hard-navigating to /v/dash (simulates deep-link / reload) ---');
reqs.length=0;
await page.goto(`${BASE}/v/dash`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);
console.log('after deep-link url:', page.url());
console.log('NET TRACE:');
reqs.forEach(r=>console.log('  '+r));

// Try direct refresh fetch from page context to see status
const refreshStatus = await page.evaluate(async () => {
  try {
    const res = await fetch('http://127.0.0.1:4001/a/v1/auth/refresh', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:'{}' });
    const txt = await res.text();
    return { status: res.status, body: txt.slice(0,200) };
  } catch(e){ return { err: String(e) }; }
});
console.log('DIRECT REFRESH FROM PAGE:', JSON.stringify(refreshStatus));

await browser.close();
