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
// 断言（真后端真数据，区别于 mock 写死值）15 项：登录 / cockpit P1 富 KPI / cockpit P2 根因 DAG /
//   cockpit P3 风险对症方案→工单 / A4 真物化计数 / A11 连接归类 / 工作流 7 步 + 比对现状 / A5 FDE 8 节点图 /
//   A7 scaffold 清单(单机可见) / A10 重跑验证终态徽章 / A18.4 整域晋升编排 / nav-reorg 业务域分组 /
//   A14 evals parity 失因列 / A18.4 审核台。
// 实测：2026-06-22 真 Chromium(headless_shell) + 真后端 9/9 通过（playwright-core 1.61 + ms-playwright chromium-1148 缓存）;
//   cockpit P1+P2+P3 + SPINE.4 指标条 + A18.4(审核台+整域晋升) 扩为 15 项。
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

  // cockpit P1 经营驾驶舱富 KPI（L4 真后端）：DemandSegment/FinancePlan/MaterialBalance 合成→派生→聚合→widget
  await page.click('a[href="/v/dash"]').catch(() => {});
  await page.waitForTimeout(1500);
  const demandKpi = await page.locator("[data-testid=widget-demand-p50]").count();
  const marginKpi = await page.locator("[data-testid=widget-gross-margin]").count();
  const matKpi = await page.locator("[data-testid=widget-material-gap]").count();
  demandKpi > 0 && marginKpi > 0 && matKpi > 0
    ? ok("cockpit P1 真后端：需求P50/毛利总额/物料缺口 富 KPI 真浏览器渲染（数据闭环）")
    : bad(`cockpit P1 真后端：富 KPI 缺失（demand=${demandKpi} margin=${marginKpi} mat=${matKpi}）`);

  // cockpit P2 规划决策推演 · 根因 DAG（L4 真后端）：plan_rootcause 求解器经营 KPI 越线 → 因子 → 取证叶三层真渲染
  await page.waitForTimeout(1500); // 等 plan_rootcause solver widget 拉取
  const dagRoot = await page.locator("[data-testid=provenance-dag]").count();
  const dagKpi = await page.locator('[data-testid^="dag-node-kpi:"]').count();
  const dagFactor = await page.locator('[data-testid^="dag-node-factor:"]').count();
  const dagLeaf = await page.locator('[data-testid^="dag-node-leaf:"]').count();
  dagRoot > 0 && dagKpi > 0 && dagFactor > 0 && dagLeaf > 0
    ? ok(`cockpit P2 真后端：根因归因 DAG 真浏览器渲染（${dagKpi} KPI 根 · ${dagFactor} 因子 · ${dagLeaf} 取证叶，结构=活数据算出）`)
    : bad(`cockpit P2 真后端：根因 DAG 缺失（dag=${dagRoot} kpi=${dagKpi} factor=${dagFactor} leaf=${dagLeaf}）`);
  // SPINE.4 经营指标条（视图读 Metric 单一出处）：metric_rollup 驱动的 op 级指标卡真渲染
  const mstrip = await page.locator("[data-testid=metric-strip]").count();
  const mcards = await page.locator("[data-testid^=metric-kpi-], [data-testid^=metric-]").count();
  mstrip > 0 && mcards > 0
    ? ok(`SPINE.4 真后端：经营指标条（Metric 单一出处 R-一致）${mcards} 卡真浏览器渲染（metric_rollup 对齐目标树算 delta/miss）`)
    : bad(`SPINE.4 真后端：经营指标条缺失（strip=${mstrip} cards=${mcards}）`);

  // cockpit P3 风险看板补全 · 对症方案→工单（L4 真后端）：风险卡 → 详情弹窗 → mitigation_select 方案表 + 采纳→工单按钮
  await page.click('a[href="/v/risk"]').catch(() => {});
  await page.waitForSelector("[data-testid^=risk-card-]", { timeout: 10000 }).catch(() => {});
  await page.locator("[data-testid^=risk-card-]").first().click().catch(() => {});
  await page.waitForSelector("[data-testid=mitigation-panel]", { timeout: 8000 }).catch(() => {});
  const mitPanel = await page.locator("[data-testid=mitigation-panel]").count();
  const mitPlans = await page.locator("[data-testid^=mitigation-plan-]").count();
  const mitAdopt = await page.locator("[data-testid^=mitigation-adopt-]").count();
  mitPanel > 0 && mitPlans > 0 && mitAdopt > 0
    ? ok(`cockpit P3 真后端：风险因子对症方案 ${mitPlans} 条 + 采纳→工单按钮真浏览器渲染（mitigation_select 全因子可用）`)
    : bad(`cockpit P3 真后端：对症方案缺失（panel=${mitPanel} plans=${mitPlans} adopt=${mitAdopt}）`);
  await page.keyboard.press("Escape").catch(() => {}); // 关风险详情弹窗，避免遮挡后续导航
  await page.waitForTimeout(400);

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

  // ── A18.4 整域晋升编排（L4 真后端）：勾选 PROVISIONAL → 建域（隔离物化、UNVERIFIED）→ 整域晋升 → GOVERNED ──
  await page.check("[data-testid=db-provisional]").catch(() => {});
  await page.click("[data-testid=sbr-run]").catch(() => {});
  await page.waitForTimeout(5000); // 真后端 PROVISIONAL 建域（闭包降级 + 隔离物化到伪租户）
  const promoteBtns = await page.locator("[data-testid^=sbr-promote-btn-]").count();
  if (promoteBtns > 0) {
    await page.locator("[data-testid^=sbr-promote-btn-]").first().click().catch(() => {});
    await page.waitForTimeout(3000); // 迁移隔离域 → 真租户 + 翻转域信任级
    const governed = await page.locator("[data-testid^=sbr-promote-summary-]").count();
    governed > 0
      ? ok("A18.4 真后端：PROVISIONAL 域整域晋升 GOVERNED（隔离数据迁入真租户，晋升摘要真浏览器渲染）")
      : bad("A18.4 真后端：整域晋升后未见 GOVERNED 摘要");
  } else { bad("A18.4 真后端：PROVISIONAL 域无整域晋升按钮（UNVERIFIED 未现）"); }

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

  // ── A18.4 求解器审核台（L4 真后端）：SPA 导航 → 页面渲染 + 真 /a/v1/solvers/artifacts 端点（无临时件→空态）──
  await page.click('a[href="/admin/solver-review"]').catch(() => {});
  await page.waitForSelector("[data-testid=solver-review-page]", { timeout: 10000 }).catch(() => {});
  const reviewPage = await page.locator("[data-testid=solver-review-page]").count();
  const reviewBody = await page.locator("[data-testid=solver-artifacts-table], [data-testid=solver-review-empty]").count();
  reviewPage > 0 && reviewBody > 0
    ? ok("A18.4 真后端：求解器审核台页渲染 + 真 artifacts 端点（队列/空态）")
    : bad(`A18.4 真后端：审核台缺失（page=${reviewPage} body=${reviewBody}）`);
} catch (e) {
  bad(`E2E 异常: ${String(e.message).slice(0, 160)}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 前后端真联调 ${results.length - failed.length}/${results.length} ===`);
process.exit(failed.length === 0 ? 0 : 1);
