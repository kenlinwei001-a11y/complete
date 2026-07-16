import { chromium } from 'playwright-core';
import fs from 'fs';

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5395';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const out = {};

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const netFail = [];
page.on('response', r => { if (r.status() >= 400 && /4095|4195|\/a\/v1|\/b\/v1/.test(r.url())) netFail.push(r.status() + ' ' + r.url().slice(0, 90)); });

async function shot(name) { try { await page.screenshot({ path: `${SHOT}/v2_${name}.png`, fullPage: true }); } catch {} }

// grab main content = body text minus the nav sidebar
async function mainText() {
  return await page.evaluate(() => {
    const main = document.querySelector('main') || document.querySelector('[class*="content"]') || document.body;
    return main ? main.innerText : '';
  });
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'demo1234');
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForTimeout(3500);
  out.afterLoginUrl = page.url();

  async function visit(key, path, needles) {
    const rec = { path, needles: {} };
    try {
      await page.goto(`${BASE}/admin/${path}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      const mt = await mainText();
      rec.mainLen = mt.length;
      rec.mainText = mt.slice(0, 1600);
      for (const n of needles) rec.needles[n] = mt.includes(n);
      await shot(key);
    } catch (e) { rec.error = String(e).slice(0, 200); await shot(key + '_ERR'); }
    out[key] = rec;
  }

  await visit('skills', 'skills', ['产能分析方法论', '风险诊断方法论', 'PUBLISHED', 'capacity_analysis']);
  await visit('agents', 'agents', ['分析师', 'universal', 'PUBLISHED', 'Agent']);
  await visit('mcp', 'mcp', ['kb_probe_srv', 'ext_verify', 'DRAFT', 'streamable']);
  await visit('workflows', 'workflows', ['产能校核流程', 'capacity_check', 'PUBLISHED']);

  out.netFail = netFail.slice(0, 20);
} catch (e) { out.fatal = String(e); }
finally {
  fs.writeFileSync(`${SHOT}/v2_out.json`, JSON.stringify(out, null, 1));
  await browser.close();
  console.log('DONE');
}
