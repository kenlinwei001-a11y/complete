import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium }=pw; import fs from 'node:fs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://127.0.0.1:5284';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const log=(...a)=>console.log(...a);
const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1600,height:1000},storageState:OUT+'/state.json'});
const page=await ctx.newPage();
const perr=[]; page.on('pageerror',e=>perr.push(String(e.message).slice(0,200)));
let net=[],rec=false; page.on('response',r=>{const u=r.url();if(rec&&(u.includes('/a/v1/')||u.includes('/b/v1/')))net.push(r.request().method()+' '+r.status()+' '+u.replace(BASE,'').slice(0,90));});

log('===== Object360 direct /o/Shipment/SHIP-changzhou =====');
await page.goto(BASE+'/o/Shipment/SHIP-changzhou',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(3500);
let full=await page.evaluate(()=>{const b=document.body;const m=document.querySelector('main')||b;return {bodyLen:b.innerText.replace(/\s+/g,' ').trim().length,mainLen:m.innerText.replace(/\s+/g,' ').trim().length,mainText:m.innerText.replace(/\s+/g,' ').trim().slice(0,1600),loading:/加载中|loading/i.test(b.innerText),sections:Array.from(m.querySelectorAll('h1,h2,h3')).map(e=>e.innerText.trim().slice(0,40)).filter(Boolean).slice(0,25),relLinks:m.querySelectorAll('a[href^="/o/"]').length,svgC:m.querySelectorAll('svg circle').length,btns:Array.from(m.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,20)};});
log('bodyLen',full.bodyLen,'mainLen',full.mainLen,'loading',full.loading);
log('h1/h2/h3:',JSON.stringify(full.sections));
log('relLinks',full.relLinks,'svgCircles',full.svgC,'btns:',JSON.stringify(full.btns));
log('MAINTEXT:',full.mainText);
await page.screenshot({path:OUT+'/shots/dcprobe_object360.png',fullPage:true});

const rl=await page.$('main a[href^="/o/"]');
if(rl){ const href=await rl.getAttribute('href'); rec=true;net=[]; await rl.click(); await page.waitForTimeout(2800); rec=false;
  const l2=await page.evaluate(()=>({len:(document.querySelector('main')||document.body).innerText.trim().length,head:(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(0,300)}));
  log('clicked neighbor',href,'-> url',page.url().replace(BASE,''),'mainLen',l2.len,'net',JSON.stringify(net)); log('  head:',l2.head); }
else log('NO neighbor /o/ link in Object360');

log('\n===== Graph /v/graph precise node click =====');
await page.goto(BASE+'/v/graph',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500);
const nodes=await page.evaluate(()=>{const m=document.querySelector('main');const cs=[...m.querySelectorAll('svg circle')];return cs.slice(0,12).map(c=>{const r=c.getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2,rr:c.getAttribute('r')};});});
log('node circle count sample:',nodes.length,'first4:',JSON.stringify(nodes.slice(0,4)));
const before=await page.evaluate(()=>({bl:document.body.innerText.length,drawers:document.querySelectorAll('[class*=drawer i],[role=dialog],aside,[class*=panel i]').length}));
log('before click: bodyLen',before.bl,'drawer-like els',before.drawers);
rec=true;net=[];
let opened=false;
for(const n of nodes){ if(!n.cx)continue; await page.mouse.click(n.cx,n.cy); await page.waitForTimeout(600);
  const after=await page.evaluate(()=>{const b=document.body;return {len:b.innerText.length, drawer:document.querySelectorAll('[class*=drawer i],[role=dialog],aside,[class*=panel i]').length, hasObjLink:!!document.querySelector('a[href^="/o/"]'), tail:b.innerText.replace(/\s+/g,' ').slice(-450)};});
  if(after.len>before.bl+25||after.drawer>before.drawers||after.hasObjLink){ log('>>> NODE CLICK at',n.cx.toFixed(0),n.cy.toFixed(0),'bodyLen',before.bl,'=>',after.len,'drawers',after.drawer,'objLink',after.hasObjLink); log('  tail:',after.tail.slice(0,350)); opened=true; break; }
}
rec=false;
if(!opened) log('*** NO detail/drawer/nav after clicking',nodes.length,'node circles. net during clicks:',JSON.stringify(net),'***');
await page.screenshot({path:OUT+'/shots/dcprobe_graph_click.png'});

const legendBefore=await page.evaluate(()=>{const cs=[...document.querySelectorAll('main svg circle')];return {n:cs.length,dim:cs.filter(c=>parseFloat(getComputedStyle(c).opacity||'1')<0.5).length};});
const lg=await page.$('main button:has-text("产品")');
if(lg){ await lg.click(); await page.waitForTimeout(1200);
  const legendAfter=await page.evaluate(()=>{const cs=[...document.querySelectorAll('main svg circle')];return {n:cs.length,dim:cs.filter(c=>parseFloat(getComputedStyle(c).opacity||'1')<0.5).length};});
  log('legend 产品: before',JSON.stringify(legendBefore),'after',JSON.stringify(legendAfter),legendAfter.dim!==legendBefore.dim?'(FILTER WORKS: dimmed changed)':'(NO visible dim change)');
}
log('\nPAGEERRORS',JSON.stringify(perr));
await browser.close(); log('DCPROBE DONE');
