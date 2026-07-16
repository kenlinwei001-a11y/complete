import pw from '/home/user/complete/.claude/worktrees/agent-a334d5e58cadc8ebe/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium }=pw;
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE='http://127.0.0.1:5284';
const OUT='/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/out';
const log=(...a)=>console.log(...a);
const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1500,height:1000},storageState:OUT+'/state.json'});
const page=await ctx.newPage();
await page.goto(BASE+'/admin/rules',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500);
await page.click('[data-testid=rule-create]'); await page.waitForTimeout(1200);
const ed=await page.evaluate(()=>{const b=document.body;return {bodyInputs:b.querySelectorAll('input,textarea').length, textareas:b.querySelectorAll('textarea').length, hasEditor:/dry|试跑|测试|表达式|expression|保存|severity|作用域/i.test(b.innerText), editorText:b.innerText.replace(/\s+/g,' ').match(/新建规则|规则.*?保存|expression[\s\S]{0,100}/i)?b.innerText.replace(/\s+/g,' ').slice(0,600):'no-editor'};});
log('body inputs',ed.bodyInputs,'textareas',ed.textareas,'hasEditorUI',ed.hasEditor);
// look for the editor panel specifically (save button + expression field)
const detail=await page.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean);
  const hasSave=btns.some(b=>/保存/.test(b));
  const hasDry=btns.some(b=>/试跑|dry|测试|预演/i.test(b));
  const labels=[...document.querySelectorAll('label,.section-title,th')].map(l=>l.innerText.trim()).filter(Boolean).slice(0,25);
  return {btns:btns.slice(0,25),hasSave,hasDry,labels};
});
log('editor buttons:',JSON.stringify(detail.btns));
log('hasSave',detail.hasSave,'hasDry',detail.hasDry);
log('labels/sections:',JSON.stringify(detail.labels));
await page.screenshot({path:OUT+'/shots/dcrule_neweditor.png',fullPage:true});
await browser.close(); log('DCRULE DONE');
