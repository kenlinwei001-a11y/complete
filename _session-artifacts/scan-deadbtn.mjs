import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const {chromium}=pw; const BASE='http://127.0.0.1:5173';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1600,height:1000}}); const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});await p.fill('#login-tenant','demo');await p.fill('#login-username','admin');await p.fill('#login-password','demo1234');await p.click('button[type=submit]');await p.waitForLoadState('networkidle');await p.waitForTimeout(1500);

async function goView(key){ const toggles=await p.$$('[data-testid^="nav-group-toggle-"]'); for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await p.waitForTimeout(30);}catch(x){}}} for(const a of await p.$$('aside a')){if((await a.getAttribute('href'))===`/v/${key}`){await a.click();await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(2500);return true;}} return false; }

// Test dead buttons on a view: click each visible main button, record DOM-change / network / new modal
async function testButtons(viewKey, max=8){
  await goView(viewKey);
  const results=[];
  const btnCount=await p.evaluate(()=>document.querySelectorAll('main button:not([disabled])').length);
  for(let i=0;i<Math.min(btnCount,max);i++){
    // re-query each time (DOM may change)
    const btns=await p.$$('main button:not([disabled])');
    if(i>=btns.length)break;
    const btn=btns[i];
    const label=(await btn.evaluate(el=>(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,20)))||'(icon)';
    let net=false; const onResp=()=>{net=true;};
    p.on('response',onResp);
    const beforeHtml=await p.evaluate(()=>document.querySelector('main')?.innerHTML.length||0);
    const beforeModals=await p.evaluate(()=>document.querySelectorAll('[role="dialog"], .modal, [class*="odal"], [class*="drawer"], [class*="Drawer"]').length);
    const beforeUrl=p.url();
    try{ await btn.click({timeout:2000}); }catch(e){ results.push({label,note:'click-failed:'+String(e).slice(0,40)}); p.off('response',onResp); continue; }
    await p.waitForTimeout(900);
    p.off('response',onResp);
    const afterHtml=await p.evaluate(()=>document.querySelector('main')?.innerHTML.length||0);
    const afterModals=await p.evaluate(()=>document.querySelectorAll('[role="dialog"], .modal, [class*="odal"], [class*="drawer"], [class*="Drawer"]').length);
    const afterUrl=p.url();
    const changed = net || Math.abs(afterHtml-beforeHtml)>15 || afterModals!==beforeModals || afterUrl!==beforeUrl;
    results.push({label, net, htmlDelta:afterHtml-beforeHtml, modalDelta:afterModals-beforeModals, urlChanged:afterUrl!==beforeUrl, reacted:changed});
    // close any opened modal/drawer to keep stable
    const close=await p.$('[aria-label="关闭"], [aria-label="close"], .modal button:has-text("取消"), button:has-text("✕"), button:has-text("×")');
    if(close){try{await close.click({timeout:800});await p.waitForTimeout(300);}catch(e){}}
    if(afterUrl!==beforeUrl){ await goView(viewKey); } // navigated away; go back
  }
  return {viewKey, btnCount, results};
}

const out=[];
for(const v of (process.env.VIEWS||'risk,plan-audit,order').split(',')){
  const r=await testButtons(v, 10);
  out.push(r);
  const dead=r.results.filter(x=>x.reacted===false && !x.note);
  console.log(`\n[${v}] ${r.btnCount} btns tested ${r.results.length}; DEAD(no reaction)=${dead.length}`);
  for(const x of r.results) console.log(`   ${x.reacted===false&&!x.note?'DEAD':'ok  '} "${x.label}" net=${x.net} htmlΔ=${x.htmlDelta} modalΔ=${x.modalDelta} url=${x.urlChanged} ${x.note||''}`);
}
import fs from 'fs';
fs.writeFileSync(`${OUT}/deadbtn.json`,JSON.stringify(out,null,2));
await b.close();console.log('\nDONE');
