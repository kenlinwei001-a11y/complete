import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5173';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
import fs from 'fs';

const ITEMS = JSON.parse(process.env.ITEMS || '[]'); // ["/admin/quarantine", ...]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

async function freshLogin(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  return page;
}

const report = [];
for (const target of ITEMS) {
  // FRESH context per page = full isolation
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await freshLogin(ctx);
  let consoleErrors=[], pageErrors=[], apiResp=[];
  page.on('console', m=>{ if(m.type()==='error') consoleErrors.push(m.text().slice(0,260)); });
  page.on('pageerror', e=>pageErrors.push(String(e).slice(0,260)));
  page.on('response', async r=>{ const u=r.url(); if(/\/(a|b|api)\/v1/.test(u) && !/workspace|auth|features|health|watermark|events/.test(u)){ let bt=''; try{ if(r.status()>=400||r.headers()['content-type']?.includes('json')) bt=(await r.text()).slice(0,160);}catch(e){} apiResp.push(`${r.status()} ${r.request().method()} ${u.split('/v1')[1]?.slice(0,70)} ${r.status()>=400?bt:''}`.trim()); } });
  // expand groups then click the matching link
  const toggles = await page.$$('[data-testid^="nav-group-toggle-"]');
  for (const t of toggles){ const e=await t.getAttribute('aria-expanded'); if(e==='false'){ try{await t.click();await page.waitForTimeout(50);}catch(x){} } }
  let clicked=false;
  for (const a of await page.$$('aside a')){ const h=await a.getAttribute('href'); if(h===target){ try{await a.click();clicked=true;break;}catch(x){} } }
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3000);
  const url=page.url();
  const main = await page.evaluate(()=>{const m=document.querySelector('main');return (m?m.innerText:'').replace(/\s+/g,' ').slice(0,500);});
  const crashed = main.includes('页面出错了') || main.includes('出了点问题');
  const file=`${OUT}/iso_${target.replace(/\//g,'_')}.png`;
  await page.screenshot({path:file});
  report.push({ target, clicked, url, reached:url.includes(target), crashed, main, pageErrors:pageErrors.slice(0,4), consoleErrors:consoleErrors.slice(0,4), apiResp:apiResp.slice(0,10), screenshot:file });
  console.log(`[${target}] reached=${url.includes(target)} crashed=${crashed} perr=${pageErrors.length}`);
  console.log('   apiResp:', JSON.stringify(apiResp.slice(0,8)));
  await ctx.close();
}
fs.writeFileSync(`${OUT}/iso-report-${process.env.TAG||'x'}.json`, JSON.stringify(report,null,2));
await browser.close();
console.log('DONE');
