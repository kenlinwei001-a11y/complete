import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { enumerateImpedimentOptions } from "../src/solvers/impediment-options.js";
import { solutionCandidateId } from "@platform/contracts";

/**
 * WO-DECISION-PLAY-OPTIONS · **接缝门**：`decision_play` ⋈ `enumerateImpedimentOptions`。
 *
 * ══ 这道门咬的是链路，不是函数 ═════════════════════════════════════════════════
 * `enumerateImpedimentOptions`（`solvers/impediment-options.ts:561`）此前**只被
 * `chain-impediment.ts:1101` 一处调用** —— 沙盘看得见候选、决策页看不见。那是
 * `CLAUDE.md` 铁律 0.5 的第三形态「**接了线接错地方**」，修法是补挂载点。
 *
 * 只测「枚举器函数能跑」证明不了「决策页拿得到方案」——那是**已排练不是已实现**。
 * 故本门全部经 `solvers.invoke("decision_play")` 这条**生产入口**驱动，并且：
 *  · S1 换 metricKey ⇒ 方案集合**真的变**（修前三条恒定，任何 metricKey 一模一样）；
 *  · S2 方案里的依据**能回指枚举器**（candidateId 用 contracts 的 `solutionCandidateId`
 *    从候选自身公开字段**反算**一遍，对得上才算真是枚举器的产物，不是另抄一份）；
 *  · S3 诚实边界：接不上就空 + 机器可读理由，**不许**拿三条无关方案填满；
 *  · S4 R6：同输入两跑逐字节一致。
 *
 * ⚠️ 金丝雀（铁律 0.6：报否定结论前先自证工具没坏）：S3 断言「cash 一条方案都没有」，
 * 同一段代码在 `seg_attain_ess` 上必须**有**方案 —— 两个断言共用同一条调用路径，
 * 一起绿才说明"空"是真的空，不是求解器整个跑挂了。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

interface Candidate {
  candidateId: string;
  impedimentId: string;
  label: string;
  lever: { objectType: string; objectId: string; prop: string };
  fromValue: number;
  toValue: number;
  rungKind: string;
  dims: { key: string; value: number | null; baseline: number | null; unit: string }[];
  provenance: { solverKey: string; formula: string; inputs: string[] };
  gapClose: { value: number | null; basis?: string; reason?: string };
}
interface JoinedPlay {
  impedimentId: string;
  kind: string;
  locus: { objectType: string; objectId: string };
  severity: number;
  ruleKey: string;
  join: { kind: "LOCUS_EXACT" | "LOCUS_TYPE" | "BASE_SCOPE"; path: string; anchorNodeId?: string; anchorContribution?: number };
  candidates: Candidate[];
  noCandidateReason?: string;
  noCandidateKind?: string;
}
interface DP {
  rootCause: { factorId: string; label: string; metricKey: string };
  options: { optionId: string; label: string; provenance: { drillType?: string; drillId?: string } }[];
  optionsOmitted: { optionId: string; label: string; reason: string }[];
  optionsEvidence: { optionId: string; match: "OBJECT" | "TYPE"; note: string }[];
  impedimentPlays: {
    joined: JoinedPlay[];
    scanned: number;
    joinedCount: number;
    candidateCount: number;
    noPlayReason?: string;
  };
  summary: string;
}

const play = async (t: TestApp, metricKey: string): Promise<DP> =>
  (await t.services.solvers.invoke(ADMIN, "decision_play", { metricKey })) as unknown as DP;

/** 一次推演的「方案指纹」：战略方案 id + 每条可执行候选的 id（集合变了指纹就变）。 */
const fingerprint = (dp: DP): string =>
  JSON.stringify({
    options: dp.options.map((o) => o.optionId).sort(),
    candidates: dp.impedimentPlays.joined.flatMap((j) => j.candidates.map((c) => c.candidateId)).sort(),
    joins: dp.impedimentPlays.joined.map((j) => `${j.join.kind}:${j.locus.objectType}/${j.locus.objectId}`).sort(),
  });

describe("WO-DECISION-PLAY-OPTIONS · decision_play ⋈ enumerateImpedimentOptions 接缝", () => {
  // 只读用例共用一份种子（`seedBattery` 单次 ~8s；改数据的 S5 自己另起一份，绝不共用后互相污染）。
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 180000);

  it("S1 换 metricKey ⇒ 方案集合真的变（修前三条恒定·任何指标一模一样）", async () => {
    const ess = await play(t, "seg_attain_ess");
    const demand = await play(t, "demand_attain");
    const cash = await play(t, "cash");

    // 根因确实不同（前提：不是同一棵树，才谈得上方案该不该不同）。
    expect(new Set([ess.rootCause.factorId, demand.rootCause.factorId, cash.rootCause.factorId]).size).toBe(3);

    // ── 先咬**战略方案身份**这一条（不依赖新字段，故修前是一条干净的断言红，不是 TypeError）──
    //    修前实测：三个指标拿到的 optionId 集合逐字节相同 —— 恒 3 条 opt-backup-cert/opt-lta-clause/opt-insource。
    const optIds = (dp: DP) => dp.options.map((o) => o.optionId).sort().join(",");
    expect(optIds(cash), "现金域根因（应收账龄）不该拿到正极供应链战略方案").not.toBe(optIds(ess));
    expect(optIds(demand), "需求达成域根因（物料短缺）不该与储能达成域拿到同一组方案").not.toBe(optIds(ess));

    // 指纹两两不同 —— 这一条修前**必红**：三个指标拿到的是同一组 opt-backup-cert/opt-lta-clause/opt-insource。
    expect(fingerprint(ess)).not.toBe(fingerprint(demand));
    expect(fingerprint(demand)).not.toBe(fingerprint(cash));
    expect(fingerprint(ess)).not.toBe(fingerprint(cash));

    // 变化不是"数值抖了一下"，是**集合本身**变了：接上的阻滞点集不同。
    const locusOf = (dp: DP) => dp.impedimentPlays.joined.map((j) => `${j.locus.objectType}/${j.locus.objectId}`).sort().join(",");
    expect(locusOf(ess)).not.toBe(locusOf(demand));
    expect(locusOf(cash)).toBe(""); // 现金域接不上（见 S3）
  });

  it("S2 方案里的依据能回指枚举器：candidateId 由 contracts 单源公式从候选自身字段反算得出", async () => {
    const dp = await play(t, "seg_attain_ess");

    const cands = dp.impedimentPlays.joined.flatMap((j) => j.candidates);
    expect(cands.length, "决策路必须真拿到枚举器候选（0 条 = 挂载点没接上）").toBeGreaterThan(0);

    for (const c of cands) {
      // ① id 反算：只用候选自身的公开字段 + contracts 的 `solutionCandidateId` 重拼一遍。
      //    对得上 ⇒ 它真是 `enumerateImpedimentOptions` 的产物，而不是决策路另抄了一份候选。
      expect(
        solutionCandidateId({
          impedimentId: c.impedimentId,
          objectType: c.lever.objectType,
          leverObjectId: c.lever.objectId,
          prop: c.lever.prop,
          rungKind: c.rungKind as never,
          toValue: c.toValue,
        }),
        `候选 ${c.candidateId} 的 id 反算不上 ⇒ 它不是枚举器产的`,
      ).toBe(c.candidateId);

      // ② 依据三件套（对应哪个阻碍项 / 哪根杠杆 / 预期影响量），不是自然语言口号。
      expect(c.impedimentId).toBeTruthy();
      expect(c.lever.objectType && c.lever.prop).toBeTruthy();
      expect(c.provenance.solverKey).toBe("chain_impediments");
      expect(c.provenance.formula).toContain("patchCapacityContext");
      const dims = new Set(c.dims.map((d) => d.key));
      expect(dims.has("breach") && dims.has("severity") && dims.has("capacityP50")).toBe(true);
      // 预期影响量必须是 baseline→value 的真对照（至少一维两头都有数），不是一个孤零零的分。
      expect(c.dims.some((d) => typeof d.baseline === "number" && typeof d.value === "number")).toBe(true);
    }

    // ③ join 路径写明凭什么把这个阻滞点算作本根因的解法（R13）。
    for (const j of dp.impedimentPlays.joined) {
      expect(["LOCUS_EXACT", "LOCUS_TYPE", "BASE_SCOPE"]).toContain(j.join.kind);
      expect(j.join.path).toContain(j.locus.objectId);
    }
  });

  it("S2' 枚举器是**同一个符号**：直调零阻滞点必须诚实空（导入不报错 ≠ 它还活着）", async () => {
    const dp = await play(t, "seg_attain_ess");
    const joined = dp.impedimentPlays.joined.find((j) => j.candidates.length > 0);
    expect(joined, "至少要有一个接上且有候选的阻滞点").toBeTruthy();

    // 直调枚举器（零阻滞点入参）→ 必须诚实空。这是**金丝雀**：证明本用例引用到的是真枚举器符号，
    // 而不是一个名字对但早已不被调用的空壳（导入不报错 ≠ 它还活着）。
    const emptyCtx = { tenantId: "demo", bases: [], lines: [], processes: [], equipment: [], maintPlans: [], orders: [], shipments: [], dataHealth: [] } as unknown as Parameters<typeof enumerateImpedimentOptions>[1]["c"];
    const empty = enumerateImpedimentOptions([], {
      c: emptyCtx,
      materialBalances: [],
      links: [],
      originOf: () => undefined,
    });
    expect(empty.byImpediment.size).toBe(0);
    expect(empty.probesUsed).toBe(0);

    // 决策路的候选 id 必须带着它宿主阻滞点的 id（枚举器的 id 拼法自带这条约束）。
    for (const c of joined!.candidates) expect(c.candidateId).toContain(joined!.impedimentId);
  });

  it("S3 诚实边界：接不上就空 + 机器可读理由，绝不拿无关方案填满（金丝雀：同代码在 ess 上有方案）", async () => {
    // 金丝雀先跑：同一条调用路径在供应链域指标上**必须**出方案。它红了就是求解器坏了，不是"真的没有"。
    const ess = await play(t, "seg_attain_ess");
    expect(ess.options.length, "金丝雀：供应链域根因必须仍有战略方案").toBeGreaterThanOrEqual(3);
    expect(ess.impedimentPlays.candidateCount, "金丝雀：供应链域根因必须接上真候选").toBeGreaterThan(0);

    // 现金域：根因是「应收账龄恶化」，落点是 ARAging —— 三条正极供应链战略与它没有任何可核对的依据关系。
    const cash = await play(t, "cash");
    expect(cash.rootCause.factorId).toBe("cf-ar-aging");
    expect(cash.options, "现金域不许再被贴上正极供应链方案").toHaveLength(0);
    expect(cash.optionsOmitted).toHaveLength(3);
    for (const om of cash.optionsOmitted) {
      expect(om.reason).toContain("不在本次归因树的落点集里");
      expect(om.reason.length).toBeGreaterThan(20); // 是理由不是标签
    }
    // 阻滞点侧同样诚实：不是"没有对策"，是"接不上"——两者修法完全不同，措辞必须区分得开。
    expect(cash.impedimentPlays.candidateCount).toBe(0);
    expect(cash.impedimentPlays.noPlayReason).toBeTruthy();
    expect(cash.impedimentPlays.noPlayReason!).toContain("交集为空");

    // 折算边界：算不出缺口收窄量时给 null + 理由，**不给 0**（"有值 0"和"算不出来"在界面上分不开）。
    const withNull = ess.impedimentPlays.joined.flatMap((j) => j.candidates).filter((c) => c.gapClose.value === null);
    expect(withNull.length).toBeGreaterThan(0);
    for (const c of withNull) {
      expect(c.gapClose.value).toBeNull();
      expect(c.gapClose.reason, "算不出来必须写清为什么").toBeTruthy();
    }
  });

  it("S4 R6 确定性：同 metricKey 两跑逐字节一致（方案 + 候选 + join 路径全部）", async () => {
    const a = await play(t, "seg_attain_ess");
    const b = await play(t, "seg_attain_ess");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("S5 改真颗粒 ⇒ 接上的候选跟着变（证候选是真试算出来的，不是贴上去的常量）", async () => {
    // 本用例**改数据**，故自己另起一份种子（共用上面那份会污染只读用例·R6 断言当场变红）。
    const t = await makeApp();
    await seedBattery(t);
    const before = await play(t, "seg_attain_ess");
    const beforeCands = before.impedimentPlays.joined.flatMap((j) => j.candidates.map((c) => `${c.candidateId}|${c.toValue}`)).sort();
    expect(beforeCands.length).toBeGreaterThan(0);

    // 拨动候选真读的那颗粒度：正极物料到货周期（`Material.leadTime` 是枚举器 join 出来的杠杆落点）。
    const mat = (await t.repos.objects.listByType("demo", "Material")).find((o) => String(o.props.matId) === "pos_lfp");
    expect(mat, "前提：正极物料对象存在").toBeTruthy();
    await t.repos.objects.put({ ...mat!, props: { ...mat!.props, leadTime: 60 } });

    const after = await play(t, "seg_attain_ess");
    const afterCands = after.impedimentPlays.joined.flatMap((j) => j.candidates.map((c) => `${c.candidateId}|${c.toValue}`)).sort();
    // 起点值变了 ⇒ 档位/效果必须跟着变（不变 = 候选是常量，不是试算出来的）。
    expect(JSON.stringify(afterCands)).not.toBe(JSON.stringify(beforeCands));
  });
});
