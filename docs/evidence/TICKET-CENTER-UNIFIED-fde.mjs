#!/usr/bin/env node
/**
 * TICKET-CENTER-UNIFIED · FDE 真浏览器验收（真 datacore:14001 + agentcore:14002 + vite:15173·非 mock）。
 * 逐值对照后端 /b/v1/growth/board 与 /b/v1/growth/tickets/:id/detail 真值。
 */
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function findChromium() {
  for (const root of ["/opt/pw-browsers", "/root/.cache/ms-playwright", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1194/chrome-linux/chrome", "chromium-1148/chrome-linux/chrome"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
function loadChromiumApi() {
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}
const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) { console.error(`no chromium(${!!exe})/playwright-core(${!!chromium})`); process.exit(1); }

const BASE = "http://127.0.0.1:15173";
const B = "http://127.0.0.1:14002";
const EV = "/home/user/complete/.claude/worktrees/agent-a560ef525c2bb5492/docs/evidence";
mkdirSync(EV, { recursive: true });
const H = { "X-Debug-User": "fdetc2:__SUB__:admin|planner|catalog_admin", "Content-Type": "application/json" };
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log(`✓ ${msg}`); else { console.error(`✗ ${msg}`); failed++; } };

// ── 自播种：每次跑用全新租户（发育闭环从空世界真长出，幂等可重跑）。
const T = `fdetc${Date.now() % 1000000}`;
const A = "http://127.0.0.1:14001";
const PADMIN = { "X-Debug-User": "platform:root:platform_admin", "Content-Type": "application/json" };
const TADMIN = { "X-Debug-User": `${T}:user-fde:admin|planner|catalog_admin`, "Content-Type": "application/json" };
await fetch(`${A}/a/v1/tenants`, { method: "POST", headers: PADMIN, body: JSON.stringify({ key: T, name: "FDE 工单中心验收", industry: "battery-manufacturing" }) });
await fetch(`${A}/a/v1/tenants/${T}/users`, { method: "POST", headers: PADMIN, body: JSON.stringify({ email: "fde@tc.local", password: "demo1234", roles: ["admin", "planner", "catalog_admin"] }) });
await fetch(`${B}/b/v1/scenarios`, { headers: TADMIN }); // 懒播种场景包（per-tenant 幂等）
// 真诊断①：空租户 LOOP → NEEDS_HUMAN 登记 DATA_GAP(provisionWorld) 在办项。
const loop1 = await fetch(`${B}/b/v1/growth/run`, { method: "POST", headers: TADMIN, body: JSON.stringify({ packageId: `pkg_battery_manufacturing__${T}`, query: "常州影响哪些订单？", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2, confirmed: true }) }).then((r) => r.json());
console.log("loop1 terminal:", loop1.terminalState);
// 真诊断②：B3 越界新实体 + 人工数据描述 → HARD DataRequest 人工描述单。
const b3 = await fetch(`${B}/b/v1/growth/run`, { method: "POST", headers: TADMIN, body: JSON.stringify({ packageId: `pkg_battery_manufacturing__${T}`, query: "火星基地的产能如何？", context: { view: "dash", selectedObjects: [], filters: {} }, slotValues: { base: "火星基地" }, dataRequestDescription: "火星基地主数据：基地编码/名称/产线数/年产能GWh；值域=集团基地台账；样例：火星基地-4条线-12GWh" }) }).then((r) => r.json());
console.log("b3 outcome:", b3.boundaryGate?.outcome, "worklistItem:", b3.worklistItem?.id);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  // ── 登录（真 JWT 链路：新租户 / fde@tc.local / demo1234）
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#login-tenant", T);
  await page.fill("#login-username", "fde@tc.local");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  console.log("✓ 登录成功（真 JWT）");

  // ── 后端真值：Node 侧同账号真登录取 JWT（access 仅存内存·浏览器侧拿不到），API 逐值对照。
  const loginRes = await fetch("http://127.0.0.1:14001/a/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: T, username: "fde@tc.local", password: "demo1234" }),
  }).then((r) => r.json());
  const token = loginRes.accessToken ?? loginRes.access_token ?? loginRes.token;
  if (!token) { console.error("no token from login:", JSON.stringify(loginRes).slice(0, 200)); process.exit(1); }
  const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
  console.log("user sub =", sub);
  const apiGet = (path) => fetch(`${B}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

  const boardTruth = await apiGet("/b/v1/growth/board");
  console.log("backend board rows:", boardTruth.items.map((r) => [r.id, r.kind, r.status].join("|")));
  ok(boardTruth.items.length >= 2, `后端 board ≥2 行（实际 ${boardTruth.items.length}）`);
  const gapRow = boardTruth.items.find((r) => r.kind === "DATA_GAP");
  const reqRow = boardTruth.items.find((r) => r.kind === "DATA_REQUEST");
  ok(!!gapRow && !!reqRow, "后端含 DATA_GAP + DATA_REQUEST 两类");

  // ── ① 工单中心页：导航入册 + 聚合行逐值对照
  await page.goto(`${BASE}/admin/tickets`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="ticket-center-page"]', { timeout: 20000 });
  const navItem = await page.locator('nav >> text=工单中心').count();
  ok(navItem >= 1, "导航含「工单中心」入口");
  for (const r of boardTruth.items) {
    const rowSel = `[data-testid="tc-row-${r.id}"]`;
    await page.waitForSelector(rowSel, { timeout: 10000 });
    const rowText = await page.locator(rowSel).innerText();
    ok(rowText.includes(r.fromQuestion), `行 ${r.id} 问句逐值=「${r.fromQuestion}」`);
    ok(rowText.includes(r.gapCode), `行 ${r.id} 缺口码逐值=${r.gapCode}`);
    const statusText = await page.locator(`[data-testid="tc-status-${r.id}"]`).innerText();
    ok(statusText.trim() === r.status, `行 ${r.id} 状态逐值=${r.status}（前端「${statusText.trim()}」）`);
  }
  await page.screenshot({ path: `${EV}/TICKET-CENTER-01-board.png`, fullPage: true });

  // ── ③ 点行 → 详情抽屉：DATA_GAP（fillPlan provisionWorld + B2 结论）逐值对照 detail 端点
  const gapDetail = await apiGet(`/b/v1/growth/tickets/${gapRow.id}/detail`);
  await page.click(`[data-testid="tc-row-${gapRow.id}"]`);
  await page.waitForSelector('[data-testid="tc-drawer"]', { timeout: 10000 });
  const dq = await page.locator('[data-testid="tc-d-question"]').innerText();
  ok(dq.trim() === gapDetail.row.fromQuestion, `抽屉问句逐值=${gapDetail.row.fromQuestion}`);
  const dgap = await page.locator('[data-testid="tc-d-gapcode"]').innerText();
  ok(dgap.includes(gapDetail.row.gapCode), `抽屉缺口码逐值=${gapDetail.row.gapCode}`);
  const dfp = await page.locator('[data-testid="tc-d-fillplan"]').innerText();
  ok(dfp.includes(gapDetail.supply.fillPlan.action), `抽屉补法清单含 action=${gapDetail.supply.fillPlan.action}`);
  ok(dfp.includes(String(gapDetail.supply.fillPlan.seed ?? 42)), "抽屉补法清单含 seed（R6）");
  const dbd = await page.locator('[data-testid="tc-d-boundary"]').innerText();
  ok(dbd.includes(gapDetail.supply.boundary.gate), `抽屉边界闸=${gapDetail.supply.boundary.gate}`);
  const dtl = await page.locator('[data-testid="tc-d-timeline"]').innerText();
  ok(dtl.includes("登记（OPEN）"), "抽屉状态时间线呈现");
  await page.screenshot({ path: `${EV}/TICKET-CENTER-02-drawer-datagap.png`, fullPage: true });
  await page.click('[data-testid="tc-drawer-close"]');

  // ── DATA_REQUEST 抽屉：B3 结论 + descriptionSchema 字段清单逐值
  const reqDetail = await apiGet(`/b/v1/growth/tickets/${reqRow.id}/detail`);
  await page.click(`[data-testid="tc-row-${reqRow.id}"]`);
  await page.waitForSelector('[data-testid="tc-d-datarequest"]', { timeout: 10000 });
  const b3 = await page.locator('[data-testid="tc-d-boundary"]').innerText();
  ok(b3.includes("B3"), "抽屉 B3 越界闸结论呈现");
  for (const f of reqDetail.supply.dataRequest.descriptionSchema ?? []) {
    const cell = await page.locator(`[data-testid="tc-d-dr-field-${f.field}"]`).innerText();
    ok(cell.includes(f.hint), `descriptionSchema 字段「${f.field}」hint 逐值=${f.hint}`);
  }
  const desc = await page.locator('[data-testid="tc-d-dr-desc"]').innerText();
  ok(desc.includes(reqDetail.supply.dataRequest.description.slice(0, 12)), "人工描述逐值呈现");
  const dl = await page.locator('[data-testid="tc-d-deeplink"]').getAttribute("href");
  ok(dl === reqDetail.supply.deeplink, `导入深链逐值=${reqDetail.supply.deeplink}`);
  await page.screenshot({ path: `${EV}/TICKET-CENTER-03-drawer-datarequest.png`, fullPage: true });
  await page.click('[data-testid="tc-drawer-close"]');

  // ── ② 认领 → 默认落「我的在办」（跨类型聚合）
  await page.click(`[data-testid="tc-claim-${gapRow.id}"]`);
  await page.waitForSelector(`[data-testid="tc-status-${gapRow.id}"]`, { timeout: 15000 });
  const st = await page.locator(`[data-testid="tc-status-${gapRow.id}"]`).innerText();
  ok(st.trim() === "CLAIMED", "认领后状态=CLAIMED（我的在办 Tab 下可见）");
  const ownerCell = await page.locator(`[data-testid="tc-owner-${gapRow.id}"]`).innerText();
  const boardAfterClaim = await apiGet("/b/v1/growth/board");
  const claimed = boardAfterClaim.items.find((r) => r.id === gapRow.id);
  ok(claimed.status === "CLAIMED" && ownerCell.trim() === claimed.owner, `认领人前后端逐值=${claimed.owner}`);
  // 我的在办 Tab 下 DATA_REQUEST（未认领）不可见 → 真收窄
  ok((await page.locator(`[data-testid="tc-row-${reqRow.id}"]`).count()) === 0, "「我的在办」真收窄（未认领行不见）");
  await page.screenshot({ path: `${EV}/TICKET-CENTER-04-claimed-mine.png`, fullPage: true });

  // ── 触发补数据缺口（provisionWorld 真跑·R6 seed=42）→ DONE
  await page.click(`[data-testid="tc-fill-${gapRow.id}"]`);
  await page.waitForFunction((id) => {
    const el = document.querySelector(`[data-testid="tc-status-${id}"]`);
    return el === null || el.textContent.includes("DONE");
  }, gapRow.id, { timeout: 60000 });
  await page.click('[data-testid="tc-tab-done"]');
  await page.waitForSelector(`[data-testid="tc-row-${gapRow.id}"]`, { timeout: 10000 });
  const doneSt = await page.locator(`[data-testid="tc-status-${gapRow.id}"]`).innerText();
  ok(doneSt.trim() === "DONE", "触发补数据缺口 → DONE（已完成 Tab 可见）");
  const boardDone = await apiGet("/b/v1/growth/board");
  ok(boardDone.items.find((r) => r.id === gapRow.id).status === "DONE", "后端状态同步 DONE（前后端一致）");
  await page.screenshot({ path: `${EV}/TICKET-CENTER-05-filled-done.png`, fullPage: true });

  // ── 世界已 provision 后再跑一问（产 FEATURE 工单）→ 板上第三类 + 只读语义
  const runRes = await fetch(`${B}/b/v1/growth/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ packageId: `pkg_battery_manufacturing__${T}`, query: "给我一份通用统计报表", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2, confirmed: true }),
  }).then((r) => r.json());
  console.log("2nd run terminal:", runRes.terminalState, "openTickets:", (runRes.openTickets ?? []).length);
  const boardWithFeat = await apiGet("/b/v1/growth/board");
  const featRow = boardWithFeat.items.find((r) => r.kind === "FEATURE" || r.kind === "SOLVER_GAP" || r.kind === "PLAN_SCAFFOLD");
  ok(!!featRow, `第三类工单落板（kind=${featRow?.kind}·gtk_）`);
  if (featRow) {
    // 第三类工单由 API 侧新开（模拟他人/后台开单）→ 刷新页面拉新板（真拉取非缓存）。
    await page.goto(`${BASE}/admin/tickets`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="ticket-center-page"]', { timeout: 20000 });
    await page.click('[data-testid="tc-tab-all"]');
    await page.waitForSelector(`[data-testid="tc-row-${featRow.id}"]`, { timeout: 15000 });
    // kind-first 只读：无认领按钮
    ok((await page.locator(`[data-testid="tc-claim-${featRow.id}"]`).count()) === 0, "FEATURE 行无认领按钮（只读施工工单）");
    const featDetail = await apiGet(`/b/v1/growth/tickets/${featRow.id}/detail`);
    await page.click(`[data-testid="tc-row-${featRow.id}"]`);
    await page.waitForSelector('[data-testid="tc-d-iocontract"]', { timeout: 10000 });
    const io = await page.locator('[data-testid="tc-d-io-output"]').innerText();
    ok(featDetail.supply.ioContract.outputShape.every((k) => io.includes(k)), `FEATURE 抽屉 outputShape 逐值=${featDetail.supply.ioContract.outputShape.join(",")}`);
    const acc = await page.locator('[data-testid="tc-d-acceptance"]').innerText();
    ok(acc.includes(featDetail.supply.acceptance.slice(0, 16)), "FEATURE 抽屉验收线索逐值呈现");
    await page.screenshot({ path: `${EV}/TICKET-CENTER-06-feature-drawer.png`, fullPage: true });
    await page.click('[data-testid="tc-drawer-close"]');
    await page.screenshot({ path: `${EV}/TICKET-CENTER-07-board-3kinds.png`, fullPage: true });
  }

  console.log(failed === 0 ? "\nALL PASS" : `\nFAILED: ${failed}`);
} finally {
  await browser.close();
}
process.exit(failed === 0 ? 0 : 1);
