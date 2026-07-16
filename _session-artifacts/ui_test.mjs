import { chromium } from 'playwright-core';
import fs from 'fs';

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5395';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const out = {};

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

async function shot(name) { await page.screenshot({ path: `${SHOT}/ui_${name}.png`, fullPage: true }); }

try {
  // ---- LOGIN ----
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'demo1234');
  await shot('00_login');
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForTimeout(3000);
  out.afterLoginUrl = page.url();
  await shot('01_afterlogin');

  // ---- helper: visit admin page, capture text ----
  async function visit(key, path) {
    const rec = { path };
    try {
      await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2500);
      rec.url = page.url();
      const body = await page.evaluate(() => document.body.innerText);
      rec.textLen = body.length;
      rec.textSample = body.slice(0, 1200);
      // count table rows / cards
      rec.tableRows = await page.locator('table tbody tr').count().catch(() => -1);
      rec.listItems = await page.locator('[class*="card"], [class*="Card"], li, [role="row"]').count().catch(() => -1);
      await shot(key);
    } catch (e) {
      rec.error = String(e).slice(0, 300);
      await shot(key + '_ERR');
    }
    out[key] = rec;
  }

  await visit('skills', 'skills');
  await visit('agents', 'agents');
  await visit('mcp', 'mcp');
  await visit('workflows', 'workflows');
  await visit('knowledge', 'knowledge');

  out.consoleErrors = errors.slice(0, 30);
} catch (e) {
  out.fatal = String(e);
} finally {
  fs.writeFileSync(`${SHOT}/ui_out.json`, JSON.stringify(out, null, 1));
  await browser.close();
  console.log('DONE. keys=', Object.keys(out).join(','));
}
