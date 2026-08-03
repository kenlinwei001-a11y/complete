import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { OpsReplayService } from "../src/opsteam/replay.js";
import type { AuthCtx } from "../src/domain.js";
import type { Decision } from "@platform/contracts";

/**
 * SEAM · `adopt_mitigation` 派单接缝（上游派单 × 真消费者 risk_timeline × S2 审批链）。
 *
 * 病灶（本单前实测·非臆断，见每条断言里的原值）：
 *  ① `decision/kernel.ts` commit 派 `{base: topBase ?? "全域", factor: option.factorId, planKey: option.optionId}`
 *     = `{"base":"handan","factor":"cf-decision-gap","planKey":"opt-backup-cert"}` →
 *     真消费者 `risk_timeline` 直接抛 `unknown mitigation plan 'opt-backup-cert' for factor cf-decision-gap`。
 *     现在不炸只因 commit 建 DRAFT（submit:false），走不到执行。
 *  ② `opsteam/replay.ts` 派的载荷缺 `factor`/`planKey` → submit 阶段被 paramsSchema（required base/factor/planKey）400 挡下。
 *
 * 本测**只认效果层**：断言"草稿建出来了 / payload 里有 planKey"是运输层，不算。
 *  · replay（路径 A）：拿它真派出去的那条载荷喂真 `risk_timeline` → **张力曲线从第 tn 天起真的降**；
 *    并断言这条单真能过 paramsSchema + 走完 planner→admin 两步审批链。
 *  · kernel（路径 B）：断言这些方案**根本不该派**（真消费者干跑必抛），因此 commit **不产出**注定失败的草稿，
 *    且决策轨迹里留了诚实记录。
 *
 * ⚠️ 诚实边界（本单范围外·不许靠放宽解析假装解决）：`ACTION_WIRING.adopt_mitigation` 至今是
 * NOT_IMPLEMENTED——审批通过后执行器仍**诚实失败**（`EXECUTOR_NOT_IMPLEMENTED`）。所以下方断言的是
 * 「剩下的唯一失败是执行器欠账，不是派单坏」；执行器接上后把该断言改成 EXECUTED 即可，派单侧无需再动。
 */

const SVC: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };

interface RiskCard {
  base: string;
  baseId: string;
  factor: string;
  peak: number;
  series: number[];
  currentTightness: { value: number };
  mitigated?: { series: number[]; peak: number; appliedPlan: string; effectiveFrom: number };
}

const riskTimeline = (t: TestApp, args: Record<string, unknown>, ctx: AuthCtx = SVC) =>
  t.services.solvers.invoke(ctx, "risk_timeline", args) as Promise<unknown> as Promise<{ cards: RiskCard[] }>;

/** 用真实服务组装回放编排器（只替 QOS/孵化 HTTP 出口；S2/求解器全走真链路）。 */
function buildReplay(t: TestApp, captured: Record<string, unknown>[]): OpsReplayService {
  return new OpsReplayService({
    actions: t.services.actions,
    sop: t.services.sop,
    solvers: t.services.solvers,
    resolvePersona: (tenantId, username) => t.services.opsTeam.resolvePersonaCtx(tenantId, username),
    ask: null,
    listPendingDrafts: async (tenantId) =>
      (await t.repos.actionDrafts.list(tenantId, (dd) => dd.status === "PENDING_APPROVAL")).map((dd) => ({ id: dd.id, originUserId: dd.origin.userId })),
    listFallbackClusters: async () => [],
    promoteIntent: null,
    // 与 app.ts 注入的实现同构（create submit:true → approve）；额外捕获载荷供效果层断言。
    adoptMitigation: async (base, approver, payload) => {
      captured.push(payload);
      const draft = await t.services.actions.create(base, { actionTypeKey: "adopt_mitigation", payload, submit: true });
      const decided = await t.services.actions.approve(approver, draft.id);
      return { draftId: draft.id, status: decided.status };
    },
    log: () => undefined,
  });
}

const PLAYBOOK = {
  key: "seam",
  version: 1,
  cadence: { onEvent: [{ event: "risk_crossed", actions: [{ kind: "adopt_mitigation" as const, persona: "vp_base_mgr_changzhou" }] }] },
};

describe("SEAM · adopt_mitigation 派单必须是可执行的真单，否则诚实不派", () => {
  // ── replay（路径 A）─────────────────────────────────────────────────────
  it("A·效果层：replay 派出的载荷喂真 risk_timeline → 张力曲线从第 tn 天起真的降（不是「有 planKey 字段」）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.opsTeam.seedDefaultPersonas("demo");
    const captured: Record<string, unknown>[] = [];
    const report = await buildReplay(t, captured).runTick("demo", PLAYBOOK, { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: ["risk_crossed"] });

    expect(report.skipped, `adopt_mitigation 被跳过了：${JSON.stringify(report.skipped)}`).toEqual([]);
    expect(captured.length).toBe(1);
    const p = captured[0] as { base: string; factor: string; planKey: string };

    // ① 效果层头号断言。**WO-ADOPT-MITIGATION 后本条升级**（原断言已过期，见下）：
    //    旧世界里「采纳」不改变任何真值，故只能拿**对照曲线** `card.mitigated`（"如果采纳会怎样"）与
    //    `card.series` 比。执行器接上后，replay 这一跑**真的写了 AdoptedMitigation**，于是
    //    `card.series` 自己就已经是降过的 —— 再问"如果采纳同一方案会怎样"，正确答案是"没有额外收益"
    //    （risk.ts:507 语义边界：同因素方案互斥不叠加）。旧断言 `after < before` 因此必然失败，
    //    **那是修好了的证据，不是回归**（插桩实测：dryRun 那次 before=[91,91,92,…] after=[91,91,83,…]；
    //    执行后那次 before 已是 [91,91,83,…]）。
    //    新断言更强：不再问"对照曲线低不低"，直接问**真曲线自己降没降**。
    const card = (await riskTimeline(t, { base: p.base, factor: p.factor })).cards[0]!;
    expect(
      card.adoptedMitigation,
      "replay 审批链走完但真曲线上看不到采纳 —— 台账没写或 riskTimeline 没消费（正是本单要治的病）",
    ).toBeTruthy();
    expect(card.adoptedMitigation!.planKey).toBe(p.planKey);
    // 对照组：同一 (base,factor) 在**没有采纳**时的曲线（干净上下文重算）——真降的基准线。
    const t2 = await makeApp();
    await seedBattery(t2);
    const clean = (await riskTimeline(t2, { base: p.base, factor: p.factor })).cards[0]!;
    const before = clean.series;
    const after = card.series;

    // ② 方案库复核（口径与 risk.ts 消费处逐字一致）→ 拿真 tn 作曲线断言的边界。
    const lib = (await t.services.solvers.getParams("demo")).risk.mitigations[p.factor];
    expect(lib, `factor「${p.factor}」不在 params.risk.mitigations 里 —— 修前 kernel 正是这样派的（cf-decision-gap）`).toBeTruthy();
    const plan = lib!.find((x) => x.key === p.planKey || x.name === p.planKey)!;
    expect(plan, `planKey「${p.planKey}」不在因子「${p.factor}」的方案库里`).toBeTruthy();
    // risk.ts:280 口径：逐日 d 从 1 起，`d >= tn` 才削减 → 数组下标 i = d−1。
    expect(card.adoptedMitigation!.tn).toBe(plan.tn);
    expect(card.adoptedMitigation!.eff).toBe(plan.eff);
    // risk.ts 口径：逐日 d 从 1 起，`d >= tn` 才削减 → 数组下标 i = d−1。
    for (let i = plan.tn - 1; i < before.length; i++) {
      expect(after[i]!, `第 ${i + 1} 天采纳后真曲线 ${after[i]} 未低于未采纳基线 ${before[i]}（曲线没真降）`).toBeLessThan(before[i]!);
    }
    // 生效前（d < tn）两条曲线必须重合——降得「提前」就是编的。
    for (let i = 0; i < plan.tn - 1; i++) expect(after[i], `第 ${i + 1} 天（方案 T+${plan.tn} 才生效）曲线就动了`).toBe(before[i]);
    expect(card.peak).toBeLessThan(clean.peak);
  });

  it("A·链路层：replay 的单真能过 paramsSchema + planner→admin 两步审批链，剩下的唯一失败是执行器欠账", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.opsTeam.seedDefaultPersonas("demo");
    const captured: Record<string, unknown>[] = [];
    const report = await buildReplay(t, captured).runTick("demo", PLAYBOOK, { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: ["risk_crossed"] });
    const draftId = report.executed[0]!.ref;
    const draft = (await t.repos.actionDrafts.get("demo", draftId))!;

    // 两步审批链真走完（planner 一审 + admin 终审），不是卡在 400/409。
    expect(draft.approvalSteps.map((s) => s.decision)).toEqual(["APPROVE", "APPROVE"]);
    // 执行侧：WO-ADOPT-MITIGATION 已接真执行器 → **按原注释留下的指示**把断言从 EXECUTION_FAILED
    // 改为 EXECUTED + AdoptedMitigation 真写入（派单侧一行未动，正如当初预期）。
    expect(draft.status).toBe("EXECUTED");
    const ledger = await t.repos.objects.listByType("demo", "AdoptedMitigation");
    expect(ledger.length, "审批 EXECUTED 了却没写台账 —— 又一次「状态绿、真值空」").toBeGreaterThan(0);
    // 绝不允许出现 MO 形态假单号（真假不可分辨 = 本仓刚清掉的病）。
    expect(String(draft.executionResult!.targetRef ?? "")).not.toMatch(/^MO-\d{4}/);
  });

  it("A·诚实不派：基地不在风险看板上 → 跳过（不派注定失败的草稿）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.opsTeam.seedDefaultPersonas("demo");
    // 目录运营 persona 无 baseName/baseScope → 选不到基地 → 必须诚实跳过而不是派空 base。
    const captured: Record<string, unknown>[] = [];
    const report = await buildReplay(t, captured).runTick(
      "demo",
      { key: "seam2", version: 1, cadence: { onEvent: [{ event: "risk_crossed", actions: [{ kind: "adopt_mitigation" as const, persona: "vp_catalog_op" }] }] } },
      { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: ["risk_crossed"] },
    );
    expect(captured).toEqual([]); // 一条草稿都没派
    expect(report.executed).toEqual([]);
    expect(report.skipped[0]!.reason).toContain("no adoptable mitigation");
  });

  // ── kernel（路径 B）────────────────────────────────────────────────────
  it("B·效果层反证：decision_play 的方案喂真 risk_timeline 必抛（所以派了就是注定失败的草稿）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const dp = (await t.services.solvers.invoke(SVC, "decision_play", { metricKey: "seg_attain_ess" })) as unknown as {
      options: { optionId: string; factorId: string }[];
    };
    const ga = (await t.services.solvers.invoke(SVC, "gap_attribution", { metricKey: "seg_attain_ess" })) as unknown as {
      levels: { depth: number; nodes: { id: string }[] }[];
    };
    const topBase = String(ga.levels.find((L) => L.depth === 1)!.nodes[0]!.id).replace(/^base:/, "");
    // 修前 kernel.ts:125 的载荷原样重建。
    for (const o of dp.options) {
      const payload = { base: topBase, factor: o.factorId, planKey: o.optionId };
      await expect(
        riskTimeline(t, { base: payload.base, factor: payload.factor, mitigation: payload }),
        `方案「${o.optionId}」竟能解析成处置方案 —— 若真如此，kernel 应改走路径 A 派单`,
      ).rejects.toThrow(/unknown mitigation plan/);
    }
  });

  it("B·效果层：commit 不产出注定失败的 adopt_mitigation 草稿，决策轨迹留诚实记录", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const dp = (await t.services.solvers.invoke(SVC, "decision_play", { metricKey: "seg_attain_ess" })) as unknown as { options: { optionId: string }[] };
    const chosen = dp.options.slice(0, 2).map((o) => o.optionId);
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: "seg_attain_ess", chosenOptionIds: chosen } })).json() as Decision;
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;

    expect(committed.status).toBe("COMMITTED");
    // ① 一条注定失败的草稿都没派（库里也确实不存在）。
    expect(committed.actionDraftIds).toEqual([]);
    const drafts = await t.repos.actionDrafts.list("demo", (x) => x.actionTypeKey === "adopt_mitigation");
    expect(drafts, "commit 仍在库里留下了 adopt_mitigation 草稿").toEqual([]);
    // ② 轨迹诚实记录（每个选定方案一条·写明为什么不派·可下钻回 optionsRef）。
    const actionSteps = committed.trace.filter((s) => s.step === "action");
    expect(actionSteps.map((s) => s.refId)).toEqual(chosen);
    for (const s of actionSteps) {
      expect(s.label).toContain("未派 adopt_mitigation");
      expect(s.label).toContain("无可采纳的真 planKey");
    }
    // ③ 事件也如实标注未派数（下游/审计不靠猜）。
    const ev = (await t.repos.outboxEvents.list("demo", (e) => e.event === "decision.committed")).find((e) => e.payload.decisionId === dec.id)!;
    expect(ev.payload.actionCount).toBe(0);
    expect(ev.payload.undispatchedCount).toBe(chosen.length);
  });

  it("B·不是一刀切拒绝：载荷真能解析时同一段代码照样派单（规则使然·非写死不派）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 造一个"方案 id 就是真 planKey、factorId 就是真风险因子"的决策 —— 这正是路径 A 成立的条件。
    const board = (await riskTimeline(t, {})).cards[0]!;
    const sel = (await t.services.solvers.invoke(SVC, "mitigation_select", {
      baseName: board.base,
      factor: board.factor,
      tightness: board.currentTightness.value,
    })) as unknown as { draftPayload: { base: string; factor: string; planKey: string } };
    const dec = await t.services.decisionKernel.create(
      SVC,
      { metricKey: "seg_attain_ess", chosenOptionIds: ["opt-backup-cert"] },
      "2026-07-17T00:00:00.000Z",
    );
    // 只改「选定方案的身份」为真方案（rootRef/optionsRef 其余照旧·仍是真推演产物）。
    const patched: Decision = {
      ...dec,
      rootRef: { ...dec.rootRef, topBase: sel.draftPayload.base },
      chosenOptionIds: [sel.draftPayload.planKey],
      optionsRef: {
        ...dec.optionsRef,
        options: [{ ...dec.optionsRef.options[0]!, optionId: sel.draftPayload.planKey, factorId: sel.draftPayload.factor }],
      },
    };
    await t.repos.decisions.put(patched);
    const committed = await t.services.decisionKernel.commit(SVC, patched.id, "2026-07-17T00:00:00.000Z");
    expect(committed.actionDraftIds.length).toBe(1);
    const draft = (await t.repos.actionDrafts.get("demo", committed.actionDraftIds[0]!))!;
    expect(draft.payload).toEqual({ base: sel.draftPayload.base, factor: sel.draftPayload.factor, planKey: sel.draftPayload.planKey });
    // C3 门不绕：commit 只建 DRAFT，执行仍需走 S2 approve（绝不直写业务真值·RL4）。
    expect(draft.status).toBe("DRAFT");
    expect(draft.actionTypeKey).toBe("adopt_mitigation");
    // 效果层：这条真派出去的载荷，真消费者算得出真降的曲线。
    const card = (await riskTimeline(t, { base: sel.draftPayload.base, factor: sel.draftPayload.factor, mitigation: sel.draftPayload })).cards[0]!;
    expect(card.mitigated!.peak).toBeLessThan(card.peak);
  });
});
