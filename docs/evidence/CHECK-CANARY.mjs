#!/usr/bin/env node
/** 决定性检查：浏览器里的页面到底跑没跑「含金丝雀」的那份模块。
 *  ① 页面 body 里有没有「【金丝雀】」这个字符串（字符串判定，绕开选择器）
 *  ② #z3 的 innerText 前 600 字
 *  ③ 页面自己 fetch /src/views/sim/DecisionConsoleView.tsx，查响应体里有没有 canary
 *  ④ testid 计数对照：dc-money / dc-finance-canary / dc-finance*
 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
const BASE = process.env.FF_BASE ?? "http://127.0.0.1:5294";
const DU = "demo:admin:admin|planner|catalog_admin";
const L = []; const say = (s = "") => { L.push(s); console.log(s); };
const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, extraHTTPHeaders: { "x-debug-user": DU } });
const p = await ctx.newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.fill("#login-tenant", "demo"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click('form button[type="submit"]'); await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 60000 });
  say("0 登录 OK");
  await p.goto(`${BASE}/v/decision-console`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(4000);

  // 只查「不点任何事件」的静态态：金丝雀应与 dc-money 同区同条件
  const inBody = await p.evaluate(() => document.body.innerText.includes("金丝雀") || document.body.innerHTML.includes("dc-finance-canary"));
  say(`1 页面 body 含金丝雀标记? ${inBody}（此时尚无结果区 —— 对照用）`);
  say(`2 testid 计数: dc-money=${await p.locator('[data-testid="dc-money"]').count()} canary=${await p.locator('[data-testid="dc-finance-canary"]').count()} fin*=${await p.locator('[data-testid^="dc-finance"]').count()}`);

  // 页面自己取模块（浏览器同源、与页面模块加载同 URL）
  const fetched = await p.evaluate(async () => {
    const r = await fetch("/src/views/sim/DecisionConsoleView.tsx");
    const t = await r.text();
    return { status: r.status, hasCanary: t.includes("dc-finance-canary"), len: t.length };
  });
  say(`3 页面 fetch 模块: status=${fetched.status} hasCanary=${fetched.hasCanary} len=${fetched.len}`);

  // 页面模块加载记录
  const res = await p.evaluate(() => performance.getEntriesByType("resource")
    .map(e => e.name).filter(n => n.includes("DecisionConsoleView")));
  say(`4 performance 里 DecisionConsoleView 资源: ${JSON.stringify(res)}`);
} catch (e) { say("FATAL: " + String(e).slice(0, 200)); }
finally {
  const fs = await import("node:fs");
  fs.writeFileSync(process.env.FF_OUT ?? "/tmp/wt-ab/docs/evidence/CHECK-CANARY.txt", L.join("\n") + "\n");
  await b.close();
}
