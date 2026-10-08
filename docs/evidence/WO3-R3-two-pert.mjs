#!/usr/bin/env node
/** WO-3 R3：真机加【两个】扰动，完整记录扰动列表 —— 坐实「合计 −15 天」的推断。
 *  复用 R1/R2 的通路：系统 Chrome（channel:"chrome"）+ playwright-core。 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";
import fs from "node:fs";

const BASE = process.env.WO3_BASE ?? "http://127.0.0.1:5294";
const OUT  = process.env.WO3_OUT ?? "/tmp/wt-ab/docs/evidence/WO3-R3-two-pert.txt";
const SHOT = process.env.WO3_SHOT ?? "/tmp/wt-ab/docs/evidence/WO3-R3-shot.png";
const DU = "demo:admin:admin|planner|catalog_admin";
const L = [];
const say = (s = "") => { L.push(s); console.log(s); };
const net = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, extraHTTPHeaders: { "x-debug-user": DU } });
const page = await ctx.newPage();
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/(a|b|api)\/v1\//.test(u)) return;
  let t = ""; try { t = (await r.text()).slice(0, 4000); } catch {}
  net.push({ status: r.status(), url: u, body: t });
});

say("## WO-3 R3 · 真机两扰动 · 完整记录扰动列表");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 登录态：看有没有 console0828 外壳（金丝雀）
const shell = await page.locator('[data-testid^="c0828"]').count();
say(`金丝雀① c0828 外壳节点数 = ${shell}  ${shell > 0 ? "✅" : "❌ 页面没起来"}`);

// 找扰动输入：优先用控制台自己的表单。若找不到就直连后端 API 建会话+扰动，
// 再让前端 attach —— 但 R1/R2 已证明前端能出钱，故此处走【后端建 + 前端读】不可行。
// ⇒ 改为：直接对后端 API 发两个扰动，再用前端 reload 读该会话。
const api = async (m, p, b) => {
  const r = await fetch("http://127.0.0.1:4052" + p, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, t };
};
const s = (await api("POST", "/a/v1/sim/sessions", {})).j;
const sid = s?.session?.id ?? s?.id;
say(`会话 ${sid}`);
// 两个扰动：−3 与 −12（若推断正确，合计 −15 ⇒ 屏上应 ≈1434.3 万元）
for (const m of [-3, -12]) {
  const r = await api("POST", `/a/v1/sim/sessions/${sid}/perturbations`, { kind: "demand_shift", targetObjectId: "obj_order_SO-3391", targetStateVar: "leadDays", mode: "delta", magnitude: m, startTick: 0, durationTicks: null, label: `真机两扰动 ${m}` });
  say(`  加扰动 ${m} ⇒ HTTP ${r.status}`);
}
// ★ 完整读回扰动列表（这是本次的目的）
const pl = await api("GET", `/a/v1/sim/sessions/${sid}/perturbations`);
const items = pl.j?.items ?? pl.j?.data?.items ?? [];
say("");
say("### 扰动列表（完整）");
say(`  条数 = ${items.length}`);
for (const x of items) say(`    ${x.id} | ${x.targetObjectId}.${x.targetStateVar} | mag=${x.magnitude} | startTick=${x.startTick} | mode=${x.mode}`);
const total = items.reduce((a, x) => a + (Number(x.magnitude) || 0), 0);
say(`  幅度合计 = ${total}`);
// 推演到位
for (let t = 0; t < 60; t++) await api("POST", `/a/v1/sim/sessions/${sid}/tick`, { n: 1 });
const p = (await api("POST", "/a/v1/solvers/finance_world_projection/invoke", { args: { worldId: sid } })).j;
const D = p?.data ?? p; const LL = Object.fromEntries((D?.lines ?? []).map((l) => [l.role, l.delta]));
say("");
say(`### API 侧读数（该会话）：COST = ${(LL.COST * 1e4).toFixed(2)} 万元`);
say(`  对照：真机 R2 屏上 1434.3 万元 / 单扰动 −3 天 = 286.86 万元`);
say("");

fs.writeFileSync(OUT, L.join("\n") + "\n");
await browser.close();
console.log(`WROTE ${OUT}`);
