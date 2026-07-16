import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const {chromium}=pw; const BASE='http://127.0.0.1:5173';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1500,height:950}}); const p=await ctx.newPage();
let cerr=[],perr=[],api=[];
p.on('console',m=>{if(m.type()==='error')cerr.push(m.text().slice(0,200));});
p.on('pageerror',e=>perr.push(String(e).slice(0,200)));
p.on('response',async r=>{const u=r.url();if(/\/(a|b|api)\/v1/.test(u)&&!/workspace|auth|features|health|watermark|events/.test(u)){let bd='';try{if(r.status()>=400)bd=(await r.text()).slice(0,120);}catch(e){}api.push(`${r.status()} ${u.split('/v1')[1]?.slice(0,55)} ${bd}`.trim());}});
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});await p.fill('#login-tenant','demo');await p.fill('#login-username','admin');await p.fill('#login-password','demo1234');await p.click('button[type=submit]');await p.waitForLoadState('networkidle');await p.waitForTimeout(1500);
const toggles=await p.$$('[data-testid^="nav-group-toggle-"]');
for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await p.waitForTimeout(40);}catch(x){}}}
// dump ALL aside hrefs
const hrefs=await p.evaluate(()=>Array.from(document.querySelectorAll('aside a')).map(a=>a.getAttribute('href')));
console.log('QUERY-HISTORY href present?', hrefs.includes('/admin/query-history'), '| total nav links', hrefs.length);
console.log('admin hrefs:', JSON.stringify(hrefs.filter(h=>h&&h.startsWith('/admin'))));
// click query-history by exact text "推演历史"
const link=await p.$('aside a:has-text("推演历史")');
if(link){await link.click();await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(3000);}
console.log('[query-history byText] clicked='+!!link+' url='+p.url()+' cerr='+cerr.length+' perr='+perr.length);
console.log('  api='+JSON.stringify(api.slice(0,6)));
const main=await p.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,350));
console.log('  crashed='+(main?.includes('出错')||main?.includes('出了点问题'))+' main='+main);
await p.screenshot({path:`${OUT}/qh_bytext.png`});

// Now Object360: navigate object-types, click first "看实例 →" then first object link
api=[];cerr=[];perr=[];
let ot=null;for(const a of await p.$$('aside a')){if((await a.getAttribute('href'))==='/admin/object-types'){ot=a;break;}}
if(ot){await ot.click();await p.waitForTimeout(2500);}
// expand a type row (click the ▸ row) then click 看实例
const see=await p.$('a:has-text("看实例"), button:has-text("看实例")');
if(see){await see.click();await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(2500);}
console.log('[after 看实例] url='+p.url());
// now find /o/ link
let o=null;for(const a of await p.$$('a')){const h=await a.getAttribute('href');if(h&&h.startsWith('/o/')){o=a;break;}}
if(o){await o.click();await p.waitForLoadState('networkidle').catch(()=>{});await p.waitForTimeout(3000);}
const ourl=p.url();const omain=await p.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,450));
console.log('[object360] reached /o/='+ourl.includes('/o/')+' url='+ourl+' crashed='+(omain?.includes('出错')||omain?.includes('暂不支持'))+' cerr='+cerr.length+' perr='+perr.length);
console.log('  api='+JSON.stringify(api.slice(0,8)));
console.log('  main='+omain);
await p.screenshot({path:`${OUT}/o360_bytext.png`});
await b.close();console.log('DONE');
