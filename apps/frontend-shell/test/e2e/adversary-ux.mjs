/* eslint-disable */
/**
 * WO-ADVERSARY-REACTION · **前后端一起测**：对抗方开/关两态，屏上同一个读数前后两个值。
 *
 * ⛔ 三条硬纪律（与 `lib.mjs` 同源，这里再声明一次因为它们是本文件成立的前提）：
 *  1. **禁 VITE_MOCK** —— `assertNoMock()` 实测校验，不靠「我没设那个变量」自证。
 *  2. **必须从登录走起** —— `login()` 是唯一入口，⛔ 不许 `page.goto('/v/xxx')` 直达。
 *  3. **报「屏上没有」之前先自证量法** —— 先对一个**已知必在**的目标跑一遍（金丝雀）。
 *
 * ⛔ 本脚本**只观测，不改 `src/views/sim/` 一行**（仓主禁令 2 冻结沙盘 UX）。
 *
 * ── 两个实测踩到的坑，写在这里防复发（都是「我用 X 当作 Y 的证据」形态）──────────
 *  · **分组按钮标签是「▾推演」——▾ 表示本来就展开**。无条件点它等于把分组**折叠**，
 *    随后目标链接 `element is not visible`、点击超时 30s。⇒ 判据改成**目标链接可见性**。
 *  · **entitlement 是登录那一刻取的**（`/a/v1/me/workspace`），SPA 之后不再refetch。
 *    先登录、再改功能开关 ⇒ 路由守卫仍用旧的那份，屏上弹「该功能已被管理员关闭」
 *    并弹回首页（`navigated:false`），而后端其实已经开了。
 *    ⇒ **开关必须在 login 之前设**；两态各起一个全新浏览器上下文。
 */
import { launch, login, shot, attachNetLog, assertNoMock, visibleText, sleep } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const A = "http://127.0.0.1:4001";
const HDR = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };
const RULE = "demo_customer_reaction_cut_order";
const CUST = "obj_customer_cust_0";
const out = { steps: [], perState: {}, findings: {} };

async function api(method, path, body) {
  const r = await fetch(A + path, { method, headers: HDR, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

/** 开/关对抗方。⚠ 必须**显式发 false** —— 省略该键 ⇒ 落回 L2 行业模板（battery 全开）= 其实是开的。 */
async function setAdversary(on) {
  await api("PUT", "/a/v1/tenants/demo/features", {
    overrides: {
      "sim.sandbox": true, "sim.propagation": true, "sim.certification": true,
      "sim.propagation.adversary": !!on,
    },
  });
  const f = await api("GET", "/a/v1/tenants/demo/features");
  return (f.json.features ?? []).includes("sim.propagation.adversary");
}

/** 建会话 + 推 3 拍（带披露）。走的是**前端同一个后端**、同一条真路由。 */
async function driveWorld() {
  const s = await api("POST", "/a/v1/sim/sessions", { baseSnapshot: { [CUST]: { receivablePressure: 96 } } });
  const t = await api("POST", `/a/v1/sim/sessions/${s.json.id}/tick?disclose=1`, { n: 3 });
  return { state: t.json.state, disclosure: t.json.disclosure };
}

/** 一态一跑：设开关 → **全新上下文登录** → 点进统一推演控制台 → 读屏。 */
async function runState(label, adversaryOn) {
  const flagOn = await setAdversary(adversaryOn);
  const world = await driveWorld();
  const { browser, page, consoleErrors } = await launch();
  const net = attachNetLog(page);
  const landed = await login(page, { user: "admin", password: "demo1234", tenant: "demo" });
  const mock = assertNoMock(net);

  // 🐤 金丝雀 a：读屏这个量法本身有没有鉴别力（首页必须命中一个已知必在的中文词）。
  const homeText = await visibleText(page);
  const canaryHome = /推演|驾驶舱|订单/.test(homeText);

  // ── 从首页**点**进统一推演控制台（⛔ 零手敲 URL）────────────────────────────
  const nav = [];
  const before = page.url();
  const SEL = '[data-testid="nav-sim-unified"]';
  let visible = await page.isVisible(SEL).catch(() => false);
  nav.push({ step: "目标链接初始可见", visible });
  if (!visible) {
    const g = await page.$('[data-testid="nav-group-toggle-推演"]');
    if (g !== null) { await g.click().catch(() => {}); await sleep(600); }
    visible = await page.isVisible(SEL).catch(() => false);
    nav.push({ step: "点开分组后可见", visible });
  }
  if (visible) {
    await page.click(SEL, { timeout: 15000 }).catch((e) => nav.push({ clickErr: String(e).slice(0, 120) }));
    await page.waitForFunction((u) => location.href !== u, before, { timeout: 20000 }).catch(() => {});
    await sleep(4000);
  }
  const reached = page.url();

  // 披露层要**真跑过一拍**才有内容：把屏上 <details> 全展开，并试着点一次推进。
  const runBtn = await page.$('button:has-text("推进"), button:has-text("运行")');
  if (runBtn !== null) { await runBtn.click().catch(() => {}); await sleep(5000); }
  await page.$$eval("details", (ds) => ds.forEach((d) => (d.open = true))).catch(() => {});
  await sleep(600);
  const toggle = await page.$('[data-testid="sim-disclosure-rule-items-toggle"]');
  if (toggle !== null) { await toggle.click().catch(() => {}); await sleep(1000); }
  await page.$$eval("details", (ds) => ds.forEach((d) => (d.open = true))).catch(() => {});
  await sleep(600);

  const text = await visibleText(page);
  const file = await shot(page, `adv-${label}`);
  await browser.close();

  const oid = Object.keys(world.state).filter((k) => k.startsWith("obj_order_")).sort()[0] ?? null;
  return {
    flagOn, landed, navigated: reached !== before, reachedUrl: reached, nav, screenshot: file,
    noMock: mock,
    canaryHomeReadable: canaryHome,
    backend: {
      probeOrder: oid,
      orderChurn: oid ? (world.state[oid]?.orderChurn ?? 0) : null,
      adversary: world.disclosure?.rules?.adversary ?? null,
    },
    onScreen: {
      // 🐤 金丝雀 b：一条**确定存在的既有边**在屏上的样子。
      //    ⚠ 第一版金丝雀找的是**规则 key**（`demo_order_demand_pressure`），全屏读不到 ⇒
      //    我差点据此报「屏上没有还手边」。实际这块面板渲染的是**人话名 + via 串**，
      //    压根不显示 key —— **是我的量法在找一个屏上从来不存在的东西**。
      //    形态：「我用『我要的串没读到』当作『那个东西不在屏上』的证据。」
      //    金丝雀不中就必须先修量法，不许直接下否定结论。
      canaryExistingEdgeVia: text.includes("Customer.receivablePressure"),
      canaryEdgeCountLabel: /条边/.test(text),
      edgeCountText: (text.match(/\d+\s*条边[^\n]{0,12}/) ?? [null])[0],
      // ── 还手边**本身**在不在屏上（走 via 串，与屏上真实渲染同一形态）──────────
      reactionViaOnScreen: text.includes("customer_places_order"),
      reactionTargetOnScreen: text.includes("Order.orderChurn"),
      reactionHumanName: /订单变更压力/.test(text),
      reactionCoefficientOnScreen: /系数\s*0\.35/.test(text),
      // ── 还手**专有**字段（后端已下发，屏上有无展示位）────────────────────────
      moveName: text.includes("砍单"),
      toleranceLabel: /容忍/.test(text),
      adversarySummary: /对抗方/.test(text),
      triggeredActorsLabel: /还手|越线/.test(text),
      disclosurePanelPresent: toggle !== null,
      reactionRuleKey: text.includes(RULE),
      weightBasis: text.includes("actor_exposure_relative"),
      normalize: text.includes("SOURCE_POOL_MEAN"),
      textLen: text.length,
    },
    consoleErrors: consoleErrors.slice(0, 5),
  };
}

const main = async () => {
  out.perState.OFF = await runState("off", false);
  out.perState.ON = await runState("on", true);
  const a = out.perState.OFF, b = out.perState.ON;
  // 「同一读数前后两值」必须读**同一个格子**：OFF 态那张单压根没被写过 ⇒ 它的 state 里
  // 没有这个 key。拿 ON 态定位到的那张单回头去 OFF 态取，两边才是同一个坐标。
  if (b.backend.probeOrder !== null) {
    const off2 = await (async () => {
      await setAdversary(false);
      const w = await driveWorld();
      return w.state[b.backend.probeOrder]?.orderChurn ?? 0;
    })();
    a.backend.orderChurnSameCell = off2;
    a.backend.probeOrderSameCell = b.backend.probeOrder;
  }
  out.findings.verdict = {
    两态开关: { OFF: a.flagOn, ON: b.flagOn },
    同一读数前后两值: {
      格子: b.backend.probeOrder,
      orderChurn_OFF: a.backend.orderChurnSameCell ?? a.backend.orderChurn,
      orderChurn_ON: b.backend.orderChurn,
    },
    屏上还手边: { OFF: a.onScreen, ON: b.onScreen },
    两张截图: [a.screenshot, b.screenshot],
    真后端: { OFF: a.noMock.ok, ON: b.noMock.ok },
    进到推演页: { OFF: a.navigated, ON: b.navigated },
  };
  writeFileSync(new URL("./adversary-ux-output.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error("E2E_FAILED", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
