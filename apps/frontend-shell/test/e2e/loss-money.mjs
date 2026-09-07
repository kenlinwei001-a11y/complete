/* eslint-disable */
/**
 * WO-LOSS-ATTRIB-MONEY · 真浏览器取证：损失归因这一屏「有没有钱」。
 *
 * ⛔ 三条纪律照 `lib.mjs` 头注：禁 VITE_MOCK（`assertNoMock` 实测网络回包，不是自证）、
 *    必须从登录走起（唯一 `goto` 是站点根）、报否定结论前先跑金丝雀。
 *
 * 本跑要回答的三问（每问都带金丝雀）：
 *  ① 损失归因屏上有没有**元金额**？—— 金丝雀：同一把尺子量经营驾驶舱必须量得到（亿/万）。
 *  ② 后端**回包里**有没有金额？—— 走用户那条路上的真回包（`attachNetLog`），不是 curl 的。
 *  ③ 热力表 13 列拆得开吗？—— 直接从回包读 `cells`，逐行数跨基地去重。
 */
import { launch, login, shot, attachNetLog, assertNoMock, visibleText, sleep } from "./lib.mjs";

const out = { env: { BASE: process.env.E2E_BASE, VITE_MOCK: process.env.VITE_MOCK ?? "(未设置)" } };
const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

/** 同一把尺子：整屏金额扫描。三个单位分开数，供金丝雀对照。 */
function moneyRuler(text) {
  const n = (re) => (text.match(re) ?? []).length;
  return {
    元: n(/元/g),
    亿: n(/亿/g),
    万: n(/万/g),
    天D: n(/\d+(?:\.\d+)?\s*D\b/g),
    百分比: n(/\d+(?:\.\d+)?\s*%/g),
    样本: (text.match(/[^\n]{0,30}(?:亿元|万元|元)[^\n]{0,15}/g) ?? []).slice(0, 8),
  };
}

/** 点着走：在整页里按可见文本找一个可点元素并点它。⛔ 不许 goto。 */
async function clickByText(page, texts) {
  for (const t of texts) {
    const el = page.locator(`a:visible, button:visible, [role="tab"]:visible, [role="button"]:visible`).filter({ hasText: t }).first();
    if ((await el.count()) > 0) {
      await el.click({ timeout: 8000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await sleep(1200);
      return { clicked: t, url: page.url() };
    }
  }
  return { clicked: null, url: page.url(), tried: texts };
}

try {
  out.landedAfterLogin = await login(page);
  await sleep(1800);
  out.noMock = assertNoMock(net);
  out.shots = [await shot(page, "L1-home-after-login")];

  // ── 金丝雀：先量经营驾驶舱，证明尺子是好的 ────────────────────────────
  out.canary = { nav: await clickByText(page, ["经营驾驶舱", "驾驶舱", "经营"]) };
  await sleep(2500);
  out.canary.money = moneyRuler(await visibleText(page));
  out.shots.push(await shot(page, "L2-canary-cockpit"));

  // ── 回首页，再点去 损失归因 ───────────────────────────────────────────
  await clickByText(page, ["首页", "主页"]);
  await sleep(1200);
  out.navToSim = await clickByText(page, ["推演", "沙盘", "决策沙盘"]);
  await sleep(2000);
  out.shots.push(await shot(page, "L3-sim-entry"));
  out.navToAttr = await clickByText(page, ["损失归因", "归因"]);
  await sleep(3500);
  out.shots.push(await shot(page, "L4-loss-attribution"));

  // ① 屏上金额
  const attrText = await visibleText(page);
  out.screenMoney = moneyRuler(attrText);
  out.screenSample = attrText.split("\n").filter((l) => l.trim()).slice(0, 40);

  // ② 用户那条路上的真回包
  const mx = net.filter((e) => /chain-loss-matrix/.test(e.url));
  out.matrixCalls = mx.map((e) => ({ status: e.status, url: e.url, bytes: e.body?.length ?? 0 }));
  const body = mx.map((e) => e.body).filter(Boolean).pop();
  if (body) {
    const j = JSON.parse(body);
    const raw = JSON.stringify(j);
    out.payloadMoney = {
      valueAtRiskYuan命中: (raw.match(/"valueAtRiskYuan"/g) ?? []).length,
      exposureYuan命中: (raw.match(/"exposureYuan"/g) ?? []).length,
      金丝雀_days命中: (raw.match(/"days"/g) ?? []).length,
      money块: j.money ?? null,
      summary: j.summary ?? null,
    };
    // ③ 13 列拆得开吗（直接读回包）
    const byNode = {};
    for (const c of j.cells ?? []) (byNode[c.nodeId] ||= []).push(c);
    out.spread = (j.nodes ?? []).map((n) => {
      const cs = byNode[n.nodeId] ?? [];
      return {
        label: n.label,
        days去重: new Set(cs.map((c) => c.days)).size,
        金额去重: new Set(cs.map((c) => c.valueAtRiskYuan)).size,
      };
    });
    out.spreadSummary = {
      行数: out.spread.length,
      days同值行: out.spread.filter((r) => r.days去重 <= 1).length,
      金额同值行: out.spread.filter((r) => r.金额去重 <= 1).length,
    };
  } else {
    out.payloadMoney = "本次没抓到 chain-loss-matrix 回包（可能这一屏还没触发取数）";
  }

  out.consoleErrors = consoleErrors.slice(0, 15);
} catch (e) {
  out.FATAL = String(e && e.stack ? e.stack : e);
  try { out.shots.push(await shot(page, "ERR-loss-money")); } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
