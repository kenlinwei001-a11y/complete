import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium }=pw;
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://127.0.0.1:5284';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const log=(...a)=>console.log(...a);
const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1500,height:1000},storageState:OUT+'/state.json'});
const page=await ctx.newPage();
const perr=[]; page.on('pageerror',e=>perr.push(String(e.message).slice(0,200)));
let net=[],rec=false; page.on('response',r=>{const u=r.url();if(rec&&(u.includes('/a/v1/')||u.includes('/b/v1/'))){net.push(r.request().method()+' '+r.status()+' '+u.replace(BASE,'').slice(0,70));}});
const toastText=async()=>page.evaluate(()=>{const t=[...document.querySelectorAll('[class*=toast i],[class*=Toast i],[role=status],[role=alert]')].map(e=>e.innerText.trim()).filter(Boolean);return t.join(' | ');});

// ---- SYNTHETIC proper ----
log('===== SYNTHETIC proper (battery/S/42, freeText empty) =====');
await page.goto(BASE+'/admin/synthetic',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
// pick scale S radio
const sRadios=await page.$$('input[type=radio][name=scale]');
if(sRadios[0]) await sRadios[0].check().catch(()=>{}); // S is first
// ensure seed=42 (default). ensure freeText empty (it is by default).
rec=true;net=[];
const gen=await page.$('button:has-text("开始生成")'); await gen.click();
await page.waitForTimeout(5000); rec=false;
const rep=await page.evaluate(()=>{const el=document.querySelector('[data-testid=synthetic-report]');const m=document.querySelector('main');return {hasReport:!!el, reportText:(el?el.innerText:m.innerText).replace(/\s+/g,' ').slice(0,700)};});
log('report present:',rep.hasReport);
log('report text:',rep.reportText);
log('NET:',JSON.stringify(net));
await page.screenshot({path:OUT+'/shots/dcfinal_synthetic.png',fullPage:true});

// ---- RULES edit->save ----
log('\n===== RULES expand->edit->dry-run->save =====');
await page.goto(BASE+'/admin/rules',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
// expand first rule row
const firstRow=await page.$('tr[data-testid^="rule-"]');
if(firstRow){ const tid=await firstRow.getAttribute('data-testid'); await firstRow.click(); await page.waitForTimeout(800); log('expanded row',tid);
  const editBtn=await page.$('button[data-testid^="rule-edit-"]');
  if(editBtn){ await editBtn.click(); await page.waitForTimeout(1000);
    const ed=await page.evaluate(()=>{const m=document.querySelector('main')||document.body;const t=m.innerText;return {hasExpr:/表达式|expression|when|条件|severity|DSL|阈值|dry|试跑|测试/.test(t), inputs:m.querySelectorAll('input,textarea').length, textareas:m.querySelectorAll('textarea').length, head:t.replace(/\s+/g,' ').slice(0,400)};});
    log('RuleEditor opened:',ed.hasExpr,'inputs',ed.inputs,'textareas',ed.textareas);
    log('editor head:',ed.head);
    // try dry-run button
    rec=true;net=[];
    const dry=await page.$('button:has-text("试跑"), button:has-text("dry"), button:has-text("测试"), button:has-text("预演")');
    if(dry){ await dry.click(); await page.waitForTimeout(1500); log('dry-run clicked; NET',JSON.stringify(net)); }
    // save
    net=[];
    const save=await page.$('button:has-text("保存")');
    if(save){ const dis=await save.isDisabled(); log('save disabled?',dis); if(!dis){ await save.click(); await page.waitForTimeout(1500); log('saved; toast=',await toastText(),'NET',JSON.stringify(net)); } }
    rec=false;
    await page.screenshot({path:OUT+'/shots/dcfinal_ruleeditor.png',fullPage:true});
  } else log('NO rule-edit button after expand');
}

// ---- PERMISSIONS ----
log('\n===== PERMISSIONS 解释 + 保存策略 =====');
await page.goto(BASE+'/admin/permissions',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
rec=true;net=[];
const explain=await page.$('button:has-text("解释")');
if(explain){ await explain.click(); await page.waitForTimeout(1200); const tail=await page.evaluate(()=>(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').slice(-350)); log('解释 clicked; tail:',tail); }
net=[];
const save=await page.$('button:has-text("保存策略")');
if(save){ const dis=await save.isDisabled(); log('保存策略 disabled?',dis); await save.click(); await page.waitForTimeout(1500); log('保存策略 clicked; toast=',await toastText(),'NET',JSON.stringify(net)); }
rec=false;
await page.screenshot({path:OUT+'/shots/dcfinal_permissions.png',fullPage:true});

// ---- META sync ----
log('\n===== META 重新落库 sync =====');
await page.goto(BASE+'/admin/meta',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
rec=true;net=[];
const sync=await page.$('[data-testid=meta-sync]');
if(sync){ await sync.click(); await page.waitForTimeout(3500); log('meta-sync clicked; toast=',await toastText(),'NET',JSON.stringify(net));
  const summary=await page.evaluate(()=>{const m=document.querySelector('main');const t=m.innerText.replace(/\s+/g,' ');const mm=t.match(/共\s*\d+|(\d+)\s*元对象|落库摘要[^。]{0,80}/g);return {summary:mm?mm.join(' ; '):'(no count found)', head:t.slice(0,300)};});
  log('after sync summary:',summary.summary); log('  head:',summary.head);
}
rec=false;
await page.screenshot({path:OUT+'/shots/dcfinal_meta.png',fullPage:true});

log('\nPAGEERRORS:',JSON.stringify(perr));
await browser.close(); log('DCFINAL DONE');
