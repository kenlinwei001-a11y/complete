import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});

// ===== 1. GAP CARD growth button (触发生成缺失数据) =====
console.log('===== GAP CARD (触发生成缺失数据) =====');
await page.goto(`${BASE}/v/dash`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(1500);
let input = await page.$('[data-testid=query-dock-bar] input');
await input.fill('未来六个月需求预测多少？');
await input.press('Enter');
let gapBtn=null;
for (let i=0;i<14;i++){
  await page.waitForTimeout(1500);
  gapBtn = await page.$('button:has-text("触发生成缺失数据"), button:has-text("触发自成长"), [data-testid*="gap"] button, button:has-text("生成缺失")');
  if (gapBtn) break;
  if (await page.$('[data-testid=answer-card]')) break;
}
if (gapBtn){
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  console.log('gap button text:', (await gapBtn.innerText()).replace(/\s+/g,' ').trim());
  try{ await gapBtn.click({timeout:3000}); }catch(e){ console.log('gap click FAIL', String(e).slice(0,60)); }
  await page.waitForTimeout(4000);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const s=snapLogs(logs); const st=await pageState(page);
  const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  console.log(`gap click: Δ=${after-before}${st.errBoundary?' ERRBND':''} http=[${[...new Set(http)].slice(0,3).join(',')}] pageerr=${s.pageerr.length}`);
  console.log('after gap tail:', (await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(-260));
} else {
  console.log('no gap button found; answer card present:', !!(await page.$('[data-testid=answer-card]')));
}
await page.screenshot({ path:`${SHOT_DIR}/gapcard.png` }).catch(()=>{});

// ===== 2. WORKFLOW EDITOR =====
console.log('\n===== WORKFLOW EDITOR (admin/workflows) =====');
await page.goto(`${BASE}/admin/workflows`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
const st2 = await pageState(page);
console.log('workflows landed textLen:', st2.textLen);
// solver select in step s2
const solverSel = await page.$('[data-testid=wf-solver-select-s2]');
if (solverSel){
  clearLogs(logs);
  const opts = await solverSel.$$('option');
  console.log('wf-solver-select-s2 options:', opts.length);
  if (opts.length>1){ const v=await opts[1].getAttribute('value'); await solverSel.selectOption(v).catch(()=>{}); await page.waitForTimeout(800); console.log('  selected solver ->', v, 'pageerr='+snapLogs(logs).pageerr.length); }
}
// rule multi-select pick
const rulePick = await page.$('[data-testid=wf-ruleids-select-s3-opt-C03]');
if (rulePick){ clearLogs(logs); await rulePick.scrollIntoViewIfNeeded(); await rulePick.click().catch(()=>{}); await page.waitForTimeout(500); console.log('  ruleid C03 toggled pageerr='+snapLogs(logs).pageerr.length); }
// new workflow button
const wfCreate = await page.$('[data-testid=workflow-create]');
if (wfCreate){ clearLogs(logs); const before=(await page.evaluate(()=>document.body.innerText)).length; await wfCreate.click().catch(()=>{}); await page.waitForTimeout(1200); const after=(await page.evaluate(()=>document.body.innerText)).length; const s=snapLogs(logs); console.log('  workflow-create click: Δ='+(after-before)+' pageerr='+s.pageerr.length+' http='+s.net4xx5xx.filter(x=>!x.includes('history')).length); }
await page.screenshot({ path:`${SHOT_DIR}/workflow-editor.png` }).catch(()=>{});

// ===== 3. adopt result verify (ofc-adopt) =====
console.log('\n===== OFC ADOPT result =====');
await page.goto(`${BASE}/v/order-chain`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3000);
const adopt = await page.$('[data-testid=ofc-adopt]');
if (adopt){
  clearLogs(logs);
  console.log('adopt button text:', (await adopt.innerText()).replace(/\s+/g,' ').trim());
  await adopt.scrollIntoViewIfNeeded();
  await adopt.click().catch(()=>{});
  await page.waitForTimeout(2000);
  const s=snapLogs(logs);
  // look for toast / confirmation / ticket ref
  const toast = await page.$('[class*=toast], [class*=Toast], [role=alert], [data-testid*=toast]');
  console.log('adopt result: toast/alert=', !!toast, 'http=', s.net4xx5xx.filter(x=>!x.includes('history')).join(';')||'none', 'pageerr=', s.pageerr.length);
  const tailTxt = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  const m = tailTxt.match(/工单[^。]{0,40}|已.{0,10}(采纳|留痕|生成)[^。]{0,30}/);
  console.log('adopt confirmation text match:', m?m[0]:'(none visible)');
}
await browser.close();
console.log('\nDONE final_probe');
