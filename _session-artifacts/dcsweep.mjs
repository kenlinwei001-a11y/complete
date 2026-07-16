// DataCore admin/ontology exhaustive route sweep harness (playwright-core)
import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5284';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT + '/shots', { recursive: true });

const ROUTES = JSON.parse(process.argv[2] || '[]');
const results = [];
let diag = null;
function newDiag() { return { console: [], pageerrors: [], failed: [], badresp: [] }; }

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', m => { if (diag && (m.type()==='error'||m.type()==='warning')) diag.console.push({t:m.type(), text:m.text().slice(0,300)}); });
page.on('pageerror', e => { if (diag) diag.pageerrors.push(String(e.message||e).slice(0,300)); });
page.on('requestfailed', r => { if (diag){ const f=r.failure(); diag.failed.push({url:r.url().slice(0,160), err:f&&f.errorText}); } });
page.on('response', r => { if (diag){ const s=r.status(); if (s>=400){ diag.badresp.push({url:r.url().replace(BASE,'').slice(0,160), status:s, method:r.request().method()}); } } });

async function snapshot(page) {
  return await page.evaluate(() => {
    const body = document.body;
    const txt = (body?.innerText || '').replace(/\s+/g,' ').trim();
    const btns = Array.from(document.querySelectorAll('button')).map(b=>({label:(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,40), disabled:b.disabled}));
    const links = Array.from(document.querySelectorAll('a[href]')).map(a=>({label:(a.innerText||'').trim().slice(0,30), href:a.getAttribute('href')})).filter(a=>a.label);
    const inputs = document.querySelectorAll('input,select,textarea').length;
    const tables = document.querySelectorAll('table').length;
    const rows = document.querySelectorAll('table tbody tr, [role=row]').length;
    const markers = [];
    for (const m of ['出错了','Something went wrong','加载失败','请求失败','未找到','无权限','FEATURE_NOT_FOUND','暂无数据','error-boundary','TypeError','undefined is not']) {
      if (txt.includes(m)) markers.push(m);
    }
    const emptyStates = document.querySelectorAll('.empty-state').length;
    return { textLen: txt.length, textHead: txt.slice(0,900), btnCount: btns.length, buttons: btns.slice(0,50), links: links.slice(0,30), inputs, tables, rows, markers, emptyStates };
  });
}

// LOGIN
diag = newDiag();
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#login-username', { timeout: 15000 });
await page.fill('#login-tenant', 'demo');
await page.fill('#login-username', 'admin');
await page.fill('#login-password', 'demo1234');
await page.click('button[type=submit]');
try { await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 }); }
catch(e){}
await page.waitForTimeout(1500);
const loginSnap = await snapshot(page);
results.push({ key:'__login__', path:'/login', url: page.url(), snap: loginSnap, diag });
fs.writeFileSync(OUT + '/login.json', JSON.stringify({url:page.url(), loginSnap, diag}, null, 2));
console.log('LOGIN done ->', page.url(), 'textLen', loginSnap.textLen);
await ctx.storageState({ path: OUT + '/state.json' });

for (const [key, path, extra] of ROUTES) {
  diag = newDiag();
  const url = BASE + path;
  let navErr = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(e){}
    await page.waitForTimeout(extra || 1200);
  } catch(e) { navErr = String(e.message||e).slice(0,200); }
  let snap = null;
  try { snap = await snapshot(page); } catch(e){ snap = { error: String(e.message).slice(0,150) }; }
  const shot = OUT + '/shots/' + key.replace(/[^\w-]/g,'_') + '.png';
  try { await page.screenshot({ path: shot, fullPage: false }); } catch(e){}
  const rec = { key, path, url: page.url(), navErr, snap, diag };
  results.push(rec);
  fs.writeFileSync(OUT + '/route_' + key.replace(/[^\w-]/g,'_') + '.json', JSON.stringify(rec, null, 2));
  const blank = !snap || (snap.textLen!==undefined && snap.textLen < 40);
  console.log(`ROUTE ${key} ${path} -> ${page.url().replace(BASE,'')} | len=${snap&&snap.textLen} btns=${snap&&snap.btnCount} tbl=${snap&&snap.tables} rows=${snap&&snap.rows} | err=${diag.pageerrors.length} bad=${diag.badresp.length} ${blank?'*** BLANK ***':''} ${navErr?('NAVERR:'+navErr):''}`);
}

fs.writeFileSync(OUT + '/all.json', JSON.stringify(results, null, 2));
await browser.close();
console.log('SWEEP COMPLETE, routes:', ROUTES.length);
