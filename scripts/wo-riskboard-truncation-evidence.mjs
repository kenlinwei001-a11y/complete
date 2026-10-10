// WO-RISKBOARD-TRUNCATION · 真浏览器取证（真 datacore + 真前端·禁 VITE_MOCK·从登录走起不许手敲 URL）。
// 取证文件锚 import.meta.url（本仓踩过「取证文件是上一轮的」这个坑）。
// playwright-core 是全局装的（不在本仓 node_modules），ESM 不吃 NODE_PATH ⇒ 用绝对路径导入。
// 可用 PW_CORE 覆盖（换机器/换版本时不用改代码）。
const PW = process.env.PW_CORE ?? "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs";
const { chromium } = await import(PW);
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "docs", "evidence", "wo-riskboard-truncation");
mkdirSync(OUT, { recursive: true });

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5211";
const CHROME = process.env.CHROME;
const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1150 } });

try {
  // ── ① 从登录走起（硬要求：手敲 URL 会让「找不到入口」这类问题整个消失）──────────────
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  ok(`登录成功 → ${page.url()}`);
  await page.screenshot({ path: join(OUT, "01-after-login.png"), fullPage: false });

  // ── ② 靠点击导航到「产能推演」，不手敲 URL ──────────────────────────────────────
  let clicks = 1; // 登录按钮
  const navTexts = ["产能推演", "推演", "风险"];
  let navigated = false;
  for (const t of navTexts) {
    const link = page.locator(`nav a:has-text("${t}"), aside a:has-text("${t}"), a:has-text("${t}")`).first();
    if (await link.count() > 0 && await link.isVisible().catch(() => false)) {
      await link.click(); clicks++; navigated = true;
      await page.waitForTimeout(2500);
      ok(`点「${t}」进入 → ${page.url()}`);
      break;
    }
  }
  if (!navigated) bad("导航里点不到「产能推演」入口（只报不改）");

  // 等风险看板真渲染出来（真后端数据，不是 mock）。
  await page.waitForSelector('[data-testid="risk-kpi"]', { timeout: 30000 });
  ok("风险看板已渲染（真后端 risk_timeline）");

  // ── ③ 诚实位必须在第一层、并且点得开 ───────────────────────────────────────────
  const chip = page.locator('[data-testid="risk-unlisted-chip"]');
  if (await chip.count() === 0) { bad("屏上没有「越线但未上榜」提示 —— 本单未生效"); }
  else {
    ok(`第一层提示原文：「${(await chip.innerText()).trim()}」`);
    ok(`KPI「风险基地」屏上显示：${(await page.locator('[data-testid="risk-kpi-bases-value"]').innerText()).trim()}`);
    ok(`读法行原文：「${(await page.locator('[data-testid="risk-unlisted-reading"]').innerText()).trim()}」`);
  }
  await page.screenshot({ path: join(OUT, "02-riskboard-collapsed.png"), fullPage: false });

  // 点开名单（"点得开、能看到是哪几个基地、各自 crossDay 第几天"）。
  await page.locator('[data-testid="risk-unlisted-toggle"]').click(); clicks++;
  await page.waitForSelector('[data-testid="risk-unlisted-table"]', { timeout: 10000 });
  const rows = await page.locator('[data-testid="risk-unlisted-table"] tbody tr').all();
  ok(`展开后名单 ${rows.length} 行：`);
  for (const r of rows) console.log("      · " + (await r.innerText()).replace(/\s+/g, " ").trim());

  // 常州必须在名单里且写着第 1 天（本单的核心断言：掉出榜 ≠ 从屏上消失）。
  const cz = page.locator('[data-testid="risk-unlisted-crossday-常州"]');
  if (await cz.count() > 0) ok(`常州在「未上榜」名单里，越线日显示：「${(await cz.innerText()).trim()}」`);
  else bad("常州不在未上榜名单里 —— 核心场景没兑现");

  // 榜上不许再有常州（它确实掉出去了，所以才需要这块提示）。
  const onBoard = await page.locator('[data-testid="risk-card-常州"]').count();
  if (onBoard === 0) ok("常州确实已掉出前 8 张卡（榜上无此卡）");
  else bad("常州仍在榜上 —— 取证前提不成立");

  await page.screenshot({ path: join(OUT, "03-riskboard-expanded.png"), fullPage: false });

  // ── ④ R-UI-4：屏上不许出现源码坐标 / 字段名 / 排期语汇 ────────────────────────────
  const body = await page.locator("body").innerText();
  const banned = ["risk.ts", ".slice", "maxCards", "unlistedCrossings", "crossDay", "WO-", "工单", "本单"];
  const hit = banned.filter((b) => body.includes(b));
  if (hit.length === 0) ok("R-UI-4 通过：屏上无源码文件名/字段名/排期语汇");
  else bad(`R-UI-4 违反：屏上出现 ${JSON.stringify(hit)}`);

  console.log(`\n总点击数=${clicks}`);
} catch (e) {
  bad(`异常：${e.message}`);
  await page.screenshot({ path: join(OUT, "99-error.png") }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n取证目录：${OUT}`);
console.log(`结果：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
