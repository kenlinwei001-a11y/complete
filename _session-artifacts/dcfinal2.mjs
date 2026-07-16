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
let net=[],rec=false; page.on('response',r=>{const u=r.url();if(rec&&(u.includes('/a/v1/')||u.includes('/b/v1/')))net.push(r.request().method()+' '+r.status()+' '+u.replace(BASE,'').slice(0,70));});

// RULE new editor
log('===== RULES 新建规则 -> RuleEditor =====');
await page.goto(BASE+'/admin/rules',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
const nr=await page.$('[data-testid=rule-create]');
if(nr){ await nr.click(); await page.waitForTimeout(1000);
  const ed=await page.evaluate(()=>{const m=document.querySelector('main');const t=m.innerText;return {inputs:m.querySelectorAll('input,textarea').length, hasExpr:/表达式|expression|severity|dry|试跑|测试|阈值|作用域|scope/i.test(t), head:t.replace(/\s+/g,' ').slice(0,450)};});
  log('RuleEditor(new): inputs',ed.inputs,'hasExprUI',ed.hasExpr); log('  head:',ed.head);
  // type an expression and try dry-run
  const ta=await page.$('main textarea, main input[type=text]');
  await page.screenshot({path:OUT+'/shots/dcf2_rulenew.png',fullPage:true});
}

// CONNECTIONS preview + manual sync
log('\n===== CONNECTIONS 预览 (source dataset) =====');
await page.goto(BASE+'/admin/connections',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800);
rec=true;net=[];
const preview=await page.$('button:has-text("预览")');
if(preview){ await preview.click(); await page.waitForTimeout(1800);
  const pv=await page.evaluate(()=>{const b=document.body;const t=b.innerText;const rows=b.querySelectorAll('table tr, [role=row]').length;return {tableRows:rows, head:t.replace(/\s+/g,' ').slice(0,300)};});
  log('preview clicked; tableRows',pv.tableRows,'NET',JSON.stringify(net));
  log('  preview head:',pv.head.slice(0,250));
} else log('NO 预览 button');
rec=false; await page.screenshot({path:OUT+'/shots/dcf2_conn_preview.png'});

// RULE-DOCS upload input (A2)
log('\n===== RULE-DOCS 上传 (A2) =====');
await page.goto(BASE+'/admin/rule-docs',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200);
const up=await page.evaluate(()=>{const m=document.querySelector('main');return {fileInputs:m.querySelectorAll('input[type=file]').length, uploadBtn:!!m.querySelector('button'), head:m.innerText.replace(/\s+/g,' ').slice(0,200)};});
log('rule-docs upload UI:',JSON.stringify(up));

// SANDBOX tick (A8 clock)
log('\n===== SANDBOX 推进 tick (A8 sim clock) =====');
await page.goto(BASE+'/v/sim-sandbox',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000);
const tickBefore=await page.evaluate(()=>{const t=document.body.innerText;const m=t.match(/已推进\s*(\d+)\s*tick|tick\s*(\d+)|未推进/);return m?m[0]:'(no tick indicator)';});
log('tick state before:',tickBefore);
rec=true;net=[];
const tickBtn=await page.$('button:has-text("推进 tick"), button:has-text("推进")');
if(tickBtn){ const dis=await tickBtn.isDisabled(); log('推进 tick disabled?',dis);
  await tickBtn.click(); await page.waitForTimeout(3500);
  const tickAfter=await page.evaluate(()=>{const t=document.body.innerText;const m=t.match(/已推进\s*(\d+)\s*tick|ACTIVE.*?tick|未推进/);return m?m[0]:'(no indicator)';});
  log('tick state after:',tickAfter,'| NET',JSON.stringify(net));
} else log('NO 推进 tick button');
rec=false; await page.screenshot({path:OUT+'/shots/dcf2_sandbox_tick.png',fullPage:false});

log('\nPAGEERRORS:',JSON.stringify(perr));
await browser.close(); log('DCFINAL2 DONE');
