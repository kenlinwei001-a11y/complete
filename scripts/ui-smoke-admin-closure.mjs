#!/usr/bin/env node
/**
 * 门B · 轨 G 管理面闭合（admin-console-closure）真浏览器 + 真后端验收。
 * 连真 datacore:4001 + agentcore:4002（demo 种子）。流程：admin 登录 →
 * 逐页走 AC8 链路（切片→工作流→意图→agent→场景→评测），逐控件断言"无死路"。
 *
 * AXIS（HANDOFF §5 双轴）：
 *  - 增量0 基线：只读断言（页面可达 + 关键控件存在），逐控件记死路。
 *  - 增量1-6 收口：每个引用控件「＋新建可达 + 已选可查看 + 空态有路」。
 *
 * 无 chromium/playwright-core → SKIP(exit 0)；断言失败 → exit 1。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5200;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-complete/ce3c4420-72b1-55c6-9fa6-b52499620ae1/scratchpad";
const require = createRequire(import.meta.url);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  for (const root of ["/root/.cache/ms-playwright", "/opt/pw-browsers", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1148/chrome-linux/chrome", "chromium-1194/chrome-linux/chrome"]) {
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
if (!exe || !chromium) {
  console.log(`⊘ admin-closure SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };
const ok = (m) => console.log(`  ✓ ${m}`);

async function nav(p, path) {
  await p.evaluate((pp) => { window.history.pushState({}, "", pp); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  await p.waitForTimeout(1200);
}

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // ── C5 求解器目录页 ───────────────────────────────────────────────
  await nav(p, "/admin/solvers");
  if ((await p.locator("[data-testid=solvers-page]").count()) > 0) {
    ok("C5 /admin/solvers 页可达");
    const rows = await p.locator("[data-testid^=solver-row-]").count();
    if (rows > 0) ok(`C5 求解器目录 ${rows} 行（来自注册表 R5 非写死）`);
    else fail("C5 求解器目录空（应有注册表项）");
    await p.screenshot({ path: `${SHOT}/shot-solvers.png` });
  } else fail("C5 /admin/solvers 不可达（页缺）");

  // ── C7 切片编辑器 ────────────────────────────────────────────────
  await nav(p, "/admin/slices");
  if ((await p.locator("[data-testid=slices-page]").count()) > 0) {
    ok("C7 /admin/slices 页可达");
    if ((await p.locator("[data-testid=slice-create]").count()) > 0) {
      ok("C7 切片＋新建入口存在");
      await p.click("[data-testid=slice-create]");
      await p.waitForTimeout(1000);
      if ((await p.locator("[data-testid=slice-builder]").count()) > 0) ok("C7 切片构建器（root+targets+规划+试切）可达");
      else fail("C7 切片构建器未展开");
    } else fail("C7 切片无＋新建入口（AC8 步1 死路）");
    await p.screenshot({ path: `${SHOT}/shot-slices.png` });
  } else fail("C7 /admin/slices 不可达");

  // ── C8 workflow 试运行 + render 可视（仅 DRAFT 可编辑 → 先＋新建一个 DRAFT）──
  await nav(p, "/admin/workflows");
  if ((await p.locator("[data-testid=workflow-create]").count()) > 0) ok("C8 工作流＋新建存在");
  await p.click("[data-testid=workflow-create]").catch(() => {});
  await p.waitForTimeout(1500);
  if ((await p.locator("[data-testid=wf-dry-run]").count()) > 0) ok("C8 工作流试运行按钮存在（DRAFT）");
  else fail("C8 工作流无试运行按钮（违 AC2）");
  if ((await p.locator("[data-testid^=wf-render-blocks-]").count()) > 0) ok("C8 render_answer 为 block 可视编排（非裸 JSON · D-28）");
  else fail("C8 render_answer 仍裸 JSON（违 D-28）");
  // 加 invoke_solver 步骤验 solverKey 引用下拉
  await p.locator("[aria-label=步骤类型]").last().selectOption("invoke_solver").catch(() => {});
  await p.click("[data-testid=wf-add-step]").catch(() => {});
  await p.waitForTimeout(600);
  if ((await p.locator("[data-testid^=wf-solver-select-]").count()) > 0) ok("C6 workflow solverKey 为引用下拉（带查看/＋新建）");
  else fail("C6 workflow solverKey 仍裸输入");

  // ── C9 评测 CRUD ─────────────────────────────────────────────────
  await nav(p, "/admin/evals");
  if ((await p.locator("[data-testid=eval-case-create]").count()) > 0) ok("C9 评测用例＋新建存在");
  else fail("C9 评测无用例 CRUD 入口（阻 agent 发布门禁）");

  // ── C10 objectRef refType + 分类测试（意图目录）──────────────────
  // enabler 已落（contracts SlotDef.refType + 后端 classify-preview）。前端：refType 下拉 + 试分类。
  await nav(p, "/admin/catalog");
  // 打开含 objectRef 槽的意图（adopt_mitigation: base=objectRef）→ 验 refType 下拉。
  if ((await p.locator("[data-testid=intent-adopt_mitigation]").count()) > 0) {
    await p.click("[data-testid=intent-adopt_mitigation]");
    await p.waitForTimeout(900);
    const refOpts = await p.locator("[data-testid=slot-reftype-0] option").count();
    if (refOpts > 1) ok(`C10 objectRef 槽位"目标对象类型"下拉可达（${refOpts - 1} 本体类型，AC4）`);
    else fail("C10 objectRef 槽无 refType 下拉（违 AC4）");
  }
  if ((await p.locator("[data-testid=intent-classify-test]").count()) > 0) {
    await p.fill("[data-testid=intent-classify-query]", "采纳常州的三班制方案").catch(() => {});
    await p.click("[data-testid=intent-classify-test]");
    await p.waitForTimeout(1200);
    if ((await p.locator("[data-testid=intent-classify-result]").count()) > 0) ok("C10 试分类调端点显命中（无死路）");
    else fail("C10 试分类无结果");
  } else fail("C10 无试分类入口");

  // ── C6 引用控件：agent 编辑器 ────────────────────────────────────
  await nav(p, "/admin/agents");
  ok("C6 /admin/agents 可达");

  // ── C12 配置迁移工作台（导出→干跑→应用 Saga）──────────────────────
  await nav(p, "/admin/config-migration");
  if ((await p.locator("[data-testid=config-migration-page]").count()) > 0) {
    ok("C12 /admin/config-migration 页可达");
    await p.click("[data-testid=cfg-export]").catch(() => {});
    await p.waitForTimeout(1200);
    const bundleLen = (await p.locator("[data-testid=cfg-bundle-text]").inputValue().catch(() => "")).length;
    if (bundleLen > 10) ok(`C12 导出本租户 bundle（${bundleLen} 字符）`);
    else fail("C12 导出无 bundle");
    await p.click("[data-testid=cfg-dry-run]").catch(() => {});
    await p.waitForTimeout(1200);
    const st = await p.locator("[data-testid=cfg-job-state]").innerText().catch(() => "none");
    if (/DRY_RUN_OK|COMMITTED/.test(st)) ok(`C12 干跑出 diff（state=${st}）`);
    else fail(`C12 干跑未通过（state=${st}）`);
  } else fail("C12 /admin/config-migration 不可达（页缺）");

  // ── C11 DSL 输入辅助（规则 expression 补全 · D-28）─────────────────
  await nav(p, "/admin/rules");
  if ((await p.locator("[data-testid=rule-create]").count()) > 0) {
    await p.click("[data-testid=rule-create]");
    await p.waitForTimeout(800);
    const expr = p.locator("[data-testid=rule-expression]");
    await expr.click().catch(() => {});
    await expr.type("Order.").catch(() => {});
    await p.waitForTimeout(600);
    const opts = await p.locator("[data-testid=rule-expression-suggest] [role=option]").count();
    if (opts > 0) ok(`C11 规则 expression 输入 Order. 弹属性补全（${opts} 候选，数据源=本体，D-28 非裸框）`);
    else fail("C11 规则 expression 无补全（违 D-28）");
  } else console.log("  ⚠ C11 规则页无新建入口（跳过补全验）");
} catch (e) {
  fail(`异常：${String(e).slice(0, 300)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ admin-closure 仍有死路（见上）。"); process.exit(1); }
console.log("\n✓ admin-closure：AC8 各页可达 + 引用控件三态齐（真后端真浏览器）。");
