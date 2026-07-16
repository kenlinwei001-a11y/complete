import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5284';
const OUT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const ROUTES = JSON.parse(process.argv[2] || '[]');

let diag = null;
function newDiag(){return {console:[],pageerrors:[],badresp:[]};}
const browser = await chromium.launch({ executablePath: EXE, headless: true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, storageState: OUT+'/state.json' });
const page = await ctx.newPage();
page.on('console', m=>{ if(diag&&(m.type()==='error'||m.type()==='warning')) diag.console.push({t:m.type(),text:m.text().slice(0,260)}); });
page.on('pageerror', e=>{ if(diag) diag.pageerrors.push(String(e.message||e).slice(0,260)); });
page.on('response', r=>{ if(diag){const s=r.status(); if(s>=400) diag.badresp.push({url:r.url().replace(BASE,'').slice(0,150),status:s,method:r.request().method()});} });

async function mainSnap(page){
  return await page.evaluate(()=>{
    const main = document.querySelector('main') || document.body;
    const txt = (main.innerText||'').replace(/\s+/g,' ').trim();
    const inMain = sel => Array.from(main.querySelectorAll(sel));
    const btns = inMain('button').map(b=>({label:(b.innerText||b.getAttribute('aria-label')||b.title||'').trim().slice(0,50), disabled:b.disabled, cls:(b.className||'').slice(0,30)}));
    const inputs = inMain('input,select,textarea').map(i=>({tag:i.tagName.toLowerCase(), type:i.type||'', name:i.name||i.id||'', placeholder:i.placeholder||''}));
    const links = inMain('a[href]').map(a=>({label:(a.innerText||'').trim().slice(0,40), href:a.getAttribute('href')})).filter(a=>a.label);
    const tabs = inMain('[role=tab],.tab,[class*=tab]').map(t=>(t.innerText||'').trim().slice(0,24)).filter(Boolean).slice(0,20);
    const svgNodes = main.querySelectorAll('svg circle, svg [class*=node], svg g[data-id], canvas').length;
    return { textLen:txt.length, text:txt.slice(0,1400), btnCount:btns.length, buttons:btns.slice(0,60), inputs:inputs.slice(0,40), links:links.slice(0,30), tabs, svgNodes };
  });
}
const results={};
for(const [key,path,extra] of ROUTES){
  diag=newDiag();
  let navErr=null;
  try{ await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:20000}); try{await page.waitForLoadState('networkidle',{timeout:8000});}catch(e){} await page.waitForTimeout(extra||1200); }
  catch(e){ navErr=String(e.message).slice(0,150); }
  let snap=null; try{snap=await mainSnap(page);}catch(e){snap={err:String(e.message).slice(0,120)};}
  results[key]={path,url:page.url(),navErr,snap,diag};
  fs.writeFileSync(OUT+'/deep_'+key.replace(/[^\w-]/g,'_')+'.json', JSON.stringify(results[key],null,2));
  console.log(`\n##### ${key} (${path}) mainLen=${snap.textLen} btns=${snap.btnCount} inputs=${snap.inputs&&snap.inputs.length} svg=${snap.svgNodes} err=${diag.pageerrors.length} bad=${diag.badresp.length}`);
  console.log('CONTENT:', (snap.text||'').slice(0,700));
  if(snap.buttons&&snap.buttons.length) console.log('BTNS:', snap.buttons.map(b=>b.label+(b.disabled?'(disabled)':'')).filter(Boolean).join(' | ').slice(0,500));
  if(diag.badresp.length) console.log('BADRESP:', JSON.stringify(diag.badresp));
  if(diag.pageerrors.length) console.log('PAGEERR:', JSON.stringify(diag.pageerrors));
}
fs.writeFileSync(OUT+'/deep_all.json', JSON.stringify(results,null,2));
await browser.close();
console.log('\nDEEP DONE');
