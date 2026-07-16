import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const role = process.argv[2]||'admin';
const { browser, page, logs } = await launch();
await login(page, {username: role==='planner'?'planner':'admin'});

async function explore(pageKey, title){
  console.log(`\n===== ${title} (admin/${pageKey}) [${role}] =====`);
  clearLogs(logs);
  await page.goto(`${BASE}/admin/${pageKey}`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  const st = await pageState(page);
  const s0 = snapLogs(logs);
  const http0 = s0.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  console.log(`land: textLen=${st.textLen}${st.errBoundary?' ERRBND':''}${http0.length?' HTTP['+[...new Set(http0)].slice(0,3).join(',')+']':''}${s0.pageerr.length?' PAGEERR['+s0.pageerr[0].slice(0,60)+']':''}`);
  if (st.textLen < 120) console.log('  SAMPLE:', st.sample);
  // buttons with meaningful labels (run/preview/detail/publish/试运行/预览/运行/详情/查看/测试)
  const actionBtns = await page.$$eval('button, a[role=button]', els => els
    .filter(e=>e.offsetParent!==null)
    .map(e=>({t:(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim(), tid:e.getAttribute('data-testid')}))
    .filter(o=>o.t && /运行|预览|试运|详情|查看|测试|发布|执行|preview|run|test|detail|打开|进入|编辑|新建|校验|模拟|重放/i.test(o.t))
  );
  const uniq = [];
  const seen = new Set();
  for (const b of actionBtns){ const k=b.t; if(!seen.has(k)){ seen.add(k); uniq.push(b); } }
  console.log(`action-ish buttons (${uniq.length}):`, uniq.slice(0,14).map(b=>b.t.slice(0,16)).join(' | '));
  // click first "detail/view/进入/详情/查看" then first "run/preview"
  const detailWord = /详情|查看|进入|打开|detail/i;
  const runWord = /运行|预览|试运|执行|测试|模拟|run|preview|test/i;
  // try clicking a detail/list-item first
  let clicked = null;
  for (const w of [detailWord, runWord]){
    const cand = uniq.find(b=>w.test(b.t));
    if (!cand) continue;
    // find element by text
    const el = await page.$(`button:has-text("${cand.t.slice(0,8)}"), a:has-text("${cand.t.slice(0,8)}")`).catch(()=>null);
    if (!el) continue;
    clearLogs(logs);
    const before=(await page.evaluate(()=>document.body.innerText)).length;
    try{ await el.scrollIntoViewIfNeeded(); await el.click({timeout:3500}); }catch(e){ console.log(`  click "${cand.t}" FAIL: ${String(e).slice(0,50)}`); continue; }
    await page.waitForTimeout(1800);
    const after=(await page.evaluate(()=>document.body.innerText)).length;
    const st2=await pageState(page); const s=snapLogs(logs);
    const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
    console.log(`  CLICK "${cand.t.slice(0,18)}": Δ=${after-before}${st2.errBoundary?' ERRBND':''}${http.length?' HTTP['+[...new Set(http)].slice(0,2).join(',')+']':''}${s.pageerr.length?' PAGEERR['+s.pageerr[0].slice(0,60)+']':''}`);
    clicked = cand.t;
  }
  await page.screenshot({ path:`${SHOT_DIR}/mgmt-${role}-${pageKey}.png` }).catch(()=>{});
}

await explore('agents','Agent 目录');
await explore('workflows','Workflow');
await explore('skills','Skill 库');
await explore('scenes','场景入口');
await explore('mcp','MCP');
await explore('solvers','求解器目录');
await explore('solver-review','求解器审核台');
await explore('scenarios','场景启动器(公共)');

await browser.close();
console.log('\nDONE mgmt '+role);
