import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://127.0.0.1:5284';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const FLOW=process.argv[2]||'all';
const net=[]; let recording=false;
const log=(...a)=>console.log(...a);

const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},storageState:OUT+'/state.json'});
const page=await ctx.newPage();
const perr=[]; page.on('pageerror',e=>perr.push(String(e.message).slice(0,200)));
page.on('response',async r=>{ if(!recording)return; const u=r.url(); if(u.includes('/a/v1/')||u.includes('/b/v1/')||u.includes('/api/v1/')){ let body=''; try{ const ct=r.headers()['content-type']||''; if(ct.includes('json')) body=(await r.text()).slice(0,1200);}catch(e){} net.push({m:r.request().method(),u:u.replace(BASE,''),s:r.status(),body}); } });

async function mainText(){ return await page.evaluate(()=>{const m=document.querySelector('main')||document.body;return (m.innerText||'').replace(/\s+/g,' ').trim();}); }
async function shot(name){ try{await page.screenshot({path:OUT+'/shots/act_'+name+'.png'});}catch(e){} }
function dumpNet(tag){ log('  NET['+tag+']:'); net.forEach(n=>log('    '+n.m+' '+n.s+' '+n.u+(n.body?(' :: '+n.body.slice(0,220).replace(/\s+/g,' ')):''))); net.length=0; }

async function flowObject360(){
  log('\n===== FLOW Object360 (via object-types 看实例) =====');
  await page.goto(BASE+'/admin/object-types',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
  // click first 看实例 button
  const seeBtns=await page.$$('button');
  let clicked=null;
  for(const b of seeBtns){ const t=(await b.innerText().catch(()=>''))||''; if(t.includes('看实例')){ recording=true; net.length=0; await b.click(); clicked=t; break; } }
  await page.waitForTimeout(2000);
  log('clicked "看实例", url=',page.url());
  dumpNet('after 看实例');
  let txt=await mainText();
  log('Object360 mainLen=',txt.length,' head=',txt.slice(0,500));
  await shot('object360');
  // relation graph nodes
  const svgInfo=await page.evaluate(()=>{const m=document.querySelector('main');return {svgCircles:m.querySelectorAll('svg circle').length,svgG:m.querySelectorAll('svg g').length,canvas:m.querySelectorAll('canvas').length,relLinks:m.querySelectorAll('a[href^="/o/"]').length,tabs:Array.from(m.querySelectorAll('[role=tab],button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,25)};});
  log('Object360 graph:',JSON.stringify(svgInfo));
  // try click a relation neighbor link /o/
  const relLink=await page.$('main a[href^="/o/"]');
  if(relLink){ const href=await relLink.getAttribute('href'); recording=true; net.length=0; await relLink.click(); await page.waitForTimeout(1500); log('clicked relation link ->',href,' now url=',page.url()); dumpNet('rel-nav'); log('  newLen=',(await mainText()).length); }
  else log('NO /o/ relation links found in Object360 main');
  // try clicking an svg node if any
  const node=await page.$('main svg circle, main svg g[data-id], main svg [class*=node]');
  if(node){ recording=true; net.length=0; await node.click({force:true}).catch(e=>log('node click err',e.message)); await page.waitForTimeout(1200); log('clicked svg node; url=',page.url()); dumpNet('svg-node'); }
  else log('NO clickable svg node in Object360 main (svgCircles='+svgInfo.svgCircles+')');
  recording=false;
}

async function flowGraph(){
  log('\n===== FLOW Ontology Graph /v/graph =====');
  await page.goto(BASE+'/v/graph',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000);
  const info=await page.evaluate(()=>{const m=document.querySelector('main');return {circles:m.querySelectorAll('svg circle').length,gnodes:m.querySelectorAll('svg g').length,texts:m.querySelectorAll('svg text').length};});
  log('graph svg:',JSON.stringify(info));
  await shot('graph_initial');
  // click a node (svg circle or g with data)
  recording=true; net.length=0;
  const clicked=await page.evaluate(()=>{
    const m=document.querySelector('main');
    const cands=[...m.querySelectorAll('svg g[data-id], svg g.node, svg circle, svg [class*=node]')];
    if(!cands.length) return 'none';
    const el=cands[Math.min(5,cands.length-1)];
    const r=el.getBoundingClientRect(); return {tag:el.tagName,x:r.x+r.width/2,y:r.y+r.height/2};
  });
  log('node candidate:',JSON.stringify(clicked));
  if(clicked&&clicked.x){ await page.mouse.click(clicked.x,clicked.y); await page.waitForTimeout(1500); }
  dumpNet('graph-node-click');
  const after=await mainText();
  await shot('graph_after_click');
  log('after node click mainLen=',after.length);
  // detect detail panel keywords
  const panel=await page.evaluate(()=>{const m=document.querySelector('main');const t=m.innerText;const hasDetail=/属性|派生|关系|绑定|求解器|详情|source|lineage|主键|物化/.test(t);return {hasDetail,tail:t.replace(/\s+/g,' ').slice(-400)};});
  log('panel:',panel.hasDetail?'DETAIL-SHOWN':'NO-DETAIL','tail=',panel.tail.slice(0,300));
  // legend filter click
  recording=true; net.length=0;
  const legend=await page.$('main button:has-text("产品"), main button:has-text("工厂")');
  if(legend){ await legend.click(); await page.waitForTimeout(1000); log('clicked legend filter; svg now:',JSON.stringify(await page.evaluate(()=>({c:document.querySelector('main').querySelectorAll('svg circle').length})))); }
  dumpNet('legend'); recording=false;
}

async function flowSynthetic(){
  log('\n===== FLOW Synthetic generate + determinism =====');
  await page.goto(BASE+'/admin/synthetic',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
  // pick battery template, scale S, seed 42
  recording=true; net.length=0;
  const b1=await page.$('button:has-text("battery-manufacturing")'); if(b1){await b1.click();log('picked battery-manufacturing');}
  const sS=await page.$('button:has-text("S")'); // scale S
  // fill seed input (number input)
  const seedInput=await page.$('main input[type=number], main input');
  if(seedInput){ await seedInput.fill('42').catch(()=>{}); }
  const gen=await page.$('button:has-text("开始生成")');
  if(gen){ await gen.click(); log('clicked 开始生成'); }
  await page.waitForTimeout(4000);
  const txt=await mainText();
  await shot('synthetic_after');
  log('synthetic mainLen=',txt.length,' head=',txt.slice(0,600));
  const det=/确定性|字节|一致|seed|重跑|byte|deterministic|同.*seed/.test(txt);
  log('determinism message present:',det);
  dumpNet('synthetic'); recording=false;
}

async function flowConnCredential(){
  log('\n===== FLOW Connections 新建连接 (credential no-echo) =====');
  await page.goto(BASE+'/admin/connections',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
  const nc=await page.$('button:has-text("新建连接")');
  if(!nc){log('NO 新建连接 button');return;}
  recording=true; net.length=0;
  await nc.click(); await page.waitForTimeout(1200);
  await shot('conn_new_modal');
  // inspect modal
  const modal=await page.evaluate(()=>{const t=document.body.innerText;const inputs=[...document.querySelectorAll('input,select,textarea')].map(i=>({name:i.name||i.id||i.placeholder,type:i.type||i.tagName}));return {hasSecret:/密钥|secret|token|password|credential|api.?key/i.test(t),inputCount:inputs.length,inputs:inputs.slice(0,20),head:t.replace(/\s+/g,' ').slice(0,400)};});
  log('new-conn modal:',JSON.stringify(modal).slice(0,600));
  dumpNet('open-new-conn'); recording=false;
}

async function flowRules(){
  log('\n===== FLOW Rules edit→save =====');
  await page.goto(BASE+'/admin/rules',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
  recording=true; net.length=0;
  // click a rule row text (not 下线/新建). Click on a rule name cell.
  const row=await page.$('main table tbody tr');
  if(row){ const cell=await row.$('td'); if(cell){ await cell.click(); log('clicked first rule row cell'); } }
  await page.waitForTimeout(1500);
  await shot('rules_detail');
  const txt=await mainText();
  log('after row click mainLen=',txt.length,' tail=',txt.slice(-400));
  const editor=/编辑|保存|DSL|表达式|条件|when|then|severity/.test(txt);
  log('editor/detail shown:',editor);
  dumpNet('rule-click');
  // try 新建规则
  net.length=0;
  const nr=await page.$('button:has-text("新建规则")');
  if(nr){ await nr.click(); await page.waitForTimeout(1200); await shot('rules_new'); log('after 新建规则 tail=',(await mainText()).slice(-350)); }
  dumpNet('rule-new'); recording=false;
}

async function flowPermissions(){
  log('\n===== FLOW Permissions =====');
  await page.goto(BASE+'/admin/permissions',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
  recording=true; net.length=0;
  const explain=await page.$('button:has-text("解释")');
  if(explain){ await explain.click(); await page.waitForTimeout(1200); log('clicked 解释; tail=',(await mainText()).slice(-350)); }
  dumpNet('perm-explain');
  net.length=0;
  const addrow=await page.$('button:has-text("加一行")');
  if(addrow){ await addrow.click(); await page.waitForTimeout(800); log('clicked 加一行授权'); }
  const save=await page.$('button:has-text("保存策略")');
  if(save){ await save.click(); await page.waitForTimeout(1500); log('clicked 保存策略; tail=',(await mainText()).slice(-300)); }
  await shot('perm_after');
  dumpNet('perm-save'); recording=false;
}

const flows={object360:flowObject360,graph:flowGraph,synthetic:flowSynthetic,conn:flowConnCredential,rules:flowRules,permissions:flowPermissions};
if(FLOW==='all'){ for(const f of Object.values(flows)){ try{await f();}catch(e){log('FLOW ERROR:',e.message);} } }
else if(flows[FLOW]){ await flows[FLOW](); }
else log('unknown flow',FLOW);
log('\nPAGEERRORS:',JSON.stringify(perr));
await browser.close();
log('INTERACT DONE');
