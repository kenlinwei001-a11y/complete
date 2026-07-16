import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const FE = 'http://127.0.0.1:5173';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
let refreshCalls = [];
page.on('request', (req) => { if (req.url().includes('/auth/refresh')) refreshCalls.push(req.method()); });

// login
await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 8000 }).catch(() => {});
log('logged in, url=', page.url());

async function testDeep(path, settleMs) {
  refreshCalls = [];
  await page.goto(`${FE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(settleMs); // give async refresh a generous window
  const url = page.url();
  const onLogin = url.endsWith('/login');
  log(`DEEP ${path} | settle ${settleMs}ms -> ${url} | onLogin=${onLogin} | refreshCalls=${refreshCalls.length}`);
  return { onLogin, refreshCount: refreshCalls.length };
}

// dash with a long settle window to rule out transient-flash that self-heals
const r1 = await testDeep('/v/dash', 4000);
// a different deep link (admin) to show it isn't dash-specific
const r2 = await testDeep('/admin/connections', 3000);
// the index route too
const r3 = await testDeep('/', 3000);

log('\n=== CONFIRM ===');
log('dash stays on login after 4s, no refresh:', r1.onLogin && r1.refreshCount === 0);
log('admin/connections stays on login, no refresh:', r2.onLogin && r2.refreshCount === 0);
log('index "/" stays on login, no refresh:', r3.onLogin && r3.refreshCount === 0);

await browser.close();
