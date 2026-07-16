import { launch, login, BASE, snapLogs, clearLogs } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
const btns = await page.$$('[data-testid^="launcher-launch-"]');
let enabled=0, disabled=0; const enabledIds=[];
for (const b of btns){ const d = await b.evaluate(el=>el.disabled); if(d) disabled++; else { enabled++; enabledIds.push(await b.getAttribute('data-testid')); } }
console.log(`launch buttons: total=${btns.length} enabled=${enabled} disabled=${disabled}`);
console.log('enabled ids:', enabledIds.join(', ')||'(none)');
// click a 查看验证状态 (developing) button
const dev = await page.$('[data-testid^="launcher-developing-"]');
if (dev){ clearLogs(logs); const before=(await page.evaluate(()=>document.body.innerText)).length; await dev.scrollIntoViewIfNeeded(); await dev.click().catch(()=>{}); await page.waitForTimeout(2500); const after=(await page.evaluate(()=>document.body.innerText)).length; console.log('查看验证状态 click: url=',page.url().replace(BASE,''),'Δ=',after-before,'http=',snapLogs(logs).net4xx5xx.filter(x=>!x.includes('history')).length); }
// if any enabled, launch it
if (enabledIds.length){ await page.goto(`${BASE}/scenarios`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500); clearLogs(logs); const b=await page.$(`[data-testid="${enabledIds[0]}"]`); await b.click().catch(()=>{}); await page.waitForTimeout(4000); const dock=await page.$('[data-testid=query-dock-panel]'); const clar=await page.$('[data-testid=clarification]'); const ans=await page.$('[data-testid=answer-card]'); console.log(`launched ${enabledIds[0]}: url=${page.url().replace(BASE,'')} dock=${!!dock} clarify=${!!clar} answer=${!!ans} http=${snapLogs(logs).net4xx5xx.filter(x=>!x.includes('history')).length}`); }
await browser.close();
