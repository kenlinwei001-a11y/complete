import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const role = process.argv[2]||'admin';
const { browser, page, logs } = await launch();
await login(page, {username: role==='planner'?'planner':'admin'});

async function clickAllPublished(pageKey, title){
  console.log(`\n===== ${title} (admin/${pageKey}) [${role}] =====`);
  await page.goto(`${BASE}/admin/${pageKey}`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2000);
  // list items = buttons starting with PUBLISHED/DRAFT/RETIRED
  const items = await page.$$('button');
  const targets=[];
  for (const b of items){ const t=(await b.innerText()).replace(/\s+/g,' ').trim(); if(/^(PUBLISHED|DRAFT|RETIRED)/.test(t)) targets.push({b,t}); }
  console.log(`items: ${targets.length}`);
  let errs=0;
  for (const {b,t} of targets){
    clearLogs(logs);
    const before=(await page.evaluate(()=>document.body.innerText)).length;
    try{ await b.scrollIntoViewIfNeeded(); await b.click({timeout:3000}); }catch(e){ console.log(`  "${t.slice(0,26)}" CLICKFAIL`); errs++; continue; }
    await page.waitForTimeout(700);
    const after=(await page.evaluate(()=>document.body.innerText)).length;
    const st=await pageState(page); const s=snapLogs(logs);
    const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
    const bad = st.errBoundary || http.length || s.pageerr.length;
    if (bad){ errs++; console.log(`  "${t.slice(0,26)}": Δ=${after-before}${st.errBoundary?' ERRBND':''}${http.length?' HTTP['+http[0]+']':''}${s.pageerr.length?' PAGEERR['+s.pageerr[0].slice(0,50)+']':''}`); }
    else if (after-before < 5 && targets.length>1){ console.log(`  "${t.slice(0,26)}": Δ=${after-before} (no detail change?)`); }
  }
  console.log(`  -> ${targets.length} items clicked, ${errs} problems`);
  await page.screenshot({ path:`${SHOT_DIR}/mgmt2-${role}-${pageKey}.png` }).catch(()=>{});
}

await clickAllPublished('agents','Agent 目录');
await clickAllPublished('skills','Skill 库');

// ---- solvers: expand several rows + try 试运行 ----
console.log(`\n===== 求解器目录 solvers [${role}] =====`);
await page.goto(`${BASE}/admin/solvers`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
const expandBtns = await page.$$('[data-testid^="solver-expand-"]');
console.log('solver rows:', expandBtns.length);
let solverErrs=0, ranSolver=0;
for (const e of expandBtns.slice(0,10)){
  const tid = await e.getAttribute('data-testid');
  clearLogs(logs);
  try{ await e.scrollIntoViewIfNeeded(); await e.click({timeout:3000}); }catch(err){ console.log(`  ${tid} clickfail`); solverErrs++; continue; }
  await page.waitForTimeout(600);
  const s=snapLogs(logs); const st=await pageState(page);
  const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  if (st.errBoundary||http.length||s.pageerr.length){ solverErrs++; console.log(`  ${tid}: ERR${st.errBoundary?' BND':''}${http.length?' HTTP['+http[0]+']':''}${s.pageerr.length?' PE['+s.pageerr[0].slice(0,40)+']':''}`); }
}
// try a 试运行 / 运行 button if present in expanded solver
const runBtn = await page.$('button:has-text("试运行"), button:has-text("运行求解"), [data-testid*="solver-run"]');
if (runBtn){ clearLogs(logs); await runBtn.scrollIntoViewIfNeeded(); const before=(await page.evaluate(()=>document.body.innerText)).length; await runBtn.click().catch(()=>{}); await page.waitForTimeout(3000); const after=(await page.evaluate(()=>document.body.innerText)).length; const s=snapLogs(logs); console.log(`  试运行 clicked: Δ=${after-before} http=${s.net4xx5xx.filter(x=>!x.includes('history')).length} pageerr=${s.pageerr.length}`); ranSolver=1; }
console.log(`  -> solvers expanded (10), ${solverErrs} problems, ranSolver=${ranSolver}`);

// ---- scenarios launcher (public) ----
console.log(`\n===== 场景启动器 /scenarios [${role}] =====`);
await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
const st = await pageState(page);
console.log('scenarios landing textLen:', st.textLen, st.errBoundary?'ERRBND':'');
const launchCards = await page.$$('[data-testid^="scenario-card"], [data-testid^="scene-card"], button:has-text("启动")');
console.log('launch cards/buttons:', launchCards.length);
if (launchCards.length){
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  await launchCards[0].scrollIntoViewIfNeeded();
  try{ await launchCards[0].click({timeout:3000}); }catch(e){}
  await page.waitForTimeout(2500);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const s=snapLogs(logs);
  console.log(`  card0 launch: Δ=${after-before} url=${page.url().replace(BASE,'')} http=${s.net4xx5xx.filter(x=>!x.includes('history')).length} pageerr=${s.pageerr.length}`);
}
await page.screenshot({ path:`${SHOT_DIR}/scenarios-${role}.png` }).catch(()=>{});

await browser.close();
console.log('\nDONE mgmt2 '+role);
