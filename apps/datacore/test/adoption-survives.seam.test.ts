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

/**
 * ⚠⚠ **派单前提被实测推翻的那一半（必须读，别照派单的话去理解这段代码）** ⚠⚠
 *
 * 派单说：「采纳 `reroute`（tn=3）后越线被消解 ⇒ 不再出卡 ⇒ 成都顶上它的位置」。
 * **卡确实消失了、成都确实顶上了，但原因不是「越线被消解」。** 实测（seed 42 · horizon 30 · 阈值 85）：
 *
 * | 态 | 常州·瓶颈工序 peak | crossDay | 在不在榜 |
 * |---|---|---|---|
 * | 基线（无采纳）        | **98**      | 1 | 在（第 5 位） |
 * | 采 `debottleneck`(13/T+6) | **97.9949** | 1 | **在**（第 6 位） |
 * | 采 `reroute`(9/T+3)   | **97.9531** | 1 | **不在**（被挤到第 9） |
 *
 * 三态的 `crossDay` **全是 1**（当前张力 91 ≫ 阈值 85，且 T+3 起效根本盖不住第 1 天）——
 * **越线一次都没有被消解**。卡片真正的去向是 `cards.slice(0, p.maxCards)` 这个 **top-8 截断**：
 * 8 个基地 `crossDay` 全为 1、常州所在的 `currentTightness=91` 档有 5 家并列，
 * 于是排序落到 `peak` 上 —— 常州 peak 从 98 掉到 97.9531，**低于成都的 97.9935**，被切掉。
 * ⇒ **决定「卡在不在」的是 0.047 个张力点的排名差，不是问题解没解决。**
 *
 * **这件事比派单描述的更糟**：屏上「常州不在风险榜」被读成「常州没事了」，
 * 而常州**第 1 天仍在越线**，采纳的 `reroute` 只削了 **0.0469** 点峰值（标称 eff=9，
 * 因为 T+3 才起效、且峰值出现在被 `saturateTension` 压住的高位段）。
 *
 * **对本单修法的影响（这是设计要害）**：若照派单字面去做 —— 在
 * `if (!pair.forced && crossDay === null) continue;` 那个分支里补一笔记录 ——
 * **本单会一行都不生效**，因为常州这条路上该分支**从未进入**。
 * 本单实际选的是**以 ACTIVE 台账为遍历源**，故两种消失机制（真消解 / top-N 截断）**都覆盖**。
 *
 * 真消解那一态**确实存在**，只是需要 `tn=1` 且 eff 盖得住越线余量的方案：
 * `jiangmen · 物料齐套 · air_freight`（eff 15 / T+1）⇒ peak 97.8399 → **82.8399**，
 * `crossDay` 真的变 `null`，江门整张卡走 `continue` 消失。两条路本文件都咬。
 */
const H = 30;
/** 「top-N 截断」那条路（卡消失、但问题**没**解决）。 */
const BASE = "changzhou";
const FACTOR = "瓶颈工序";
/** 「真消解」那条路（`crossDay` 真变 null、走 `continue` 丢卡）。 */
const RES_BASE = "jiangmen";
const RES_FACTOR = "物料齐套";
const RES_PLAN = "air_freight";

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
  it("① 前提复现 · **两种消失机制各一条**（派单只写了其中一条，且把另一条的成因说错了）", async () => {
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

    // ── A 路：reroute（eff 9 / T+3）⇒ 卡消失，但**不是因为消解**，是 top-8 截断 ──
    const ta = await makeApp();
    await seedBattery(ta);
    expect((await adopt(ta, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");
    const afterReroute = await board(ta);
    expect(pairOf(afterReroute, BASE, FACTOR), "卡确实消失了（派单看到的症状属实）").toBeUndefined();
    // ⚠ 但成因**不是**「越线被消解」——台账那条把真相摆出来：仍越线，只是峰值排名掉出 top-8。
    const rowA = rowOf(afterReroute, BASE, FACTOR)!;
    expect(rowA.crossDay, "**推翻派单前提**：采纳 reroute 后第 1 天仍在越线，越线一次都没被消解").not.toBeNull();
    expect(rowA.state).toBe("STILL_CROSSING");
    expect(rowA.peakCut, "标称 eff=9，实测削峰不足 1 点（T+3 才起效 + 高位饱和）").toBeLessThan(1);
    expect(afterReroute.cards.length, "卡数不变：常州出榜，另一家顶上它的位置").toBe(before.cards.length);
    expect(
      afterReroute.cards.every((c) => c.crossDay !== null),
      "顶上来的那张必须是真在越线的卡（否则就是把已消解的问题复活成告警）",
    ).toBe(true);

    // ── B 路：真消解（air_freight eff 15 / T+1）⇒ crossDay 真变 null，走 `continue` 丢卡 ──
    const tc = await makeApp();
    await seedBattery(tc);
    expect(pairOf(await board(tc), RES_BASE, RES_FACTOR), `金丝雀：${RES_BASE}·${RES_FACTOR} 基线该在榜`).toBeTruthy();
    expect((await adopt(tc, { base: RES_BASE, factor: RES_FACTOR, planKey: RES_PLAN })).status).toBe("EXECUTED");
    const afterRes = await board(tc);
    expect(pairOf(afterRes, RES_BASE, RES_FACTOR), "真消解 ⇒ 该 pair 的卡整张消失").toBeUndefined();
    const rowB = rowOf(afterRes, RES_BASE, RES_FACTOR)!;
    expect(rowB.crossDay, "这一条才是派单描述的那种消失：越线真的没了").toBeNull();
    expect(rowB.wouldCrossDay, "而不采纳的话它会越线 ⇒ 确实是这条处置消解的").not.toBeNull();
    expect(rowB.state).toBe("RESOLVED");

    // ── C 路：debottleneck（eff 13 / T+6）⇒ 卡还在（这条路今天是对的，不许连它一起改了）──
    const tb = await makeApp();
    await seedBattery(tb);
    expect((await adopt(tb, { base: BASE, factor: FACTOR, planKey: "debottleneck" })).status).toBe("EXECUTED");
    const afterDeb = await board(tb);
    const kept = pairOf(afterDeb, BASE, FACTOR);
    expect(kept, "反向对照：debottleneck 削峰更少（0.005 < reroute 的 0.047）⇒ 峰值排名保住 ⇒ 卡留得住").toBeTruthy();
    expect(kept!.crossDay, "留住的那张卡仍在越线").not.toBeNull();
  }, 300000);

  it("② 实验 1 · 卡下榜之后采纳记录仍在，且四项披露齐全 —— **两条消失路各验一遍**", async () => {
    // 逐条断言两条路共用的判据；参数化避免「只咬住其中一条路」这种半拉子覆盖。
    for (const cs of [
      { base: BASE, factor: FACTOR, planKey: "reroute", state: "STILL_CROSSING", crossNull: false },
      { base: RES_BASE, factor: RES_FACTOR, planKey: RES_PLAN, state: "RESOLVED", crossNull: true },
    ] as const) {
      const t = await makeApp();
      await seedBattery(t);
      const plan = (await board(t)).mitigationLibrary[cs.factor]!.find((p) => p.key === cs.planKey)!;
      expect((await adopt(t, { base: cs.base, factor: cs.factor, planKey: cs.planKey })).status).toBe("EXECUTED");

      const out = await board(t);
      expect(pairOf(out, cs.base, cs.factor), `${cs.planKey}：该 pair 的卡已下榜（引擎行为不变）`).toBeUndefined();

      const row = rowOf(out, cs.base, cs.factor);
      expect(
        row,
        `**本单的要害**（${cs.planKey}）：卡下榜了，采纳记录必须仍在 —— ` +
          "否则「把问题解决了」与「记录被抹掉了」在屏上一模一样",
      ).toBeTruthy();
      // 四项披露（WO 设计约束 4）——全部来自台账/引擎原值，前端零重算。
      expect(row!.planKey, "采纳了哪条").toBe(cs.planKey);
      expect(row!.planName, "方案人话名必须来自台账自带的 planName（不许读侧再编一个）").toBe(plan.name);
      expect(row!.eff, "消解多少（标称）").toBe(plan.eff);
      expect(row!.tn, "第几天起效").toBe(plan.tn);
      expect(row!.adoptedAt, "何时采纳（确定性时间锚 forecastStart·非 Date.now）").toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 对照实验（铁律 1.5 判据一）：把这条采纳拿掉会怎样 —— 三态由它裁定，不由「卡在不在」裁定。
      expect(row!.state).toBe(cs.state);
      expect(row!.crossDay === null, `${cs.planKey} 采纳后是否仍越线`).toBe(cs.crossNull);
      expect(row!.wouldCrossDay, "反事实：不采纳则会越线").not.toBeNull();
      expect(row!.peakWithout, "反事实峰值必须高于采纳后峰值").toBeGreaterThan(row!.peak);
      expect(row!.peakCut, "实测削峰量 = peakWithout − peak（是实测差，不是标称 eff）").toBeCloseTo(row!.peakWithout - row!.peak, 6);
      expect(row!.onBoard, "该卡已下榜 ⇒ onBoard 必须诚实为 false").toBe(false);
    }
  }, 300000);

  it("②b **削峰量必须说实话**：reroute 标称 eff=9，实测只削 <1 点 —— 不许拿标称值冒充效果", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await adopt(t, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");
    const row = rowOf(await board(t), BASE, FACTOR)!;
    expect(row.eff, "标称值照原样给（它是方案库事实）").toBe(9);
    expect(row.peakCut, "**实测**削峰量必须另给一个数，且这里它远小于标称值").toBeLessThan(1);
    expect(row.peakCut).toBeGreaterThan(0);
    // 反面样例：真起作用的那条，两个数才对得上（tn=1 ⇒ 全窗覆盖 ⇒ 实测削峰 = 标称 eff）。
    const t2 = await makeApp();
    await seedBattery(t2);
    expect((await adopt(t2, { base: RES_BASE, factor: RES_FACTOR, planKey: RES_PLAN })).status).toBe("EXECUTED");
    const row2 = rowOf(await board(t2), RES_BASE, RES_FACTOR)!;
    expect(row2.peakCut, "T+1 起效且未触饱和 ⇒ 实测削峰恰等于标称 eff").toBeCloseTo(row2.eff, 6);
  }, 300000);

  it("③ 实验 3 · **不许复活告警**：已消解的问题不许回到「当前风险」，board 上每张卡都仍在越线", async () => {
    const t0 = await makeApp();
    await seedBattery(t0);
    const baselineCount = (await board(t0)).cards.length;

    // 真消解那条路（air_freight）才是「会不会复活告警」的真考题：卡是因为**不越线了**才走的。
    const t = await makeApp();
    await seedBattery(t);
    expect((await adopt(t, { base: RES_BASE, factor: RES_FACTOR, planKey: RES_PLAN })).status).toBe("EXECUTED");
    const out = await board(t);

    // 判据 1：**当前风险卡数不变**（台账另开一条读侧，不占卡位、不新增告警）。
    expect(out.cards.length, "当前风险卡数：加台账前后必须相等（台账不进 cards[]）").toBe(baselineCount);
    // 判据 2：看板上不许出现任何"其实已经不越线"的卡。
    for (const c of out.cards) {
      expect(c.crossDay, `${c.baseId}·${c.factor} 在看板上却不越线 ⇒ 已消解的问题被复活成告警`).not.toBeNull();
    }
    // 判据 3：已消解的那个 pair 不在看板上（它的位置由台账承载，不由告警承载）。
    expect(pairOf(out, RES_BASE, RES_FACTOR)).toBeUndefined();
    // 判据 4：台账里凡 RESOLVED 的，onBoard 必须为 false —— 两条读侧不许自相矛盾。
    for (const r of out.adoptionLedger ?? []) {
      if (r.state === "RESOLVED") expect(r.onBoard, `${r.baseId}·${r.factor} 已消解却仍在看板 ⇒ 自相矛盾`).toBe(false);
    }
    // 同一组判据在 top-8 截断那条路上也必须成立。
    const t2 = await makeApp();
    await seedBattery(t2);
    expect((await adopt(t2, { base: BASE, factor: FACTOR, planKey: "reroute" })).status).toBe("EXECUTED");
    const out2 = await board(t2);
    expect(out2.cards.length, "当前风险卡数：截断路同样必须相等").toBe(baselineCount);
    for (const c of out2.cards) expect(c.crossDay).not.toBeNull();
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
    expect((await adopt(t, { base: RES_BASE, factor: RES_FACTOR, planKey: RES_PLAN })).status).toBe("EXECUTED");

    // 会话 A 的读数（真消解那条：卡已走 `continue` 消失，记录只剩台账这一条路可走）
    expect(rowOf(await board(t), RES_BASE, RES_FACTOR)!.state).toBe("RESOLVED");

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
    expect(active.some((o) => o.props.baseId === RES_BASE && o.props.factor === RES_FACTOR && o.props.planKey === RES_PLAN)).toBe(true);
    for (const o of active) {
      for (const k of Object.keys(o.props)) {
        expect(/session/i.test(k), `台账不许带会话字段，实见 ${k}`).toBe(false);
      }
    }

    const asPlanner = await invokeSolver(t, "risk_timeline", { horizon: H }, PLANNER);
    expect(asPlanner.statusCode, asPlanner.body).toBe(200);
    const outB = (asPlanner.json() as { data: RiskOut }).data;
    expect(rowOf(outB, RES_BASE, RES_FACTOR)!.state, "会话 B 的推演里同样带着这条台账").toBe("RESOLVED");
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
