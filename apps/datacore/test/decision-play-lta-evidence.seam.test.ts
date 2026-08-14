import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-LTA-EVIDENCE-CONFLICT · **接缝门**：同一根因树上，「哪份长协是证据」只许有一个答案。
 *
 * ══ 修前实测（seed=42·demo·`solvers.invoke("decision_play", {})`）═══════════════════
 *   `opt-lta-clause`  → `drillId = lta-lfp-rbkj`（`ltas.find(materialType==="正极")` ＝ **数组第一条**）
 *   `opt-insource`    → `drillId = lta-lfp-cylk`（源码里的**字面量**）
 *   `cf-lta-breach`   → `drillId = lta-lfp-cylk`（`synthetic/battery-extended.ts` 因子表）
 * 三者在**同一棵归因树**上，却指着两份不同的长协。屏上于是出现
 * 「因为 A 家（SUP-003）长协违约 ⇒ 给 B 家（SUP-001）加价格联动条款」——
 * 读起来通顺、实际张冠李戴，而依据强度只显示成 `TYPE`（弱），**用户分辨不出指错了人**。
 *
 * ══ 这道门咬的是链路，不是函数 ═══════════════════════════════════════════════
 * 全部经 `services.solvers.invoke("decision_play")` 这条**生产入口**驱动，并且**每一条断言的
 * 期望值都从同一次调用的 `gap_attribution` 产物里现算**（不写死 `lta-lfp-cylk`）——
 * 写死 id 的门只能证明"今天这个数没变"，证明不了"两边锚的是同一份"。
 * 直接测 `resolveEvidenceLta()` 函数不算：那是"已排练"，不是"已实现"。
 *
 * ══ 金丝雀（铁律 0.6：报肯定/否定结论前先自证工具没坏）════════════════════════
 * L1 先断言「本次归因树上**确实有** LongTermAgreement 落点」「**确实有**引用长协的方案」。
 * 少了这两条，「所有引用长协的方案都一致」在**零条方案**时也会绿 —— 那是空真，不是通过。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

const LTA = "LongTermAgreement";

interface Prov { kind?: string; basis?: string; drillType?: string; drillId?: string; drillValue?: number }
interface DP {
  rootCause: { factorId: string; label: string; metricKey: string };
  options: { optionId: string; label: string; provenance: Prov }[];
  optionsEvidence: { optionId: string; match: "OBJECT" | "TYPE"; note: string }[];
  optionsOmitted: { optionId: string; label: string; reason: string }[];
}
interface GaNode { id: string; factor: string; contribution: number; provenance?: Prov }
interface GA {
  levels: { depth: number; nodes: GaNode[] }[];
  atomicLeaves: GaNode[];
}

const play = async (t: TestApp, metricKey?: string): Promise<DP> =>
  (await t.services.solvers.invoke(ADMIN, "decision_play", metricKey ? { metricKey } : {})) as unknown as DP;

const attribution = async (t: TestApp, metricKey?: string): Promise<GA> =>
  (await t.services.solvers.invoke(ADMIN, "gap_attribution", metricKey ? { metricKey } : {})) as unknown as GA;

/** 归因树上所有长协落点（本门的**唯一裁判**：方案说谁是证据，得跟树上这批对得上）。 */
const ltaAnchorsOf = (ga: GA): GaNode[] =>
  [...ga.levels.flatMap((L) => L.nodes), ...(ga.atomicLeaves ?? [])].filter((n) => n.provenance?.drillType === LTA);

/** 一条方案引用的长协 id（不引用长协 ⇒ null，不参与本门）。 */
const ltaRefOf = (o: DP["options"][number]): string | null =>
  o.provenance?.drillType === LTA ? String(o.provenance.drillId ?? "") : null;

describe("WO-LTA-EVIDENCE-CONFLICT · 同一根因树上「哪份长协是证据」只许有一个答案", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 180000);

  it("L1 金丝雀：本次推演里**确实有**长协落点、也**确实有**引用长协的方案（否则下面全是空真）", async () => {
    const [dp, ga] = [await play(t), await attribution(t)];
    const anchors = ltaAnchorsOf(ga);
    expect(anchors.length, "归因树上一个长协落点都没有 ⇒ 是求解器/种子坏了，不是'证据一致'").toBeGreaterThan(0);
    const refs = dp.options.map(ltaRefOf).filter((x): x is string => x !== null);
    expect(refs.length, "一条引用长协的方案都没有 ⇒ 下面的一致性断言是空真，不是通过").toBeGreaterThanOrEqual(2);
  });

  it("L2 核心：所有引用长协的方案指向**同一份**，且就是归因树锚定的那一份（期望值现算·不写死 id）", async () => {
    const [dp, ga] = [await play(t), await attribution(t)];

    // 期望值从**同一次归因**里现算：贡献最大的长协落点（并列再比 nodeId）——与引擎侧同一条判据。
    const anchors = ltaAnchorsOf(ga);
    const winner = [...anchors].sort((a, b) => b.contribution - a.contribution || a.id.localeCompare(b.id))[0]!;
    const expected = String(winner.provenance!.drillId ?? "");
    expect(expected, "树锚的 drillId 不该是空/占位").not.toBe("");

    const refs = dp.options.map((o) => ({ optionId: o.optionId, ltaId: ltaRefOf(o) })).filter((r) => r.ltaId !== null);

    // ① 内部一致：两条方案不许各认一份（修前这里必红 —— rbkj vs cylk）。
    const distinct = [...new Set(refs.map((r) => r.ltaId))];
    expect(
      distinct,
      `同一根因树上出现了 ${distinct.length} 份不同的"证据长协"：${JSON.stringify(refs)} ` +
        `—— 屏上会读成「因为 A 家长协违约 ⇒ 给 B 家加条款」，而用户分辨不出`,
    ).toHaveLength(1);

    // ② 对外一致：那一份必须就是归因树上的落点，不是另挑的一份（否则①在"两条一起指错"时也绿）。
    expect(distinct[0], `方案的证据长协 ${distinct[0]} ≠ 归因树锚定的 ${expected}（节点 ${winner.id}·${winner.factor}）`).toBe(expected);
  });

  it("L3 依据强度：长协方案不再是 TYPE«同类型不同实例»，一律 OBJECT（修前 opt-lta-clause 是 TYPE）", async () => {
    const dp = await play(t);
    const ltaOptionIds = new Set(dp.options.filter((o) => ltaRefOf(o) !== null).map((o) => o.optionId));
    expect(ltaOptionIds.size, "金丝雀：得先有长协方案才谈得上强度").toBeGreaterThanOrEqual(2);
    for (const ev of dp.optionsEvidence.filter((e) => ltaOptionIds.has(e.optionId))) {
      expect(ev.match, `${ev.optionId} 的依据强度仍是 ${ev.match}：${ev.note}`).toBe("OBJECT");
    }
  });

  it("L4 证据对象 ⟷ 证据读数同源：drillValue 是**那一份**长协自己的数，不是全体合计", async () => {
    const dp = await play(t);
    for (const o of dp.options) {
      const ltaId = ltaRefOf(o);
      if (!ltaId) continue;
      const obj = await t.repos.objects.get(ADMIN.tenantId, `obj_longtermagreement_${ltaId}`);
      expect(obj, `方案 ${o.optionId} 指的 ${ltaId} 在库里不存在 ⇒ 证据指向空气`).toBeTruthy();
      const p = obj!.props as Record<string, unknown>;
      const shortfall = Math.max(0, Number(p.contractedQtyTon) - Number(p.actualDeliveredTon));
      const linked = p.priceLinked === true ? 1 : 0;
      // 读数必须能在**这一份**长协上核对出来（priceLinked 或 自身欠交量二者之一）。
      // 修前 opt-insource 的 drillValue 是**三份正极长协合计** 1550，而 drillId 只指其中一份 ⇒ 这里必红。
      expect(
        [linked, shortfall],
        `方案 ${o.optionId} 的 drillValue=${o.provenance.drillValue} 在 ${ltaId} 上核对不出来` +
          `（该长协 priceLinked=${linked}·自身欠交=${shortfall}）⇒ 对象与读数不是同一个东西`,
      ).toContain(o.provenance.drillValue);
    }
  });

  it("L5 解析路径可核对：basis 里写明证据长协是**怎么选出来的**（不是'恰好排第一'）", async () => {
    const dp = await play(t);
    const ltaOpts = dp.options.filter((o) => ltaRefOf(o) !== null);
    expect(ltaOpts.length).toBeGreaterThanOrEqual(2);
    for (const o of ltaOpts) {
      const basis = String(o.provenance.basis ?? "");
      expect(basis, `${o.optionId} 的 basis 没写证据长协是哪一份`).toContain(String(o.provenance.drillId));
      expect(basis, `${o.optionId} 的 basis 没写它是从归因树锚来的 ⇒ 无从核对`).toContain("归因树节点");
    }
  });

  it("L6 换根因树 ⇒ 结论跟着换（不是把 lta-lfp-cylk 写死在另一个地方）", async () => {
    // demand_attain 的根因树下钻面是 MaterialBalance/Equipment —— 树上没有长协落点。
    const dp = await play(t, "demand_attain");
    const ga = await attribution(t, "demand_attain");
    expect(ltaAnchorsOf(ga).length, "金丝雀：这条用例要的就是'树上没长协'这个前提").toBe(0);
    // 没有可核对的长协依据 ⇒ 两条长协方案**诚实不下发**，绝不带着一个兜底 id 贴上去。
    expect(dp.options.filter((o) => ltaRefOf(o) !== null)).toHaveLength(0);
    const omitted = dp.optionsOmitted.map((x) => x.optionId);
    expect(omitted).toContain("opt-lta-clause");
    expect(omitted).toContain("opt-insource");
    for (const x of dp.optionsOmitted) expect(x.reason).toBeTruthy();
  });

  it("L7 R6 确定性：同输入两跑，长协证据逐字节一致", async () => {
    const a = await play(t);
    const b = await play(t);
    const fp = (dp: DP) => JSON.stringify(dp.options.map((o) => [o.optionId, o.provenance]));
    expect(fp(a)).toBe(fp(b));
  });
});
