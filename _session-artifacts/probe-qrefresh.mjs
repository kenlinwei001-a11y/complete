import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const {chromium}=pw; const BASE='http://127.0.0.1:5173';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1500,height:950}}); const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});await p.fill('#login-tenant','demo');await p.fill('#login-username','admin');await p.fill('#login-password','demo1234');await p.click('button[type=submit]');await p.waitForLoadState('networkidle');await p.waitForTimeout(1500);
const toggles=await p.$$('[data-testid^="nav-group-toggle-"]'); for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await p.waitForTimeout(30);}catch(x){}}}
for(const a of await p.$$('aside a')){if((await a.getAttribute('href'))==='/admin/validation'){await a.click();break;}}
await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(2800);
const m1=await p.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,200));
console.log('[validation] crashed?', m1.includes('出错'), '| main:', m1);
await p.screenshot({path:`${OUT}/validation_crash.png`});
// click 刷新 to test recovery
const refresh=await p.$('main button:has-text("刷新")');
if(refresh){ await refresh.click(); await p.waitForTimeout(1500); const m2=await p.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,200)); console.log('[validation after 刷新] still crashed?', m2.includes('出错'), '| main:', m2); }
await b.close();console.log('DONE');
