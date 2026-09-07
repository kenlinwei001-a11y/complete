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
 * 判据（协调方要的两项）：
 *  ① 开/关两态下**同一屏同一个读数**的前后两个值 + 两张截图；
 *  ② 可披露那一层（规则 key / 系数 / 承载条数）**屏上能不能读到** —— 读不到就明写
 *     「后端已下发、屏上无展示位」，这是交给仓主批禁令 2 的材料，不是可以省略的一句。
 */
import { launch, login, shot, attachNetLog, assertNoMock, visibleText, sleep, BASE } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const A = "http://127.0.0.1:4001";
const HDR = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };
const RULE = "demo_customer_reaction_cut_order";
const CUST = "obj_customer_cust_0";
const out = { steps: [], findings: {} };

async function api(method, path, body) {
  const r = await fetch(A + path, { method, headers: HDR, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

/** 开/关对抗方。⚠ 必须**显式发 false** —— 实测省略该键 ⇒ 覆盖被清掉、按默认走（本租户默认是开）。 */
async function setAdversary(on) {
  await api("PUT", "/a/v1/tenants/demo/features", {
    overrides: { "sim.sandbox": true, "sim.propagation": true, "view.risk-board": true, "sim.propagation.adversary": !!on },
  });
  const f = await api("GET", "/a/v1/tenants/demo/features");
  return (f.json.features ?? []).includes("sim.propagation.adversary");
}

/** 建会话 + 推 3 拍（带披露），回 {读数, 披露}。走的是**前端同一个后端**。 */
async function driveWorld() {
  const s = await api("POST", "/a/v1/sim/sessions", { baseSnapshot: { [CUST]: { receivablePressure: 96 } } });
  const sid = s.json.id;
  const t = await api("POST", `/a/v1/sim/sessions/${sid}/tick?disclose=1`, { n: 3 });
  return { sid, state: t.json.state, disclosure: t.json.disclosure };
}

const main = async () => {
  const { browser, page, consoleErrors } = await launch();
  const net = attachNetLog(page);

  // ── 步骤 1：真登录（⛔ 唯一允许的 goto 是站点根）────────────────────────────
  const landed = await login(page, { user: "admin", password: "demo1234", tenant: "demo" });
  out.steps.push({ n: 1, what: "登录 demo/admin/demo1234", landedUrl: landed });
  const mock = assertNoMock(net);
  out.findings.noMock = mock;
  if (!mock.ok) throw new Error("assertNoMock 失败 —— 这一屏没有打到真后端，本次取证作废");
  await shot(page, "adv-01-home-after-login");

  // ── 步骤 2：金丝雀 —— 先证明「读屏」这个量法本身有鉴别力 ────────────────────
  // 拿一个**已知必在**首页的串跑一遍；它若也读不到，那是量法坏了，不是屏上没有。
  const homeText = await visibleText(page);
  out.findings.canaryReadScreen = {
    homeTextLen: homeText.length,
    hasKnownString: /推演|驾驶舱|订单|首页|工作台/.test(homeText),
    note: "金丝雀：首页可见文本里必须命中一个已知必在的中文词；不命中 ⇒ 报『量法坏了』",
  };

  // ── 步骤 3：关闭态取一次读数（后端真跑，前端同源）──────────────────────────
  const offOn = await setAdversary(false);
  const off = await driveWorld();
  // ── 步骤 4：开启态再取一次 ────────────────────────────────────────────────
  const onOn = await setAdversary(true);
  const on = await driveWorld();

  const orderOf = (st) => {
    const ids = Object.keys(st).filter((k) => k.startsWith("obj_order_")).sort();
    return ids[0] ?? null;
  };
  const oid = orderOf(on.state) ?? orderOf(off.state);
  out.findings.readings = {
    featureFlag: { off: offOn, on: onOn },
    probeOrder: oid,
    orderChurn_OFF: oid ? (off.state[oid]?.orderChurn ?? 0) : null,
    orderChurn_ON: oid ? (on.state[oid]?.orderChurn ?? 0) : null,
    adversary_OFF: off.disclosure?.rules?.adversary ?? null,
    adversary_ON: on.disclosure?.rules?.adversary ?? null,
  };

  // ── 步骤 5：**从首页点进推演页**（⛔ 不许手敲 URL）────────────────────────
  // 入口找不到本身就是结论 —— 如实记下点了什么、到了哪。
  const navTried = [];
  let reached = null;
  for (const label of ["推演", "风险", "沙盘", "看板"]) {
    const link = await page.$(`a:has-text("${label}"), button:has-text("${label}")`);
    navTried.push({ label, found: link !== null });
    if (link !== null && reached === null) {
      await link.click();
      await sleep(2500);
      reached = page.url();
    }
  }
  out.steps.push({ n: 5, what: "从首页点导航进推演相关页", navTried, reachedUrl: reached });
  await shot(page, "adv-02-sim-page");

  // ── 步骤 6：屏上找可披露层（先金丝雀，再报否定结论）──────────────────────
  const simText = await visibleText(page);
  const panelToggle = await page.$('[data-testid="sim-disclosure-rule-items-toggle"]');
  if (panelToggle !== null) {
    await panelToggle.click();
    await sleep(800);
  }
  const afterText = await visibleText(page);
  out.findings.onScreenDisclosure = {
    panelPresent: panelToggle !== null,
    // 金丝雀：一条**确定存在**的既有规则 key —— 它若也读不到，说明面板压根没渲染，
    // 那么"还手边读不到"就不构成"后端没下发"的证据。
    canaryExistingRuleVisible: afterText.includes("demo_order_demand_pressure"),
    reactionRuleKeyVisible: afterText.includes(RULE),
    weightBasisVisible: afterText.includes("actor_exposure_relative"),
    normalizeVisible: afterText.includes("SOURCE_POOL_MEAN"),
    // 这几项是**还手专有**字段，DisclosurePanel today 没有它们的展示位（禁令 2 冻结未改）。
    moveNameVisible: afterText.includes("砍单"),
    toleranceLabelVisible: /容忍/.test(afterText),
    adversarySummaryVisible: /对抗方/.test(afterText),
    simTextLen: simText.length,
  };
  await shot(page, "adv-03-disclosure-panel");

  out.findings.consoleErrors = consoleErrors.slice(0, 10);
  await browser.close();
  writeFileSync(new URL("./adversary-ux-output.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error("E2E_FAILED", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
