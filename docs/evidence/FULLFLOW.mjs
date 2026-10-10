#!/usr/bin/env node
/** 完整流：真前端 → /v/decision-console → 加「物料价格变动·电芯壳体」→ 算一下 → dump dc-finance。
 *  规避两个已知坑：① 候选要等出现再点（不是填完就点）② payload 控件要认清（number 那个）。 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE=process.env.FF_BASE??"http://127.0.0.1:5294";
const MAG=Number(process.env.FF_MAG??3);
const OUT=process.env.FF_OUT??"/tmp/wt-ab/docs/evidence/FULLFLOW.txt";
const DU="demo:admin:admin|planner|catalog_admin";
const L=[]; const say=(s="")=>{L.push(s);console.log(s);};
const b=await chromium.launch({channel:"chrome",headless:true});
const ctx=await b.newContext({viewport:{width:1920,height:1080},extraHTTPHeaders:{"x-debug-user":DU}});
const p=await ctx.newPage();
try{
  await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded",timeout:60000});
  await p.fill("#login-tenant","demo");await p.fill("#login-username","admin");await p.fill("#login-password","demo1234");
  await p.click('form button[type="submit"]'); await p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:60000});
  say("0 登录 OK");
  await p.goto(`${BASE}/v/decision-console`,{waitUntil:"domcontentloaded",timeout:60000});
  await p.waitForTimeout(3500);
  say(`1 dc 外壳=${await p.locator('[data-testid="decision-console"]').count()} · 金丝雀 dc-go=${await p.locator('[data-testid="dc-go"]').count()}`);

  // ① 点「物料价格变动」
  // 用 nth(7)（物料价格变动）—— hasText 早前点不动；先滚进视野再点
  const IDX = Number(process.env.FF_EV ?? 4);   // 4 = 订单改价
  const allEv = p.locator('#z1 button');
  const ev = allEv.nth(IDX);
  await ev.scrollIntoViewIfNeeded().catch(()=>{});
  say(`2a 第 8 个事件按钮文本="${((await ev.textContent())||'').trim().slice(0,20)}"`);
  await ev.click({timeout:20000}); await p.waitForTimeout(2000);
  say(`2 已展开（第 8 个）`);

  // ② 主体搜索 → 等候选 → 点（若本事件无搜索框，input[0] 可能是 number ⇒ 跳过）
  const firstType = await p.locator('#z1 input').nth(0).getAttribute('type').catch(()=>null);
  if (firstType === 'text') {
    await p.locator('#z1 input').nth(0).fill(process.env.FF_SUB ?? 'SO-3391'); await p.waitForTimeout(2800);
  } else { say(`2b input[0] type=${firstType} ⇒ 本事件无搜索框，跳过主体搜索`); }
  let cn = await p.locator('#z1 [aria-pressed]').count();
  if (cn === 0) { await p.waitForTimeout(2500); cn = await p.locator('#z1 [aria-pressed]').count(); }
  say(`3 候选 = ${cn}`);
  if (cn > 0) { await p.locator('#z1 [aria-pressed]').first().click(); await p.waitForTimeout(800); }

  // ③ payload：number 那个 input
  const inputs = p.locator('#z1 input');
  const n = await inputs.count();
  let payIdx = -1;
  for (let i=0;i<n;i++){ const t=await inputs.nth(i).getAttribute('type'); if(t==='number'){ payIdx=i; break; } }
  say(`4 input 数=${n} · payload(number)下标=${payIdx}`);
  if (payIdx>=0) { await inputs.nth(payIdx).fill(String(MAG)); await p.waitForTimeout(500); }

  // ④ 加进去
  const addBtn = p.locator('#z1 button', { hasText: '加进去' });
  say(`5 「加进去」disabled? ${await addBtn.isDisabled().catch(()=>'?')}`);
  if (await addBtn.isDisabled().catch(()=>true)) { say("⛔ 仍禁用 ⇒ 停"); throw new Error("add disabled"); }
  await addBtn.click(); await p.waitForTimeout(1500);
  say(`6 已加进去 · 暂存=` + (await p.locator('[data-testid="dc-"]').count()));

  // ⑤ 算一下
  await p.locator('[data-testid="dc-go"]').click();
  say(`7 已点「算一下」，等结果…`);
  await p.waitForTimeout(40000);

  // ⑥ dump dc-finance
  const fin = await p.locator('[data-testid^="dc-finance"]').evaluateAll(es=>es.map(e=>({tid:e.getAttribute('data-testid'),txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,160)})));
  say(`8 dc-finance 命中 ${fin.length} 处：`);
  for (const f of fin) say(`   [${f.tid}] ${f.txt}`);
  const money = await p.locator('[data-testid="dc-money"]').textContent().catch(()=>"—");
  say(`9 dc-money="${String(money??"").replace(/\s+/g," ").slice(0,70)}"`);
  await p.screenshot({path:"/tmp/wt-ab/docs/evidence/FULLFLOW-shot.png"});
}catch(e){ say("FATAL: "+String(e).slice(0,200)); }
fs.writeFileSync(OUT,L.join("\n")+"\n"); await b.close(); console.log("WROTE "+OUT);
