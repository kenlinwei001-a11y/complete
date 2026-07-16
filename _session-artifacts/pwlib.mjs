// Reusable Playwright helper for D5 chapter verification.
// Usage: import { withLogin } from './pwlib.mjs'
import { chromium } from 'playwright-core';

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const BASE = process.env.FE_BASE || 'http://127.0.0.1:5296';

export async function launch() {
  return chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
}

export async function login(page, { username = 'admin', password = 'demo1234', tenant = 'demo' } = {}) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-username', { timeout: 20000 });
  await page.fill('#login-tenant', tenant);
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('button[type=submit], button:has-text("登录")');
  // wait for navigation away from login
  await page.waitForFunction(() => !document.querySelector('#login-username'), { timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(1500);
}

export async function withLogin(opts, fn) {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', m => logs.push('[console] ' + m.type() + ': ' + m.text()));
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    await login(page, opts);
    return await fn(page, ctx, logs);
  } finally {
    await browser.close();
  }
}
