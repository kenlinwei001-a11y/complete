/**
 * ⚠ 命名说明（并线时由审核方改名）：本文件原名 `zz-adversary-adopt.test.ts`。仓内 `zz-` 前缀的既定含义是
 * **临时探针**（见 LOOP 简报），而这是一套要长期留在测试集里的对抗性复验——顶着 `zz-` 早晚会被当草稿删掉。
 * 内容一字未改，只改文件名。
 */
import { describe, expect, it } from "vitest";
import { RiskTimelineOutputSchema } from "@platform/contracts";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";

/**
 * 对抗性复验（证伪导向）：针对 WO-ADOPT-MITIGATION 的 7 个攻击方向。
 * 本文件**不为通过而写**——每条断言都是"如果它成立则被验方的声明为假"。
 */

const HEADER_BY_ROLE: Record<string, Record<string, string>> = { planner: PLANNER, admin: ADMIN };

interface DraftView {
  id: string;
  status: string;
  approvalSteps: { seq: number; role: string; decision?: string }[];
  executionResult?: { ok?: boolean; targetRef?: string; error?: string };
}

async function createSubmitted(t: TestApp, payload: Record<string, unknown>): Promise<string> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "adopt_mitigation", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  return (created.json() as { draftId: string }).draftId;
}

/** 逐步审批直到不再 PENDING_APPROVAL。 */
async function driveToEnd(t: TestApp, draftId: string): Promise<DraftView> {
  for (let g = 0; g < 6; g++) {
    const cur = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN })).json() as DraftView;
    if (cur.status !== "PENDING_APPROVAL") return cur;
    const pending = cur.approvalSteps.find((s) => !s.decision)!;
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: HEADER_BY_ROLE[pending.role]!, payload: {} });
  }
  throw new Error("not converged");
}

/** 只走到"还差最后一步"，把最后一步留给调用方（用于并发）。 */
async function driveToLastStep(t: TestApp, draftId: string): Promise<string> {
  for (let g = 0; g < 6; g++) {
    const cur = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN })).json() as DraftView;
    const undecided = cur.approvalSteps.filter((s) => !s.decision);
    if (undecided.length <= 1) return undecided[0]!.role;
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: HEADER_BY_ROLE[undecided[0]!.role]!, payload: {} });
  }
  throw new Error("not converged");
}

async function adopt(t: TestApp, payload: Record<string, unknown>): Promise<DraftView> {
  return driveToEnd(t, await createSubmitted(t, payload));
}

interface Card {
  base: string;
  baseId: string;
  factor: string;
  series: number[];
  peak: number;
  crossDay: number | null;
  adoptedMitigation?: { planKey: string; eff: number; tn: number };
}

/** `base` 认 baseId（"changzhou"）**或**中文名（"常州"）——聚合侧 `risks[].base` 给的是中文名。 */
async function forcedCard(t: TestApp, base: string, factor: string, horizon = 30): Promise<Card> {
  const res = await invokeSolver(t, "risk_timeline", { base, factor, horizon });
  expect(res.statusCode, res.body).toBe(200);
  const out = (res.json() as { data: { cards: Card[] } }).data;
  const card = out.cards.find((c) => (c.baseId === base || c.base === base) && c.factor === factor);
  expect(card, `forced risk_timeline(${base}, ${factor}) 未返回该卡`).toBeTruthy();
  return card!;
}

describe("ADVERSARY · WO-ADOPT-MITIGATION 证伪", () => {
  // ── 攻击 A：counterfactual_timeline 的「do-nothing baseline」被采纳污染 ──
  it("A · counterfactual_timeline：采纳 A 后再问 B 的反事实 → baseline 已含 A 的削减，peakCut 语义崩坏", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";

    const lib = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { mitigationLibrary: Record<string, { key: string; name: string; eff: number; tn: number }[]> };
    };
    const plans = lib.data.mitigationLibrary[factor]!;
    const strong = [...plans].sort((a, b) => b.eff - a.eff)[0]!;
    const weak = [...plans].sort((a, b) => a.eff - b.eff)[0]!;
    expect(strong.key, "需要两个 eff 不同的方案才能驱动本攻击").not.toBe(weak.key);

    const cfBefore = (await invokeSolver(t, "counterfactual_timeline", { base, factor, horizon: 30, mitigationKey: weak.key })).json() as {
      data: { delta: { peakCut: number; crossDelayDays: number }; summary: string };
    };
    expect(cfBefore.data.delta.peakCut, "未采纳时 peakCut 应 ≥0").toBeGreaterThanOrEqual(0);

    expect((await adopt(t, { base, factor, planKey: strong.key })).status).toBe("EXECUTED");

    const cfAfter = (await invokeSolver(t, "counterfactual_timeline", { base, factor, horizon: 30, mitigationKey: weak.key })).json() as {
      data: { delta: { peakCut: number; crossDelayDays: number }; summary: string };
    };
    // eslint-disable-next-line no-console
    console.log(`ADV_A strong=${strong.key}(eff=${strong.eff},tn=${strong.tn}) weak=${weak.key}(eff=${weak.eff},tn=${weak.tn})`);
    // eslint-disable-next-line no-console
    console.log(`ADV_A before.peakCut=${cfBefore.data.delta.peakCut} after.peakCut=${cfAfter.data.delta.peakCut}`);
    // eslint-disable-next-line no-console
    console.log(`ADV_A after.summary=${cfAfter.data.summary}`);
    // 证伪目标：peakCut 变负 = "处置后比不处置更差"，是无法向用户解释的输出。
    expect(cfAfter.data.delta.peakCut, "peakCut 负数 = counterfactual 的 baseline 与 mitigated 不同源（前者含已采纳，后者不含）").toBeGreaterThanOrEqual(0);
  }, 300000);

  // ── 攻击 B：affected_orders 聚合（订单全链）与 risk_timeline 卡面必须是**同一事实的同一个出处** ──
  // #82（本体 §8 `G-RISK-PEAK-TWO-SOURCES` · R-一致「同一事实一个出处」+ R13 可溯源）。
  //
  // 修前实测（demo·seed 42·horizon 30·两侧对同一 (base, primaryFactor)）：
  //   聚合侧 `affectedOrdersAggregate` **另起一条** `tensionSeries(c, baseId, factor, horizon, riskEvents(...))`
  //   = 第二个出处，比卡面那条少传两个入参：
  //     ① 缺 `baseline` → 回落 `mockTightness` 哈希锚，而卡面锚的是 `liveTightness` **实测**；
  //     ② 缺 `mitigation` → `adoptedMitigationIndex` 只喂给卡面曲线，聚合侧**永远看不见已采纳**。
  //   接缝另一半在 service.ts：`affected_orders` 不在 `ADOPTION_AWARE_SOLVERS` 里 → `c.adoptedMitigations`
  //   恒空，聚合侧即使想读也读不到。用户后果：风险看板曲线已降、订单全链还是老数。
  // 修法（**不是把两边的数调成一样**，是让第二个出处消失）：两侧同走 `risk.ts riskFactorProjection`
  //   （峰值/越线日的唯一算法），并把 `affected_orders` 纳入 ADOPTION_AWARE_SOLVERS + 补声明 Line/Process/Equipment。
  //
  // 本条是**效果层**常驻回归门（不是"形状测"）：
  //   ① 聚合列出的**每一格** (base,factor) 都必须与卡面逐字相等（peak + crossDay）——这就是"单一出处"的定义；
  //   ② 采纳后两侧仍相等，且两侧 peak 都真的低于采纳前——"采纳"这件事必须同时到达两屏。
  // ⚠ 逐格差异**先收齐再断言**（不是首格即抛）：投影一旦被改回各算各的，报告里要能一眼看见劈了几格、劈在哪。
  it("B · affected_orders 聚合与 risk_timeline 卡面对同一 (base,factor) 必须同源同数（采纳后两侧同降）【#82】", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const H = 30;
    type Ref = { base: string; factor: string; peak: number; crossDay: number | null };
    type Agg = { data: { rows: { so: string; risks: Ref[] }[] } };

    /** 订单全链聚合列出的每格风险引用（base → ref·聚合每基地一条）。 */
    const readAggRefs = async (): Promise<Map<string, Ref>> => {
      const res = await invokeSolver(t, "affected_orders", { horizon: H });
      expect(res.statusCode, res.body).toBe(200);
      const m = new Map<string, Ref>();
      for (const r of (res.json() as Agg).data.rows) for (const k of r.risks) m.set(k.base, k);
      return m;
    };

    /** 单一出处不变量：聚合的每一格 == 风险看板对同一 (base,factor) 的卡面。先收齐全部劈裂再断言。 */
    const reconcile = async (tag: string, refs: Map<string, Ref>): Promise<string[]> => {
      expect(refs.size, "前提：聚合应至少列出一格风险（否则本条测不到接缝）").toBeGreaterThan(0);
      const lines: string[] = [];
      const diffs: string[] = [];
      for (const [b, ref] of [...refs.entries()].sort()) {
        const card = await forcedCard(t, b, ref.factor, H);
        const line = `${tag} ${b}|${ref.factor} card=${card.peak}/${card.crossDay} agg=${ref.peak}/${ref.crossDay}`;
        lines.push(line);
        if (ref.peak !== card.peak || ref.crossDay !== card.crossDay) diffs.push(line);
      }
      // eslint-disable-next-line no-console
      console.log(`ADV_B ${tag} 逐格对账（card=risk_timeline 卡面 · agg=订单全链聚合 · peak/crossDay）:\n${lines.join("\n")}`);
      expect(
        diffs,
        `${tag}：订单全链聚合与风险看板对同一 (base,factor) 报了不同的 peak/crossDay —— ` +
          `同一事实两个出处（#82 回潮）。劈裂 ${diffs.length}/${lines.length} 格`,
      ).toEqual([]);
      return lines;
    };

    const before = await readAggRefs();
    await reconcile("BEFORE", before);

    // 采纳目标 = 聚合里峰值最高且该因素有对症方案的那格（同分按基地名定序 → R6 确定性）。
    const lib = (await invokeSolver(t, "risk_timeline", { horizon: H })).json() as {
      data: { mitigationLibrary: Record<string, { key: string; eff: number; tn: number }[]> };
    };
    const target = [...before.values()]
      .filter((r) => (lib.data.mitigationLibrary[r.factor] ?? []).length > 0)
      .sort((a, b) => b.peak - a.peak || (a.base < b.base ? -1 : 1))[0];
    expect(target, "前提：聚合里至少一格的因素有对症处置方案").toBeTruthy();
    const strong = [...lib.data.mitigationLibrary[target!.factor]!].sort((a, b) => b.eff - a.eff)[0]!;
    // eslint-disable-next-line no-console
    console.log(`ADV_B target=${target!.base}|${target!.factor} plan=${strong.key}(eff=${strong.eff},tn=${strong.tn})`);
    expect((await adopt(t, { base: target!.base, factor: target!.factor, planKey: strong.key })).status).toBe("EXECUTED");

    const after = await readAggRefs();
    await reconcile("AFTER", after);

    // ② 采纳这件事必须**同时**到达两屏：卡面与聚合的峰值都真的降了（而不是一边降一边老数）。
    const peakBefore = before.get(target!.base)!.peak;
    const aggAfter = after.get(target!.base)!;
    const cardAfter = await forcedCard(t, target!.base, target!.factor, H);
    expect(cardAfter.peak, "采纳后风险看板卡面峰值应下降").toBeLessThan(peakBefore);
    expect(
      aggAfter.peak,
      "采纳后订单全链聚合峰值纹丝不动 —— 风险看板已降、订单全链还是老数（同一事实两个出处·#82 回潮）",
    ).toBeLessThan(peakBefore);
    // 两侧同数（已由 reconcile 逐格钉死，此处再钉住采纳格本身，读者一眼可见）。
    expect(aggAfter.peak).toBe(cardAfter.peak);
    expect(aggAfter.crossDay).toBe(cardAfter.crossDay);
  }, 300000);

  // ── 攻击 C：并发审批 → "至多一条 ACTIVE" 是不是真的写时不变量 ──
  it("C · 同 (base,factor) 两个方案并发执行 → ACTIVE 条数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const lib = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { mitigationLibrary: Record<string, { key: string }[]> };
    };
    const [p1, p2] = lib.data.mitigationLibrary[factor]!;

    const d1 = await createSubmitted(t, { base, factor, planKey: p1!.key });
    const d2 = await createSubmitted(t, { base, factor, planKey: p2!.key });
    const r1 = await driveToLastStep(t, d1);
    const r2 = await driveToLastStep(t, d2);
    // 同一时刻按下两个"最后一步审批"（真实可发生：两个审批人各自点批）
    await Promise.all([
      t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d1}/approve`, headers: HEADER_BY_ROLE[r1]!, payload: {} }),
      t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${d2}/approve`, headers: HEADER_BY_ROLE[r2]!, payload: {} }),
    ]);

    const objs = await t.repos.objects.listByType("demo", "AdoptedMitigation");
    const active = objs.filter((o) => o.props.status === "ACTIVE");
    // eslint-disable-next-line no-console
    console.log(`ADV_C objs=${objs.length} active=${active.length} keys=${JSON.stringify(active.map((o) => o.props.planKey))}`);
    expect(active.length, "并发采纳后 ACTIVE 仍应恒为 1（作者称这是'写时不变量'）").toBe(1);
  }, 300000);

  // ── 攻击 D：绕过执行器直接写两条 ACTIVE（作者自称有"末条胜"防御但未测） ──
  it("D · 两条 ACTIVE 直写 → riskTimeline 不抛错、按 objectId 末条胜、且是确定性的", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const lib = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { mitigationLibrary: Record<string, { key: string; eff: number; tn: number }[]> };
    };
    const plans = lib.data.mitigationLibrary[factor]!;
    const a = plans[0]!;
    const b = plans[1]!;
    for (const pl of [a, b]) {
      await t.repos.objects.put({
        id: `obj_adoptedmitigation_${base}-${factor}-${pl.key}`,
        tenantId: "demo",
        type: "AdoptedMitigation",
        props: { adoptionId: `${base}-${factor}-${pl.key}`, baseId: base, factor, planKey: pl.key, eff: pl.eff, tn: pl.tn, status: "ACTIVE" },
        origin: { type: "MANUAL" },
      });
    }
    const c1 = await forcedCard(t, base, factor, 30);
    const c2 = await forcedCard(t, base, factor, 30);
    // eslint-disable-next-line no-console
    console.log(`ADV_D a=${a.key} b=${b.key} winner=${JSON.stringify(c1.adoptedMitigation)}`);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2)); // R6 确定性
    const idA = `obj_adoptedmitigation_${base}-${factor}-${a.key}`;
    const idB = `obj_adoptedmitigation_${base}-${factor}-${b.key}`;
    const expectWin = idA < idB ? b : a; // 末条胜 = id 最大者
    expect(c1.adoptedMitigation?.planKey, "末条胜（objectId 升序末条）").toBe(expectWin.key);
  }, 300000);

  // ── 攻击 E：加性披露 adoptedMitigation 能不能真的到达前端（契约层） ──
  it("E · RiskTimelineOutputSchema.parse（前端 RiskBoardView 的必经之路）是否保留 card.adoptedMitigation", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const lib = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { mitigationLibrary: Record<string, { key: string }[]> };
    };
    expect((await adopt(t, { base, factor, planKey: lib.data.mitigationLibrary[factor]![0]!.key })).status).toBe("EXECUTED");

    const raw = (await invokeSolver(t, "risk_timeline", { base, factor, horizon: 30 })).json() as { data: unknown };
    const rawCard = (raw.data as { cards: Card[] }).cards[0]!;
    expect(rawCard.adoptedMitigation, "服务端确实带了该键").toBeTruthy();
    const parsed = RiskTimelineOutputSchema.parse(raw.data);
    // eslint-disable-next-line no-console
    console.log(`ADV_E parsedCardKeys=${JSON.stringify(Object.keys(parsed.cards[0]!))}`);
    expect(
      (parsed.cards[0] as unknown as Card).adoptedMitigation,
      "契约 parse 后仍应保留（否则前端永远拿不到，R13 加性披露形同虚设）",
    ).toBeTruthy();
  }, 300000);

  // ── 攻击 F：诚实拒绝的原子性——已有 ACTIVE 时，一次失败的采纳会不会把它撤了 ──
  it("F · 已有 ACTIVE 时 planKey 解不出 → 旧 ACTIVE 必须原封不动（不许被半路撤销）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const lib = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { mitigationLibrary: Record<string, { key: string }[]> };
    };
    const p1 = lib.data.mitigationLibrary[factor]![0]!;
    expect((await adopt(t, { base, factor, planKey: p1.key })).status).toBe("EXECUTED");
    const seriesAfterOk = (await forcedCard(t, base, factor, 30)).series;

    const bad = await adopt(t, { base, factor, planKey: "查无此方案" });
    expect(bad.status).toBe("EXECUTION_FAILED");
    const objs = await t.repos.objects.listByType("demo", "AdoptedMitigation");
    expect(objs.length, "失败不应产生新记录").toBe(1);
    expect(objs[0]!.props.status, "失败不应撤销旧 ACTIVE").toBe("ACTIVE");
    expect((await forcedCard(t, base, factor, 30)).series).toEqual(seriesAfterOk);
  }, 300000);

  // ── 攻击 G：按需加载真按需？其余求解器不得看见该台账 ──
  it("G · 非 ADOPTION_AWARE 求解器的 ctx.adoptedMitigations 恒空（按需加载真按需）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const svc = t.services.solvers as unknown as {
      loadContext: (tid: string, vo?: unknown, o?: Record<string, unknown>) => Promise<{ adoptedMitigations?: unknown[] }>;
    };
    await t.repos.objects.put({
      id: "obj_adoptedmitigation_probe",
      tenantId: "demo",
      type: "AdoptedMitigation",
      props: { adoptionId: "probe", baseId: "jiangmen", factor: "瓶颈工序", planKey: "x", eff: 1, tn: 1, status: "ACTIVE" },
      origin: { type: "MANUAL" },
    });
    const noFlag = await svc.loadContext("demo");
    expect(noFlag.adoptedMitigations ?? [], "默认（不传 withAdoptions）必须为空").toEqual([]);
    const withFlag = await svc.loadContext("demo", undefined, { withAdoptions: true });
    expect((withFlag.adoptedMitigations ?? []).length).toBe(1);
  }, 300000);

  // ── 攻击 H：ACTION_WIRING=WIRED 宣称整型已接，但决策内核这条生产者派的 payload 形状执行不了 ──
  it("H · decision kernel commit 出的 adopt_mitigation 草稿，审批后能否真写", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const svcCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };
    const dp = (await t.services.solvers.invoke(svcCtx as never, "decision_play", { metricKey: "seg_attain_ess" })) as unknown as {
      options: { optionId: string }[];
    };
    const chosen = dp.options.slice(0, 1).map((o) => o.optionId);
    const dec = (
      await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: "seg_attain_ess", chosenOptionIds: chosen } })
    ).json() as { id: string };
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as {
      actionDraftIds: string[];
    };
    const draftId = committed.actionDraftIds[0];
    // ⚠ 本条断言方向由审核方并线时**改正**（原断言要求 EXECUTED，是错的）。
    // 原断言把「动作类型有真执行器（WIRED）」偷换成「每条生产者路径都必须产出可执行草稿」。
    // 决策内核这条**刻意不派**，且论证充分（kernel.ts commit 注释）：`decision_play` 恒产出 3 条
    // **公司级供应链战略**（备份供应商认证 / 长协价格联动 / 上游自采矿），factorId 是 gap_attribution
    // 的因果因子 `cf-*`；而 `params.risk.mitigations` 的键是 7 个**基地级产能风险因子**，方案是
    // early_stock / air_freight / reroute 这类基地处置动作。**两个域没有任何真实映射**。
    // 若为了"让链路看起来通"挑一条：台账写着决策者选了「上游自采矿」，Action 却去执行「空运补料」
    // 并按它的 eff/tn 把曲线压下去——界面上分辨不出，是刚清掉的假 MO 号同款病换件衣服（#81）。
    // 判据不自己发明：`dryRunMitigation` 拿真消费者 risk_timeline 干跑同一载荷，算得出真降才派。
    // 故正确不变量 = **零草稿 + 决策轨迹留诚实理由**，而不是 EXECUTED。
    expect(
      committed.actionDraftIds.length,
      "决策内核对公司级战略方案派出了 adopt_mitigation 草稿 —— 那是注定失败/或更糟：静默错数（#81）",
    ).toBe(0);
    expect(draftId, "同上：不该有 draftId").toBeUndefined();
    // 台账必须干净：没派单就不该有任何采纳记录凭空出现。
    expect((await t.repos.objects.listByType("demo", "AdoptedMitigation")).length).toBe(0);
  }, 300000);
});
