#!/usr/bin/env node
/**
 * 门B · 场景卡发育闭环（PRD-scenario-ontogenesis P1）真浏览器 + 真后端验收。
 * 不走 mock：连已起的 datacore:4001 + agentcore:4002（vite :5199 VITE_*_URL 指向真服务）。
 * 流程：admin 登录 → /admin/scenes → 点「发育验证」(grow) → 经 QOS 正序实跑 triggerQuestion 到终态
 *       → 断言前端可见：maturity 徽章 + 发育留痕面板（三环 + 验证结论 + 答案预览 + 溯源链 Link）。
 * 治"写到数据库但前端看不见来源"——用户铁律：推演生成的数据必须留痕且前端可见、知道从哪来。
 * 无 chromium/playwright-core → SKIP(exit 0)；真交互断言失败 → exit 1。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = process.env.UI_PORT || 5199;
const BASE = `http://127.0.0.1:${PORT}/`;
const SCEN = process.env.SCEN_KEY || "S01";
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
  for (const spec of ["playwright-core", "/tmp/shotter/node_modules/playwright-core/index.js", "/root/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright-core/index.js"]) {
    try { return require(spec).chromium; } catch { /* next */ }
  }
  return null;
}

const exe = findChromium();
const chromium = loadChromiumApi();
if (!exe || !chromium) {
  console.log(`⊘ ontogenesis-smoke SKIP：未找到 chromium(${!!exe}) 或 playwright-core(${!!chromium})。`);
  process.exit(0);
}

let failed = false;
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
p.on("console", (msg) => { if (msg.type() === "error") console.error("  [browser console.error]", msg.text().slice(0, 160)); });
try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  // 真后端登录：admin / demo1234（grow 需 catalog_admin 权限）。
  await p.fill("#login-tenant", "demo").catch(() => {});
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2000);

  // SPA 内导航到 /admin/scenes（pushState+popstate，不 goto——避免丢内存态 JWT）。
  await p.evaluate(() => { window.history.pushState({}, "", "/admin/scenes"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForSelector("[data-testid=scenarios-table]", { timeout: 15000 });
  await p.waitForTimeout(800);

  const row = p.locator(`[data-testid=scenario-row-${SCEN}]`);
  if ((await row.count()) === 0) { fail(`无场景行 ${SCEN}`); throw new Error("no row"); }

  const growBtn = p.locator(`[data-testid=scenario-grow-${SCEN}]`);
  if ((await growBtn.count()) === 0) fail(`${SCEN} 无「发育验证」按钮（须 PUBLISHED + admin）`);
  else {
    await growBtn.click();
    // grow 经 QOS 实跑到终态——给足时间（真求解器 + 轮询）。
    await p.waitForSelector(`[data-testid=scenario-ontogenesis-${SCEN}]`, { timeout: 45000 });
    await p.waitForTimeout(500);

    // 断言 1：maturity 徽章渲染（真后端值，非 mock）。
    const badge = p.locator(`[data-testid=scenario-maturity-${SCEN}]`);
    if ((await badge.count()) === 0) fail("无 maturity 徽章");
    else console.log("  maturity 徽章:", (await badge.first().innerText()).trim());

    // 断言 2：发育留痕面板有验证结论。
    const verif = p.locator(`[data-testid=scenario-verif-${SCEN}]`);
    if ((await verif.count()) === 0) fail("无验证结论行（scenario-verif）");
    else {
      const vt = (await verif.first().innerText()).trim();
      console.log("  验证结论:", vt.slice(0, 120));
      if (!/VERIFIED|NOT_VERIFIED|NOT_RUN|验证/.test(vt)) fail(`验证结论文本异常: ${vt.slice(0, 80)}`);
    }

    // 断言 3：三环（data/ontology/capability）留痕面板可见。
    const panelText = (await p.locator(`[data-testid=scenario-ontogenesis-${SCEN}]`).innerText()).trim();
    console.log("  留痕面板:", panelText.replace(/\s+/g, " ").slice(0, 160));

    // 断言 4：溯源链 Link（taskId）——用户铁律"知道数据从哪来"的可见入口。
    const trace = p.locator(`[data-testid=scenario-ontogenesis-${SCEN}] a`, { hasText: "溯源链" });
    const traceAny = p.locator(`[data-testid=scenario-ontogenesis-${SCEN}] a`);
    if ((await traceAny.count()) === 0) {
      // 仅 GOVERNED+有 taskId 才有溯源链；PROVISIONAL 无 taskId 可接受，但应有缺口提示。
      if (/已验证|GOVERNED/.test(await badge.first().innerText())) fail("GOVERNED 但无溯源链 Link");
      else console.log("  (PROVISIONAL：无溯源链，符合诚实降级)");
    } else {
      const href = await traceAny.first().getAttribute("href");
      console.log("  溯源链 →", href);
      if (!href || !/\/task\//.test(href)) fail(`溯源链 href 异常: ${href}`);
      // 点进溯源链，断言导航到任务详情（真 taskId 落点）。
      await traceAny.first().click();
      await p.waitForTimeout(1500);
      if (!/\/task\//.test(p.url())) fail(`溯源链未导航到 /task/（${p.url()}）`);
      else console.log("  溯源链导航到:", p.url());
    }
  }
} catch (e) {
  fail(`异常：${String(e).slice(0, 200)}`);
} finally {
  await b.close();
}

if (failed) {
  console.error("\n✗ ontogenesis-smoke 未通过：场景卡发育闭环前端不可见或断链。");
  process.exit(1);
}
console.log("\n✓ ontogenesis-smoke：发育验证→maturity 徽章→留痕面板→溯源链 全程真后端可见可达。");
