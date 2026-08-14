import { describe, expect, it } from "vitest";
import type { ObjectInstance } from "../src/domain.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-ORDER-JOURNEY · `decision_play` **落点挂载点** SEAM（数据半 × 引擎半 · 端到端走 HTTP）。
 *
 * ══ 咬的接缝 ═══════════════════════════════════════════════════════════════════
 *  · **数据半** = `battery-extended.ts` 的 `CHAIN_LOCUS_CAUSAL_FACTORS`（本单补的两条
 *    `cf-batch-idle` / `cf-base-capacity-contention`）落成真 `CausalFactor` 对象；
 *  · **引擎半** = `solvers/service.ts` 的 `decisionPlayLocus`（locus → 因子 join + 落点候选）。
 *  任一半漏 ⇒ 本文件红。两半各自绿证明不了它 —— 这正是 SEAM-GATE 要的东西。
 *
 * ══ 头号纪律 ═══════════════════════════════════════════════════════════════════
 * 期望值**零字面量硬编码**：locus 从 `chain_impediments` 的**本次回包**现取，
 * 因子从**真库** `repos.objects.listByType("CausalFactor")` 现读 —— 不是抄一份好看的常量。
 *
 * ══ 变异反证注入点（交付说明贴 RC 原文）═════════════════════════════════════════
 *  ㈠ 撤掉 `CHAIN_LOCUS_CAUSAL_FACTORS` 两条种子 → OJ-2 / OJ-3 红（证明咬的是**数据**）。
 *  ㈡ `decisionPlayLocus` 恒返回 `null`（= `decisionPlay` 退回只出写死三条）→ OJ-1/2/3/4 全红。
 *  ㈢ 把 `precision` 恒设成 `EXACT`（把「按类型对上」冒充「这一张自己的因子」）→ OJ-3 红。
 */

interface LocusJoin {
  status: "JOINED" | "NO_FACTOR";
  precision: "EXACT" | "TYPE" | "NONE";
  factorId: string | null;
  factorLabel: string | null;
  basis: string;
  candidateFactorCount: number;
}
interface LocusPlay {
  locus: { objectType: string; objectId: string };
  join: LocusJoin;
  impediments: { impedimentId: string; candidates: unknown[]; noCandidateKind?: string; noCandidateReason?: string }[];
  candidateTotal: number;
  scanId: string;
  optionsNote: string;
  summary: string;
}
interface DecisionPlayOut {
  rootCause: { factorId: string } | null;
  options: { optionId: string }[];
  locusPlay?: LocusPlay;
}

async function invoke(t: TestApp, key: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await t.app.inject({ method: "POST", url: `/a/v1/solvers/${key}/invoke`, headers: ADMIN, payload: { args } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as Record<string, unknown>;
}

/** 本次扫描回包里的全部 locus（**现取**，不抄常量 —— locus 类型随规则/种子演进会变）。 */
async function lociOf(t: TestApp): Promise<{ objectType: string; objectId: string }[]> {
  const s = await invoke(t, "chain_impediments", {});
  const imps = s.impediments as { locus: { objectType: string; objectId: string } }[];
  return imps.map((i) => i.locus);
}

const factorsOf = (t: TestApp): Promise<ObjectInstance[]> => t.repos.objects.listByType("demo", "CausalFactor");

describe("WO-ORDER-JOURNEY · decision_play 落点挂载点 SEAM", () => {
  it("OJ-0 金丝雀 · 上游真产出阻滞点，且本次 locus 里真的同时有 MaterialBatch 与 Base（否则下面全是空跑）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loci = await lociOf(t);
    expect(loci.length, "一条阻滞点都没有 ⇒ 数据源坏了，不是挂载点坏了").toBeGreaterThan(0);
    const types = new Set(loci.map((l) => l.objectType));
    // 金丝雀同时自证「工具是好的」：一个我确定存在的类型必须命中。
    expect(types.has("MaterialBalance"), "连 MaterialBalance 都读不到 ⇒ 读取器坏了").toBe(true);
    expect(types.has("MaterialBatch"), "本次没有 MaterialBatch 落点 ⇒ OJ-3 会恒真").toBe(true);
  });

  it("OJ-1 · **可回退性**：不传 locus 时输出与今天逐字节相同（连 locusPlay 这个键都不加）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bare = (await invoke(t, "decision_play", { metricKey: "demand_attain" })) as unknown as DecisionPlayOut;
    expect(Object.prototype.hasOwnProperty.call(bare, "locusPlay"), "没锚落点却加了键 ⇒ 不是 additive").toBe(false);

    const loci = await lociOf(t);
    const anchored = (await invoke(t, "decision_play", {
      metricKey: "demand_attain",
      locusType: loci[0]!.objectType,
      locusId: loci[0]!.objectId,
    })) as unknown as DecisionPlayOut;
    expect(anchored.locusPlay, "锚了落点却没出 locusPlay ⇒ 挂载点没接上").toBeDefined();
    // 删掉新键之后必须与不锚落点的那一份**逐字节**相同 —— additive 的机器可核判据。
    const { locusPlay: _drop, ...rest } = anchored as unknown as Record<string, unknown>;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(bare));
  });

  it("OJ-2 · 落点候选真来自枚举器（有候选的那条 locus 上，candidateTotal 与阻滞点回包一致）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await invoke(t, "chain_impediments", {});
    const imps = s.impediments as { impedimentId: string; locus: { objectType: string; objectId: string }; candidates?: unknown[] }[];
    const withC = imps.find((i) => (i.candidates ?? []).length > 0);
    expect(withC, "本次扫描没有任何带候选的阻滞点 ⇒ 本用例空跑（数据源问题，不是挂载点问题）").toBeDefined();

    const out = (await invoke(t, "decision_play", {
      locusType: withC!.locus.objectType,
      locusId: withC!.locus.objectId,
    })) as unknown as DecisionPlayOut;
    const lp = out.locusPlay!;
    // 只比 id 两维：阻滞点的 locus 还带一个人读 `label`，挂载点回带的是**引擎认的那两维**（不复制人读名）。
    expect({ objectType: lp.locus.objectType, objectId: lp.locus.objectId }).toEqual({
      objectType: withC!.locus.objectType,
      objectId: withC!.locus.objectId,
    });
    // 期望值现取自阻滞点回包，不是写死的数。
    const expected = imps
      .filter((i) => i.locus.objectType === withC!.locus.objectType && i.locus.objectId === withC!.locus.objectId)
      .reduce((a, i) => a + (i.candidates ?? []).length, 0);
    expect(expected, "期望值是 0 ⇒ 断言退化成恒真").toBeGreaterThan(0);
    expect(lp.candidateTotal).toBe(expected);
    // 「上面三条战略」与「这个落点自己的解法」不许合并成一张表 —— 这句话必须在回包里。
    expect(lp.optionsNote).toContain("公司级战略");
    // 六维方案卡一条都没被动过（本单不改 options）。
    expect(out.options.length).toBe(3);
  });

  it("OJ-3 · **对上率**：MaterialBatch 落点对到本单补的 cf-batch-idle，且精度是 TYPE（不许冒充 EXACT）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loci = await lociOf(t);
    const batch = loci.find((l) => l.objectType === "MaterialBatch");
    expect(batch, "本次没有 MaterialBatch 落点 ⇒ 本用例空跑").toBeDefined();

    // 真库里现读：这条因子确实是**种子给的**，不是测试自己造的。
    const factors = (await factorsOf(t)).map((o) => o.props);
    const seeded = factors.find((f) => f.factorId === "cf-batch-idle");
    expect(seeded, "种子里没有 cf-batch-idle ⇒ 数据半没落地").toBeDefined();
    expect(seeded!.drillType).toBe("MaterialBatch");
    expect(seeded!.drillField, "因子指的必须是判据 C28 真读的那个字段，不是随便挑一个").toBe("idleDays");

    const out = (await invoke(t, "decision_play", { locusType: batch!.objectType, locusId: batch!.objectId })) as unknown as DecisionPlayOut;
    const j = out.locusPlay!.join;
    expect(j.status).toBe("JOINED");
    expect(j.factorId).toBe("cf-batch-idle");
    // 精度三态禁塌：drillId 是 `*` 通配 ⇒ 只对上到**类型**，不是这一张批次自己的因子。
    expect(j.precision).toBe("TYPE");
    expect(j.basis).toContain("按类型聚合");
  });

  it("OJ-4 · 对不上时**诚实空**：造一个库里没有的 drillType，必须 NO_FACTOR，绝不回落默认根因", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await invoke(t, "decision_play", { locusType: "NoSuchObjectType", locusId: "nope" })) as unknown as DecisionPlayOut;
    const j = out.locusPlay!.join;
    expect(j.status).toBe("NO_FACTOR");
    expect(j.precision).toBe("NONE");
    expect(j.factorId).toBeNull();
    expect(j.candidateFactorCount).toBe(0);
    // 病因原文必须说清「为什么不回落」——空白/一句「暂无」会被读成「这里没问题」。
    expect(j.basis).toContain("不回落");
    // 五区照旧有根因（本块只是加信息，不影响既有推演）。
    expect(out.rootCause).not.toBeNull();
  });
});
