import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium }=pw;
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://127.0.0.1:5284';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const log=(...a)=>console.log(...a);
const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1600,height:1000},storageState:OUT+'/state.json'});
const page=await ctx.newPage();
await page.goto(BASE+'/v/graph',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500);
const dimCount=async()=>page.evaluate(()=>{const gs=[...document.querySelectorAll('main svg g')];return gs.filter(g=>parseFloat(getComputedStyle(g).opacity||'1')<0.5).length;});
const b=await dimCount();
log('dimmed node <g> before:',b);
// click legend-product via testid
const has=await page.$('[data-testid="legend-product"]');
log('legend-product button exists:',!!has);
if(has){
  const opBefore=await page.evaluate(()=>{const e=document.querySelector('[data-testid="legend-product"]');return getComputedStyle(e).opacity;});
  await has.click(); await page.waitForTimeout(1200);
  const a=await dimCount();
  const opAfter=await page.evaluate(()=>{const e=document.querySelector('[data-testid="legend-product"]');return getComputedStyle(e).opacity;});
  log('dimmed node <g> after click:',a,'| legend btn opacity',opBefore,'->',opAfter);
  log(a>b?'*** LEGEND FILTER WORKS: '+ (a-b) +' nodes dimmed ***':'*** legend produced no node dim ***');
  // toggle back
  await has.click(); await page.waitForTimeout(800);
  const c=await dimCount();
  log('dimmed after toggle-back:',c);
}
// also test mapping button
const map=await page.$('[data-testid="graph-mapping-btn"]');
if(map){ await map.click(); await page.waitForTimeout(1000); const t=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,200)); log('mapping opened, body head:',t); }
await page.screenshot({path:OUT+'/shots/dclegend.png'});
await browser.close(); log('LEGEND PROBE DONE');
