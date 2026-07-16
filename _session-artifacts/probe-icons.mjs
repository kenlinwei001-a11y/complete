import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const {chromium}=pw; const BASE='http://127.0.0.1:5173';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1600,height:1000}}); const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});await p.fill('#login-tenant','demo');await p.fill('#login-username','admin');await p.fill('#login-password','demo1234');await p.click('button[type=submit]');await p.waitForLoadState('networkidle');await p.waitForTimeout(1500);
const toggles=await p.$$('[data-testid^="nav-group-toggle-"]'); for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await p.waitForTimeout(30);}catch(x){}}}
for(const a of await p.$$('aside a')){if((await a.getAttribute('href'))==='/v/plan-audit'){await a.click();break;}}
await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(2800);
// dump all main buttons with empty text: their html, testid, title, onclick presence
const info=await p.evaluate(()=>{
  return Array.from(document.querySelectorAll('main button')).map((bn,i)=>({
    i, text:(bn.innerText||'').trim().slice(0,25), aria:bn.getAttribute('aria-label'), title:bn.getAttribute('title'),
    testid:bn.getAttribute('data-testid'), cls:bn.className.slice(0,40),
    html:bn.innerHTML.slice(0,50), disabled:bn.disabled,
    hasOnclick: !!bn.onclick, parentCls:(bn.parentElement?.className||'').slice(0,30)
  })).filter(x=>!x.text);
});
console.log('EMPTY-TEXT main buttons in plan-audit:');
info.forEach(x=>console.log(JSON.stringify(x)));
await b.close();console.log('DONE');
