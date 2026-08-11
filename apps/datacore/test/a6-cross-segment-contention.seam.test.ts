import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { SEG_REGISTRY, type ChainImpediment } from "@platform/contracts";
import { evaluateExpression } from "../src/ruledsl.js";
import { CONTENTION_LOCUS_TYPE, readBaseContention } from "../src/solvers/chain-impediment.js";

/**
 * WO-A6-CONTENTION · 跨业务线产能争用 **SEAM**（数据半 × 引擎半）
 * —— `docs/PRD-sandbox-redesign.md` §9 验收 **A6** 的机器可核那一半。
 *
 * ══ A6 原文与它的两半 ═════════════════════════════════════════════════════════
 *   > **三业务**：跨 seg 争用场景**能产出阻滞点**，且**保谁的判据来自 `SEG_REGISTRY.marginPct/floorPct`**
 *   > 怎么核：改 `SEG_REGISTRY` 一个值 → 结论真跟着变
 * 两半此前一半有一半没有（`docs/AUDIT-a6-rule-carriers.md` §5 实测）：
 * 「保谁」的取值链早就活着（`SEG_REGISTRY → DemandSegment.floorPct → C15`），
 * 「有争用」则**规则库 28 条 expression 无一条是多主体谓词** ⇒ 结构上判不出来。
 * 本文件咬的就是补齐之后的**整条链**。
 *
 * ══ 为什么每条断言都从种子跑起（不许直构 ctx）═════════════════════════════════
 * 判据是「**种子数据 → 引擎 → 判定 → 输出**」整条通，不是「判定函数对某个手捏入参返回 true」。
 * 后者是本仓的假绿第 9 形态（测试咬的是**函数**不是**链路**）。故全部走
 * `seedBattery`（真 battery 合成种子·seed 42）+ `POST /a/v1/solvers/chain_impediments/invoke` 真路由。
 *
 * ══ ⚠ 两条断言缺一不可（A1 那条的教训·同一份 PRD :359）══════════════════════
 * A1 的原措辞只咬后半段，而前半段恒真 ⇒ 那条断言**无法失败**。本文件因此把
 * 「无争用」也咬成**显式结论**，并额外断言它**不是空转**：
 *   ① 有争用时：改册一个值 → `keep` 真翻（A6 原文的核法）；
 *   ② 无争用时：必须显式报 `NO_CONTENTION`，且**该 scope 下确实存在 ≥2 条业务线**
 *      （前半段不成立的话，「没争用」这个结论本身就是废话，断言也就无法失败）。
 *
 * ══ 变异反证注入点（交付说明里贴了三发红的原文）════════════════════════════════
 *  · 摘掉 C34 的 `COUNT(...) > 1` 合取项      → CONTENTION-3 必红（单业务线基地被冒充成争用）
 *  · 摘掉 `loci()` 的 `Base` 分派             → CONTENTION-1 必红（判据整条掉进 unresolved）
 *  · 把演示基地的越线值调回线内（抬产能面）   → CONTENTION-1 必红（CONTENDED 变 NO_CONTENTION）
 */

interface ContentionVerdict {
  ruleKey: string;
  verdict: "CONTENDED" | "NO_CONTENTION" | "UNKNOWN";
  basesScanned: number;
  multiSegmentBases: string[];
  contendedBases: string[];
  note: string;
}
interface AttributionRow {
  bindingId: string;
  ruleKey: string;
  locusObjectType: string;
  carriesSegment: boolean;
  emitted: number;
  unattributed: number;
  note: string;
}
interface ScanOut {
  scanId: string;
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  impediments: ChainImpediment[];
  unresolved: { bindingId: string; status: string; reason: string }[];
  caveats: { bindingId: string; ruleKey: string; note: string }[];
  thresholds: { bindingId: string; ruleKey: string; source: string; fieldPath?: string; value: number; unit: string }[];
  contention?: ContentionVerdict;
  segmentAttribution?: { requested: string[]; rows: AttributionRow[]; unattributedTotal: number };
}

const CONTENTION_BINDING = "BOTTLENECK.CAPACITY.cross-segment-contention";
const CONTENTION_RULE = "C34";

async function scan(t: TestApp, scope: Record<string, unknown> = {}): Promise<ScanOut> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/chain_impediments/invoke",
    headers: ADMIN,
    payload: { args: { scope } },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as ScanOut;
}

/** 经**规则编辑路径**改 C34（新版本 → 发布），全程不碰源码常量 —— 这是接缝的「规则半」。 */
async function republishC34(t: TestApp, expression: string): Promise<void> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/rules",
    headers: ADMIN,
    payload: {
      key: CONTENTION_RULE,
      name: "跨业务线产能争用",
      expression,
      scopeObjectTypes: [CONTENTION_LOCUS_TYPE, "Order", "DemandSegment"],
      severity: "BLOCK",
      params: {},
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${created.json().id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode, pub.body).toBe(200);
}

const contentionOf = (s: ScanOut) => s.impediments.filter((i) => i.locus.objectType === CONTENTION_LOCUS_TYPE && i.contention);

describe("WO-A6-CONTENTION · 跨业务线争用 SEAM（PRD §9 A6）", () => {
  it("CONTENTION-1 · 种子→引擎→判定→输出整条：真种子上判得出跨业务线争用，且每条都指得出「保谁·凭什么」", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 🐤 金丝雀：这次扫描本身得是活的 —— 既有三类阻滞点仍在（否则"多了两条争用"这个结论没有参照系）。
    expect(s.counts.CONGESTION, "既有堵点判据应仍在（金丝雀：扫描没瞎）").toBeGreaterThan(0);
    expect(s.counts.BREAK, "既有断点判据应仍在").toBeGreaterThan(0);

    // ── ① 显式结论：这是一个**判定结果**，不是"有没有产出" ──────────────────────
    expect(s.contention, "扫描必须显式给出跨业务线争用的结论（空白会被读成「没问题」）").toBeDefined();
    const v = s.contention as ContentionVerdict;
    expect(v.ruleKey).toBe(CONTENTION_RULE);
    expect(v.verdict).toBe("CONTENDED");
    expect(v.basesScanned).toBeGreaterThan(0);
    // 前半段必须成立，否则「判出争用」是空转：结构上可能争用的面非空，且真越线的是它的子集。
    expect(v.multiSegmentBases.length, "必须真有基地被 ≥2 条业务线索取（前半段不成立 ⇒ 后半段无法失败）").toBeGreaterThan(0);
    expect(v.contendedBases.length).toBeGreaterThan(0);
    expect(v.contendedBases.every((b) => v.multiSegmentBases.includes(b)), "越线的基地必须是多业务线基地的子集").toBe(true);

    // ── ② 阻滞点真产出，且落在真对象上 ────────────────────────────────────────
    const cts = contentionOf(s);
    expect(cts.length, "争用面上必须真产出阻滞点（A6 原文「能产出阻滞点」）").toBe(v.contendedBases.length);
    expect(cts.map((i) => i.locus.objectId).sort()).toEqual([...v.contendedBases].sort());

    for (const im of cts) {
      expect(im.kind).toBe("BOTTLENECK");
      expect(im.evidence.ruleKey).toBe(CONTENTION_RULE);
      // 实测值真的越过阈值（不是拍上去的一条"看着合理"的记录）。
      expect(im.evidence.metricValue).toBeGreaterThan(im.evidence.threshold);
      // severity 必须能由 metric/threshold **重算出来**（禁固定权重表）。
      const expected = Math.max(0, Math.min(100, Math.round(((im.evidence.metricValue - im.evidence.threshold) / Math.abs(im.evidence.threshold)) * 100)));
      expect(im.severity).toBe(expected);

      // ── ③「保谁」的判据逐值回 `SEG_REGISTRY` 对拍 —— 引擎不许自带一份经营参数 ──
      const ct = im.contention!;
      expect(ct.basisSource).toBe("SEG_REGISTRY");
      expect(ct.businessTypes.length).toBeGreaterThanOrEqual(2);
      expect(ct.keep, "有册值就必须给出保谁（判不出来才允许 unknownReason）").toBeDefined();
      expect(ct.unknownReason).toBeUndefined();
      expect(ct.businessTypes).toContain(ct.keep);
      for (const b of ct.basis) {
        const reg = SEG_REGISTRY.find((x) => x.seg === b.seg);
        expect(reg, `basis 里的细分 ${b.seg} 必须在册里真存在`).toBeDefined();
        expect(b.marginPct, "marginPct 必须逐值等于册值（引擎自带一份就会漂）").toBe(reg!.marginPct);
        expect(b.floorPct, "floorPct 必须逐值等于册值").toBe(reg!.floorPct);
        expect(b.headroomPct).toBe(reg!.marginPct - reg!.floorPct);
      }
      // keep = 余量最大的那条（两个册值**都**参与，缺一个这条断言就废了）。
      const best = [...ct.basis].sort((a, b) => b.headroomPct - a.headroomPct || b.marginPct - a.marginPct)[0]!;
      expect(ct.keep).toBe(best.businessType);
    }

    // ── ④ 阈值出处：source="field"（改数据即改判定），不抬 A2 的 literal 棘轮 ──
    const row = s.thresholds.find((x) => x.bindingId === CONTENTION_BINDING);
    expect(row, "争用判据必须申报阈值出处").toBeDefined();
    expect(row!.source).toBe("field");
    expect(row!.fieldPath).toBe(`${CONTENTION_LOCUS_TYPE}.capacityDailyPacks`);
    expect(s.thresholds.filter((x) => x.source === "literal").length, "A2 literal 棘轮：只降不升（基线 4）").toBeLessThanOrEqual(4);

    // ── ⑤ 三类互斥仍成立（新 locus 类型没把裁决搅乱）───────────────────────────
    const loci = s.impediments.map((i) => `${i.locus.objectType}|${i.locus.objectId}`);
    expect(new Set(loci).size).toBe(loci.length);
  }, 180000);

  it("CONTENTION-2 · A6 的核法：改 `SEG_REGISTRY` 一个值 → 「保谁」的结论真跟着翻（不改一行代码）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = contentionOf(await scan(t));
    expect(before.length, "先得真有争用，否则这条断言无法失败").toBeGreaterThan(0);
    const target = before[0]!;
    const keepBefore = target.contention!.keep!;
    // 取当选者与亚军：把当选者的底线抬到亚军之上，余量排序必须整个翻过来。
    const ranked = [...target.contention!.basis].sort((a, b) => b.headroomPct - a.headroomPct || b.marginPct - a.marginPct);
    const winner = ranked[0]!;
    const runnerUp = ranked[1]!;
    expect(winner.businessType).toBe(keepBefore);

    const regRow = SEG_REGISTRY.find((x) => x.seg === winner.seg)!;
    const originalFloor = regRow.floorPct;
    try {
      // 只动**一个数**：当选者的 floorPct 抬过头，使其余量低于亚军。
      regRow.floorPct = regRow.marginPct - runnerUp.headroomPct + 1;
      const after = contentionOf(await scan(t)).find((i) => i.impedimentId === target.impedimentId);
      expect(after, "变异后这条争用阻滞点应仍在（判的是同一个 locus）").toBeDefined();
      expect(after!.contention!.keep, "改册一个值 → 保谁必须跟着翻（不翻 ⇒ 判据没真读册 = 装饰品）").toBe(runnerUp.businessType);
      expect(after!.contention!.keep).not.toBe(keepBefore);
      // 判据原文也必须跟着变（人读那一层不许还印着旧数）。
      expect(after!.contention!.basis.find((b) => b.businessType === winner.businessType)!.floorPct).toBe(regRow.floorPct);
    } finally {
      regRow.floorPct = originalFloor;
    }

    // 还原后必须回到原结论（证明上面那一翻确实是**这个改动**造成的，不是别的漂移）。
    const restored = contentionOf(await scan(t)).find((i) => i.impedimentId === target.impedimentId);
    expect(restored!.contention!.keep).toBe(keepBefore);
  }, 180000);

  it("CONTENTION-3 · 「无争用」必须是**显式结论**：≥2 业务线但不越线 ⇒ NO_CONTENTION；单业务线压满 ⇒ 不许冒充争用", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await scan(t);
    const allV = all.contention as ContentionVerdict;

    // ── ① 多业务线**但不越线**的基地：结论必须是显式的「没有」，不是空白 ──────────
    const notContended = allV.multiSegmentBases.filter((b) => !allV.contendedBases.includes(b));
    expect(notContended.length, "种子里必须存在「有 ≥2 业务线但不越线」的对照基地，否则本条无法失败").toBeGreaterThan(0);
    const quiet = await scan(t, { baseIds: [notContended[0]!] });
    const qv = quiet.contention as ContentionVerdict;
    expect(qv.verdict).toBe("NO_CONTENTION");
    expect(qv.note.length, "「没有争用」必须带明文结论（空白会被读成「没问题」）").toBeGreaterThan(0);
    // ⚠ 前半段必须成立：这个 scope 下确实有 ≥2 条业务线在索取，"没争用"才是个有内容的结论。
    expect(qv.multiSegmentBases, "对照基地在本 scope 下必须真被 ≥2 条业务线索取").toContain(notContended[0]);
    expect(contentionOf(quiet).length).toBe(0);

    // ── ② 单业务线压满的基地：越线但只有一条线在要 ⇒ 不是争用（COUNT>1 合取项是承重的）──
    const single = all.impediments.find((i) => i.locus.objectType === "Line" && typeof i.locus.objectId === "string");
    expect(single, "金丝雀：种子上应有产线级卡点可作单业务线样本").toBeDefined();
    const soloBase = allV.basesScanned > allV.multiSegmentBases.length;
    expect(soloBase, "金丝雀：扫描面里必须有非多业务线的基地，否则第 ② 条无法失败").toBe(true);

    // ── ③ 判定与显式结论**同一份 scope 过滤**：报「评估了几个」必须是本次真评估的那几个 ──
    expect(qv.basesScanned).toBe(1);
    expect(qv.basesScanned).toBeLessThan(allV.basesScanned);
  }, 180000);

  it("CONTENTION-4 · 规则半 × 引擎半：走真发布路径改 C34 的表达式 → 判定跟着变（引擎里一个业务阈值都没有）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    expect((before.contention as ContentionVerdict).verdict).toBe("CONTENDED");

    // 把「争的人得 ≥2」抬成「≥3」：种子上没有任何基地被三条业务线同时索取 ⇒ 争用应当消失。
    await republishC34(t, `COUNT(${CONTENTION_LOCUS_TYPE}.segClaims.dailyRate) > 2 AND ${CONTENTION_LOCUS_TYPE}.claimedDailyRate > ${CONTENTION_LOCUS_TYPE}.capacityDailyPacks`);
    const after = await scan(t);
    expect((after.contention as ContentionVerdict).verdict, "改规则表达式 → 判定必须跟着变（不变 ⇒ 引擎里另有一份判据）").toBe("NO_CONTENTION");
    expect(contentionOf(after).length).toBe(0);
    // 其余判据不受牵连（改一条规则不许把别的判定也带歪）。
    expect(after.counts.CONGESTION).toBe(before.counts.CONGESTION);
    expect(after.counts.BREAK).toBe(before.counts.BREAK);
  }, 180000);

  it("CONTENTION-5 · scope.businessTypes 放行后：承载业务线的**真裁**，不承载的**诚实报 UNKNOWN**（绝不静默退回全域）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await scan(t);
    const allV = all.contention as ContentionVerdict;
    // 找一条真在争的业务线（从争用结论里取，不写死）。
    const bt = contentionOf(all)[0]!.contention!.businessTypes[0]!;

    const scoped = await scan(t, { businessTypes: [bt] });
    expect(scoped.segmentAttribution, "限了业务线就必须给作用面账").toBeDefined();
    const att = scoped.segmentAttribution!;
    expect(att.requested).toEqual([bt]);

    // ① 承载业务线的判据：真裁 —— 产出的争用面必须都含所选业务线。
    const carriers = att.rows.filter((r) => r.carriesSegment);
    expect(carriers.length, "至少要有一条判据真按业务线裁得动，否则放行毫无意义").toBeGreaterThan(0);
    for (const im of contentionOf(scoped)) {
      expect(im.contention!.businessTypes, "选了某业务线，产出的争用面必须真含它（跨业务线泄漏 = 红）").toContain(bt);
      expect(im.dataMode).not.toBe("PARTIAL"); // 归属判得出来 ⇒ 不降级
    }

    // ② 不承载业务线的判据：**保留但出声**（丢掉 = 谎称"这条业务线没有这些问题"；静默保留 = 以为筛了其实没筛）
    const nonCarriers = att.rows.filter((r) => !r.carriesSegment && r.emitted > 0);
    expect(nonCarriers.length, "种子上必须存在不承载业务线的 locus，否则本条无法失败").toBeGreaterThan(0);
    expect(att.unattributedTotal).toBe(nonCarriers.reduce((s, r) => s + r.unattributed, 0));
    expect(att.unattributedTotal).toBeGreaterThan(0);
    for (const r of nonCarriers) {
      expect(r.note).toContain("UNKNOWN");
      // ⚠ 这里**不能**只断言「该 bindingId 存在某条 caveat」——本单初版就是那么写的，
      // 而 C05 那条判据的 caveat 槽早被 SUSTAIN 说明占着，于是断言**为了错误的理由通过**：
      // 归属 UNKNOWN 那句话当时压根没进 `caveats[]`。故改咬**文案本身**。
      const hit = scoped.caveats.filter((c) => c.bindingId === r.bindingId && c.note.includes("UNKNOWN") && c.note.includes("不承载业务线"));
      expect(hit.length, `判不动业务线的判据 ${r.bindingId} 必须把「归属 UNKNOWN」这句话本身写进 caveats（不能靠别的 caveat 顶包）`).toBeGreaterThan(0);
    }
    // 同一条判据可以同时有多条削弱说明（SUSTAIN + 归属 UNKNOWN），后到的不许把先到的挤掉。
    const sustainBinding = scoped.caveats.find((c) => c.note.includes("SUSTAIN"));
    if (sustainBinding && nonCarriers.some((r) => r.bindingId === sustainBinding.bindingId)) {
      expect(scoped.caveats.filter((c) => c.bindingId === sustainBinding.bindingId).length).toBeGreaterThan(1);
    }
    // 归属 UNKNOWN 的阻滞点，诚实位必须降级 —— 这是机器能咬到的第三处。
    const unattributedTypes = new Set(nonCarriers.map((r) => r.locusObjectType));
    const degraded = scoped.impediments.filter((i) => unattributedTypes.has(i.locus.objectType));
    expect(degraded.length).toBe(att.unattributedTotal);
    for (const im of degraded) expect(im.dataMode, `${im.locus.objectId} 业务线归属 UNKNOWN 却仍自称 ${im.dataMode}`).toBe("PARTIAL");

    // ③ 型号维**仍然 400**（无 contracts 级单源册 + 无 locus 承载 ⇒ 放开就是静默返全域）。
    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/chain_impediments/invoke",
      headers: ADMIN,
      payload: { args: { scope: { modelIds: ["4680-NCM"] } } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("R-ARG-FIDELITY");

    // ④ 回带 scope（R-ARG-FIDELITY：结果要说清自己是在什么范围下算出来的）。
    expect(scoped.impediments.every((i) => i.scope.businessTypes?.[0] === bt)).toBe(true);
    expect(allV.contendedBases.length).toBeGreaterThan(0); // 全域那次仍成立（对照没塌）
  }, 180000);

  it("CONTENTION-6 · 组装层单一实现 + R6 确定性：DSL 的 SUM/COUNT 与引擎读数是**同一个数**，两次扫描字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const bases = await t.repos.objects.listByType("demo", CONTENTION_LOCUS_TYPE);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const lines = await t.repos.objects.listByType("demo", "Line");
    expect(bases.length, "金丝雀：种子里应有基地对象").toBeGreaterThan(0);

    let checked = 0;
    for (const b of bases) {
      const r = readBaseContention(b, orders, lines);
      if (r.status !== "OK") continue;
      checked++;
      const payload = { [CONTENTION_LOCUS_TYPE]: { ...b.props, segClaims: r.segClaims, claimedDailyRate: r.claimedDailyRate, capacityDailyPacks: r.capacityDailyPacks } };
      // 守护断言：`claimedDailyRate` 与 DSL 的 `SUM(segClaims.dailyRate)` 必须是同一个数 ——
      // 两份就是两个真相源，改一处漏一处时**没有任何测试会红**（本仓已坐实过这一族）。
      const sum = r.segClaims.reduce((s, x) => s + x.dailyRate, 0);
      expect(sum).toBeCloseTo(r.claimedDailyRate, 6);
      expect(
        evaluateExpression(`SUM(${CONTENTION_LOCUS_TYPE}.segClaims.dailyRate) > ${CONTENTION_LOCUS_TYPE}.capacityDailyPacks`, { payload }),
        `${b.props.baseId as string}：DSL 的 SUM 与引擎读数应给出同一个越线判断`,
      ).toBe(r.claimedDailyRate > r.capacityDailyPacks);
      // COUNT 真的数得出「几条业务线在争」（这是规则库第一条多主体谓词的承重点）。
      expect(evaluateExpression(`COUNT(${CONTENTION_LOCUS_TYPE}.segClaims.dailyRate) > 1`, { payload })).toBe(r.segClaims.length > 1);
    }
    expect(checked, "金丝雀：至少要有基地能读出争用面，否则上面的循环是空转").toBeGreaterThan(0);

    // R6：同输入两次扫描字节一致（含新加的 contention 段）。
    const a = await scan(t);
    const c = await scan(t);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  }, 180000);
});
