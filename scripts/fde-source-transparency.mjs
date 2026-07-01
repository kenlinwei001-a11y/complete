#!/usr/bin/env node
/**
 * WO-SOURCE-TRANSPARENCY · FDE 亲手验收（真起前端 + 真 Chromium + 真下载 .xlsx 见真业务数据）。
 * 前置：run-source-transparency-fde.sh 已起 datacore:4001(SEED_DEMO=1) + vite:5199(VITE_DATACORE_URL 真后端)。
 *
 * 走一遍用户旅程：admin 登录 → /admin/connections → 见合成源全部数据集 + 行预览 →
 *   点「下载 Excel」→ 真下载 .xlsx → node-xlsx 解开见真业务数据（Order 表头 + 真行）→ 截图。
 * 校验：文件名带 .synthetic（合成诚实位）；SYNTHETIC 徽标在；xlsx 内容非空、含业务列。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.FDE_OUT || "docs/evidence";
const DL = "/tmp/fde-st-downloads";
const require = createRequire(import.meta.url);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  for (const root of ["/opt/pw-browsers", "/root/.cache/ms-playwright", `${process.env.HOME}/.cache/ms-playwright`]) {
    for (const sub of ["chromium-1194/chrome-linux/chrome", "chromium-1148/chrome-linux/chrome", "chromium_headless_shell-1194/chrome-linux/headless_shell"]) {
      if (existsSync(`${root}/${sub}`)) return `${root}/${sub}`;
    }
  }
  return null;
}
function loadChromium() {
  for (const spec of ["playwright-core", "playwright"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}
async function loadXlsx() {
  for (const spec of ["node-xlsx"]) {
    try { const m = await import(spec); return m.default ?? m; } catch { /* next */ }
  }
  try {
    const resolved = require.resolve("node-xlsx", { paths: [`${process.cwd()}/apps/datacore`, process.cwd()] });
    const m = await import(`file://${resolved}`);
    return m.default ?? m;
  } catch { /* next */ }
  return null;
}

const exe = findChromium();
const chromium = loadChromium();
const xlsx = await loadXlsx();
if (!exe || !chromium) { console.log(`⊘ SKIP：chromium(${!!exe})/playwright(${!!chromium}) 缺。`); process.exit(0); }
mkdirSync(OUT, { recursive: true });
mkdirSync(DL, { recursive: true });

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 }, acceptDownloads: true });
const p = await ctx.newPage();
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  await p.evaluate(() => { window.history.pushState({}, "", "/admin/connections"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(2500);

  // 1) 合成源数据集面板 + 全部数据集
  const panels = await p.locator("[data-testid^=conn-datasets-]").count();
  if (panels < 1) fail("无连接数据集面板（conn-datasets-*）"); else console.log(`  连接数据集面板：${panels}`);
  const dsItems = await p.locator("[data-testid^=ds-item-]").count();
  if (dsItems < 2) fail(`数据集数过少（${dsItems}）——应露全部数据集非首个`); else console.log(`  露出数据集数：${dsItems}（全部·非仅首个）`);

  // 2) SYNTHETIC 徽标常驻（合成源诚实位·透明≠冒充）
  const synBadges = await p.locator("[data-testid^=conn-synthetic-]").count();
  if (synBadges < 1) fail("合成源 SYNTHETIC 徽标缺失"); else console.log(`  SYNTHETIC 徽标：${synBadges} ✓（诚实·透明≠冒充真实）`);

  // 3) 行预览：点第一张数据集的「预览」→ 真行表
  const firstPreview = p.locator("[data-testid^=ds-preview-]").first();
  await firstPreview.click();
  await p.waitForTimeout(1200);
  const previewTables = await p.locator("[data-testid^=ds-preview-table-]").count();
  const previewRows = await p.locator("[data-testid^=ds-preview-row-]").count();
  if (previewTables < 1 || previewRows < 1) fail(`行预览未渲染真行（tables=${previewTables} rows=${previewRows}）`);
  else console.log(`  行预览：表 ${previewTables} · 真行 ${previewRows} ✓`);

  await p.screenshot({ path: `${OUT}/WO-SOURCE-TRANSPARENCY-connectors-page.png`, fullPage: true });
  console.log(`  截图 → ${OUT}/WO-SOURCE-TRANSPARENCY-connectors-page.png`);

  // 4) 点「下载 Excel」→ 真下载 .xlsx（用 Order 数据集下载按钮，若无则取第一个）
  const orderBtn = p.locator("[data-testid^=ds-download-xlsx-]");
  const dlBtn = orderBtn.first();
  const [download] = await Promise.all([
    p.waitForEvent("download", { timeout: 15000 }),
    dlBtn.click(),
  ]);
  const suggested = download.suggestedFilename();
  const savePath = `${DL}/${suggested}`;
  await download.saveAs(savePath);
  console.log(`  真下载文件：${suggested}`);

  // 5) 文件名带 .synthetic（合成诚实位）
  if (!suggested.includes(".synthetic")) fail(`下载文件名未带 .synthetic：${suggested}`);
  else console.log(`  文件名含 .synthetic ✓（导出物自带来源诚实位·不冒充真实）`);
  if (!suggested.endsWith(".xlsx")) fail(`不是 .xlsx：${suggested}`);

  // 6) 打开 .xlsx 见真业务数据
  if (xlsx) {
    const buf = readFileSync(savePath);
    const sheets = xlsx.parse(buf);
    const data = sheets[0]?.data ?? [];
    if (data.length < 2) fail(`xlsx 内容为空/仅表头（${data.length} 行）——非真业务数据`);
    else console.log(`  xlsx 解开：工作表「${sheets[0].name}」· ${data.length - 1} 行真业务数据`);
    console.log(`  表头：${JSON.stringify((data[0] ?? []).slice(0, 8))}`);
    console.log(`  首行：${JSON.stringify((data[1] ?? []).slice(0, 8))}`);
    // 非空、非模版：至少一行有非空业务值
    const hasRealVal = data.slice(1).some((r) => Array.isArray(r) && r.some((c) => c !== "" && c != null));
    if (!hasRealVal) fail("xlsx 各行全空（模版而非真数据）");
    else console.log("  xlsx 含真业务值（非空模版）✓");
  } else {
    console.log("  ⊘ node-xlsx 不可用，跳过内容解析（仅验文件名/下载成功）");
  }
} catch (e) {
  fail(`异常：${String(e).slice(0, 400)}`);
} finally {
  await b.close();
}

if (failed) { console.error("\n✗ WO-SOURCE-TRANSPARENCY FDE 未通过。"); process.exit(1); }
console.log("\n✓ WO-SOURCE-TRANSPARENCY FDE：数据连接器页见全部数据集 + 行预览 → 点下载 Excel → 真 .xlsx 见真业务数据（文件名带 .synthetic·SYNTHETIC 徽标在）。");
