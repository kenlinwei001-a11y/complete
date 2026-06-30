#!/usr/bin/env node
/**
 * #4 真 Kimi 端到端逐字流浏览器实拍：前端(非 mock·dual baseURL→真 datacore/agentcore)→登录→
 * /v/dash 发开放式问句→真 Kimi Path B agent 流式 answer.delta→QueryDock 逐字流预览→截图。
 * 前置：datacore :4301 + agentcore :4302 已起（真 KIMI_API_KEY）。无 chromium → SKIP。
 * 截图 docs/evidence/WO-Q1-realkimi-streaming.png。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOT = new URL("../docs/evidence/WO-Q1-realkimi-streaming.png", import.meta.url).pathname;
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
const exe = findChromium();
let chromium = null;
try { chromium = require("playwright-core").chromium; } catch { try { chromium = require("playwright").chromium; } catch { /* none */ } }
if (!exe || !chromium) { console.log(`⊘ realkimi-shot SKIP：chromium(${!!exe})/playwright(${!!chromium}) 缺失。`); process.exit(0); }

let vite, failed = false;
try {
  vite = spawn("npx", ["vite", "--force", "--port", String(PORT), "--host", "127.0.0.1"], {
    cwd: new URL("../apps/frontend-shell", import.meta.url).pathname,
    env: { ...process.env, VITE_DATACORE_URL: "http://127.0.0.1:4301", VITE_AGENTCORE_URL: "http://127.0.0.1:4302" },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) { up = true; break; } } catch { /* */ } await sleep(1000); }
  if (!up) { console.error("✗ dev server 未就绪"); process.exit(1); }

  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.fill("#login-tenant", "demo");
    await p.fill("#login-username", "planner");
    await p.fill("#login-password", "demo1234");
    await p.click("button[type=submit]");
    await p.waitForTimeout(2500);
    await p.click('a[href="/v/dash"]');
    await p.waitForTimeout(2000);
    const input = p.locator('[aria-label="查询输入"]').first();
    if ((await input.count()) === 0) { console.error("✗ 未找到查询 Dock 输入"); failed = true; }
    else {
      await input.fill("请发散评估我们电池业务的长期战略风险并给出尽量详尽的应对建议");
      await input.press("Enter");
      // 真 Kimi：ROUTING(~50s)→EXECUTING_AGENT 流式 answer.delta。等预览出现（最长 180s）。
      await p.waitForSelector('[data-testid^="task-streaming-"]', { timeout: 180000 });
      await p.waitForTimeout(1500);
      const preview = (await p.locator('[data-testid^="task-streaming-"]').first().textContent()) || "";
      await p.screenshot({ path: SHOT, fullPage: false });
      if (preview.trim().length < 8) { console.error(`✗ 预览过短：${preview.slice(0, 40)}`); failed = true; }
      else console.log(`✓ 真 Kimi 逐字流预览实拍：「…${preview.replace(/\s+/g, "").slice(0, 60)}…」 → ${SHOT}`);
    }
  } finally { await b.close(); }
} catch (e) { console.error(`✗ realkimi-shot 异常：${String(e).slice(0, 200)}`); failed = true; }
finally { if (vite) vite.kill("SIGTERM"); }
process.exit(failed ? 1 : 0);
