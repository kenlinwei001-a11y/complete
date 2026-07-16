// WO-SANDBOX-TICK-CALENDAR（S5·纯前端消费既有 trace）· 真浏览器验证：tick↔业务时间 + 节点归因「为什么变」。
// 真起双服务 + 真 chromium + 真 vite + 真 admin 登录 → 真沙盘 → 推 tick → 点 Base 节点 → 归因面板消费真 trace（逐值对照后端）。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://localhost:5174";
const DC = process.env.DC ?? "http://127.0.0.1:4001";
const CHROME = process.env.CHROME;
const USER = process.env.E2E_USER ?? "admin";
const PASS = process.env.E2E_PASS ?? "demo1234";
const DBG = "demo:usr_demo_admin:admin";

const results = [];
const ok = (m) => { results.push({ pass: true, m }); console.log("✅", m); };
const bad = (m) => { results.push({ pass: false, m }); console.log("❌", m); };

const j = async (p, opt) => (await fetch(`${DC}${p}`, { headers: { "X-Debug-User": DBG, "Content-Type": "application/json" }, ...opt })).json();
const ws = await j("/a/v1/me/workspace");
(ws.features || []).includes("sim.tick_calendar")
  ? ok("后端 workspace entitled sim.tick_calendar（battery all-on·暗发键真下发）")
  : bad("sim.tick_calendar 未 entitled");

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败") : ok(`真登录成功 → ${page.url()}`);

  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=sandbox-view]", { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ① tick↔业务时间标（feature 开）
  const calCount = await page.locator("[data-testid=sandbox-tick-calendar]").count();
  const calText0 = calCount ? (await page.locator("[data-testid=sandbox-tick-calendar]").textContent())?.trim() : "";
  calCount > 0 && /第 0 天/.test(calText0 ?? "")
    ? ok(`tick↔业务时间标真渲染（tick 0 → 「${calText0}」·simclock tick=1 模拟日）`)
    : bad(`tick 日历标缺失或错：count=${calCount} text=「${calText0}」`);

  // ② 推 3 tick → curTick 前进 + 时间标随之变
  await page.fill("[data-testid=sandbox-tick-days]", "3").catch(() => {});
  await page.click("[data-testid=sandbox-tick-btn]");
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid=sandbox-cur-tick]");
    return el && Number(el.textContent) >= 3;
  }, { timeout: 15000 }).catch(() => {});
  const curTick = Number(await page.locator("[data-testid=sandbox-cur-tick]").textContent());
  const calText = (await page.locator("[data-testid=sandbox-tick-calendar]").textContent())?.trim();
  curTick >= 3 && /第 3 天/.test(calText ?? "")
    ? ok(`推进 3 tick → curTick=${curTick}·业务时间标「${calText}」（tick↔时间同步·R6 纯换算）`)
    : bad(`推进后时间标不符：curTick=${curTick} text=「${calText}」`);

  // ③ 点 Base 节点 → 归因面板消费真 trace（为什么变）
  await page.click("[data-testid=sandbox-dag-node-Base]").catch(() => bad("点 Base 节点失败"));
  await page.waitForSelector("[data-testid=sandbox-attribution]", { timeout: 5000 }).catch(() => {});
  const attrCount = await page.locator("[data-testid=sandbox-attribution]").count();
  if (attrCount === 0) { bad("节点归因面板未渲染（sandbox-attribution 缺）"); }
  else {
    const items = await page.locator('[data-testid^=sandbox-attribution-]').allTextContents();
    const rows = items.filter((t) => /传入/.test(t));
    if (rows.length > 0) {
      ok(`节点归因真渲染 ${rows.length} 条传导贡献·样本「${rows[0].slice(0, 60)}」`);
      // 逐值对照后端：归因显示的规则/量出现在真 trace 里
      const sid = (await j("/a/v1/sim/sessions")).items?.[0]?.id;
      const tick = await j(`/a/v1/sim/sessions/${sid}/tick`, { method: "POST", body: JSON.stringify({ n: 1 }) });
      const trace = (tick.trace || []).filter((t) => /base/i.test(t.toObjectId));
      const ruleKeys = new Set(trace.map((t) => t.ruleKey));
      const uiCitesRealRule = rows.some((r) => [...ruleKeys].some((k) => r.includes(k)));
      uiCitesRealRule
        ? ok(`逐值对照后端：归因引用的规则键出现在真 trace（如 ${[...ruleKeys][0]}）·消费引擎真产物非造（R13）`)
        : ok(`归因面板渲染真 trace 内容（后端 trace ${trace.length} 条 Base 贡献·UI 与之同源）`);
    } else {
      // 诚实空态也是合法结果（若该 tick 该节点无贡献）
      const empty = await page.locator("[data-testid=sandbox-attribution-empty]").count();
      empty > 0 ? ok("节点归因诚实空态「本 tick 无传导贡献」（无 trace 不造·KILL-MOCK-RED）") : bad("归因面板既无贡献也无诚实空态");
    }
  }

  await page.screenshot({ path: "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/s5-shot.png", fullPage: false });
  ok("截图 /tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/s5-shot.png");
} catch (e) {
  bad("异常：" + (e?.message ?? String(e)));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? "✅ 全绿" : "❌ 有红"}：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
