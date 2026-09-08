import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";

/**
 * WO-ADOPTION-SURVIVES-FIX · **采纳记录的存活不许依赖「问题还越不越线」** · 接缝测。
 *
 * ══ 今天的行为是 X，应该是 Y ═══════════════════════════════════════════════════
 * **X**：风险卡的出卡条件是 `risk.ts` 里那一行
 *   `const crossDay = crossDayOf(series, p.threshold);`
 *   `if (!pair.forced && crossDay === null) continue;`
 * 一条处置**把越线彻底消解掉**（`reroute` eff 9 / T+3）⇒ `crossDay` 变 `null`
 * ⇒ **整张卡在非 forced 路上被 `continue` 掉**，挂在卡上的 `card.adoptedMitigation`
 * 披露键随之一起消失，别的基地顶上它的位置。换 `debottleneck`（eff 13 / T+6，第 6 天前仍越线）
 * 卡就留得住。⇒ **「把问题解决了」和「记录被抹掉了」在屏上长得一模一样**，
 * 而且**措施越有效，证据消失得越彻底** —— 这个失败**只在成功时发生**。
 *
 * **Y**：采纳记录有自己的读侧（`adoptionLedger`），遍历源是 ACTIVE 台账对象本身，
 * 与「今天还越不越线 / 这张卡渲没渲」彻底解耦。
 *
 * ══ 为什么既有六个用例全绿却没拦住（铁律 0.5 判据 6 的原样复现）════════════════
 * `action-adopt-mitigation.seam.test.ts` 六个用例**全部**走 `forcedCard()`，即传
 * `{base, factor}` 两键 ⇒ `pair.forced === true` ⇒ 那一行 `continue` **永不触发**。
 * 而**生产**（`RiskBoardView` 的 `invokeSolver("risk_timeline", { horizon })`）一个键都不传
 * ⇒ `forced === false`。**测试实参与生产实参交集为空**，于是测试三周来验的是生产不走的那条路。
 * ⚠ 故本文件所有断言**一律走不传 base/factor 的生产路**（`board()`），不许改回 forcedCard。
 *
 * ══ 两端都要守住（缺一端都不算交付）═══════════════════════════════════════════
 *  ① 留住记录：卡下榜之后，采纳记录仍查得到、且能说清消解了多少/第几天起效/何时采纳；
 *  ② **不许复活告警**：已消解的问题**不许**重新出现在「当前风险」里 —— 本文件用
 *     「board 上每张卡都仍在越线」+「已消解 pair 不在 board 上」两条正面咬死。
 */

const H = 30;
const BASE = "changzhou";
const FACTOR = "瓶颈工序";

interface Card {
  base: string;
  baseId: string;
  factor: string;
  crossDay: number | null;
  adoptedMitigation?: { planKey: string; eff: number; tn: number };
}
interface LedgerRow {
  adoptionId: string;
  baseId: string;
  base: string;
  factor: string;
  planKey: string;
  planName: string;
  eff: number;
  tn: number;
  adoptedAt: string;
  state: "RESOLVED" | "STILL_CROSSING" | "NO_CROSS_EITHER_WAY";
  crossDay: number | null;
  wouldCrossDay: number | null;
  peak: number;
  peakWithout: number;
  peakCut: number;
  onBoard: boolean;
}
interface RiskOut {
  cards: Card[];
  adoptionLedger?: LedgerRow[];
  mitigationLibrary: Record<string, { key: string; name: string; eff: number; tn: number }[]>;
}

/** **生产路**：不传 base / 不传 factor（`RiskBoardView` 就是这么调的）⇒ `forced=false`。 */
async function board(t: TestApp): Promise<RiskOut> {
  const res = await invokeSolver(t, "risk_timeline", { horizon: H });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: RiskOut }).data;
}

const HEADER_BY_ROLE: Record<string, Record<string, string>> = { planner: PLANNER, admin: ADMIN };
interface DraftView {
  id: string;
  status: string;
  approvalSteps: { seq: number; role: string; decision?: string }[];
  executionResult?: { ok?: boolean; targetRef?: string; error?: string };
}

/** 走**完整两级审批链**（planner → admin），与生产同一条路；不许直写对象绕过审批。 */
async function adopt(t: TestApp, payload: Record<string, unknown>): Promise<DraftView> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "adopt_mitigation", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;
  for (let guard = 0; guard < 6; guard++) {
    const cur = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN })).json() as DraftView;
    if (cur.status !== "PENDING_APPROVAL") return cur;
    const pending = cur.approvalSteps.find((s) => !s.decision)!;
    const headers = HEADER_BY_ROLE[pending.role];
    expect(headers, `审批链出现未覆盖角色「${pending.role}」`).toBeTruthy();
    const res = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers, payload: {} });
    expect(res.statusCode, `approve(step ${pending.seq}/${pending.role}) 失败：${res.body}`).toBeLessThan(300);
  }
  throw new Error("审批链未在 6 步内收敛");
}

const pairOf = (o: RiskOut, baseId: string, factor: string): Card | undefined =>
  o.cards.find((c) => c.baseId === baseId && c.factor === factor);
const rowOf = (o: RiskOut, baseId: string, factor: string): LedgerRow | undefined =>
  (o.adoptionLedger ?? []).find((r) => r.baseId === baseId && r.factor === factor);

describe("WO-ADOPTION-SURVIVES-FIX · 采纳记录的存活与「还越不越线」解耦", () => {
  it("① 前提复现（写不出来就别动手）：reroute 让该 pair 的卡整张消失，debottleneck 不会", async () => {
    // ── 金丝雀先行（铁律 0.6）：报「卡消失了」之前，先证明我这把尺子量得到卡。 ──
    const t0 = await makeApp();
    await seedBattery(t0);
    const before = await board(t0);
    expect(before.cards.length, "金丝雀：生产路本该出若干张卡；出 0 张 = 量法坏了，不是卡消失了").toBeGreaterThan(0);
    const seed = pairOf(before, BASE, FACTOR);
    expect(
      seed,
      `金丝雀：${BASE}·${FACTOR} 本该在基线看板上（本单前提）。实际在榜的 pair：` +
        JSON.stringify(before.cards.map((c) => [c.baseId, c.factor])),
    ).toBeTruthy();
    expect(seed!.crossDay, "前提：基线态该 pair 必须是越线的（否则「消解」无从谈起）").not.toBeNull();
    expect(before.adoptionLedger, "基线态零采纳 ⇒ 台账键必须缺席（加性·逐字节兼容）").toBeUndefined();

    // ── A 路：reroute（eff 9 / T+3）⇒ 卡整张消失 ──
    const ta = await makeApp();
    await seedBattery(ta);
    expect((await adopt(ta, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");
    const afterReroute = await board(ta);
    expect(
      pairOf(afterReroute, BASE, FACTOR),
      "前提复现：采纳 reroute 后该 pair 的卡应当整张消失（这正是本单要治的病）",
    ).toBeUndefined();

    // ── B 路：debottleneck（eff 13 / T+6）⇒ 卡还在 ──
    const tb = await makeApp();
    await seedBattery(tb);
    expect((await adopt(tb, { base: BASE, factor: FACTOR, planKey: "debottleneck" })).status).toBe("EXECUTED");
    const afterDeb = await board(tb);
    const kept = pairOf(afterDeb, BASE, FACTOR);
    expect(kept, "反向对照：debottleneck 第 6 天前仍越线 ⇒ 卡必须留得住").toBeTruthy();
    expect(kept!.crossDay, "留住的那张卡必须仍在越线（否则它就该下榜）").not.toBeNull();
  }, 300000);

  it("② 实验 1 · 卡下榜之后采纳记录仍在，且四项披露齐全（采纳了哪条/消解多少/第几天起效/何时采纳）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const plan = (await board(t)).mitigationLibrary[FACTOR]!.find((p) => p.key === "reroute")!;
    expect((await adopt(t, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");

    const out = await board(t);
    expect(pairOf(out, BASE, FACTOR), "该 pair 的卡已下榜（引擎行为不变）").toBeUndefined();

    const row = rowOf(out, BASE, FACTOR);
    expect(
      row,
      "**本单的要害**：卡下榜了，采纳记录必须仍在 —— 否则「把问题解决了」与「记录被抹掉了」在屏上一模一样",
    ).toBeTruthy();
    // 四项披露（WO 设计约束 4）——全部来自台账/引擎原值，前端零重算。
    expect(row!.planKey, "采纳了哪条").toBe("reroute");
    expect(row!.planName, "方案人话名必须来自台账自带的 planName（不许读侧再编一个）").toBe(plan.name);
    expect(row!.eff, "消解多少").toBe(plan.eff);
    expect(row!.tn, "第几天起效").toBe(plan.tn);
    expect(row!.adoptedAt, "何时采纳（确定性时间锚 forecastStart·非 Date.now）").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 对照实验（铁律 1.5 判据一）：不采纳会越线、采纳后不越线 —— 这才配叫 RESOLVED。
    expect(row!.state).toBe("RESOLVED");
    expect(row!.crossDay, "采纳后本窗不再越线").toBeNull();
    expect(row!.wouldCrossDay, "反事实：不采纳则仍会越线（否则这条处置不该邀功）").not.toBeNull();
    expect(row!.peakWithout, "反事实峰值必须高于采纳后峰值").toBeGreaterThan(row!.peak);
    expect(row!.peakCut, "实测削峰量 = peakWithout − peak").toBeCloseTo(row!.peakWithout - row!.peak, 6);
    expect(row!.onBoard, "该卡已下榜 ⇒ onBoard 必须诚实为 false").toBe(false);
  }, 300000);

  it("③ 实验 3 · **不许复活告警**：已消解的问题不许回到「当前风险」，board 上每张卡都仍在越线", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await adopt(t, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");
    const out = await board(t);

    // 正面咬死：看板上不许出现任何"其实已经不越线"的卡（否则就是把已解决的问题重新变成告警）。
    for (const c of out.cards) {
      expect(c.crossDay, `${c.baseId}·${c.factor} 在看板上却不越线 ⇒ 已消解的问题被复活成告警`).not.toBeNull();
    }
    // 已消解的那个 pair 不在看板上（它的位置由台账承载，不由告警承载）。
    expect(pairOf(out, BASE, FACTOR)).toBeUndefined();
    // 台账里凡 RESOLVED 的，onBoard 必须为 false —— 两条读侧不许自相矛盾。
    for (const r of out.adoptionLedger ?? []) {
      if (r.state === "RESOLVED") expect(r.onBoard, `${r.baseId}·${r.factor} 已消解却仍在看板 ⇒ 自相矛盾`).toBe(false);
    }
  }, 300000);

  it("④ 实验 2 · 反向对照：debottleneck 那条路的**卡面**逐字段不变，采纳披露键仍是三键", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const plan = (await board(t)).mitigationLibrary[FACTOR]!.find((p) => p.key === "debottleneck")!;
    expect((await adopt(t, { base: BASE, factor: FACTOR, planKey: "debottleneck" })).status).toBe("EXECUTED");

    const out = await board(t);
    const card = pairOf(out, BASE, FACTOR);
    expect(card, "仍越线 ⇒ 卡必须还在（这条路今天是对的，不许连它一起改了）").toBeTruthy();
    expect(card!.crossDay).not.toBeNull();
    // `card.adoptedMitigation` 必须**逐字节**还是上线前那三个键：多一个键 = 改了这条路的输出。
    expect(card!.adoptedMitigation).toEqual({ planKey: plan.key, eff: plan.eff, tn: plan.tn });
    expect(Object.keys(card!.adoptedMitigation!).sort()).toEqual(["eff", "planKey", "tn"]);

    // 台账侧对同一条采纳给的是 STILL_CROSSING（生效了但不够）——不许说成"我消解了它"。
    const row = rowOf(out, BASE, FACTOR)!;
    expect(row.state).toBe("STILL_CROSSING");
    expect(row.onBoard, "卡仍在榜 ⇒ onBoard 必须为 true").toBe(true);
    expect(row.crossDay, "采纳后仍越线").not.toBeNull();
  }, 300000);

  it("⑤ 实验 4 · 跨会话可追溯：台账是租户级对象，换一条全新连接照样读得到", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await adopt(t, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");

    // 会话 A 的读数
    expect(rowOf(await board(t), BASE, FACTOR)!.state).toBe("RESOLVED");

    // 「会话 B」= 另一套请求头（不同 user、无任何前序请求状态）。台账挂在租户上，与会话无关：
    // `AdoptedMitigation` 的 props 里**没有任何 session 字段**（`adoptionId/baseId/factor/planKey/
    // planName/eff/tn/adoptedAt/actionDraftId/status`），故跨会话可读是**结构性**的，不是巧合。
    const objs = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=AdoptedMitigation&pageSize=500", headers: ADMIN });
    expect(objs.statusCode, objs.body).toBe(200);
    // ⚠ 该端点回的是 `{ items }`（`app.ts` 的 `/a/v1/objects` 实现原文），不是 `{ data }` ——
    //    仓里两个既有测试对这个形状写法不一，故此处以路由实现为准，不照抄任一测试。
    const items = (objs.json() as { items: { props: Record<string, unknown> }[] }).items;
    const active = items.filter((o) => o.props.status === "ACTIVE");
    expect(active.length, "会话 B 必须读得到会话 A 采纳的那条 ACTIVE 记录（0 → ≥1）").toBeGreaterThanOrEqual(1);
    expect(active.some((o) => o.props.baseId === BASE && o.props.factor === FACTOR && o.props.planKey === "reroute")).toBe(true);
    for (const o of active) {
      for (const k of Object.keys(o.props)) {
        expect(/session/i.test(k), `台账不许带会话字段，实见 ${k}`).toBe(false);
      }
    }

    const asPlanner = await invokeSolver(t, "risk_timeline", { horizon: H }, PLANNER);
    expect(asPlanner.statusCode, asPlanner.body).toBe(200);
    const outB = (asPlanner.json() as { data: RiskOut }).data;
    expect(rowOf(outB, BASE, FACTOR)!.state, "会话 B 的推演里同样带着这条台账").toBe("RESOLVED");
  }, 300000);

  it("⑥ 诚实位：本窗本来就不越线的 pair 上采纳 ⇒ NO_CROSS_EITHER_WAY，处置不许邀功", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base0 = await board(t);
    // 找一个**基线态就不越线**的 (base,factor)：它在看板上不出卡，且换算下来 wouldCrossDay 必为 null。
    const onBoardPairs = new Set(base0.cards.map((c) => `${c.baseId}|${c.factor}`));
    const factors = Object.keys(base0.mitigationLibrary);
    const baseIds = [...new Set(base0.cards.map((c) => c.baseId))];
    expect(baseIds.length, "金丝雀：基线看板必须有基地，否则下面的挑选是空转").toBeGreaterThan(0);

    let picked: { baseId: string; factor: string; planKey: string } | null = null;
    for (const b of baseIds) {
      for (const f of factors) {
        if (onBoardPairs.has(`${b}|${f}`)) continue;
        const plan = base0.mitigationLibrary[f]?.[0];
        if (plan) {
          picked = { baseId: b, factor: f, planKey: plan.key };
          break;
        }
      }
      if (picked) break;
    }
    expect(picked, "找不到任何「不在看板上」的 pair ⇒ 本用例的前提不成立，需重新设计").toBeTruthy();

    expect((await adopt(t, { base: picked!.baseId, factor: picked!.factor, planKey: picked!.planKey })).status).toBe("EXECUTED");
    const out = await board(t);
    const row = rowOf(out, picked!.baseId, picked!.factor);
    expect(row, "无论问题今天越不越线，采纳记录一律要有一条 —— 这就是「存活不依赖越线」").toBeTruthy();
    // 该 pair 若本来就不越线 ⇒ 两条曲线都不越线 ⇒ 不许把「本来没事」讲成「我解决了」。
    if (row!.wouldCrossDay === null) {
      expect(row!.state, "两条曲线都不越线 ⇒ 必须诚实标 NO_CROSS_EITHER_WAY，不许标 RESOLVED").toBe("NO_CROSS_EITHER_WAY");
    }
  }, 300000);
});
