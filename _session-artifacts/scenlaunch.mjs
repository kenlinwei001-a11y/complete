import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const role = process.argv[2]||'admin';
const { browser, page, logs } = await launch();
await login(page, {username: role==='planner'?'planner':'admin'});

async function launchScenario(sid){
  await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2000);
  const btn = await page.$(`[data-testid="launcher-launch-${sid}"]`);
  const dev = await page.$(`[data-testid="launcher-developing-${sid}"]`);
  if(!btn){ console.log(`  ${sid}: launch btn MISS (dev=${!!dev})`); return; }
  clearLogs(logs);
  await btn.scrollIntoViewIfNeeded();
  try{ await btn.click({timeout:3000}); }catch(e){ console.log(`  ${sid}: clickfail`); return; }
  await page.waitForTimeout(3500);
  const st = await pageState(page); const s=snapLogs(logs);
  const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  // did a query get fired / dock open / view change?
  const dock = await page.$('[data-testid=query-dock-panel]');
  const answer = await page.$('[data-testid=answer-card]');
  const clar = await page.$('[data-testid=clarification]');
  console.log(`  ${sid}: url=${page.url().replace(BASE,'')} textLen=${st.textLen}${st.errBoundary?' ERRBND':''}${http.length?' HTTP['+http[0]+']':''}${s.pageerr.length?' PAGEERR['+s.pageerr[0].slice(0,50)+']':''} dock=${!!dock} answer=${!!answer} clarify=${!!clar}`);
  await page.screenshot({ path:`${SHOT_DIR}/scen-${role}-${sid}.png` }).catch(()=>{});
}

console.log(`===== SCENARIO LAUNCHES [${role}] =====`);
// launch a spread of scenarios
for (const sid of ['S01','S07','S11','S26','S35','S36']) await launchScenario(sid);

await browser.close();
console.log('DONE scenlaunch '+role);
