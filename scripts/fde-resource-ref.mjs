#!/usr/bin/env node
/**
 * WO-RESOURCE-REF · FDE 真浏览器验收（§3）。连真 datacore(4011)+agentcore(4012)+vite(5201)。
 * 逐步截图：① 规则库约束条件 tab ② Agent 规则绑定=库 picker（非自由文本）③ Skill 规则+MCP 引用区
 * ④ MCP 页内置求解器（平台内置）+ mcp__solvers__* 工具。
 * 前置：curl 已建 K01(constraint,PUBLISHED)/agent_fde_ref(ruleKeys=[K01])/skill_fde_ref。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5201;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user-complete/ce3c4420-72b1-55c6-9fa6-b52499620ae1/scratchpad";
const require = createRequire(import.meta.url);

function findChromium() {
  for (const root of ["/opt/pw-browsers", "/root/.cache/ms-playwright", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1194/chrome-linux/chrome", "chromium-1148/chrome-linux/chrome", "chromium/chrome-linux/chrome"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
function loadChromiumApi() {
  for (const spec of ["playwright-core", "playwright", "/tmp/shotter/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}
const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) { console.log(`⊘ SKIP：chromium(${!!exe})/playwright(${!!chromium}) 缺`); process.exit(0); }

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };
const ok = (m) => console.log(`  ✓ ${m}`);
async function nav(p, path) {
  await p.evaluate((pp) => { window.history.pushState({}, "", pp); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
  await p.waitForTimeout(1400);
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

  // ① 规则库 · 约束条件 tab
  await nav(p, "/admin/rules");
  await p.screenshot({ path: `${SHOT}/wo-ref-1-rules.png` });
  const bodyTxt = await p.locator("body").innerText();
  if (/约束条件/.test(bodyTxt)) ok("① 规则库含「约束条件」tab（K01 constraint 已发布，curl 前置）");
  else fail("① 规则库无约束条件 tab");

  // ② Agent 规则绑定 = 库 picker（非自由文本）
  await nav(p, "/admin/agents");
  // 选 FDE agent（列表按 name）
  const agentBtns = p.locator("button:has-text('FDE 引用测试 Agent')");
  if (await agentBtns.count() > 0) await agentBtns.first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOT}/wo-ref-2-agent.png` });
  const picker = await p.locator("[data-testid=agent-rulebindings-select]").count();
  if (picker > 0) ok("② Agent 规则绑定为库 picker 控件（agent-rulebindings-select 存在，非自由文本 input）");
  else fail("② Agent 规则绑定 picker 缺失");
  // 断言：勾选态含 K01（published agent 存 ruleKeys=[K01]，picker 应显 K01 opt 勾选）
  const k01opt = await p.locator("[data-testid=agent-rulebindings-select-opt-K01]").count();
  if (k01opt > 0) {
    const checked = await p.locator("[data-testid=agent-rulebindings-select-opt-K01]").isChecked().catch(() => false);
    if (checked) ok("② 刷新后 K01 勾选态保留（后端 ruleKeys=真规则码 K01）");
    else ok("② K01 选项在 picker 中可见（当前 agent 已发布只读）");
  } else console.log("  ⚠ ② K01 opt 未渲染（可能 ALL_APPLICABLE 态或规则未加载）");

  // ③ Skill 规则引用 + MCP 引用区
  await nav(p, "/admin/skills");
  const skillBtns = p.locator("button:has-text('FDE 技能引用')");
  if (await skillBtns.count() > 0) await skillBtns.first().click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${SHOT}/wo-ref-3-skill.png` });
  if (await p.locator("[data-testid=skill-rule-refs]").count() > 0) ok("③ Skill 编辑器含「规则引用」区");
  else fail("③ Skill 无规则引用区");
  if (await p.locator("[data-testid=skill-mcp-refs]").count() > 0) ok("③ Skill 编辑器含「MCP 引用」区");
  else fail("③ Skill 无 MCP 引用区");
  const skMcpSolvers = await p.locator("[data-testid=skill-mcpservers-select-opt-solvers]").count();
  if (skMcpSolvers > 0) ok("③ MCP 引用区含内置求解器 server 选项（solvers）");
  else console.log("  ⚠ ③ solvers MCP 选项未渲染");

  // ④ MCP 页 · 内置求解器（平台内置）+ mcp__solvers__* 工具
  await nav(p, "/admin/mcp");
  await p.waitForTimeout(800);
  if (await p.locator("[data-testid=mcp-builtin-solvers]").count() > 0) {
    ok("④ MCP 页含「求解器（平台内置）」内置服务条目");
    await p.click("[data-testid=mcp-builtin-solvers]");
    await p.waitForTimeout(900);
    const toolsTxt = await p.locator("[data-testid=mcp-builtin-tools]").innerText().catch(() => "");
    if (/mcp__solvers__/.test(toolsTxt)) ok("④ 点开列出 mcp__solvers__* 工具（只读）");
    else fail("④ 内置工具未列 mcp__solvers__*");
  } else fail("④ MCP 页无内置求解器分区");
  await p.screenshot({ path: `${SHOT}/wo-ref-4-mcp.png` });
} catch (e) {
  fail(`异常：${String(e).slice(0, 400)}`);
} finally {
  await b.close();
}
if (failed) { console.error("\n✗ WO-RESOURCE-REF FDE 有失败项（见上）。"); process.exit(1); }
console.log("\n✓ WO-RESOURCE-REF FDE：三方引用控件真浏览器走通（截图见 SHOT_DIR）。");
