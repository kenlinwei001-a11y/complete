#!/usr/bin/env node
/** 事件影响与对策：订单改交期 × advanceDays 三值（3 / 30 / 300），看结论是否随数变。 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE=process.env.DC_BASE??"http://127.0.0.1:5294";
const OUT="/tmp/wt-ab/docs/evidence/DC-3RUN.txt";
const DU="demo:admin:admin|planner|catalog_admin";
const L=[]; const say=(s="")=>{L.push(s);console.log(s);};
const b=await chromium.launch({channel:"chrome",headless:true});
const ctx=await b.newContext({viewport:{width:1920,height:1080},extraHTTPHeaders:{"x-debug-user":DU}});
const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded",timeout:60000});
await p.fill("#login-tenant","demo");await p.fill("#login-username","admin");await p.fill("#login-password","demo1234");
await p.click('form button[type="submit"]'); await p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:60000});
say("0 登录 OK");
await p.goto(`${BASE}/v/decision-console`,{waitUntil:"domcontentloaded",timeout:60000});
await p.waitForTimeout(3500);
say(`1 dc 外壳=${await p.locator('[data-testid="decision-console"]').count()} · 金丝雀 dc-go=${await p.locator('[data-testid="dc-go"]').count()}`);
await p.locator('#z1 button').first().click().catch(()=>{}); await p.waitForTimeout(1200);
// ① 搜索 → 点候选（pick 设 pickedId）
await p.locator('#z1 input').nth(0).fill('SO-3391');
await p.waitForTimeout(2200);
const cn = await p.locator('#z1 [aria-pressed]').count();
say(`2 候选项=${cn}`);
if (cn===0){ say("⛔ 无候选 ⇒ 停"); fs.writeFileSync(OUT,L.join("\n")+"\n"); await b.close(); process.exit(0); }
await p.locator('#z1 [aria-pressed]').first().click(); await p.waitForTimeout(800);
say(`2b pickedId=${await p.locator('#z1 input').nth(0).inputValue()}`);
const pay = p.locator('#z1 input').nth(1);        // advanceDays（必填 number）
const addBtn=p.locator('#z1 button',{hasText:'加进去'});
for (const v of ["3","30","300"]) {
  await pay.fill(v); await p.waitForTimeout(500);
  const dis = await addBtn.isDisabled().catch(()=>'?');
  if (v==="3") {
    say(`3 「加进去」disabled? ${dis}`);
    if (dis===true){ say("⛔ 仍禁用 ⇒ 停"); fs.writeFileSync(OUT,L.join("\n")+"\n"); await b.close(); process.exit(0); }
    await addBtn.click(); await p.waitForTimeout(1500);
    say(`4 已加进去 · 「改数」框=${await p.locator('[aria-label^="改「"]').count()}`);
  }
  // 改数（staged 里的同一个控件）并重算
  const edit=p.locator('[aria-label^="改「"]').first();
  if (await edit.count()) await edit.fill(v).catch(()=>{});
  await p.waitForTimeout(400);
  await p.locator('[data-testid="dc-go"]').click();
  await p.waitForTimeout(12000);
  const money=await p.locator('[data-testid="dc-money"]').textContent().catch(()=>"—");
  say(`  提前${String(v).padStart(3)}天 ⇒ dc-money="${String(money??"").replace(/\s+/g," ").slice(0,80)}"`);
}
fs.writeFileSync(OUT,L.join("\n")+"\n"); await b.close(); console.log("WROTE "+OUT);
