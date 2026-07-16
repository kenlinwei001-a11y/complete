import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5173';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
import fs from 'fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
let cerr=[], perr=[];
page.on('console', m=>{ if(m.type()==='error') cerr.push(m.text().slice(0,200)); });
page.on('pageerror', e=>perr.push(String(e).slice(0,200)));

await page.goto(`${BASE}/login`, { waitUntil:'networkidle' });
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500);

async function snap(name){ await page.screenshot({path:`${OUT}/sp_${name}.png`}); }

// 1) scenarios launcher (click ⚡ 场景启动器)
cerr=[];perr=[];
const sl = await page.$('a[data-testid="nav-scenario-launcher"]');
if(sl){ await sl.click(); await page.waitForTimeout(2500); }
const slMain = await page.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,300));
console.log('[scenarios] url='+page.url()+' cerr='+cerr.length+' perr='+perr.length+' main='+slMain);
await snap('scenarios');

// 2) query-history via nav
cerr=[];perr=[];
const toggles = await page.$$('[data-testid^="nav-group-toggle-"]');
for(const t of toggles){ const e=await t.getAttribute('aria-expanded'); if(e==='false'){try{await t.click();await page.waitForTimeout(40);}catch(x){}} }
let qh=null; for(const a of await page.$$('aside a')){ if((await a.getAttribute('href'))==='/admin/query-history'){qh=a;break;} }
if(qh){ await qh.click(); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(2800); }
const qhMain = await page.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,400));
console.log('[query-history] clicked='+!!qh+' url='+page.url()+' cerr='+cerr.length+' perr='+perr.length+' crashed='+(qhMain?.includes('出错')||qhMain?.includes('出了点问题'))+' main='+qhMain);
await snap('query-history');

// 3) /v/sim-sandbox via nav (only if entitlement on)
cerr=[];perr=[];
let ss=null; for(const a of await page.$$('aside a')){ if((await a.getAttribute('href'))==='/v/sim-sandbox'){ss=a;break;} }
if(ss){ await ss.click(); await page.waitForTimeout(3000); const m=await page.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,300)); console.log('[sim-sandbox] present, url='+page.url()+' cerr='+cerr.length+' perr='+perr.length+' main='+m); await snap('sim-sandbox'); }
else console.log('[sim-sandbox] nav entry not present (entitlement likely off)');

// 4) Object360 - navigate via global search or a known object. Try direct in-app: click an object link if any on dash. Else use GlobalSearch.
cerr=[];perr=[];
// go to dashboard then try global search
for(const a of await page.$$('aside a')){ if((await a.getAttribute('href'))==='/v/dash'){await a.click();break;} }
await page.waitForTimeout(2000);
const gs = await page.$('input[placeholder*="搜索"], [data-testid*="search"] input, input[type="search"]');
let o360='no-search';
if(gs){ await gs.fill('Base'); await page.waitForTimeout(1500); const opt=await page.$('[role="option"], [data-testid*="search-result"] a, [class*="result"] a'); if(opt){ await opt.click(); await page.waitForTimeout(2500); o360='clicked '+page.url(); } else o360='search-no-results'; }
const o360crash = await page.evaluate(()=>{const m=document.querySelector('main')?.innerText||'';return m.includes('出错')||m.includes('出了点问题');});
console.log('[object360] '+o360+' onO360page='+page.url().includes('/o/')+' crashed='+o360crash);
await snap('object360');

console.log('CERR_DUMP', JSON.stringify(cerr.slice(0,5)));
console.log('PERR_DUMP', JSON.stringify(perr.slice(0,5)));
await browser.close();
console.log('DONE');
