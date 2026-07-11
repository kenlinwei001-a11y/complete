// WO-SANDBOX-TRUST-BADGE（S2·前端半·方案A）· 真浏览器验证：真起双服务 + 真 chromium + 真 vite（.env.local·localhost 同站）
// + 真 admin 登录（真 JWT）→ 真沙盘渲染器 → 逐枚诚信位徽标**逐值对照后端** propagation-rules/view-config 派生真值。
// 非 jsdom·非机制冒充。用法：CHROME=<chrome> FRONT=http://localhost:5173 DC=http://127.0.0.1:4001 node scripts/e2e-sandbox-trust-badge.mjs
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://localhost:5173";
const DC = process.env.DC ?? "http://127.0.0.1:4001";
const CHROME = process.env.CHROME;
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";
const DBG = "demo:usr_demo_admin:admin";

const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

// ── 后端真值（逐值对照 source of truth）：从活服务派生每变量应得诚信位 ──────────────
const RANK = { LIVE: 0, UNKNOWN: 1, UNCALIBRATED: 2, SYNTHETIC: 3, STALE: 4 };
const j = async (p) => (await fetch(`${DC}${p}`, { headers: { "X-Debug-User": DBG } })).json();
const rules = (await j("/a/v1/sim/propagation-rules")).items ?? [];
const cfg = await j("/a/v1/sim/view-config");
const uncalSet = new Set(rules.filter((r) => !r.coefficientRef).map((r) => r.targetStateVar));
const nodeMode = cfg.nodeObjectMode; // Dev-1 依赖·当前 undefined
const ids = Object.values(cfg.nodeObjectIds ?? {}).flat();
const cellMode = (oid, v) => nodeMode?.[oid]?.[v] ?? (uncalSet.has(v) ? "UNCALIBRATED" : "UNKNOWN");
const varMode = (v) => {
  let worst = "LIVE", any = false;
  for (const oid of ids) { any = true; const m = cellMode(oid, v); if (RANK[m] > RANK[worst]) worst = m; }
  return any ? worst : (uncalSet.has(v) ? "UNCALIBRATED" : "UNKNOWN");
};
let overall = "LIVE", anyCell = false;
for (const oid of ids) for (const v of (cfg.stateVars ?? [])) { anyCell = true; const m = cellMode(oid, v); if (RANK[m] > RANK[overall]) overall = m; }
if (!anyCell) overall = "UNKNOWN";
const expected = Object.fromEntries((cfg.stateVars ?? []).map((v) => [v, varMode(v)]));
console.log("· 后端派生期望：overall=", overall, "· 逐 stateVar=", JSON.stringify(expected));
console.log("· uncalSet(coefficientRef 空的 target)=", [...uncalSet], "· nodeObjectMode=", JSON.stringify(nodeMode));

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败,停在 /login") : ok(`真后端登录成功 → ${page.url()}`);

  // 真沙盘渲染器（同站 refresh cookie 使硬导航保登录态）
  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=sandbox-kpis]", { timeout: 15000 });
  ok("真浏览器渲染出沙盘 KPI 区（sandbox-kpis）");

  const attr = async (tid) => page.locator(`[data-testid=${tid}]`).first().getAttribute("data-sim-datamode").catch(() => null);
  const count = async (sel) => page.locator(sel).count();

  // ① 顶部汇总位（feature 开·暗发 battery all-on）
  const summaryCount = await count("[data-testid=sandbox-trust-summary]");
  const summaryMode = await attr("sandbox-trust-summary");
  summaryCount > 0 && summaryMode === overall
    ? ok(`顶部汇总诚信位真渲染·data-sim-datamode=${summaryMode} == 后端派生 overall=${overall}（逐值一致）`)
    : bad(`顶部汇总位对不上：DOM=${summaryMode}(count=${summaryCount}) 期望=${overall}`);
  const summaryText = await page.locator("[data-testid=sandbox-trust-summary-text]").textContent().catch(() => "");
  summaryText && summaryText.length > 0
    ? ok(`汇总位人话摘要真渲染：「${summaryText.trim().slice(0, 40)}…」`)
    : bad("汇总位摘要缺失");

  // ② 全局态 KPI 徽标 = overall
  const globalMode = await attr("sandbox-kpi-global-datamode");
  globalMode === overall
    ? ok(`全局态 KPI 徽标 data-sim-datamode=${globalMode} == overall=${overall}（逐值一致）`)
    : bad(`全局态 KPI 徽标对不上：DOM=${globalMode} 期望=${overall}`);

  // ③ 逐 stateVar KPI 徽标**逐值对照后端派生**
  let allMatch = true;
  for (const [v, exp] of Object.entries(expected)) {
    const dom = await attr(`sandbox-kpi-${v}-datamode`);
    if (dom === exp) ok(`stateVar「${v}」KPI 徽标 ${dom} == 后端派生 ${exp}（coefficientRef 真判据·逐值一致）`);
    else { bad(`stateVar「${v}」KPI 徽标对不上：DOM=${dom} 期望=${exp}`); allMatch = false; }
  }
  allMatch && ok("§5.1/5.2 全部 stateVar KPI 诚信位逐值==后端 coefficientRef 派生（未校准诚实·无真源退 UNKNOWN·绝不假标 LIVE）");

  // ④ 诚实边界自证：无后端 nodeObjectMode（Dev-1 未补）→ 无一枚假标 LIVE/SYNTHETIC
  const liveBadges = await count('[data-sim-datamode=LIVE]');
  const synthBadges = await count('[data-sim-datamode=SYNTHETIC]');
  liveBadges === 0 && synthBadges === 0
    ? ok(`诚实边界：后端未提供 origin 血缘（nodeObjectMode 空）→ 零枚假标 LIVE/SYNTHETIC（KILL-MOCK-RED·绝不冒充实测）`)
    : bad(`诚实边界破：出现 ${liveBadges} LIVE + ${synthBadges} SYNTHETIC 徽标但后端无 origin 依据（假标回潮）`);

  await page.screenshot({ path: "docs/evidence/S2-sandbox-trust-badge-realbrowser.png", fullPage: false });
  ok("截图 docs/evidence/S2-sandbox-trust-badge-realbrowser.png");
} catch (e) {
  bad("异常：" + (e?.message ?? String(e)));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? "✅ 全绿" : "❌ 有红"}：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
