import { launch, login, clearLogs, snapLogs, SHOT_DIR, BASE } from './driver.mjs';

const role = process.argv[2] || 'admin';
const startView = process.argv[3] || 'dash';
const queries = process.argv.slice(4);
const creds = role==='planner' ? {username:'planner'} : {username:'admin'};

const { browser, page, logs } = await launch();
await login(page, creds);
await page.goto(`${BASE}/v/${startView}`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(1500);

async function handleClarification() {
  // returns true if it handled a clarification round
  const clar = await page.$('[data-testid=clarification]');
  if (!clar) return false;
  // INTENT_CHOICE?
  const intentOpts = await page.$$('[data-testid^=intent-option-]');
  if (intentOpts.length) {
    const tid = await intentOpts[0].getAttribute('data-testid');
    console.log(`   [clarify] INTENT_CHOICE -> clicking ${tid}`);
    await intentOpts[0].click();
    await page.waitForTimeout(2500);
    return true;
  }
  // SLOT_FILLING
  const slotForm = await page.$('[data-testid=slot-form]');
  if (slotForm) {
    console.log('   [clarify] SLOT_FILLING form present -> filling');
    // fill selects
    const selects = await slotForm.$$('select');
    for (const s of selects) { const opts = await s.$$('option'); if (opts.length>1){ const v = await opts[1].getAttribute('value'); await s.selectOption(v).catch(()=>{}); } }
    // fill date inputs
    for (const d of await slotForm.$$('input[type=date]')) await d.fill('2026-08-15').catch(()=>{});
    // fill number
    for (const n of await slotForm.$$('input[type=number]')) await n.fill('20').catch(()=>{});
    // fill text/combobox
    for (const t of await slotForm.$$('input[type=text]')) { await t.fill('常州').catch(()=>{}); await page.waitForTimeout(600); const opt = await page.$('ul[role=listbox] button[role=option]'); if (opt) await opt.click().catch(()=>{}); }
    const submitBtn = await slotForm.$('button[type=submit]');
    if (submitBtn) { await submitBtn.click(); console.log('   [clarify] submitted slots'); await page.waitForTimeout(3000); return true; }
  }
  return false;
}

for (const q of queries) {
  clearLogs(logs);
  console.log(`\n### QUERY: ${q}`);
  // open dock via bar input
  let input = await page.$('[data-testid=query-dock-bar] input, [data-testid=query-dock-panel] input');
  if (!input) { // expand
    const exp = await page.$('[data-testid=query-dock-bar] button'); if (exp) await exp.click(); await page.waitForTimeout(400);
    input = await page.$('[data-testid=query-dock-panel] input, [data-testid=query-dock-bar] input');
  }
  await input.fill(q);
  await input.press('Enter');
  // wait for task-run / streaming / answer / clarification, up to ~20s with clarification handling
  let answered=false;
  for (let i=0;i<20;i++){
    await page.waitForTimeout(1500);
    if (await handleClarification()) continue;
    const ans = await page.$('[data-testid=answer-card]');
    const failed = await page.$('[data-testid=task-failed]');
    if (ans || failed) { answered=true; break; }
  }
  // capture
  const s = snapLogs(logs);
  const panel = await page.$('[data-testid=query-dock-panel]');
  const answerCard = await page.$('[data-testid=answer-card]');
  const trust = await page.$('[data-testid=trust-badge]');
  const failed = await page.$('[data-testid=task-failed]');
  const info = {
    answered,
    trust: trust ? (await trust.innerText()).trim() : null,
    dataTrust: answerCard ? await answerCard.getAttribute('data-trust') : null,
    failed: failed ? (await failed.innerText()).trim().slice(0,160) : null,
    answerText: answerCard ? (await answerCard.innerText()).replace(/\s+/g,' ').slice(0,500) : null,
    http_err: s.net4xx5xx.filter(x=>!x.includes('history/bundle')),
    pageerr: s.pageerr,
  };
  console.log('   answered:', info.answered, '| trust:', info.trust, '| dataTrust:', info.dataTrust);
  if (info.failed) console.log('   FAILED:', info.failed);
  if (info.http_err.length) console.log('   HTTP_ERR:', info.http_err.slice(0,4).join(' ; '));
  if (info.pageerr.length) console.log('   PAGEERR:', info.pageerr.slice(0,2).join(' | '));
  if (info.answerText) console.log('   ANSWER:', info.answerText);
  const safe = q.replace(/[^\w一-龥]/g,'_').slice(0,20);
  await page.screenshot({ path:`${SHOT_DIR}/qos-${role}-${safe}.png`, fullPage:false }).catch(()=>{});
  // collapse/reset dock for next query: reload view to reset conversation
  await page.goto(`${BASE}/v/${startView}`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1200);
}

await browser.close();
console.log('\nDONE qos '+role);
