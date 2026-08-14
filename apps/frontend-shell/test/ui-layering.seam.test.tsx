import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";
import zh from "@/locales/zh";

/**
 * WO-UI-LAYERING-BURNDOWN · **接缝测试**：信息分层不是"少写点字"，是**内容搬到了另一层且搬得到**。
 *
 * ── 这条测试守的是什么（与门的分工，别混）──────────────────────────────────────
 * `scripts/check-ui-first-layer.mjs` 是**计数**门：它数得出「第一层少了 16 块、浮层多了 16 块」，
 * 但它**证明不了**那 16 块是不是真的还在、hover 之后是不是真的出得来 ——
 * 静态计数与"用户点得到"是两个命题。本文件补的正是后者：**真 hover / 真点击**，
 * 不查 DOM 存在（`InfoPopover` 关着时**根本不渲染**，查存在会把"没搬"读成"搬好了"）。
 *
 * ── 三页（从**真实 workspace** 出发，不是隔离挂组件）─────────────────────────
 *   `/v/decision-play`（合并后的行动清单）· `/v/sop-balance`（口径降层）· `/v/risk`（产能推演）
 *
 * ── 反向判据（本文件的要害，逐条都是"曾经真的错过"的形态）───────────────────
 *   ① **一刀切降层把结论也埋了** —— 「下面显示的是默认根因」是**结论**不是解释，删了/藏了都算错。
 *   ② **静默降层** —— 第一层不留 `?`，内容等于消失（规范 §1 原文）。
 *   ③ **两套源各说一遍** —— 同一个行动出两行、两种措辞。
 *   ④ **把规则模板与当前值排成一行** —— 屏上出现「7.18 > 8」这种**假断言**。
 *   ⑤ **把「无规则」与「未触发」合成一句** —— 一个词盖住两个不同事实。
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * decision_play 引擎态（**刻意造出四种行动形态**，一种都不许在屏上丢）
 *   · opt-backup-cert  有方案 + 有规则，规则**未到线** ← ④ 假断言那条（7.18 > 8）
 *   · opt-lta-clause   有方案 + 有规则，**已触发**
 *   · opt-insource     有方案 **无规则**（来自求解器推荐）← ⑤ 三态里最容易被合并掉的那个
 *   · trig-fx-hedge    **只有规则没有方案** ← 对不上就独立成行，不许丢
 * ═══════════════════════════════════════════════════════════════════════════ */
const DIMS0 = { cost: 100, cycleDays: 30, risk: 0.2, exposure: 0.1, reversibility: 0.8 };
const PROV = { kind: "求解器", basis: "BackupSupplierPool.certWeeks", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillValue: 16 };
const OPTIONS = [
  { optionId: "opt-backup-cert", factorId: "cf-upstream-cut", label: "缩短备份供应商认证周期", sourceKind: "solver", closesGap: 3.2, ...DIMS0, provenance: PROV },
  { optionId: "opt-lta-clause", factorId: "cf-upstream-cut", label: "长协加价格联动条款", sourceKind: "agent", closesGap: 4.1, ...DIMS0, provenance: { ...PROV, kind: "策略推理", basis: "LongTermAgreement.priceLinked", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 0 } },
  { optionId: "opt-insource", factorId: "cf-upstream-cut", label: "上游自采矿+战略储备", sourceKind: "agent", closesGap: 5.5, ...DIMS0, cycleDays: 180, provenance: { ...PROV, kind: "策略推理", basis: "正极供应缺口", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 600 } },
];

/**
 * ⚠ 这三条 `action` 措辞**刻意与上面的 `label` 不一致** —— 那不是我编的，
 * 那是今天生产里的真实症状：两个源在说同一批行动。
 *   区④ ← `synthetic/battery-extended.ts` 的 `TRIGGER_RULES.action`（「启动备份供应商认证」）
 *   区⑤ ← `solvers/service.ts` 的方案 `label`（「缩短备份供应商认证周期」）
 * 本文件断言的正是：合并之后**这两种说法不会同时出现在屏上**。
 */
const TRIGGERS = [
  // 未触发：7.18 不大于 8。这一条是「假断言」判据的靶子。
  { triggerId: "trig-backup-cert", signalRef: "usd_cny", signalValue: 7.18, op: ">", threshold: 8, fired: false, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
  { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", signalValue: 96000, op: ">", threshold: 90000, fired: true, action: "长协重谈加价格联动条款", thresholdSource: "rule.params" },
  // 对不上任何方案 ⇒ 独立成行（不许丢）。
  { triggerId: "trig-fx-hedge", signalRef: "usd_cny_hedge", signalValue: 1, op: ">", threshold: 9, fired: false, action: "启动汇率对冲", thresholdSource: "trigger.default" },
];

const DP = {
  rootCause: { factorId: "cf-upstream-cut", label: "上游减供", metricKey: "seg_attain_ess", gap: 27.8, unit: "%" },
  options: OPTIONS,
  matrix: OPTIONS.map((o) => ({ optionId: o.optionId, label: o.label, dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility } })),
  triggers: TRIGGERS,
  recommendedPlan: {
    planId: "plan-cf-upstream-cut",
    optionIds: ["opt-lta-clause", "opt-backup-cert", "opt-insource"],
    steps: [
      { phase: "即刻", action: "长协加价格联动条款", optionRef: "opt-lta-clause" },
      { phase: "本季", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
      { phase: "半年", action: "上游自采矿+战略储备", optionRef: "opt-insource" },
    ],
    totalClosesGap: 12.8,
    totalCost: 300,
  },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 15.0, narrowedPct: 46.04, ticks: 0 },
  summary: "根因「上游减供」→ 3 方案比对",
};

/** 「从阻滞点进来」且**没对到因子**的入参（§2.3 那句结论就挂在这条路径上）。 */
const IMP_QS =
  "?fromImpediment=imp-1&impKind=物料齐套&impStage=SUPPLY&impRule=rule-kit" +
  "&impLocusType=MaterialBalance&impLocusId=mb-1&impLocusLabel=正极物料平衡&impMode=PARTIAL&impJoin=NO_FACTOR_DIMENSION";

function dpHandler(payload: unknown) {
  return http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: payload, snapshotVersion: "ov-dp" }));
}

function openDecisionPlay(qs = "") {
  loginAs("planner");
  server.use(dpHandler(DP));
  return renderApp(`/v/decision-play${qs}`);
}

/** 第一层 = 不点、不悬停就看得见的那一屏。 */
const visibleText = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

describe("WO-UI-LAYERING-BURNDOWN · 信息分层接缝（三页 · 真 hover 非查 DOM）", () => {
  it("① 降到浮层的内容**默认不可见**，真 hover 之后**可见**（三页各验一条）", async () => {
    const user = userEvent.setup();

    // ── 页 1 · 决策推演：行动清单的「凭什么」（规则 op/阈值/当前值/thresholdSource）在浮层 ──
    openDecisionPlay();
    await screen.findByTestId("dp-plan");
    // 默认：浮层正文**不在 DOM 里**（InfoPopover 关着时不渲染 —— 藏起来的东西照样被读屏念）
    expect(screen.queryByTestId("dp-why-opt-backup-cert")).toBeNull();
    await user.hover(screen.getByTestId("info-wrap-dp-action-opt-backup-cert"));
    const why = await screen.findByTestId("dp-why-opt-backup-cert");
    expect(why).toBeVisible();
    // 搬下去的四样「凭什么」逐个咬（防"降层顺手少搬一半"）
    expect(visibleText(why)).toContain("usd_cny"); // 哪条规则
    expect(visibleText(why)).toContain("8"); // 阈值
    expect(visibleText(why)).toContain("7.18"); // 当前值
    expect(visibleText(screen.getByTestId("dp-trigger-src-trig-backup-cert"))).toContain("阈值来源");

    cleanup();
    queryClient.clear();
    server.resetHandlers();

    // ── 页 2 · 月度规划：MRP 净需求口径（`净需求 = Σ需求×BOM − 库存 − 在途`）在浮层 ──
    loginAs("planner");
    renderApp("/v/sop-balance");
    // MRP 表挂在第 ③ 步（供应评审）里 —— 像用户一样建版本再点过去，不绕过导航直接挂组件。
    await user.click(await screen.findByTestId("sop-create", undefined, { timeout: 15000 }));
    await user.click(await screen.findByTestId("sop-step-chip-3", undefined, { timeout: 15000 }));
    const mrpWrap = await screen.findByTestId("info-wrap-sop-mrp-formula", undefined, { timeout: 15000 });
    expect(screen.queryByTestId("info-body-sop-mrp-formula")).toBeNull();
    await user.hover(mrpWrap);
    const mrpBody = await screen.findByTestId("info-body-sop-mrp-formula");
    expect(mrpBody).toBeVisible();
    expect(visibleText(mrpBody)).toContain(zh.sim.sop.info.mrpBody);

    cleanup();
    queryClient.clear();
    server.resetHandlers();

    // ── 页 3 · 产能推演：派生诊断的口径与溯源在浮层 ──
    loginAs("planner");
    renderApp("/v/risk");
    // 这一页的「这一页在回答什么」是顶层降层内容，落地即在第一层留记号。
    const bridgeWrap = await screen.findByTestId("info-wrap-risk-bridge", undefined, { timeout: 15000 });
    expect(screen.queryByTestId("info-body-risk-bridge")).toBeNull();
    await user.hover(bridgeWrap);
    const bridgeBody = await screen.findByTestId("info-body-risk-bridge");
    expect(bridgeBody).toBeVisible();
    expect(visibleText(bridgeBody).length).toBeGreaterThan(20);
  }, 60000);

  it("② §2.3 那句**结论**默认就可见（防「一刀切降层，把结论也埋了」）", async () => {
    openDecisionPlay(IMP_QS);

    // 这句是**结论**不是解释：删了/藏了，用户会把下面的推演当成对自己那条阻滞点的回答 —— 那是**读错**。
    const concl = await screen.findByTestId("dp-from-default-root");
    expect(concl).toBeVisible(); // 真可见，不是"在 DOM 里"
    const t = visibleText(concl);
    expect(t).toContain("默认根因");
    expect(t).toContain("不是这条阻滞点对应的根因");
    // 「5 区」因 ④+⑤ 合并已不成立 ⇒ 口径**改指新列表**，不是删掉（派单原文）。
    expect(t).not.toContain("5 区");
    expect(t).toMatch(/行动清单|根因/);

    // 而「为什么对不上」的口径/机制**默认不可见**（它才是该降层的那一半）。
    expect(screen.queryByTestId("dp-from-why-body")).toBeNull();

    // 「开发的话」下屏：契约类型名一个都不许在屏上（用户读了做不了任何决定）。
    const page = visibleText(document.body);
    for (const devWord of ["ChainImpedimentSchema", "strictObject"]) {
      expect(page).not.toContain(devWord);
    }
  }, 30000);

  it("③ 第一层留**可见记号**（`?`）——静默降层等于删除", async () => {
    openDecisionPlay(IMP_QS);
    await screen.findByTestId("dp-plan");

    // 每一条降了层的地方，第一层都得有一个摸得到的触发器（真 <button>，Tab 到得了）。
    for (const id of ["dp-action-opt-backup-cert", "dp-action-opt-insource", "dp-from-why", "dp-from-caveat", "dp-narrowing"]) {
      const mark = screen.getByTestId(`info-${id}`);
      expect(mark).toBeVisible();
      expect(mark.tagName).toBe("BUTTON"); // 不是只在 hover 时才显形的花活
      expect((mark.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  }, 30000);

  /* ═══════════════════════════════════════════════════════════════════════
   * 以下三条是**合并 ④+⑤ 之后新增的判据**（派单追加要求原文）
   * ═══════════════════════════════════════════════════════════════════════ */

  it("④ 同一个行动**只出现一次** —— 两套源的两种措辞不同时上屏", async () => {
    openDecisionPlay();
    await screen.findByTestId("dp-plan");
    const page = visibleText(document.body);

    /*
     * 反面判据（这正是今天两套源的症状）：
     *   区④ 说「启动备份供应商认证」（种子 TRIGGER_RULES.action）
     *   区⑤ 说「缩短备份供应商认证周期」（求解器方案 label）
     * 合并后**只许留一种说法**。两句同时出现 = 合并没做，只是把两块摞在了一起。
     */
    const fromTrigger = page.includes("启动备份供应商认证");
    const fromSolver = page.includes("缩短备份供应商认证周期");
    expect(fromTrigger && fromSolver).toBe(false);
    expect(fromTrigger || fromSolver).toBe(true); // 也不许两个都没了（那是删内容）

    // 长协那对同理（`trig-lta-reprice` ↔ `opt-lta-clause`，首段唯一 ⇒ 合并）。
    expect(page.includes("长协重谈加价格联动条款") && page.includes("长协加价格联动条款")).toBe(false);

    // 行数 = 方案 3 + 对不上的规则 1 = 4，一条不多一条不少（对不上的规则不许被丢掉）。
    const rows = document.querySelectorAll("[data-testid^='dp-action-'][data-state]");
    expect(rows.length).toBe(4);
    expect(screen.getByTestId("dp-action-trig-fx-hedge")).toBeVisible();

    // 三态**三套话**：「无触发规则」与「规则未到线」措辞必须不同（一个词盖两个事实 = 老病）。
    const noRule = visibleText(screen.getByTestId("dp-action-state-opt-insource"));
    const notFired = visibleText(screen.getByTestId("dp-action-state-opt-backup-cert"));
    const fired = visibleText(screen.getByTestId("dp-action-state-opt-lta-clause"));
    expect(new Set([noRule, notFired, fired]).size).toBe(3);
    expect(screen.getByTestId("dp-action-opt-insource")).toHaveAttribute("data-state", "NO_RULE");
    expect(screen.getByTestId("dp-action-opt-backup-cert")).toHaveAttribute("data-state", "NOT_FIRED");
  }, 30000);

  it("⑤ 「未触发」的规则条件**不被渲染成断言句**（屏上不出现 `7.18 > 8`）", async () => {
    const user = userEvent.setup();
    openDecisionPlay();
    await screen.findByTestId("dp-plan");

    /*
     * 老区④ 把「当前值 7.18」「op >」「阈值 8」排成一行，读起来就是一句**假断言**：
     * 7.18 并不大于 8，而结论恰恰写着"未触发" —— 屏上自相矛盾。
     * 修法是**排版不是改数**：规则模板与当前值拆成两句，中间隔着结论词。
     *
     * 判据写成**对每条 trigger 通用**的形态，不是只钉这一对数 ——
     * 钉死一对数的断言，换组数据就哑了。
     */
    const assertNoAssertionSentence = (text: string) => {
      for (const t of TRIGGERS) {
        const re = new RegExp(`${t.signalValue}\\s*\\${t.op}\\s*${t.threshold}`);
        expect(text).not.toMatch(re);
      }
    };

    assertNoAssertionSentence(visibleText(document.body)); // 第一层
    // 浮层里也不许（降层不是把假断言藏起来，是不许有这个形态）
    await user.hover(screen.getByTestId("info-wrap-dp-action-opt-backup-cert"));
    const why = await screen.findByTestId("dp-why-opt-backup-cert");
    assertNoAssertionSentence(visibleText(why));

    // 且正确形态确实在：规则模板一句、当前值另一句、结论第三句。
    expect(visibleText(screen.getByTestId("dp-rule-tpl-opt-backup-cert"))).toMatch(/usd_cny.*>.*8/);
    expect(visibleText(screen.getByTestId("dp-rule-cur-opt-backup-cert"))).toContain("7.18");
    expect(visibleText(screen.getByTestId("dp-rule-verdict-opt-backup-cert"))).toContain("未");
    // 两者必须是**两个不同元素**（同一元素里就还是一行，假断言照旧）。
    expect(screen.getByTestId("dp-rule-tpl-opt-backup-cert")).not.toBe(screen.getByTestId("dp-rule-cur-opt-backup-cert"));
  }, 30000);

  it("⑥ 筛选：按触发态 / 按时间窗各筛得动，且档位**由数据现算**不写死", async () => {
    const user = userEvent.setup();
    openDecisionPlay();
    await screen.findByTestId("dp-plan");

    // 时间窗档位来自引擎给的 steps（即刻/本季/半年）+「未排期」（对不上方案的规则没有周期）。
    for (const p of ["即刻", "本季", "半年"]) expect(screen.getByTestId(`dp-fp-${p}`)).toBeVisible();
    expect(screen.getByTestId("dp-fp-none")).toBeVisible();

    // 按「无触发规则」筛 → 只剩求解器推荐那一行。
    await user.click(screen.getByTestId("dp-fs-NO_RULE"));
    await waitFor(() => expect(document.querySelectorAll("[data-testid^='dp-action-'][data-state]").length).toBe(1));
    expect(screen.getByTestId("dp-action-opt-insource")).toBeVisible();

    // 按时间窗筛。
    await user.click(screen.getByTestId("dp-fs-ALL"));
    await user.click(screen.getByTestId("dp-fp-即刻"));
    await waitFor(() => expect(document.querySelectorAll("[data-testid^='dp-action-'][data-state]").length).toBe(1));
    expect(screen.getByTestId("dp-action-opt-lta-clause")).toBeVisible();
  }, 30000);

  it("⑦ 产能推演：每层「这层在算什么」第一层可见，且层3 与层4 屏上**不相同**", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/risk");
    // 6 层派生诊断挂在基地卡展开之后 —— 照用户的真实路径点进去。
    await user.click(await screen.findByTestId("risk-card-常州", undefined, { timeout: 15000 }));
    await screen.findByTestId("cap-dag-nodes", undefined, { timeout: 15000 });

    // role 是这一层的身份（规范 §4.1 结构性口径豁免）。
    for (const n of [1, 2, 3, 4, 5, 6]) expect(screen.getByTestId(`cap-dag-role-${n}`)).toBeVisible();

    // 反面判据：去掉数值之后，层3 与层4 的可见文本必须不同（数值恰好相等时旧屏逐字一样）。
    const strip = (n: number) => visibleText(screen.getByTestId(`cap-dag-node-toggle-${n}`)).replace(/[\d,./]/g, "");
    expect(strip(3)).not.toBe(strip(4));

    // 诚实位**升层**：数据出身 + 「层1–4 无绝对产能数」+ 缺口分母，三条都在第一层。
    expect(screen.getByTestId("cap-dag-provenance-mark")).toBeVisible();
    expect(screen.getByTestId("cap-dag-noabs-mark")).toBeVisible();
    expect(visibleText(screen.getByTestId("cap-dag-denom-6"))).toMatch(/需求/);
  }, 30000);
});
