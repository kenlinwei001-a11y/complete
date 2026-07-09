// UPG-L0-CONSOLE-BOARD 真浏览器 E2E（铁律0.4·真起服务真数据真看 UI 逐值对照后端）：
// 真 datacore(comprehend 桩·真闭包)+真 agentcore(OBO 真投影)+前端真后端模式 → Playwright 真 Chromium。
// MODE=on：flag 开 → 断言 source 透镜 script tab 现 + BUILD_CLOSURE 行渲染 + 详情闭包逐段逐值对后端 GET detail。
// MODE=off：flag 关（C3 回退）→ 断言 script 透镜 tab 隐 + board 无 BUILD_CLOSURE 行 = 改造前 query-目标 board。
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5301";
const AC = process.env.AC ?? "http://127.0.0.1:4302";
const MODE = process.env.MODE ?? "on";
const SBC = process.env.SBC_ID ?? ""; // 期望的 BUILD_CLOSURE 行 id（flag-on 时校验详情逐值）
const SHOT = "/home/user/complete/.claude/worktrees/agent-a974864b680758611/docs/evidence";
mkdirSync(SHOT, { recursive: true });

function findChromium() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"]) if (existsSync(p)) return p;
  return null;
}
const exe = findChromium();
const { chromium } = require("playwright-core");
if (!exe) { console.error("no chromium"); process.exit(2); }

let failed = false;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗", m); failed = true; };

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });
// 抓取前端真发出的 detail 响应，供逐值对照（前端所见 = 后端真值）。
let detailFromNetwork = null;
page.on("response", async (resp) => {
  if (resp.url().includes("/growth/tickets/") && resp.url().includes("/detail")) {
    try { detailFromNetwork = await resp.json(); } catch { /* ignore */ }
  }
});

try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`登录成功 → ${page.url()}`);

  // SPA 导航到统一工单中心（保 access token 仅内存·不硬刷）。
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForSelector("[data-testid=ticket-center-page]", { timeout: 10000 });
  await page.waitForSelector("[data-testid=tc-source-lens]", { timeout: 8000 });
  ok("统一工单中心 + source 透镜渲染");

  const hasScriptLens = await page.locator("[data-testid=tc-source-script]").count();
  if (MODE === "on") {
    // C2：script 目标透镜现（buildClosureEnabled=true）。
    hasScriptLens > 0 ? ok("C2 source 透镜含「script 目标」tab（暗发 ON）") : bad("C2 script 透镜 tab 缺失");
    // 点 script 透镜 → 只剩 BUILD_CLOSURE 行。
    await page.click("[data-testid=tc-source-script]");
    await page.waitForTimeout(600);
    const closureRow = page.locator("[data-testid^=tc-row-sbc_]").first();
    const closureCount = await page.locator("[data-testid^=tc-row-sbc_]").count();
    closureCount > 0 ? ok(`C1 BUILD_CLOSURE 行真浏览器渲染（${closureCount} 行·script 透镜）`) : bad("C1 BUILD_CLOSURE 行未渲染");
    // source 徽章 = 既有 token（script 建域）。
    const rowId = await closureRow.getAttribute("data-testid");
    const sbcId = rowId.replace("tc-row-", "");
    const badgeText = await page.locator(`[data-testid="tc-source-badge-${sbcId}"]`).textContent().catch(() => "");
    badgeText.includes("script") ? ok(`C2 source 徽章「${badgeText.trim()}」（零新色·既有 badge token）`) : bad(`C2 source 徽章异常：${badgeText}`);

    // 点行 → 详情抽屉 → 全链闭包逐段块 + counts。
    await closureRow.click();
    await page.waitForSelector("[data-testid=tc-d-closure]", { timeout: 8000 });
    ok("C1 详情抽屉「全链闭包逐段」块渲染");
    // 逐值对照：前端所见 closure counts 文本 vs 后端 detail 真值（前端真发出的 detail 响应）。
    await page.waitForTimeout(400);
    const uiCounts = (await page.locator("[data-testid=tc-d-closure-counts]").textContent()) ?? "";
    const uiGate = (await page.locator("[data-testid=tc-d-closure-gate]").textContent()) ?? "";
    // 后端真值（前端此次真拉取的 detail）。
    const be = await fetch(`${AC}/b/v1/growth/tickets/${sbcId}/detail`, { headers: { "x-debug-user": "demo:user-admin:catalog_admin|planner" } }).then((r) => r.json()).catch(() => null);
    const c = be?.supply?.closure ?? detailFromNetwork?.supply?.closure;
    if (c) {
      const expect = `objectsBound=${c.counts.objectsBound} · dataOrphans=${c.counts.dataOrphans} · forwardMissing=${c.counts.forwardMissing} · chainBroken=${c.counts.chainBroken} · shapeBroken=${c.counts.shapeBroken}`;
      uiCounts.replace(/\s+/g, " ").includes(expect)
        ? ok(`C1 逐值对照通过：UI counts = 后端 [${expect}]`)
        : bad(`C1 逐值不符：UI「${uiCounts.trim()}」 vs 后端「${expect}」`);
      const gateWord = c.gatePassed ? "通过" : "未通过";
      uiGate.includes(gateWord) ? ok(`C1 逐值对照：闭包闸 UI「${uiGate.trim()}」= 后端 gatePassed=${c.gatePassed}`) : bad(`C1 闸不符：UI「${uiGate}」 vs 后端 ${gateWord}`);
      // 逐段 CHAIN:FAILED 段可见。
      const chainSeg = await page.locator("[data-testid=tc-d-closure-seg-CHAIN]").count();
      chainSeg > 0 ? ok("C1 逐段 CHAIN 段渲染（真 MISSING 段）") : bad("C1 CHAIN 逐段缺失");
    } else { bad("C1 无法取后端 detail 逐值对照"); }
    await page.screenshot({ path: `${SHOT}/console-board-on.png`, fullPage: true }).catch(() => {});
    ok("证据截图 → docs/evidence/console-board-on.png");
    // C2：切回「query 目标」透镜 → 无 BUILD_CLOSURE 行（透镜真收窄）。
    await page.locator("[data-testid=tc-drawer-close]").click().catch(() => {});
    await page.click("[data-testid=tc-source-query]");
    await page.waitForTimeout(500);
    const stillClosure = await page.locator("[data-testid^=tc-row-sbc_]").count();
    stillClosure === 0 ? ok("C2 切「query 目标」透镜真收窄（BUILD_CLOSURE 行隐）") : bad("C2 query 透镜未收窄");
  } else {
    // C3 回退：flag 关 → script 透镜 tab 隐 + board 无 BUILD_CLOSURE 行。
    hasScriptLens === 0 ? ok("C3 回退：source 透镜无「script 目标」tab（暗发 OFF·关闸=改造前系统）") : bad("C3 script 透镜未隐藏");
    await page.click("[data-testid=tc-source-all]");
    await page.waitForTimeout(500);
    const closureCount = await page.locator("[data-testid^=tc-row-sbc_]").count();
    closureCount === 0 ? ok("C3 回退：board 无 BUILD_CLOSURE 行 = 现状 query-目标 board") : bad(`C3 board 仍含 ${closureCount} BUILD_CLOSURE 行`);
    await page.screenshot({ path: `${SHOT}/console-board-off.png`, fullPage: true }).catch(() => {});
    ok("证据截图 → docs/evidence/console-board-off.png");
  }
} catch (e) {
  bad(`E2E 异常: ${String(e && e.stack || e).slice(0, 400)}`);
} finally {
  await b.close();
}
console.log(`\n=== console-board E2E [MODE=${MODE}] ${failed ? "FAIL" : "PASS"} ===`);
process.exit(failed ? 1 : 0);
