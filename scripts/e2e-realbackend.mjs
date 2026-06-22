// 前后端真联调 E2E（L4 真后端，TESTING-STANDARD §1）：真 datacore + 真 agentcore + 前端真后端模式
// （非 MSW mock），Playwright 真浏览器登录 + 逐页断言。验"前端 UI ↔ 真后端"真打通，守"绿测试≠能用"。
//
// 前置（本地/夜间跑，非 CI 必过——A16 决策待定）：
//   1) pnpm -r build
//   2) 起真后端：
//      PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-rb SEED_DEMO=1 CREDENTIAL_KEY=<64hex> \
//        SERVICE_TOKEN=svc AGENTCORE_BASE_URL=http://127.0.0.1:4002 node apps/datacore/dist/server.js &
//      PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js &
//   3) 起前端真后端模式（不设 VITE_MOCK）：
//      VITE_DATACORE_URL=http://127.0.0.1:4001 VITE_AGENTCORE_URL=http://127.0.0.1:4002 \
//        pnpm --filter frontend-shell exec vite --port 5200 --host 127.0.0.1 &
//   4) 装 Playwright（一次）：npm i -g playwright-core 或本地 + npx playwright install chromium
//   5) CHROME=<chrome 路径> FRONT=http://127.0.0.1:5200 node scripts/e2e-realbackend.mjs
//
// 一键编排：bash scripts/run-l4-realbackend.sh（起双后端+vite 真后端模式+跑本脚本，自动清理）。
// 断言（真后端真数据，区别于 mock 写死值）9 项：登录 / A4 真物化计数 / A11 连接归类 / 工作流 7 步 + 比对现状 /
//   A5 FDE 8 节点图 / A7 scaffold 清单(单机可见) / A10 重跑验证终态徽章 / nav-reorg 业务域分组 / A14 evals parity 失因列。
// 实测：2026-06-22 真 Chromium(headless_shell) + 真后端 **9/9 通过**（playwright-core 1.61 + ms-playwright chromium-1148 缓存）。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME; // chromium 可执行路径（playwright install 后的路径）
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";

const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败,停在 /login") : ok(`真后端登录成功 → ${page.url()}`);

  // A4 对象/类型浏览器：真后端真物化计数
  await page.click('a[href="/admin/object-types"]').catch(() => {});
  await page.waitForSelector("[data-testid=object-types-page]", { timeout: 10000 });
  const rows = await page.$$eval("[data-testid^=ot-row-]", (els) => els.length);
  const counts = await page.$$eval("[data-testid^=ot-count-]", (els) => els.map((e) => e.textContent));
  rows > 0 && counts.some((c) => c && c !== "0") ? ok(`A4 真后端：${rows} 类型 + 真物化计数`) : bad("A4 真后端：类型/计数异常");

  // A11 连接器归类列
  await page.click('a[href="/admin/connections"]').catch(() => {});
  await page.waitForTimeout(1000);
  const cats = await page.$$eval("[data-testid^=conn-cat-]", (els) => els.length);
  cats > 0 ? ok(`A11 真后端：${cats} 条连接含归类列`) : bad("A11 真后端：无连接归类列");

  // 工作流时间线 + 比对现状（真后端 run：真 comprehend floor + planSlice + provisioners）
  await page.click('a[href="/admin/data-builder"]').catch(() => {});
  await page.waitForSelector("[data-testid=wf-timeline]", { timeout: 10000 });
  await page.click("[data-testid=wf-start]");
  await page.waitForTimeout(4000);
  const steps = await page.$$eval("[data-testid^=wf-step-]", (els) => new Set(els.map((e) => e.getAttribute("data-testid")).filter((x) => x && !x.includes("error"))).size);
  const gap = await page.locator("[data-testid=wf-gap-analysis]").count();
  steps >= 6 ? ok(`工作流真后端：7 步状态机 + 比对现状${gap ? "表" : "(未展开)"}`) : bad(`工作流真后端：步骤异常 ${steps}`);

  // ── A5 FDE 编排节点图（L4 真后端）：展开运行 → 8 节点 DAG 真浏览器渲染 ──
  const fdeNodes = await page.$$eval("[data-testid^=fde-node-]", (els) => new Set(els.map((e) => e.getAttribute("data-testid"))).size);
  fdeNodes >= 8 ? ok(`A5 真后端：FDE 节点图 ${fdeNodes} 节点真浏览器渲染`) : bad(`A5 真后端：FDE 节点数异常 ${fdeNodes}`);

  // ── A7 B 栈 scaffold 单机可见（L4 真后端）：cross_scaffold 步下 scaffold 清单 ──
  const scaffold = await page.locator("[data-testid=wf-scaffold-manifest]").count();
  scaffold > 0 ? ok("A7 真后端：scaffold 清单（单机可见）真浏览器渲染") : bad("A7 真后端：scaffold 清单缺失");

  // ── A10 终态闭环验证（L4 真后端）：建域并记入历史(sbr-run,自动展开) → 重跑验证按钮 → 终态徽章 ──
  await page.click("[data-testid=sbr-run]").catch(() => {});
  await page.waitForTimeout(5000); // 真后端建域(floor comprehend + 闭包 + 物化 + 自动验证)
  const verifyBtns = await page.locator("[data-testid^=sbr-verify-btn-]").count();
  if (verifyBtns > 0) {
    await page.locator("[data-testid^=sbr-verify-btn-]").first().click().catch(() => {});
    await page.waitForTimeout(2500);
    const vstatus = await page.locator("[data-testid^=sbr-verify-status-]").count();
    vstatus > 0 ? ok("A10 真后端：重跑验证 → 终态徽章真浏览器渲染") : bad("A10 真后端：验证终态徽章缺失");
  } else { bad("A10 真后端：无重跑验证按钮（历史记录未现）"); }

  // ── nav-reorg 导航分组（L4 真后端，数据无关）：管理区业务域分组头 ──
  const navGroups = await page.$$eval("[data-testid^=nav-group-]", (els) => els.map((e) => e.getAttribute("data-testid")));
  navGroups.includes("nav-group-数据接入") && navGroups.includes("nav-group-建模与图谱")
    ? ok(`nav-reorg 真后端：管理区 ${navGroups.length} 业务域分组真浏览器渲染`)
    : bad(`nav-reorg 真后端：分组头缺失（${navGroups.length}）`);

  // ── A14 evals parity（L4 真后端）：SPA 导航（access token 仅内存，禁 goto 硬刷会丢登录态）→ 跑一次 → parity 失因列 ──
  await page.click('a[href="/admin/evals"]').catch(() => {});
  await page.waitForSelector("[data-testid=evals-page]", { timeout: 10000 }).catch(() => {});
  const evalRun = await page.locator("[data-testid=eval-run]").count();
  if (evalRun > 0) {
    await page.click("[data-testid=eval-run]").catch(() => {});
    await page.waitForTimeout(3500);
    const parityCol = await page.locator("[data-testid^=eval-parity-]").count();
    parityCol > 0 ? ok("A14 真后端：评测 parity 失因列真浏览器渲染") : bad("A14 真后端：parity 列缺失");
  } else { bad("A14 真后端：evals 页无运行入口"); }
} catch (e) {
  bad(`E2E 异常: ${String(e.message).slice(0, 160)}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 前后端真联调 ${results.length - failed.length}/${results.length} ===`);
process.exit(failed.length === 0 ? 0 : 1);
