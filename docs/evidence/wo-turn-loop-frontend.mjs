/* eslint-disable */
/**
 * WO-TURN-LOOP · 前端判据：tick×1 vs tick×3，**同屏同读数**两个值 + 两张截图。
 * 从登录走起（⛔ 不手敲 URL —— 手敲会让「找不到入口」这类问题整个消失）。真后端 4001/4002，⛔ 无 VITE_MOCK。
 *
 * ⚠ 本脚本踩过的三个量法坑，写这防复发（都是「我用 X 当作 Y 的证据，而 X 并不度量 Y」）：
 *  ① 按候选表顺序点「含沙盘|推演」的第一项 ⇒ 撞进「推演指控台」（另一个页面），
 *     控件全找不到。必须 `getByText("推演沙盘", {exact:true})`。
 *  ② 读数全 null 就报「tick×1 与 tick×3 屏上一模一样」——**错**。实测那是
 *     `sandbox-impact-finance-no-session`（会话还没建好）在渲染，不是"两次相同"。
 *     ⇒ 报"相同"之前**必须先证明读到了非空值**（下面 waitWorld 就是这道闸）。
 *  ③ 落点下拉是**窗口化**的（只渲染前若干条），直接 selectOption 找不到 `pos_ncm`。
 *     必须先往 `sandbox-perturbation-object-filter` 里打字过滤。
 */
import { chromium } from "playwright";
import fs from "node:fs";

const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const P = (n) => `${SHOT}/turnloop-fe-${n}.png`;
const log = [];
const say = (s) => { console.log(s); log.push(s); };
let clicks = 0;
const click = async (loc, what) => { await loc.click({ timeout: 20000 }); clicks++; say(`   [点击#${clicks}] ${what}`); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 2200, height: 1200 } });
/** 财务带单独出一张元素截图 —— 整屏图里右栏被挤成竖排单字，读数看不清。 */
const shotBand = async (n) => {
  const el = pg.locator('[data-testid="sandbox-impact-finance"]');
  if (await el.count()) { await el.screenshot({ path: P(n) }); say(`   元素截图 turnloop-fe-${n}.png（财务带特写）`); }
};
const hosts = new Map();
pg.on("request", (r) => {
  const u = new URL(r.url());
  if (/^\/(a|b|api)\/v1/.test(u.pathname)) hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
});

say("① 打开应用根（不敲深链）");
await pg.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await pg.screenshot({ path: P("01-login") });
say(`   turnloop-fe-01-login.png · 标题=${await pg.title()}`);

say("② 登录 demo / admin / demo1234");
await pg.fill("#login-tenant", "demo");
await pg.fill("#login-username", "admin");
await pg.fill("#login-password", "demo1234");
await click(pg.locator('button[type="submit"]'), "登录");
await pg.waitForTimeout(3000);
await pg.screenshot({ path: P("02-after-login") });
say(`   登录后 URL=${pg.url()} · turnloop-fe-02-after-login.png`);

say("③ 导航进推演沙盘（不手敲 URL）");
await click(pg.getByText("推演沙盘", { exact: true }).first(), "左侧导航「推演沙盘」");
await pg.waitForTimeout(3000);
say(`   ⇒ ${pg.url()}`);

// ── 闸：等世界真建好。⛔ 没等到就**不许**报任何「相同/不同」结论 ─────────────────
say("④ 等沙盘自动建世界（配置就绪后才建；没建好时屏上是 no-session，读数恒 null）");
let ready = false;
for (let i = 0; i < 60; i++) {
  if ((await pg.locator('[data-testid="sandbox-impact-finance-worldstate"]').count()) > 0) { ready = true; say(`   世界就绪（等了约 ${i * 2}s）`); break; }
  await pg.waitForTimeout(2000);
}
if (!ready) { say("⛔ 世界始终没建好 ⇒ 量法未就位，停止报结论"); fs.writeFileSync(`${SHOT}/turnloop-fe-report.txt`, log.join("\n")); await b.close(); process.exit(2); }
await pg.screenshot({ path: P("03-sandbox") });

// ── 读数取法 ────────────────────────────────────────────────────────────────────
const readAll = async () => {
  const grab = async (sel) => (await pg.locator(sel).count()) ? (await pg.locator(sel).first().innerText()).replace(/\s+/g, " ").trim() : null;
  const body = (await pg.locator("body").innerText()).replace(/\s+/g, " ");
  return {
    tickOnScreen: (body.match(/全局态 · tick (\d+)/) ?? [])[1] ?? null, // 顶栏那条，屏上唯一写着拍号的地方
    worldstate: await grab('[data-testid="sandbox-impact-finance-worldstate"]'),
    pressures: await grab('[data-testid="sandbox-impact-finance-pressures"]'),
    lines: await grab('[data-testid="sandbox-impact-finance-lines"]'),
    money: await grab('[data-testid="sandbox-impact-finance-money"]'),
    _body: body,
  };
};

// ── ⑤ 施加扰动（全走界面控件）─────────────────────────────────────────────────────
say("⑤ 施加扰动（界面控件）");
const bar = pg.locator('[data-testid="sandbox-config-bar"]');
if ((await bar.getAttribute("aria-expanded")) !== "true") { await click(bar, "「展开配置 ▾」"); await pg.waitForTimeout(1500); }
const pick = async (tid, re, what) => {
  const s = pg.locator(`[data-testid="${tid}"]`);
  const opts = await s.locator("option").allTextContents();
  const vals = await s.locator("option").evaluateAll((os) => os.map((o) => o.value));
  let i = opts.findIndex((o) => re.test(o)); if (i < 0) i = vals.findIndex((v) => re.test(v));
  if (i < 0) { say(`   ⚠ ${what} 没有匹配项（前6：${JSON.stringify(opts.slice(0, 6))}）`); return false; }
  await s.selectOption(vals[i]); await pg.waitForTimeout(800); say(`   [选择] ${what} = ${opts[i]}`); return true;
};
await pick("sandbox-perturbation-kind", /cost|成本/i, "扰动类型");
// 落点下拉是窗口化的 ⇒ 先用过滤框把目标捞进窗口，再选。
// ⚠ 过滤串要写全 `obj_material_pos_ncm`：只写 `pos_ncm` 会先命中
//   `CarbonFactor · obj_carbonfactor_cf_pos_ncm` —— 那个落点**不是任何传导规则的端点**
//   （屏上原话：「扰动它不会沿本体链路扩散，下游读数一格都不会动」），
//   拿它去测「回合看不看得见」必然测出"没动"，而那是选错了落点，不是回合没接上。
await pg.locator('[data-testid="sandbox-perturbation-object-filter"]').fill("obj_material_pos_ncm");
await pg.waitForTimeout(1500);
say("   [输入] 落点过滤框 = obj_material_pos_ncm");
await pick("sandbox-perturbation-object", /^Material · obj_material_pos_ncm$/i, "落点对象");
await pick("sandbox-perturbation-statevar", /priceShock|价格/i, "量纲");
await pg.locator('[data-testid="sandbox-perturbation-magnitude"]').fill("20");
say("   [输入] 幅度 = 20");
// ⚠ 必须按 testid 取「施加扰动」按钮：`button:has-text("施加扰动")` 会先命中**顶栏 stepper
//   的第 ② 段（也叫「施加扰动」）** —— 点它只是切了个阶段，扰动一条都没施加，
//   而屏上「已施加 0 条」是唯一会说话的地方。故下面用 applied 计数当金丝雀。
const appliedBefore = await pg.locator('[data-testid="sandbox-config-bar-applied"]').innerText();
await click(pg.locator('[data-testid="sandbox-perturbation-apply-btn"]'), "「施加扰动」(apply-btn)");
await pg.waitForTimeout(4500);
const appliedAfter = await pg.locator('[data-testid="sandbox-config-bar-applied"]').innerText();
say(`   🐤 金丝雀·已施加条数 ${appliedBefore} → ${appliedAfter}  ${appliedBefore === appliedAfter ? "⚠ 没变 ⇒ 扰动没真施加" : "✅ 真施加了"}`);
// 收起配置面板 + 切到第 ④ 段「影响带读数」——财务带被分段闸 `upto(4)` 关着，不切就永远不渲染。
if ((await bar.getAttribute("aria-expanded")) === "true") { await click(bar, "「收起 ▴」"); await pg.waitForTimeout(1200); }
await click(pg.locator('[data-testid="sb-steps-step-4"]'), "stepper ④「影响带读数」");
await pg.waitForTimeout(4000);
await pg.locator('[data-testid="sandbox-impact-band"]').scrollIntoViewIfNeeded().catch(() => {});
await pg.waitForTimeout(1000);
await pg.screenshot({ path: P("04-perturbed") });
const r0 = await readAll();
say(`   [施加后·tick0] 屏上 tick=${r0.tickOnScreen} · worldstate=${r0.worldstate}`);

// ── ⑥⑦ tick×1 → tick×3 ─────────────────────────────────────────────────────────
const tick = async (n) => {
  for (let i = 0; i < n; i++) {
    await click(pg.locator('[data-testid="sandbox-tick-btn"]'), "「推进 tick」");
    await pg.waitForTimeout(4500);
  }
  // 推进 tick 会把 stepper 顶回第 ③ 段 ⇒ 每次读数前重新切回 ④，否则财务带不渲染。
  const s4 = pg.locator('[data-testid="sb-steps-step-4"]');
  if ((await s4.getAttribute("aria-current")) !== "step") { await click(s4, "stepper ④「影响带读数」"); await pg.waitForTimeout(3500); }
  await pg.locator('[data-testid="sandbox-impact-band"]').scrollIntoViewIfNeeded().catch(() => {});
  await pg.waitForTimeout(1200);
};

say("⑥ 推进 tick ×1，读同一读数");
await tick(1); await pg.waitForTimeout(3000);
const r1 = await readAll();
await pg.screenshot({ path: P("05-tick1") }); await shotBand("05b-tick1-band");
say(`   [tick×1] 屏上 tick = ${r1.tickOnScreen}`);
say(`   [tick×1] worldstate = ${r1.worldstate}`);
say(`   [tick×1] pressures  = ${(r1.pressures || "").slice(0, 260)}`);
say(`   [tick×1] lines      = ${(r1.lines || "").slice(0, 260)}`);

say("⑦ 再推进 2 拍（累计 tick×3），读同一读数");
await tick(2); await pg.waitForTimeout(3000);
const r3 = await readAll();
await pg.screenshot({ path: P("06-tick3") }); await shotBand("06b-tick3-band");
say(`   [tick×3] 屏上 tick = ${r3.tickOnScreen}`);
say(`   [tick×3] worldstate = ${r3.worldstate}`);
say(`   [tick×3] pressures  = ${(r3.pressures || "").slice(0, 260)}`);
say(`   [tick×3] lines      = ${(r3.lines || "").slice(0, 260)}`);

// ── ⑧ 判据 ─────────────────────────────────────────────────────────────────────
say("\n══ 前端判据（同屏同读数两个值）══");
for (const k of ["tickOnScreen", "worldstate", "pressures", "lines", "money"]) {
  if (r1[k] == null && r3[k] == null) { say(`  ${k}: ⚠ 两次都读不到 ⇒ 量法坏了，此项不作结论`); continue; }
  say(`  ${k}: ${r1[k] === r3[k] ? "❌ 两次一模一样" : "✅ 两个值不同（屏上看得见推进）"}`);
}

// 「第 N 回合」这个概念屏上有没有（本单要害问题之一）
const turnWords = ["回合", "逐拍", "轨迹", "峰值", "上一拍", "累积", "第 3 拍", "拐点"];
say(`\n  屏上「回合」类词命中: ${JSON.stringify(turnWords.filter((w) => r3._body.includes(w)))}`);
say(`  金丝雀（确认在读真页面）: 含"tick"=${r3._body.includes("tick")} 含"沙盘"=${r3._body.includes("沙盘")} 正文长度=${r3._body.length}`);
say(`  传导轴 stepper 四段是否在屏: ${["会话与配置", "施加扰动", "世界传播", "影响带读数"].filter((w) => r3._body.includes(w)).join(" → ")}`);
say(`\n  总点击数 = ${clicks}`);
say(`  网络里连到的后端 host: ${JSON.stringify([...hosts.entries()])}`);
say(`  ⛔VITE_MOCK 判据：msw 请求数 = ${await pg.evaluate(() => performance.getEntriesByType("resource").filter((r) => /mockServiceWorker|msw/i.test(r.name)).length)}`);

fs.writeFileSync(`${SHOT}/turnloop-fe-report.txt`, log.join("\n"));
await b.close();
