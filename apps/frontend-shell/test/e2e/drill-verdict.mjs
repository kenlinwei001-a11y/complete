/* eslint-disable */
/**
 * WO-DRILL-VERDICT-BACKEND · 真浏览器取证（仓主硬要求：前后端一起测）
 *
 * ⛔ 三条硬纪律（继承 `lib.mjs`，此处不复述理由）：禁 VITE_MOCK · 必须从登录走起 ·
 *    报否定结论前先自证量法（金丝雀）。
 *
 * 本脚本回答两问，且**只观测不改** `views/sim/`（禁令 2）：
 *  ① 阈值改完之后，屏上那句「18.45 > 12 已触发」跟不跟着变？（修前修后各贴屏上原文）
 *  ② 会话 A 采纳一条措施后，屏上**哪里**能看到它？看不到就明写「后端已可查·屏上无入口」。
 */
import { login, launch, shot, attachNetLog, visibleText, sleep } from "./lib.mjs";
import { writeFileSync } from "node:fs";

/**
 * ⚠ **不复用 `lib.mjs` 的 `assertNoMock`**：它把端口写死成 4001/4002，而本单的栈跑在
 * 4071/4082（4001/4002/5173 被**别的 agent** 占着，不许动）。直接复用会恒报「0 条真回包
 * ⇒ 疑似 mock」—— 那不是 mock 的证据，是**量法对错了端口**。本轮第一次跑就踩了这个坑。
 * 形态：「我用『没有打到 4001 的回包』当作『没打真后端』的证据，而前者并不度量后者。」
 */
const REAL_PORTS = /127\.0\.0\.1:(4071|4082)/;
function assertNoMockOnMyPorts(netLog) {
  const real = netLog.filter((e) => REAL_PORTS.test(e.url) && e.status >= 200 && e.status < 400);
  return { ok: real.length > 0, realHits: real.length, sample: real.slice(0, 5).map((e) => `${e.status} ${e.method} ${e.url}`) };
}

const DC = process.env.E2E_DATACORE ?? "http://127.0.0.1:4071";
const OUT = process.env.E2E_OUT ?? "apps/frontend-shell/test/e2e/drill-verdict-output.json";
const HDR = { "content-type": "application/json", "x-debug-user": "demo:admin:admin|planner|catalog_admin" };
const PLANNER = { "content-type": "application/json", "x-debug-user": "demo:planner:planner" };

const api = async (path, init) => {
  const r = await fetch(DC + path, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
};

/**
 * 在整屏文本里找**触发判定**那一句。
 * ⚠ 不用「包含 12」这种匹配：页面上到处是数字，12 会到处命中（假阳性）。
 * 判据落在**触发动作名 + 阈值符号**这种句法特征上，并把命中行原文整句返回。
 */
function findTriggerLines(text, needle) {
  return text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0 && s.includes(needle));
}

const report = { steps: [], screen: {}, verdict: {} };
const say = (...a) => { console.log(...a); report.steps.push(a.join(" ")); };

const run = async () => {
  const { browser, page, consoleErrors } = await launch();
  const net = attachNetLog(page);

  // ── 本单的命门观测：浏览器**真正发出去**的 chain-loss 请求体长什么样 ─────────
  // 后端已收 `sessionId`（本单改的），但前端发不发是另一回事。
  // 只 grep 源码会被读成"接了线"；这里记的是**用户那条路上真发出的字节**。
  const chainLossReqs = [];
  page.on("request", (r) => {
    if (/\/a\/v1\/sim\/chain-loss-(matrix|drill)/.test(r.url())) {
      chainLossReqs.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ""), body: r.postData() });
    }
  });

  // ── 0 · 真登录（唯一 goto 是站点根，之后全靠点）───────────────────────────
  const landed = await login(page, { user: "admin" });
  say("登录后落点 URL =", landed);
  await sleep(1500);
  const mock = assertNoMockOnMyPorts(net);
  say("禁 mock 自证：真后端(4071/4082) 200 回包", mock.realHits, "条 ⇒", mock.ok ? "确为真后端" : "❌ 疑似 mock");
  say("  样本:", mock.sample.join(" | "));
  report.noMock = mock;
  await shot(page, "dv-01-home");

  // ── 1 · 判据①：先在屏上找到「触发」那一屏 ─────────────────────────────────
  // 从首页开始**点**过去，不手敲 URL（手敲会让"找不到入口"这类问题凭空消失）。
  const navTexts = await page.$$eval("a, button, [role=tab], [role=button]", (els) =>
    els.map((e) => (e.innerText || e.textContent || "").trim()).filter((s) => s && s.length < 30),
  );
  report.screen.navCandidates = [...new Set(navTexts)].slice(0, 80);
  say("首页可点项（前 40）:", report.screen.navCandidates.slice(0, 40).join(" | "));

  // 触发判定挂在 `DecisionPlayPanel`，它**不占导航位**（`ShellLayout.tsx:287` 仓主裁决：
  // 「决策推演不该占导航位，已嵌入各决策点」），嵌在订单链 / 链阻滞 / 壳布局三处。
  // 故这里点导航里的**订单进展与卡因**（= OrderChainView，嵌 DecisionPlayEmbed）。
  // ⛔ 仍不手敲 URL：全靠点。
  // ⛔ 仍然只**点**，不手敲 URL —— 但改用 `a[href=…]` 精确定位，因为 `text=` 会多义命中
  // （首轮实测「订单进展与卡因」`text=` 点击 8s 超时，而它的 href 就在导航里，可点）。
  // href 从 `nav-probe.mjs` 实测枚举得来，不是猜的。
  const LEAVES = [
    ["/v/order-chain", "订单进展与卡因（嵌 DecisionPlayEmbed）"],
    ["/v/chain-impediments", "全链阻滞点（嵌 DecisionPlayEmbed）"],
    ["/v/sim-unified", "统一推演控制台"],
    ["/v/sim-attribution", "损失归因（真打 chain-loss-matrix）"],
    ["/v/chain-line-map", "全链线路图"],
    ["/v/risk", "产能推演（风险卡）"],
  ];
  // 触发行的句法特征 = 触发动作名 / 阈值出处标签（不是"含 12"——页面到处是数字，那会假阳性）。
  const NEEDLES = ["启动备份供应商认证", "备份供应商", "长协重谈", "汇率对冲", "阈值来自", "规则参数"];
  const scanTriggers = (text) => [...new Set(NEEDLES.flatMap((n) => findTriggerLines(text, n)))];

  const tried = [];
  let triggerHitPage = null;
  for (const [href, label] of LEAVES) {
    const link = await page.$(`a[href="${href}"]`);
    if (!link) { tried.push(`${label}:导航里没有 ${href}`); continue; }
    try {
      await link.click({ timeout: 8000 });
      await sleep(5000);
      const t = await visibleText(page);
      const hits = scanTriggers(t);
      const url = page.url().replace(/^https?:\/\/[^/]+/, "");
      tried.push(`${label}:进入(${url}) 触发句命中${hits.length}`);
      await shot(page, `dv-nav-${href.replace(/\//g, "_")}`);
      if (hits.length > 0 && triggerHitPage === null) triggerHitPage = { entry: label, href, url, lines: hits };
    } catch (e) {
      tried.push(`${label}:点击失败 ${String(e.message).slice(0, 50)}`);
    }
  }
  report.screen.tried = tried;
  say("入口尝试:", tried.join(" ; "));
  if (triggerHitPage) { report.screen.triggerEntry = triggerHitPage; say("触发判定所在屏:", triggerHitPage.href); }

  // ── 金丝雀：证明"扫屏"这个量法本身有鉴别力 ────────────────────────────────
  // 拿一个**确定在屏上**的串（登录后的租户名/用户名）扫一遍；扫不到 ⇒ 量法坏了。
  const bodyText = await visibleText(page);
  const canary = ["demo", "admin"].filter((s) => bodyText.toLowerCase().includes(s));
  say("扫屏金丝雀（确定在屏上的串）命中:", canary.join(",") || "(无)");
  report.screen.canary = { hits: canary, ok: canary.length > 0, textLen: bodyText.length };
  if (canary.length === 0) say("⚠ 金丝雀不中 ⇒ **量法坏了**，下面所有『屏上没有』的结论都不算数");

  await shot(page, "dv-02-after-nav");
  report.screen.triggerBefore = triggerHitPage;
  say("修改前·屏上触发判定原文:", triggerHitPage ? JSON.stringify(triggerHitPage.lines) : "(这一屏上没找到触发判定)");

  // ── 2 · 经真 REST 改阈值 12 → 30（用户可走的同一条路）───────────────────
  const created = await api("/a/v1/rules", {
    method: "POST", headers: HDR,
    body: JSON.stringify({
      key: "trigger_thresholds", name: "触发阈值(真浏览器取证)",
      expression: "TriggerRule.threshold > 0", scopeObjectTypes: ["TriggerRule"],
      severity: "INFO", params: { "trig-backup-cert": 30 },
    }),
  });
  say("建规则:", created.status, created.json?.id ?? JSON.stringify(created.json ?? created.text).slice(0, 200));
  if (created.json?.id) {
    const pub = await api(`/a/v1/rules/${created.json.id}/publish`, { method: "POST", headers: HDR, body: "{}" });
    say("发布规则:", pub.status);
  }
  report.verdict.ruleCreate = created.status;

  // ── 3 · 回到**同一屏**（不是刷根），看那句判定跟没跟着变 ─────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(4500);
  const after = await visibleText(page);
  report.screen.triggerAfter = scanTriggers(after);
  const afterLines = report.screen.triggerAfter;
  say("修改后·屏上触发判定原文:", JSON.stringify(report.screen.triggerAfter));
  await shot(page, "dv-03-after-threshold");

  // 后端侧同一时刻的真值（屏上没有时，用它区分「后端没变」与「屏上没渲染」——两者修法不同）。
  const dp = await api("/a/v1/solvers/decision_play/invoke", { method: "POST", headers: HDR, body: "{}" });
  const trg = ((dp.json?.data ?? dp.json)?.triggers ?? []).map(
    (x) => `${x.triggerId} 值=${x.signalValue} ${x.op} 阈=${x.threshold} fired=${x.fired} 出处=${x.thresholdSource}`,
  );
  report.verdict.backendTriggersAfter = trg;
  say("后端同一时刻 triggers:", JSON.stringify(trg));

  // ── 4 · 判据②：采纳一条措施，然后在屏上找它 ──────────────────────────────
  const before = await api("/a/v1/objects?type=AdoptedMitigation&pageSize=50", { headers: HDR });
  const draft = await api("/a/v1/action-drafts", {
    method: "POST", headers: HDR,
    body: JSON.stringify({
      actionTypeKey: "adopt_mitigation", title: "真浏览器取证:瓶颈工序扩容",
      // 换一个**没采纳过**的基地，好让条数是干净的 +1（常州那条前面的实验已采过，再采是幂等覆盖）。
      payload: { factor: "瓶颈工序", planKey: "reroute", base: "枣庄" },
    }),
  });
  const did = draft.json?.draftId;
  say("采纳单 draftId=", did);
  if (did) {
    await api(`/a/v1/action-drafts/${did}/approve`, { method: "POST", headers: PLANNER, body: "{}" });
    const ok = await api(`/a/v1/action-drafts/${did}/approve`, { method: "POST", headers: HDR, body: "{}" });
    say("两级审批后 status=", (ok.json?.draft ?? ok.json)?.status, JSON.stringify((ok.json?.draft ?? ok.json)?.executionResult ?? {}));
  }
  const afterLedger = await api("/a/v1/objects?type=AdoptedMitigation&pageSize=50", { headers: HDR });
  report.verdict.ledger = { before: before.json?.total, after: afterLedger.json?.total };
  say("台账条数:", before.json?.total, "→", afterLedger.json?.total);

  // 屏上找：走到**风险看板**（后端就是在风险卡上挂 adoptedMitigation 的），再整屏扫。
  const riskLink = await page.$('a[href="/v/risk"]');
  if (riskLink) { try { await riskLink.click({ timeout: 8000 }); await sleep(5500); } catch { /* 点不动 */ } }
  say("台账观测落点 URL =", page.url().replace(/^https?:\/\/[^/]+/, ""));
  const t2 = await visibleText(page);
  const ledgerNeedles = ["已采纳", "采纳", "工艺路线调整", "reroute", "处置方案", "枣庄"];
  const ledgerHits = {};
  for (const n of ledgerNeedles) ledgerHits[n] = findTriggerLines(t2, n).slice(0, 4);
  report.screen.ledgerHits = ledgerHits;
  say("屏上台账相关命中:", JSON.stringify(ledgerHits));
  await shot(page, "dv-04-after-adopt");

  // 后端同一时刻：这张卡到底有没有 adoptedMitigation（分清「后端没给」与「屏上没渲染」）。
  const rt = await api("/a/v1/solvers/risk_timeline/invoke", { method: "POST", headers: HDR, body: "{}" });
  const cards = ((rt.json?.data ?? rt.json)?.cards ?? []).map(
    (c) => `${c.baseId ?? c.base}/${c.factor}: adopted=${JSON.stringify(c.adoptedMitigation ?? null)}`,
  );
  report.verdict.riskCardsAfter = cards;
  say("后端风险卡 adoptedMitigation:", JSON.stringify(cards));

  // ── 本单命门：前端到底发没发 sessionId ────────────────────────────────────
  report.verdict.chainLossRequests = chainLossReqs;
  const withSession = chainLossReqs.filter((r) => (r.body ?? "").includes("sessionId"));
  say("浏览器发出的 chain-loss 请求", chainLossReqs.length, "条，其中带 sessionId 的",
      withSession.length, "条 ⇒",
      chainLossReqs.length === 0 ? "（这几屏没触发该请求）"
        : withSession.length === 0 ? "**后端已收 sessionId，前端还没发** ⇒ 屏上仍是真实世界那条链" : "前端已发");
  say("  请求体样本:", chainLossReqs.slice(0, 3).map((r) => `${r.url} ${r.body}`).join(" | ") || "(无)");

  report.consoleErrors = consoleErrors.slice(0, 15);
  say("控制台错误数:", consoleErrors.length);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  say("报告已写:", OUT);
  await browser.close();
};

run().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
