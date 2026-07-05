// POLISH-P3-BUNDLE 真浏览器取证（mock 模式·VITE_MOCK=1 build + vite preview + 真 Chromium）：
//   ① 叙事 ⟦ref⟧ sup 角标 hover：驻留计时（hover→浮层出现耗时）+ 热区命中（角标下缘外 4px 悬停能否触发）。
//   ② 沙盘 DAG（/v/sim-sandbox 全展开态）：边标注 getBoundingClientRect 两两相交计数（修前 8 → 修后 0）。
//
// 用法：
//   VITE_MOCK=1 pnpm --filter frontend-shell build
//   pnpm --filter frontend-shell exec vite preview --port 5301 --host 127.0.0.1 &
//   MODE=before|after FRONT=http://127.0.0.1:5301 node scripts/fde-polish-p3-evidence.mjs
// 产出：docs/evidence/polish-p3-{prov-hover,sandbox-edgelabels}-<MODE>.png + polish-p3-bundle-<MODE>.json
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5301";
const MODE = process.env.MODE ?? "after";
const CHROME =
  process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`;

mkdirSync("docs/evidence", { recursive: true });
const evidence = { mode: MODE, at: new Date().toISOString(), front: FRONT };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  // ── 登录（mock 账号：planner/demo，见 mocks/fixtures ACCOUNTS） ─────────────
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  // sim.sandbox 暗发默认关（R3）：演示前按正门开租户 entitlement（MSW 拦截同款 PUT，
  // 与 ui-smoke-sandbox.mjs 真后端同一开通路径）→ 登录后 workspace 才带 sim.* 功能。
  await page.evaluate(async () => {
    await fetch("/a/v1/tenants/demo/features", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: { "sim.sandbox": true, "sim.propagation": true } }),
    });
  });
  await page.fill("#login-username", "planner");
  await page.fill("#login-password", "demo");
  await page.click("button[type=submit]");
  await page.waitForTimeout(1500);
  if (page.url().endsWith("/login")) throw new Error("登录失败，停在 /login");
  evidence.login = page.url();

  // SPA 内跳转（token 仅存内存，整页刷新会退登录）：pushState + popstate 通知 React Router。
  const spaGoto = async (path) => {
    await page.evaluate((p) => {
      window.history.pushState({}, "", p);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await page.waitForTimeout(800);
  };

  // ── ① 叙事 sup 角标 hover ──────────────────────────────────────────────────
  // 查询坞只在 /v/* 视图页挂载 → 先进驾驶舱视图，提交 A2 问句（mock SSE 脚本 → 终答含 ⟦ref⟧ 叙事角标），
  // 再进任务详情页（静态渲染 AnswerCard）测 hover——避开对话坞跑动态时的布局抖动干扰计时。
  await spaGoto("/v/dash");
  await page.waitForSelector('[data-testid="query-dock-bar"] input', { timeout: 20000 });
  const taskIdP = page.waitForResponse((r) => r.url().includes("/queries") && r.request().method() === "POST").then(async (r) => (await r.json()).taskId);
  await page.click('[data-testid="query-dock-bar"] input');
  await page.fill('[data-testid="query-dock-bar"] input', "订单加 20% 能不能接");
  await page.press('[data-testid="query-dock-bar"] input', "Enter");
  await page.locator('[data-testid="prov-mark-prov-a2-3"]').first().waitFor({ state: "visible", timeout: 20000 });
  const taskId = await taskIdP;
  evidence.taskId = taskId;
  await spaGoto(`/tasks/${taskId}`);
  const mark = page.locator('[data-testid="prov-mark-prov-a2-3"]').first();
  await mark.waitFor({ state: "visible", timeout: 20000 });
  await mark.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // (a) 驻留计时：hover 角标本体 → 浮层出现耗时（修前 ~300ms+ / 修后 ~150ms+，含 hover 事件开销）。
  // SSE 尾部重排偶发吃掉首次 hover → 最多重试 3 次，只记成功那次的耗时 + 尝试次数（诚实呈现）。
  let hoverMs = null;
  let attempts = 0;
  for (let i = 0; i < 3 && hoverMs === null; i++) {
    attempts++;
    await page.mouse.move(10, 10);
    await page.waitForTimeout(400);
    const t0 = Date.now();
    await mark.hover();
    try {
      await page.waitForSelector('[data-testid="prov-popover"]', { timeout: 3000 });
      hoverMs = Date.now() - t0;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  if (hoverMs === null) throw new Error("hover 角标 3 次均未出浮层");
  evidence.hoverToPopoverMs = hoverMs;
  evidence.hoverAttempts = attempts;

  // (b) 热区命中：移开重置 → 悬停「角标下缘外 4px」（旧：文本框外=不触发；新：::after 外扩 6px=触发）。
  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);
  if (await page.locator('[data-testid="prov-popover"]').count()) throw new Error("移开后浮层未关闭");
  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 4);
  await page.waitForTimeout(700); // > 驻留上限（300ms）+ 余量
  evidence.hitAreaBelow4px = (await page.locator('[data-testid="prov-popover"]').count()) > 0;
  if (evidence.hitAreaBelow4px) {
    // 浮层内容非空（值与口径段真值可见）——顺证浮层可用。
    evidence.popoverText = (await page.locator('[data-testid="prov-popover"]').innerText()).slice(0, 80);
  }
  await page.screenshot({ path: `docs/evidence/polish-p3-prov-hover-${MODE}.png`, fullPage: false });
  // 收口：鼠标移开触发 mouseleave 关闭 hover 态浮层（Escape 只对钉住态生效），避免残留遮住下一屏截图。
  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);

  // ── ② 沙盘 DAG 边标注（全展开态） ──────────────────────────────────────────
  await spaGoto("/v/sim-sandbox");
  // 收起查询坞面板（步骤①展开的），避免遮住 DAG 截图右半。
  const collapse = page.locator('[data-testid="query-dock-panel"] button[aria-label*="收起"]');
  if (await collapse.count()) { await collapse.first().click(); await page.waitForTimeout(300); }
  await page.waitForSelector('[data-testid^="sandbox-dag-edge-label-"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const dag = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid^="sandbox-dag-edge-label-"]')];
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect();
      return { n: e.getAttribute("data-testid"), dense: e.getAttribute("data-dense") === "1", x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
    });
    const vis = boxes.filter((b) => !b.dense);
    const hits = [];
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j];
        if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) hits.push(`${a.n} × ${b.n}`);
      }
    const mode = document.querySelector('[data-testid="sandbox-dag-wrap"]')?.getAttribute("data-dag-mode");
    return { dagMode: mode, labelTotal: boxes.length, visible: vis.length, dense: boxes.length - vis.length, intersections: hits.length, pairs: hits };
  });
  evidence.sandbox = dag;
  await page.locator('[data-testid="sandbox-dag-pz"]').screenshot({ path: `docs/evidence/polish-p3-sandbox-edgelabels-${MODE}.png` });

  // 密集隐标 hover 显（若有 dense）：悬停该边组 → 标注 opacity 变 1。
  if (dag.dense > 0) {
    const denseLabel = page.locator('[data-testid^="sandbox-dag-edge-label-"][data-dense="1"]').first();
    const before = await denseLabel.evaluate((e) => getComputedStyle(e).opacity);
    await page.locator("g.pm-el-dense path").first().hover({ force: true });
    await page.waitForTimeout(200);
    const after = await denseLabel.evaluate((e) => getComputedStyle(e).opacity);
    evidence.denseHoverReveal = { before, after };
  }

  writeFileSync(`docs/evidence/polish-p3-bundle-${MODE}.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
