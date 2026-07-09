// UPG-L0-CONSOLE-APPROVE 真浏览器 E2E（铁律0.4·真起服务真数据真看 UI 逐值对照后端·不作假）：
// 真 datacore(4001·SEED_DEMO·comprehend 桩真闭包)+真 agentcore(4102·OBO 真投影)+前端真后端模式 → Playwright 真 Chromium。
// MODE=on（flag CONSOLE_INDRAWER_APPROVE=1）：开工单详情抽屉 → 断言「就地批复」段现 + 就地批准一条 PENDING_APPROVAL
//   草稿 → 逐值对照后端 GET /a/v1/action-drafts（草稿离开 PENDING_APPROVAL → APPROVED）+ 全程未跳页（R17·仍 /admin/tickets）。
// MODE=off（flag 关·C3 回退）：抽屉无「就地批复」段 = 改造前系统（草稿仍在后端待批·仍走旧 DataBuilder / /admin/actions）。
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5301";
const DC = process.env.DC ?? "http://127.0.0.1:4001";
const MODE = process.env.MODE ?? "on";
const SHOT = process.env.SHOT ?? "/home/user/complete/.claude/worktrees/agent-a0e8109137fbeb208/docs/evidence";
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

// 后端真值助手：datacore 登录 + 查 PENDING_APPROVAL 草稿（逐值对照证据源）。
async function dcLogin() {
  const r = await fetch(`${DC}/a/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) }).then((x) => x.json());
  return r.accessToken;
}
async function pendingDrafts(tok) {
  return fetch(`${DC}/a/v1/action-drafts?status=PENDING_APPROVAL`, { headers: { authorization: `Bearer ${tok}` } }).then((x) => x.json());
}
async function draftById(tok, id) {
  return fetch(`${DC}/a/v1/action-drafts/${id}`, { headers: { authorization: `Bearer ${tok}` } }).then((x) => x.json());
}

const apiTok = await dcLogin();
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });

try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`登录成功 → ${page.url()}`);

  await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForSelector("[data-testid=ticket-center-page]", { timeout: 10000 });
  ok("统一工单中心渲染");

  // 开第一条工单详情抽屉（BUILD_CLOSURE 行·任意 kind 均可承接就地批复段）。
  const firstRow = page.locator("[data-testid^=tc-row-]").first();
  const rowCount = await page.locator("[data-testid^=tc-row-]").count();
  rowCount > 0 ? ok(`board 有 ${rowCount} 行·开首行详情抽屉`) : bad("board 无行·无法开抽屉");
  await firstRow.click();
  await page.waitForSelector("[data-testid=tc-drawer]", { timeout: 8000 });
  ok("工单详情抽屉渲染");

  if (MODE === "on") {
    // C1：就地批复段承接（暗发 ON）。
    await page.waitForSelector("[data-testid=tc-db-approvals]", { timeout: 8000 });
    ok("C1 抽屉内「就地批复」段渲染（db-approvals 承接·R4）");
    const approveBtn = page.locator("[data-testid^=tc-db-approve-]").first();
    const draftTestId = await approveBtn.getAttribute("data-testid");
    const draftId = draftTestId.replace("tc-db-approve-", "");
    ok(`就地批复按钮定位·目标草稿 ${draftId}`);

    // 逐值对照 · 批复前：后端该草稿 PENDING_APPROVAL。
    const beforeList = await pendingDrafts(apiTok);
    const beforeCount = beforeList.length;
    const beforeMine = beforeList.find((d) => d.id === draftId);
    beforeMine && beforeMine.status === "PENDING_APPROVAL"
      ? ok(`C1 批复前逐值：后端草稿 ${draftId} status=PENDING_APPROVAL（待批总数 ${beforeCount}）`)
      : bad(`C1 批复前后端状态异常：${JSON.stringify(beforeMine)}`);

    // 就地批准（不跳页·R17）。
    await approveBtn.click();
    await page.waitForTimeout(1500);

    // R17：批复后路由仍在统一 Console（未跳 /admin/actions）。
    const url = await page.evaluate(() => window.location.pathname);
    url === "/admin/tickets" ? ok(`C1 R17 就地批复未跳页（路由仍 ${url}）`) : bad(`C1 违反 R17：跳到 ${url}`);

    // 逐值对照 · 批复后：后端该草稿离开 PENDING_APPROVAL + admin 审批步记录 decision=APPROVE（R4 就地批复真生效）。
    // 注：终态可为 APPROVED/EXECUTED/EXECUTION_FAILED（取决于下游领域执行器·与「就地批复」正交）——本 WO 验的是批复动作真落库。
    const afterDraft = await draftById(apiTok, draftId);
    const afterList = await pendingDrafts(apiTok);
    afterDraft.status !== "PENDING_APPROVAL"
      ? ok(`C1 批复后逐值：后端草稿 ${draftId} 离开 PENDING_APPROVAL → status=${afterDraft.status}（真状态变更）`)
      : bad(`C1 批复后后端仍 PENDING_APPROVAL（就地批复未落库）`);
    const adminStep = (afterDraft.approvalSteps ?? []).find((s) => s.role === "admin");
    adminStep && adminStep.decision === "APPROVE"
      ? ok(`C1 逐值：后端 admin 审批步 decision=APPROVE·comment=「${adminStep.comment ?? ""}」（就地批复真落库·R4）`)
      : bad(`C1 后端审批步未记 APPROVE：${JSON.stringify(adminStep)}`);
    afterList.length === beforeCount - 1
      ? ok(`C1 逐值对照：后端待批总数 ${beforeCount}→${afterList.length}（就地批复真生效）`)
      : bad(`C1 待批总数未减：${beforeCount}→${afterList.length}`);

    await page.screenshot({ path: `${SHOT}/console-approve-on.png`, fullPage: true }).catch(() => {});
    ok("证据截图 → docs/evidence/console-approve-on.png");
  } else {
    // C3 回退：flag 关 → 抽屉无就地批复段（改造前系统）。
    const has = await page.locator("[data-testid=tc-db-approvals]").count();
    has === 0 ? ok("C3 回退：抽屉无「就地批复」段（暗发 OFF·关闸=改造前系统·仍走旧审批面）") : bad("C3 就地批复段未隐藏");
    // 后端草稿仍在待批（回退不丢·仍可经旧 DataBuilder InPlaceApprovalPanel / /admin/actions 批）。
    const list = await pendingDrafts(apiTok);
    list.length > 0 ? ok(`C3 回退可证：后端仍有 ${list.length} 条 PENDING_APPROVAL 待批（旧面可承接）`) : bad("C3 后端无待批草稿（无法证回退承接）");
    await page.screenshot({ path: `${SHOT}/console-approve-off.png`, fullPage: true }).catch(() => {});
    ok("证据截图 → docs/evidence/console-approve-off.png");
  }
} catch (e) {
  bad(`E2E 异常: ${String((e && e.stack) || e).slice(0, 500)}`);
} finally {
  await b.close();
}
console.log(`\n=== console-approve E2E [MODE=${MODE}] ${failed ? "FAIL" : "PASS"} ===`);
process.exit(failed ? 1 : 0);
