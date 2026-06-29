#!/usr/bin/env node
/**
 * WO-Q1 增量3(a) 真浏览器实拍：QueryDock 终答逐字流预览（streamingText + 可折叠 reasoning）。
 * 起 vite(VITE_MOCK=1) → 登录 → /v/dash 打开查询 Dock → 发哨兵问句「逐字流」（mock SSE 拉开
 * answer.delta 间隔 + 延迟 answer.final）→ 等 task-streaming-* 预览出现 → 截图 + 断言。
 * 环境无 chromium/playwright → SKIP(exit0)。截图存 docs/evidence/WO-Q1-inc3-streaming.png。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOT = new URL("../docs/evidence/WO-Q1-inc3-streaming.png", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  for (const root of ["/opt/pw-browsers", "/root/.cache/ms-playwright", `${process.env.HOME}/.cache/ms-playwright`]) {
    if (existsSync(`${root}/chromium`)) return `${root}/chromium`;
    for (const sub of ["chromium-1148/chrome-linux/chrome", "chromium-1194/chrome-linux/chrome", "chromium/chrome-linux/chrome"]) {
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

const exe = findChromium();
const chromium = loadChromium();
if (!exe || !chromium) {
  console.log(`⊘ streaming-shot SKIP：chromium(${!!exe})/playwright(${!!chromium}) 缺失。`);
  process.exit(0);
}

let vite;
let failed = false;
try {
  vite = spawn("npx", ["vite", "--force", "--port", String(PORT), "--host", "127.0.0.1"], {
    cwd: new URL("../apps/frontend-shell", import.meta.url).pathname,
    env: { ...process.env, VITE_MOCK: "1" },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(BASE)).ok) { up = true; break; } } catch { /* not up */ }
    await sleep(1000);
  }
  if (!up) { console.error("✗ dev server 未就绪"); process.exit(1); }

  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.fill("#login-username", "planner");
    await p.fill("#login-password", "demo");
    await p.click("button[type=submit]");
    await p.waitForTimeout(1500);
    await p.click('a[href="/v/dash"]');
    await p.waitForTimeout(1500);
    // 打开查询 Dock 并发哨兵问句
    const input = p.locator('[aria-label="查询输入"]').first();
    if ((await input.count()) === 0) { console.error("✗ 未找到查询 Dock 输入框"); failed = true; }
    else {
      await input.fill("逐字流演示：评估供应链韧性并给三条建议");
      await input.press("Enter");
      // 等逐字流预览出现（终答前）
      await p.waitForSelector('[data-testid^="task-streaming-"]', { timeout: 8000 });
      await p.waitForTimeout(2600); // 让多个 text 增量累加（终答 ~4.8s 后才到，此时仍流式预览）
      const preview = await p.locator('[data-testid^="task-streaming-"]').first().textContent();
      await p.screenshot({ path: SHOT, fullPage: false });
      // 证逐字流预览真渲染：含「思考中」(reasoning) + 累加答案文本（已超首帧）。
      const ok = preview && preview.includes("供应链韧性评估") && preview.includes("①");
      if (!ok) {
        console.error(`✗ 预览未含累加文本：${(preview || "").slice(0, 80)}`);
        failed = true;
      } else {
        console.log(`✓ 逐字流预览实拍：「…${preview.replace(/\s+/g, "").slice(0, 50)}…」 截图 → ${SHOT}`);
      }
    }
  } finally {
    await b.close();
  }
} catch (e) {
  console.error(`✗ streaming-shot 异常：${String(e).slice(0, 200)}`);
  failed = true;
} finally {
  if (vite) vite.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
