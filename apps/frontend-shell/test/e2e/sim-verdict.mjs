/* eslint-disable */
/**
 * WO-SIM-VERDICT-FRONTEND · 真浏览器取证（仓主硬要求：前后端一起测）
 *
 * ⛔ 三条硬纪律（继承 `lib.mjs`，不复述理由）：禁 VITE_MOCK · 必须从登录走起 ·
 *    报否定结论前先自证量法（金丝雀）。
 *
 * 本脚本一次跑完三条缺口的屏上取证，**同一个 tag 跑修前 / 修后各一遍**，两份 JSON 对拍：
 *  ① 损失归因台：浏览器**真正发出**的 chain-loss 请求体带不带 `sessionId`；
 *     以及「根因树 / 归因明细」两块的屏上读数 md5（施扰动前 vs 施扰动后必须拉开）。
 *  ② 触发判定：屏上有没有「阈值多少 · 来自哪 · 触发没触发」。
 *  ③ 采纳台账：屏上看不看得见「上一次采纳了什么」。
 *
 * ⚠ **不复用 `lib.mjs` 的 `assertNoMock`**：它把端口写死成 4001/4002，本单的栈跑在
 *    4091/4092/5191。直接复用会恒报「0 条真回包 ⇒ 疑似 mock」——那不是 mock 的证据，
 *    是**量法对错了端口**（同坑已有一个 dev 踩过，写在 `drill-verdict.mjs` 头注里）。
 */
import { login, launch, shot, attachNetLog, visibleText, sleep } from "./lib.mjs";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TAG = process.env.E2E_TAG ?? "x";
const DC = process.env.E2E_DATACORE ?? "http://127.0.0.1:4091";
const OUT = process.env.E2E_OUT ?? `apps/frontend-shell/test/e2e/sim-verdict-${TAG}.json`;
const REAL_PORTS = /127\.0\.0\.1:(4091|4092)/;
const HDR = { "content-type": "application/json", "x-debug-user": "demo:admin:admin|planner|catalog_admin" };

const md5 = (s) => createHash("md5").update(s ?? "", "utf8").digest("hex");
const assertNoMockOnMyPorts = (netLog) => {
  const real = netLog.filter((e) => REAL_PORTS.test(e.url) && e.status >= 200 && e.status < 400);
  return { ok: real.length > 0, realHits: real.length, sample: real.slice(0, 4).map((e) => `${e.status} ${e.method} ${e.url}`) };
};
const api = async (path, init) => {
  const r = await fetch(DC + path, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
};
const lines = (text, needle) => text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0 && s.includes(needle));

const report = { tag: TAG, steps: [], attribution: {}, trigger: {}, ledger: {} };
const say = (...a) => { console.log(...a); report.steps.push(a.join(" ")); };

/** 读一块面板的屏上文本 + md5。面板不在 ⇒ 如实说「不在」而不是给一个空串的 md5。 */
const panel = async (page, testid) => {
  const el = await page.$(`[data-testid="${testid}"]`);
  if (el === null) return { present: false, text: null, md5: null };
  const text = (await el.evaluate((n) => n.innerText)).trim();
  return { present: true, text, md5: md5(text) };
};

/** 收集一族 `data-testid` 前缀命中的元素的屏上文本（**只取 innerText ⇒ 折叠起来的不算数**）。 */
const collect = async (page, prefix) =>
  page.$$eval(`[data-testid^="${prefix}"]`, (els) =>
    els.map((e) => ({ id: e.getAttribute("data-testid"), text: (e.innerText || "").replace(/\s+/g, " ").trim() })),
  );

/** 点顶部页签（`role=tab`）。返回是否点到。 */
const clickTab = async (page, label) => {
  const els = await page.$$('[role="tab"]');
  for (const e of els) {
    const t = ((await e.evaluate((n) => n.innerText)) || "").replace(/\s+/g, " ").trim();
    if (!t.includes(label)) continue;
    // 禁用的页签点不动 —— 如实回「禁用」而不是抛超时（超时会把整条取证打断，
    // 且「点不到」与「这一档被禁用」是两个结论）。
    if (await e.evaluate((n) => n.disabled === true || n.getAttribute("aria-disabled") === "true")) return "disabled";
    try { await e.click({ timeout: 8000 }); return true; } catch { return "clickfail"; }
  }
  return false;
};

const run = async () => {
  const { browser, page, consoleErrors } = await launch();
  const net = attachNetLog(page);
  const chainLossReqs = [];
  page.on("request", (r) => {
    if (/\/a\/v1\/sim\/chain-loss-(matrix|drill)/.test(r.url())) {
      chainLossReqs.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ""), body: r.postData(), hasSessionId: (r.postData() ?? "").includes("sessionId") });
    }
  });

  // ── 0 · 真登录（唯一 goto 是站点根，之后全靠点）────────────────────────────
  const landed = await login(page, { user: "admin" });
  say("登录后落点 URL =", landed);
  await sleep(1500);
  const mock = assertNoMockOnMyPorts(net);
  say("禁 mock 自证：真后端(4091/4092) 200 回包", mock.realHits, "条 ⇒", mock.ok ? "确为真后端" : "❌ 疑似 mock");
  say("  样本:", mock.sample.join(" | "));
  report.noMock = mock;
  await shot(page, `sv-${TAG}-01-home`);

  // 金丝雀：证明「扫屏」这把尺子有鉴别力（拿一个确定在屏上的串量一遍）。
  const homeText = await visibleText(page);
  report.canary = { hit: homeText.toLowerCase().includes("admin"), textLen: homeText.length };
  say("扫屏金丝雀 admin 命中:", report.canary.hit, "（不中 ⇒ 量法坏了，下面所有『屏上没有』都不算数）");

  // ── 1 · 损失归因台：点导航 → 统一推演控制台 → 损失归因页签（⛔ 不手敲 URL）─────
  const link = await page.$('a[href="/v/sim-unified"]');
  if (link === null) { say("❌ 导航里没有 /v/sim-unified"); }
  else {
    await link.click({ timeout: 8000 });
    await sleep(4000);
    say("落点:", page.url().replace(/^https?:\/\/[^/]+/, ""));
    const ok = await clickTab(page, "损失归因");
    say("点『损失归因』页签:", ok ? "成功" : "❌ 点不到");
    await sleep(6000);
    report.attribution.detail = await panel(page, "sandbox-attr-detail");
    report.attribution.tree = await panel(page, "sandbox-attr-tree");
    report.attribution.simctx = await panel(page, "sandbox-attr-simctx");
    await shot(page, `sv-${TAG}-02-attr`);
    say("归因明细 md5 =", report.attribution.detail.md5, "| 根因树 md5 =", report.attribution.tree.md5);
    say("推演上下文披露块（第一层）:", report.attribution.simctx.present ? JSON.stringify(report.attribution.simctx.text).slice(0, 400) : "(屏上没有这一块)");
    // 降层 ≠ 删除：第一层留了 `?` 记号，**真 hover** 一下证明逐段明细拿得到。
    const info = await page.$('[data-testid="info-sandbox-attr-simctx"]');
    if (info === null) report.attribution.simctxDetail = { present: false };
    else {
      await info.hover();
      await sleep(800);
      report.attribution.simctxDetail = await panel(page, "info-body-sandbox-attr-simctx");
      await shot(page, `sv-${TAG}-02a-simctx-detail`);
    }
    say("推演上下文明细（浮层·真 hover）:", JSON.stringify(report.attribution.simctxDetail.text ?? null));
    // ── 反向对照（同一屏、同一会话、同一个后端）───────────────────────────────
    // 「传导识别」这一档也调同一条矩阵端点，但它**不在本单点名的三处之内**，
    // 一个字节都没动 ⇒ 它发出的 body 必须仍是 `{}`。
    // 这条比「我没改那个文件」强：它证的是**用户那条路上真发出的字节**没变。
    const condOk = await clickTab(page, "传导识别");
    say("点『传导识别』页签（反向对照）:", condOk);
    await sleep(6000);
    await shot(page, `sv-${TAG}-02b-conduction`);
  }
  report.attribution.requests = chainLossReqs.slice();
  report.attribution.reverseControl = chainLossReqs.filter((r) => !r.hasSessionId).map((r) => `${r.url} ${r.body}`);
  say("反向对照 · 不带 sessionId 的请求:", JSON.stringify(report.attribution.reverseControl));
  const withSid = chainLossReqs.filter((r) => r.hasSessionId).length;
  say("浏览器发出的 chain-loss 请求", chainLossReqs.length, "条，带 sessionId 的", withSid, "条");
  say("  请求体:", chainLossReqs.map((r) => `${r.url} ${r.body}`).join(" | ") || "(无)");

  // ── 2 · 触发判定：屏上有没有「阈值多少 · 来自哪 · 触发没触发」──────────────
  // 探针串 = 触发动作名 / 阈值出处标签（不是「含 12」——页面到处是数字，会假阳性）。
  const NEEDLES = ["启动备份供应商认证", "备份供应商", "长协重谈", "汇率对冲", "阈值来自", "规则参数"];
  const scanTrig = (t) => [...new Set(NEEDLES.flatMap((n) => lines(t, n)))];
  // 触发判定挂在决策推演的嵌入处（`/v/order-chain` 是其中一个宿主，且是本单点名的三屏之一）。
  // ⛔ 仍不手敲 URL：走导航里的链接。
  const ocLink = await page.$('a[href="/v/order-chain"]');
  if (ocLink === null) say("❌ 导航里没有 /v/order-chain");
  else {
    await ocLink.click({ timeout: 8000 });
    await sleep(9000);
    say("触发判定观测落点 URL =", page.url().replace(/^https?:\/\/[^/]+/, ""));
    const ocText = await visibleText(page);
    report.trigger.screenHits = scanTrig(ocText);
    report.trigger.strip = await collect(page, "oc-play-trigstrip");
    await shot(page, `sv-${TAG}-03-trigger`);
    say("订单链屏上触发句命中:", JSON.stringify(report.trigger.screenHits));
    say("触发判定条:", JSON.stringify(report.trigger.strip));
  }

  const backendTrig = await api("/a/v1/solvers/decision_play/invoke", { method: "POST", headers: HDR, body: "{}" });
  report.trigger.backend = ((backendTrig.json?.data ?? backendTrig.json)?.triggers ?? []).map(
    (x) => `${x.triggerId} 值=${x.signalValue} ${x.op} 阈=${x.threshold} fired=${x.fired} 出处=${x.thresholdSource}`,
  );
  say("后端同一时刻 triggers:", JSON.stringify(report.trigger.backend));

  // ── 3 · 采纳台账：屏上看不看得见「上一次采纳了什么」──────────────────────
  const riskLink = await page.$('a[href="/v/risk"]');
  if (riskLink) { try { await riskLink.click({ timeout: 8000 }); await sleep(6000); } catch { say("风险看板点不动"); } }
  say("台账观测落点 URL =", page.url().replace(/^https?:\/\/[^/]+/, ""));
  const riskText = await visibleText(page);
  const LEDGER_NEEDLES = ["已采纳", "采纳", "工艺路线调整", "reroute", "处置方案", "起效"];
  report.ledger.hits = Object.fromEntries(LEDGER_NEEDLES.map((n) => [n, lines(riskText, n).slice(0, 5)]));
  report.ledger.adoptedLines = await collect(page, "risk-adopted-line-");
  say("屏上「已采纳」行:", report.ledger.adoptedLines.length, "条 ⇒", JSON.stringify(report.ledger.adoptedLines));
  await shot(page, `sv-${TAG}-04-risk`);
  say("屏上台账相关命中:", JSON.stringify(report.ledger.hits));

  const rt = await api("/a/v1/solvers/risk_timeline/invoke", { method: "POST", headers: HDR, body: "{}" });
  report.ledger.backendCards = ((rt.json?.data ?? rt.json)?.cards ?? []).map(
    (c) => `${c.baseId ?? c.base}/${c.factor}: adopted=${JSON.stringify(c.adoptedMitigation ?? null)}`,
  );
  say("后端风险卡 adoptedMitigation:", JSON.stringify(report.ledger.backendCards));

  report.consoleErrors = consoleErrors.slice(0, 15);
  say("控制台错误数:", consoleErrors.length);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  say("报告已写:", OUT);
  await browser.close();
};

run().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
