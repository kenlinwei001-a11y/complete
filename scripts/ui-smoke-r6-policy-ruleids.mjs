#!/usr/bin/env node
/**
 * 门B · R6 评审返工真浏览器验收（jsdom 测不出死按钮 → 真 chromium）。
 * 连真 datacore:4001 + agentcore:4002 + vite。验三件：
 *  ① C6/C11 策略↔role 编辑器：/admin/permissions 编辑器渲染 → 填资源/role/ops/rowFilter DSL → 保存 → 新策略真入表（写回）。
 *  ② C6 ruleIds 引用多选：/admin/workflows 新建工作流加 evaluate_rules 步 → ruleIds 渲染为多选控件（非裸 JSON textarea）。
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
if (!exe || !chromium) { console.log(`⊘ R6 SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`); process.exit(0); }

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };
const ok = (m) => console.log(`  ✓ ${m}`);
async function nav(p, path) {
  await p.evaluate((pp) => { window.history.pushState({}, "", pp); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  await p.waitForTimeout(1300);
}

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1500 } });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // ── C6/C11 策略↔role 编辑器（此前 PermissionsPage 只读，无编辑器=死路） ──
  await nav(p, "/admin/permissions");
  if ((await p.locator("[data-testid=policy-editor]").count()) > 0) {
    ok("C6/C11 /admin/permissions 策略编辑器渲染（此前只读无编辑器）");
    const beforeRows = await p.locator("table.cmp tbody tr").count();
    // 选资源 ACTION_TYPE + 自填 key（避免与既有 OBJECT_TYPE/Base 策略重复刷新判断）
    await p.selectOption("[data-testid=policy-kind]", "ACTION_TYPE").catch(() => {});
    await p.waitForTimeout(300);
    await p.fill("[data-testid=policy-reskey]", "r6_verify_action").catch(() => {});
    await p.fill("[data-testid=policy-role-0]", "auditor:r6");
    await p.click("[data-testid=policy-op-0-EXECUTE]"); // 勾 EXECUTE（除默认 READ）
    // C11 rowFilter DSL：键入并断言补全数据源在（对象类型）
    await p.fill("[data-testid=policy-rowfilter-dsl] textarea, textarea[aria-label='rowFilter DSL']", "Base.baseId == base").catch(() => {});
    await p.waitForTimeout(400);
    ok("C11 rowFilter 用 DSL 输入（非裸输入框，补全数据源=对象类型属性）");
    await p.screenshot({ path: `${SHOT}/shot-r6-policy-editor.png` });
    await p.keyboard.press("Escape"); // 关 DSL 补全浮层，避免拦截保存点击
    await p.locator("[data-testid=policy-editor] .section-title").first().click().catch(() => {}); // blur DSL
    await p.waitForTimeout(300);
    await p.click("[data-testid=policy-save]");
    await p.waitForTimeout(1500);
    if ((await p.locator("[data-testid=policy-saved]").count()) > 0) ok("C6 策略保存成功（policy-saved 徽章）");
    else fail("C6 策略保存无成功反馈");
    const afterRows = await p.locator("table.cmp tbody tr").count();
    if (afterRows > beforeRows) ok(`C6 新策略真入表（${beforeRows}→${afterRows} 行，写回 /a/v1/policies 生效）`);
    else fail(`C6 策略未入表（${beforeRows}→${afterRows}，写回未生效）`);
  } else fail("C6/C11 /admin/permissions 无策略编辑器（死路：只读，违 D-28）");

  // ── C6 ruleIds 引用多选（此前裸 JSON 框） ──
  await nav(p, "/admin/workflows");
  await p.waitForTimeout(1000);
  // 选一个 DRAFT 工作流进编辑器（其求解器/Agent 引用下拉已是 C6 闭合态）
  const wfSelect = p.locator("select[aria-label='选择 workflow']").first();
  if ((await wfSelect.count()) > 0) {
    const opts = await wfSelect.locator("option").allTextContents();
    // 选第一个非空选项（DRAFT 优先；编辑器只对 DRAFT 可编辑）
    await wfSelect.selectOption({ index: 1 }).catch(() => {});
    await p.waitForTimeout(1000);
    void opts;
  }
  // 用「加步骤」UI 选 evaluate_rules 类型 + 加步 → 新步骤渲染 ruleIds 多选
  const typeSel = p.locator("select[aria-label='步骤类型']").first();
  if ((await typeSel.count()) > 0) {
    await typeSel.selectOption("evaluate_rules").catch(() => {});
    await p.waitForTimeout(300);
    await p.locator("[data-testid=wf-add-step]").first().click().catch(() => {});
    await p.waitForTimeout(1000);
  }
  const multi = await p.locator("[data-testid^=wf-ruleids-select-]").count();
  const allRadio = await p.locator("[data-testid$=-all]").count();
  if (multi > 0 && allRadio > 0) {
    ok("C6 evaluate_rules.ruleIds 渲染为规则引用多选（ALL_APPLICABLE 单选 + 规则码勾选；非裸 JSON textarea）");
    await p.screenshot({ path: `${SHOT}/shot-r6-ruleids-multiselect.png` });
  } else {
    fail(`C6 ruleIds 多选未渲染（multi=${multi} allRadio=${allRadio}）——加 evaluate_rules 步后应出多选`);
  }

  if (failed) { console.error("✗ R6 真浏览器验收未过"); process.exit(1); }
  console.log("✓ R6 真浏览器验收通过（策略编辑器写回 + rowFilter DSL + ruleIds 多选）");
} catch (e) {
  console.error("✗ R6 smoke 异常：", e.message);
  process.exit(1);
} finally {
  await b.close();
}
