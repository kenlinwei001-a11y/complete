import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const role = process.argv[2]||'admin';
const { browser, page, logs } = await launch();
await login(page, {username: role==='planner'?'planner':'admin'});

const flags=[];
function rep(tag, msg){ console.log(`   ${tag}: ${msg}`); }
async function clickTest(testid, label){
  const el = await page.$(`[data-testid="${testid}"]`);
  if (!el){ rep('MISS', `${label} (${testid}) not present`); return null; }
  clearLogs(logs);
  const before = (await page.evaluate(()=>document.body.innerText)).length;
  try { await el.click({timeout:4000}); } catch(e){ rep('CLICKFAIL', `${label} ${String(e).slice(0,80)}`); return 'clickfail'; }
  await page.waitForTimeout(900);
  const after = (await page.evaluate(()=>document.body.innerText)).length;
  const s = snapLogs(logs);
  const httpErr = s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  const st = await pageState(page);
  let note = `Δtext=${after-before}`;
  if (st.errBoundary) { note+=' ERROR_BOUNDARY'; flags.push(`${label}: error boundary`); }
  if (httpErr.length) { note+=' HTTP['+httpErr.slice(0,2).join(',')+']'; }
  if (s.pageerr.length) { note+=' PAGEERR['+s.pageerr[0].slice(0,60)+']'; flags.push(`${label}: pageerr`); }
  rep('CLICK', `${label} -> ${note}`);
  return { deltaText: after-before, httpErr, pageerr:s.pageerr };
}

console.log('===== ORDER-CHAIN (v/order-chain) =====');
await page.goto(`${BASE}/v/order-chain`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
let st = await pageState(page);
console.log('landed textLen=', st.textLen);

// 1. capture P90 shown in ofc-panel for default order
async function readOfcCap(){
  const cap = await page.$('[data-testid=ofc-judge-cap]');
  return cap ? (await cap.innerText()).replace(/\s+/g,' ').trim() : null;
}
async function readSelect(){ const s = await page.$('[data-testid=ofc-so-select]'); if(!s) return null; return await s.evaluate(el=>({value:el.value, options:Array.from(el.options).map(o=>o.value)})); }
console.log('ofc default cap:', await readOfcCap());
const sel = await readSelect();
console.log('ofc-so-select:', sel ? `value=${sel.value} options=${sel.options.length} [${sel.options.slice(0,6).join(',')}]` : 'MISSING');

// 2. switch orders across models, record P90 shown
if (sel && sel.options.length){
  const probe = ['SO-3391','SO-3452','SO-3470','SO-3476'].filter(o=>sel.options.includes(o));
  for (const so of (probe.length?probe:sel.options.slice(0,4))){
    const s = await page.$('[data-testid=ofc-so-select]');
    await s.selectOption(so).catch(()=>{});
    await page.waitForTimeout(1800);
    console.log(`  [order ${so}] cap:`, await readOfcCap());
  }
}

// 3. click DAG nodes, judges, adopt, provenance
console.log('--- ofc panel buttons ---');
await clickTest('ofc-verdict', '统一结论卡');
await clickTest('ofc-adopt', '采纳结论→工单');
// DAG nodes
const dagNodes = await page.$$('[data-testid=ofc-dag] [data-testid^="dag-node"], [data-testid=ofc-dag] g[role=button], [data-testid=ofc-dag] .node, [data-testid^=ofc-dag-node]');
console.log('ofc-dag clickable nodes found:', dagNodes.length);
if (dagNodes.length){ clearLogs(logs); try{ await dagNodes[0].click({timeout:3000}); await page.waitForTimeout(1000); const s=snapLogs(logs); console.log('  clicked dag node0 -> pageerr='+s.pageerr.length+' http='+s.net4xx5xx.filter(x=>!x.includes('history')).length);}catch(e){console.log('  dag node click err', String(e).slice(0,80));} }

// 4. inline row expansion in detail table
console.log('--- inline row expansion (oc-row-*) ---');
const rows = await page.$$('[data-testid^="oc-row-"]');
console.log('detail rows:', rows.length);
for (const r of rows.slice(0,3)){
  const tid = await r.getAttribute('data-testid');
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  try{ await r.click({timeout:3000}); }catch(e){ console.log(`  ${tid} clickfail`); continue; }
  await page.waitForTimeout(1600);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const so = tid.replace('oc-row-','');
  const sim = await page.$(`[data-testid="oc-sim-judge-${so}-cap"]`);
  const simEmpty = await page.$(`[data-testid="oc-sim-empty-${so}"]`);
  const s=snapLogs(logs);
  console.log(`  ${tid} -> Δtext=${after-before} simCap=${sim?(await sim.innerText()).replace(/\s+/g,' ').trim():(simEmpty?'EMPTY-STATE':'none')} pageerr=${s.pageerr.length}`);
}

// 5. margin ledger, econ table, problems, caliber
console.log('--- other order-chain buttons ---');
for (const [tid,label] of [['oc-margin-ledger','毛利账本'],['oc-caliber','口径'],['oc-revenue','营收下钻'],['oc-econ-total','经济总计']]) await clickTest(tid,label);
// problem chips -> problem-dag modal
const probChips = await page.$$('[data-testid^="oc-problem-"], [data-testid^="oc-risk-chip-"]');
console.log('problem/risk chips:', probChips.length);
if (probChips.length){ clearLogs(logs); try{ await probChips[0].click({timeout:3000}); await page.waitForTimeout(1200); const modal=await page.$('[data-testid=problem-dag]'); const s=snapLogs(logs); console.log('  chip0 -> problem-dag modal:', modal?'OPENED':'none', 'pageerr='+s.pageerr.length);}catch(e){console.log('  chip click err');} }

await page.screenshot({ path:`${SHOT_DIR}/cockpit-order-${role}.png`, fullPage:true }).catch(()=>{});
console.log('\nFLAGS:', flags.length?flags.join(' | '):'none');
await browser.close();
console.log('DONE cockpit-order '+role);
