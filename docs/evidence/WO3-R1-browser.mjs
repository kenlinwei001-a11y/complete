/**
 * WO-3 · R1 · 真机（系统 Chrome + playwright-core）驱动统一推演控制台，实拍「三行钱」。
 *
 * 目的：把「三行钱的渲染分支无法被可靠验证」这句话，从「本机没有浏览器」这一层
 *       往下打穿 —— 先证明**浏览器这条腿本来就是通的**（本单第一判断的反例），
 *       再看真机跑出来的到底是哪条分支、卡在哪一跳。
 *
 * ⛔ 本探针只读 + 只在 5294（本单自己的 vite dev）与 4052（本单改后臂）上取数；
 *    不碰 4001/4002/5173（别人的部署）。
 * ⛔ 金丝雀：脚本必须并排给出「必然为真」的对照（c0828 外壳在、事件按钮在），
 *    否则「三行钱没出数」会被读成「页面根本没起来」。
 */
import { chromium } from "/Users/apple/workdsh-mcp-servers/node_modules/playwright-core/index.mjs";

const BASE = process.env.WO3_BASE ?? "http://127.0.0.1:5294";
const SHOT = process.env.WO3_SHOT ?? "/tmp/wt-ab/docs/evidence/WO3-R1-shot-money.png";
const DEBUG_USER = "demo:admin:admin|planner|catalog_admin";

const net = [];
const consoleErrs = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  extraHTTPHeaders: { "x-debug-user": DEBUG_USER },
});
const page = await ctx.newPage();
page.on("request", (r) => {
  const u = r.url();
  if (!u.includes("127.0.0.1:5294/")) return;
  if (/^\w+:/.test(u) && !/\/\/(127\.0\.0\.1|localhost)/.test(u)) return;
  if (!/\/(a|b|api)\/v1\//.test(u)) return;
  net.push({ kind: "req", method: r.method(), url: u, body: (r.postData() ?? "").slice(0, 200) });
});
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/(a|b|api)\/v1\//.test(u)) return;
  let snippet = "";
  try {
    const ct = r.headers()["content-type"] ?? "";
    if (ct.includes("json")) snippet = (await r.text()).slice(0, 400);
  } catch { /* body 可能已被丢弃 */ }
  net.push({ kind: "res", status: r.status(), url: u, snippet });
});
page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") consoleErrs.push("[console] " + m.text().slice(0, 300)); });

const out = { base: BASE, steps: [], dump: {}, net: [], consoleErrs };
const step = (n, v) => { out.steps.push({ n, ok: !!v, v: String(v).slice(0, 400) }); };

try {
  // ── 登录（真后端 demo 账号；口令 demo1234，来自 synthetic/service.ts seedDemoAccounts）
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click('form button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  step("0 登录（demo/admin/demo1234）", page.url());

  await page.goto(`${BASE}/v/sim-unified`, { waitUntil: "domcontentloaded", timeout: 30000 });
  step("1 goto /v/sim-unified", "ok");

  // ── 金丝雀 A（必然为真）：外壳在场。缺它则下面一切「没有」都不成立。
  await page.waitForSelector('[data-testid="c0828-rail"]', { timeout: 30000 });
  step("2 金丝雀A·外壳 c0828-rail 在场", "ok");

  // ── 金丝雀 B（必然为真）：12 类扰动事件按钮列出来了。
  const evCount = await page.locator('[data-testid^="c0828-ev-"]').count();
  step("3 金丝雀B·事件按钮数", `${evCount}（应 =12）`);

  // 等会话：c0828-go 的 disabled 属性反映 enabled && staged>0，但 enabled 靠 sessionId。
  await page.waitForFunction(
    () => {
      const h = document.querySelector('[data-testid="c0828-horizon-echo"]');
      return h !== null && (h.textContent ?? "").includes("推演至");
    },
    { timeout: 30000 },
  ).catch(() => step("4 等会话（horizon-echo 含『推演至』）", "TIMEOUT（可能会话未建立）"));
  step("4 会话就绪标志 c0828-horizon-echo", await page.locator('[data-testid="c0828-horizon-echo"]').textContent());

  // ── 加一件扰动：订单改交期（due-change → leadDays，与 GOALLOOP-R2 探针同族）
  await page.click('[data-testid="c0828-ev-due-change"]');
  await page.waitForSelector('[data-testid="c0828-pick-due-change"]', { timeout: 15000 });
  const opts = await page.locator('[data-testid="c0828-pick-due-change"] option').allTextContents();
  step("5 落点下拉选项", `${opts.length} 项: ${opts.slice(0, 4).join(" | ")}`);
  const values = await page.locator('[data-testid="c0828-pick-due-change"] option').evaluateAll(
    (els) => els.map((e) => e.getAttribute("value")).filter((v) => v !== "" && v !== null),
  );
  if (values.length === 0) throw new Error("落点下拉没有可选项 ⇒ 后面全不成立（先红）");
  await page.selectOption('[data-testid="c0828-pick-due-change"]', values[0]);
  step("6 选中落点", values[0]);

  const mag = await page.locator('[data-testid="c0828-mag-due-change"]').inputValue();
  await page.fill('[data-testid="c0828-mag-due-change"]', "-3");
  step("7 幅度", `默认 ${mag} → 填 -3`);

  await page.click('[data-testid="c0828-add-due-change"]');
  await page.waitForSelector('[data-testid="c0828-chip-due-change"]', { timeout: 10000 });
  step("8 已加入暂存区", await page.locator('[data-testid="c0828-staged-count"]').textContent());

  // ── 开推
  const goDisabled = await page.locator('[data-testid="c0828-go"]').isDisabled();
  step("9 c0828-go disabled?", goDisabled);
  if (goDisabled) throw new Error("开始推演按钮点不动 ⇒ 停在此处（⛔ 不许把点不动读成没反应）");
  await page.click('[data-testid="c0828-go"]');

  // 稳态等待：等结果门开（money 块只在 result!==null 时挂）
  await page.waitForSelector('[data-testid="c0828-money"]', { state: "attached", timeout: 60000 });
  step("10 结果门开 c0828-money 挂进 DOM", "ok");
  await page.waitForTimeout(2500); // 稳态：留给后续 queryClient 失效重取
  const hidden0 = await page.locator('[data-testid="c0828-pane-money"]').isHidden();
  step("10b 财务影响页签是当前页签吗（pane hidden?）", hidden0);
  await page.click('[data-testid="c0828-tab-money"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="c0828-pane-money"]')?.hasAttribute("hidden"),
    { timeout: 10000 },
  ).catch(() => step("10c 切到「财务影响」页签", "TIMEOUT"));
  await page.waitForTimeout(400);
  const visibleNow = await page.locator('[data-testid="c0828-money"]').isVisible();
  step("10c 切到「财务影响」页签后 c0828-money 可见", visibleNow);

  // ── 三行钱实拍
  const moneyRows = await page.locator('[data-testid="c0828-pane-money"] .brkVal, [data-testid="c0828-money"] span').evaluateAll(
    (els) => els.map((e) => (e.textContent ?? "").trim()).filter(Boolean),
  );
  const nocalc = await page.locator('[data-testid^="c0828-nocalc-"]').allTextContents();
  const moneyCells = {};
  for (const label of ["新增成本", "毛利差额", "占压应收"]) {
    moneyCells[label] = await page.locator(`[data-testid="c0828-money-${label}"]`).textContent().catch(() => null);
  }
  out.dump = {
    nocalc,
    moneyCells,
    calibre: await page.locator('[data-testid="c0828-money-calibre"]').textContent().catch(() => null),
    detail: (await page.locator('[data-testid="c0828-money-detail"]').textContent().catch(() => null))?.slice(0, 900) ?? null,
    exposure: await page.locator('[data-testid="c0828-exposure"]').textContent().catch(() => null),
    exposureSub: await page.locator('[data-testid="c0828-exposure-sub"]').textContent().catch(() => null),
    moneyWholeText: (await page.locator('[data-testid="c0828-money"]').textContent().catch(() => null))?.slice(0, 2500) ?? null,
  };

  await page.screenshot({ path: SHOT, fullPage: false });
  out.screenshot = SHOT;
} catch (e) {
  out.fatal = String(e).slice(0, 600);
}

out.net = net.filter((x) => /\/(b\/v1\/solvers|a\/v1\/sim)/.test(x.url)).map((x) => ({
  kind: x.kind, status: x.status, method: x.method,
  url: x.url.replace("http://127.0.0.1:", ":"),
  body: x.body, snippet: x.snippet,
}));
await browser.close();
console.log(JSON.stringify(out, null, 1));
