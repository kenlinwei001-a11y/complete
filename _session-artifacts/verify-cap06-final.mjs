import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:5262';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport:{width:1600,height:1300} })).newPage();

let lastPost = null, tokenSeen = null;
page.on('request', req => {
  if (req.method()==='POST' && /\/a\/v1\/sim\/sessions$/.test(req.url())) {
    let body=null; try{ body=JSON.parse(req.postData()||'{}'); }catch(e){}
    lastPost = { keys: Object.keys(body.baseSnapshot||{}), scope: body.scope||{} };
  }
  const auth = req.headers()['authorization'];
  if (auth && auth.startsWith('Bearer ')) tokenSeen = auth.slice(7);
});
const readText = async (sel) => { const l=page.locator(sel); return (await l.count())>0 ? (await l.first().innerText()).trim() : '<absent>'; };

await page.goto(BASE+'/', {waitUntil:'networkidle'});
await page.fill('#login-tenant','demo'); await page.fill('#login-username','admin'); await page.fill('#login-password','demo1234');
await page.click('button[type=submit]'); await page.waitForTimeout(2500);

// project-sim -> stepper to base table -> click 常州
await page.goto(BASE+'/v/project-sim', {waitUntil:'networkidle'});
await page.waitForTimeout(4000);
for (let i=0;i<7;i++){ if (await page.locator('[data-testid^=pm-run-sim-]').count()>0) break; const n=page.locator('[data-testid=pm-next]'); if(await n.count()===0) break; await n.first().click(); await page.waitForTimeout(1600); }
await page.locator('[data-testid="pm-run-sim-常州"]').first().click();
await page.waitForTimeout(4500);

const belongs = (oid,baseId) => new RegExp('(^|[_-])'+baseId+'([_-]|$)').test(oid);
const keys = lastPost?.keys || [];
const baseId = lastPost?.scope?.baseId;
const allBelong = keys.every(k => belongs(k, baseId));
const foreign = keys.filter(k => !belongs(k, baseId));
console.log('=== CROPPED SESSION (client-sent) ===');
console.log('baseId:', baseId, '| total keys:', keys.length);
console.log('ALL keys belong to base:', allBelong, '| foreign keys:', JSON.stringify(foreign));
console.log('presetContext.subject:', lastPost?.scope?.presetContext?.subject);
// count objects that belong to OTHER bases (must be 0 = R3 isolation)
const otherBases = ['xiamen','chengdu','meishan','wuhan','jiangmen','hefei','xinyang','zaozhuang','handan','zigong','luoyang'].filter(b=>b!==baseId);
const leaked = keys.filter(k => otherBases.some(b=>belongs(k,b)));
console.log('keys leaking OTHER base tokens (R3 must be 0):', leaked.length, JSON.stringify(leaked.slice(0,5)));

// ==== confirm backend PERSISTED the cropped session ====
const SC='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const fs = await import('node:fs');
fs.writeFileSync(SC+'/browser-token.txt', tokenSeen||'');
console.log('\\ntoken captured len:', (tokenSeen||'').length);
await browser.close();
console.log('DONE');
