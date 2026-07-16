import pw from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE='http://127.0.0.1:5173';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/scan';
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});

async function login(ctx){const p=await ctx.newPage();await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});await p.fill('#login-tenant','demo');await p.fill('#login-username','admin');await p.fill('#login-password','demo1234');await p.click('button[type=submit]');await p.waitForLoadState('networkidle');await p.waitForTimeout(1500);return p;}

// ---- query-history isolated ----
{
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  const page=await login(ctx);
  let cerr=[],perr=[],api=[];
  page.on('console',m=>{if(m.type()==='error')cerr.push(m.text().slice(0,200));});
  page.on('pageerror',e=>perr.push(String(e).slice(0,200)));
  page.on('response',async r=>{const u=r.url();if(/\/(a|b|api)\/v1/.test(u)&&!/workspace|auth|features|health|watermark|events/.test(u)){let b='';try{if(r.status()>=400)b=(await r.text()).slice(0,120);}catch(e){}api.push(`${r.status()} ${u.split('/v1')[1]?.slice(0,60)} ${b}`.trim());}});
  const toggles=await page.$$('[data-testid^="nav-group-toggle-"]');
  for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await page.waitForTimeout(40);}catch(x){}}}
  let qh=null;for(const a of await page.$$('aside a')){if((await a.getAttribute('href'))==='/admin/query-history'){qh=a;break;}}
  if(qh)await qh.click();
  await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(3000);
  const main=await page.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,450));
  const crashed=main?.includes('出错')||main?.includes('出了点问题');
  await page.screenshot({path:`${OUT}/qh_iso.png`});
  console.log('[query-history] clicked='+!!qh+' url='+page.url()+' crashed='+crashed+' cerr='+cerr.length+' perr='+perr.length);
  console.log('  api='+JSON.stringify(api.slice(0,8)));
  console.log('  main='+main);
  await ctx.close();
}

// ---- Object360 via direct in-app link from object-types browser ----
{
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  const page=await login(ctx);
  let cerr=[],perr=[],api=[];
  page.on('console',m=>{if(m.type()==='error')cerr.push(m.text().slice(0,200));});
  page.on('pageerror',e=>perr.push(String(e).slice(0,200)));
  page.on('response',async r=>{const u=r.url();if(/\/(a|b|api)\/v1/.test(u)&&!/workspace|auth|features|health|watermark|events/.test(u)){let b='';try{if(r.status()>=400)b=(await r.text()).slice(0,120);}catch(e){}api.push(`${r.status()} ${u.split('/v1')[1]?.slice(0,60)} ${b}`.trim());}});
  // navigate to object-types browser
  const toggles=await page.$$('[data-testid^="nav-group-toggle-"]');
  for(const t of toggles){const e=await t.getAttribute('aria-expanded');if(e==='false'){try{await t.click();await page.waitForTimeout(40);}catch(x){}}}
  let ot=null;for(const a of await page.$$('aside a')){if((await a.getAttribute('href'))==='/admin/object-types'){ot=a;break;}}
  if(ot)await ot.click();
  await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(2500);
  // find any link to /o/ (object 360) and click it
  let o=null;for(const a of await page.$$('a')){const h=await a.getAttribute('href');if(h&&h.startsWith('/o/')){o=a;break;}}
  let how='link';
  if(!o){ // try clicking an object row that may push to /o/
    const row=await page.$('a[href*="/o/"], [data-testid*="object"] a');
    if(row){o=row;}
  }
  if(o){ await o.click(); how='clicked /o/ link'; }
  else { // fallback: hard navigate (will lose token — but test render anyway via fresh login deep-link won't work). Instead push via evaluate using router link not available; use goto and re-login? simplest: goto and accept it may bounce.
    how='no /o/ link found on object-types';
  }
  await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(3000);
  const url=page.url();
  const main=await page.evaluate(()=>document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,450));
  const crashed=main?.includes('出错')||main?.includes('出了点问题')||main?.includes('暂不支持');
  await page.screenshot({path:`${OUT}/o360_iso.png`});
  console.log('[object360] how='+how+' url='+url+' onO360='+url.includes('/o/')+' crashed='+crashed+' cerr='+cerr.length+' perr='+perr.length);
  console.log('  api='+JSON.stringify(api.slice(0,8)));
  console.log('  main='+main);
  await ctx.close();
}
await browser.close();
console.log('DONE');
