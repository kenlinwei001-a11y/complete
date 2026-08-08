import { describe, expect, it } from "vitest";
import {
  BASE_REGISTRY,
  SEG_REGISTRY,
  BusinessTypeSchema,
  CADENCE_KINDS,
  CADENCE_STEP_KIND,
  CANONICAL_BASE_IDS,
  CHAIN_BREAK_SUBTYPES,
  CHAIN_IMPEDIMENT_KINDS,
  CHAIN_NODE_REGISTRY,
  CHAIN_STAGES,
  CHAIN_STEP_KINDS,
  CadenceSchema,
  CanonicalBaseIdSchema,
  ChainImpedimentSchema,
  ChainNodeSchema,
  ChainScopeSchema,
  ChainStepSchema,
  CANDIDATE_JOIN_RANK,
  SolutionCandidateSchema,
  candidateDimImprovement,
  candidateDimMoved,
  candidatesEffectDistinct,
  compareSolutionCandidate,
  firstDuplicateCandidatePair,
  type SolutionCandidate,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  LossAttributionSchema,
  VALUE_ADD_STEP_KIND,
  cadenceWaitStep,
  chainNonValueDays,
  chainValueAddDays,
  compareChainImpediment,
  computeLossAttribution,
  expectedCadenceWaitDays,
  isChainScopeUnscoped,
  isKnownChainNodeId,
  isValueAddKind,
  lossConservationResidual,
  nodeFlowEfficiency,
  nodeLeadTimeDays,
  nodeValueAddDays,
  segOfBusinessType,
  type BusinessType,
  type Cadence,
  type CanonicalSeg,
  type ChainImpediment,
  type ChainNode,
  type ChainStep,
} from "../src/index.js";

/**
 * WO-SANDBOX-S0 · 契约冻结的锁死测试。
 *
 * 三条主测（工单硬要求）：
 *   ① 契约往返：strict parse 正例通过 / 反例（错枚举值、多写字段、跨字段矛盾）抛。
 *   ② **等待期望公式锁死**：E[wait] == everyDays / 2（不是 everyDays、不是 0、与 offsetDays 无关）。
 *   ③ **损失守恒**：非增值环节 pctOfChainLoss 之和 == 100（±0.001），分母**排除增值段**。
 *
 * 另守两条派生纪律：单源派生（业务线↔SEG_REGISTRY · 基地↔BASE_REGISTRY，零内联字面量）、
 * 诚实缺席（算不出来返回 null / 空数组，绝不兜一个 0）。
 */

// ── 公共夹具：一条两节点的链（数值全部手算，供守恒测反查） ───────────────
//   节点 A（产能段）：queue 12 · cadence(30d 会议)=15 · work 6 · rework 2.5 · handoff 1.5
//   节点 B（物料段）：queue 8  · cadence(15d 结算)=7.5 · work 4 · handoff 3
//   非增值合计 = 12+15+2.5+1.5 + 8+7.5+3 = 49.5   增值合计 = 6+4 = 10   前置期 = 59.5
const SOP_CADENCE: Cadence = { everyDays: 30, kind: "meeting" };
const SETTLE_CADENCE: Cadence = { everyDays: 15, offsetDays: 3, kind: "settlement" };
const NON_VALUE_TOTAL = 49.5;
const VALUE_ADD_TOTAL = 10;
const LEAD_TOTAL = 59.5;

const nodeA: ChainNode = {
  nodeId: "n-capacity",
  label: "化成排产",
  stage: "CAPACITY",
  steps: [
    { stepId: "a-queue", nodeId: "n-capacity", kind: "queue", days: 12, valueAdd: false },
    cadenceWaitStep({ stepId: "a-cadence", nodeId: "n-capacity", cadence: SOP_CADENCE }),
    { stepId: "a-work", nodeId: "n-capacity", kind: "work", days: 6, valueAdd: true },
    { stepId: "a-rework", nodeId: "n-capacity", kind: "rework", days: 2.5, valueAdd: false },
    { stepId: "a-handoff", nodeId: "n-capacity", kind: "handoff", days: 1.5, valueAdd: false },
  ],
};
const nodeB: ChainNode = {
  nodeId: "n-material",
  label: "物料齐套",
  stage: "MATERIAL",
  steps: [
    { stepId: "b-queue", nodeId: "n-material", kind: "queue", days: 8, valueAdd: false },
    cadenceWaitStep({ stepId: "b-cadence", nodeId: "n-material", cadence: SETTLE_CADENCE }),
    { stepId: "b-work", nodeId: "n-material", kind: "work", days: 4, valueAdd: true },
    { stepId: "b-handoff", nodeId: "n-material", kind: "handoff", days: 3, valueAdd: false },
  ],
};
const chainSteps: ChainStep[] = [...nodeA.steps, ...nodeB.steps];

const impediment: ChainImpediment = {
  impedimentId: "imp-001",
  tenantId: "demo",
  scanId: "scan-001",
  kind: "BOTTLENECK",
  stage: "CAPACITY",
  scope: {},
  nodeId: "n-capacity",
  locus: { objectType: "Process", objectId: "proc-formation-cz", label: "化成工序" },
  severity: 82.5,
  evidence: { solverKey: "bottleneck_matrix", ruleKey: "C03", ruleParamKey: "utilRedline", metricValue: 0.94, threshold: 0.9, unit: "ratio" },
  dataMode: "LIVE",
};

// ══════════════════════════════════════════════════════════════════════════
// ② 等待期望公式锁死（本系列最值钱的一条：损失 Top3 全是等节拍，合计 30.7%）
// ══════════════════════════════════════════════════════════════════════════
describe("S0-② Cadence 等待期望 == everyDays / 2（公式锁死）", () => {
  it("逐个周期长度：期望等待恰为周期的一半（硬编码期望值，改公式即红）", () => {
    const table: { everyDays: number; expected: number }[] = [
      { everyDays: 30, expected: 15 }, // S&OP 共识会
      { everyDays: 15, expected: 7.5 }, // 开票对账
      { everyDays: 7, expected: 3.5 }, // 主计划
      { everyDays: 5, expected: 2.5 }, // 订单评审
      { everyDays: 2, expected: 1 }, // 过程质检
      { everyDays: 1, expected: 0.5 },
    ];
    for (const t of table) {
      expect(expectedCadenceWaitDays({ everyDays: t.everyDays }), `everyDays=${t.everyDays}`).toBe(t.expected);
    }
  });

  it("两个常见错法被显式排除：既不是 everyDays（最坏等待），也不是 0（当节拍不存在）", () => {
    for (const everyDays of [30, 15, 7, 5, 2]) {
      const wait = expectedCadenceWaitDays({ everyDays });
      expect(wait, `everyDays=${everyDays} 不得等于 everyDays（那是最坏等待）`).not.toBe(everyDays);
      expect(wait, `everyDays=${everyDays} 不得等于 0（那是假设随到随办）`).not.toBe(0);
      expect(wait * 2, `everyDays=${everyDays} 期望×2 必须还原周期`).toBe(everyDays);
    }
  });

  it("offsetDays 是相位，不改变期望（均匀到达假设下与相位无关）", () => {
    const base = expectedCadenceWaitDays({ everyDays: 30 });
    for (const offsetDays of [0, 1, 7, 29]) {
      const c = CadenceSchema.parse({ everyDays: 30, offsetDays, kind: "batch" });
      expect(expectedCadenceWaitDays(c), `offsetDays=${offsetDays}`).toBe(base);
    }
  });

  it("cadenceWaitStep 构造出的环节 days 恒 == 公式产出，且非增值、带 cadence", () => {
    const s = cadenceWaitStep({ stepId: "s1", nodeId: "n1", cadence: SOP_CADENCE, label: "等 S&OP 共识会" });
    expect(s.days).toBe(expectedCadenceWaitDays(SOP_CADENCE));
    expect(s.days).toBe(15);
    expect(s.kind).toBe(CADENCE_STEP_KIND);
    expect(s.valueAdd).toBe(false);
    expect(s.cadence).toEqual(SOP_CADENCE);
    expect(ChainStepSchema.safeParse(s).success).toBe(true);
  });

  it("节拍缩短的效果 == Δ(everyDays)/2（E4 单的 SEAM 判据在契约层先立住）", () => {
    const before = expectedCadenceWaitDays({ everyDays: 30 });
    const after = expectedCadenceWaitDays({ everyDays: 7 });
    expect(before - after).toBe((30 - 7) / 2);
    expect(before - after).toBe(11.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 损失守恒（分母排除增值段 ⇒ 非增值环节 pct 之和 == 100）
// ══════════════════════════════════════════════════════════════════════════
describe("S0-③ LossAttribution 守恒：非增值 pctOfChainLoss 之和 == 100（±0.001）", () => {
  it("分母是**全链非增值总量**，不含增值段（口径的单点）", () => {
    expect(chainNonValueDays(chainSteps)).toBe(NON_VALUE_TOTAL);
    expect(chainValueAddDays(chainSteps)).toBe(VALUE_ADD_TOTAL);
    expect(chainNonValueDays(chainSteps) + chainValueAddDays(chainSteps)).toBe(LEAD_TOTAL);
    // 分母若误用前置期，下面这条恒不成立（49.5 ≠ 59.5）——把"用错分母"写成一条显式断言。
    expect(chainNonValueDays(chainSteps)).not.toBe(LEAD_TOTAL);
  });

  it("守恒律：Σ pctOfChainLoss == 100（±0.001）", () => {
    const rows = computeLossAttribution(chainSteps);
    const residual = lossConservationResidual(rows);
    expect(residual).not.toBeNull();
    expect(Math.abs(residual as number)).toBeLessThanOrEqual(LOSS_CONSERVATION_TOLERANCE_PCT);
    const sum = rows.reduce((s, r) => s + r.pctOfChainLoss, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("增值段一条都不进归因表（它不是损失）", () => {
    const rows = computeLossAttribution(chainSteps);
    const ids = rows.map((r) => r.stepId);
    expect(ids).not.toContain("a-work");
    expect(ids).not.toContain("b-work");
    expect(rows).toHaveLength(chainSteps.filter((s) => !s.valueAdd).length);
  });

  it("逐行占比 = 该环节非增值天数 ÷ 49.5（分母手写死，分母被改即红）", () => {
    const rows = computeLossAttribution(chainSteps);
    const by = Object.fromEntries(rows.map((r) => [r.stepId, r]));
    expect(by["a-cadence"]!.nonValueDays).toBe(15);
    expect(by["a-cadence"]!.pctOfChainLoss).toBeCloseTo((15 / NON_VALUE_TOTAL) * 100, 9);
    expect(by["a-queue"]!.pctOfChainLoss).toBeCloseTo((12 / NON_VALUE_TOTAL) * 100, 9);
    expect(by["b-handoff"]!.pctOfChainLoss).toBeCloseTo((3 / NON_VALUE_TOTAL) * 100, 9);
    // 等节拍两段合计（本系列的头号损失源）：22.5 / 49.5 ≈ 45.45%
    const cadencePct = rows.filter((r) => r.stepId.endsWith("cadence")).reduce((s, r) => s + r.pctOfChainLoss, 0);
    expect(cadencePct).toBeCloseTo((22.5 / NON_VALUE_TOTAL) * 100, 9);
  });

  it("诚实缺席：全链无非增值环节 → 空表 + residual=null（不返回一堆 0 冒充归因）", () => {
    const allValueAdd: ChainStep[] = [{ stepId: "w", nodeId: "n", kind: "work", days: 5, valueAdd: true }];
    expect(chainNonValueDays(allValueAdd)).toBe(0);
    expect(computeLossAttribution(allValueAdd)).toEqual([]);
    expect(lossConservationResidual([])).toBeNull();
  });

  it("computeLossAttribution 的产出逐条过 LossAttributionSchema", () => {
    for (const r of computeLossAttribution(chainSteps)) {
      expect(LossAttributionSchema.safeParse(r).success, r.stepId).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ① 契约往返 · strict parse（正例通过 / 错枚举值抛 / 多写字段抛 / 跨字段矛盾抛）
// ══════════════════════════════════════════════════════════════════════════
describe("S0-① 契约往返 · zod 4 strict", () => {
  it("五个契约的正例往返：parse 输出与输入逐字段相等", () => {
    expect(CadenceSchema.parse(SETTLE_CADENCE)).toEqual(SETTLE_CADENCE);
    expect(ChainStepSchema.parse(nodeA.steps[0])).toEqual(nodeA.steps[0]);
    expect(ChainNodeSchema.parse(nodeA)).toEqual(nodeA);
    expect(ChainNodeSchema.parse(nodeB)).toEqual(nodeB);
    expect(ChainImpedimentSchema.parse(impediment)).toEqual(impediment);
    const scope = { businessTypes: ["storage"], baseIds: [BASE_REGISTRY[0]!.baseId], modelIds: ["m-4680-lfp"] };
    expect(ChainScopeSchema.parse(scope)).toEqual(scope);
    const loss = { stepId: "a-queue", nonValueDays: 12, pctOfChainLoss: 24.2424 };
    expect(LossAttributionSchema.parse(loss)).toEqual(loss);
  });

  it("写错枚举值 → 抛", () => {
    expect(() => CadenceSchema.parse({ everyDays: 30, kind: "meetings" })).toThrow();
    expect(() => ChainStepSchema.parse({ stepId: "s", nodeId: "n", kind: "wait", days: 1, valueAdd: false })).toThrow();
    expect(() => ChainNodeSchema.parse({ ...nodeA, stage: "PROCUREMENT" })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, kind: "STUCK" })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, kind: "BREAK", breakSubtype: "NETWORK" })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, dataMode: "MOCK" })).toThrow(); // 派生侧词表无 MOCK
    expect(() => ChainScopeSchema.parse({ businessTypes: ["passenger_car"] })).toThrow();
  });

  it("多写字段 → 抛（strictObject：冻结的含义就是加字段得回契约里加）", () => {
    expect(() => CadenceSchema.parse({ ...SOP_CADENCE, jitterDays: 2 })).toThrow();
    expect(() => ChainStepSchema.parse({ ...nodeA.steps[0], owner: "计划部" })).toThrow();
    expect(() => ChainNodeSchema.parse({ ...nodeA, leadTimeDays: LEAD_TOTAL })).toThrow(); // 派生量不许落字段
    expect(() => ChainScopeSchema.parse({ businessTypes: ["storage"], segment: SEG_REGISTRY[0]!.seg })).toThrow(); // 旧的 segment 维（值取自册，不内联名字）
    // 金值更新（WO-SANDBOX-S3）：`candidates` 已由 S3 追加进契约，故它不再是"多写字段"。
    // 旧断言（`candidates: []` → 抛，理由「S3 才追加」）今天仍然抛，但**理由变了**：
    // 空候选集必须同时给 `noCandidateReason`（诚实缺席不许静默空）。理由变了就得改断言，
    // 否则它会变成一条"碰巧还绿"的测试——绿着但证的已不是它自称在证的那件事。
    expect(() => ChainImpedimentSchema.parse({ ...impediment, candidates: [], noCandidateReason: undefined })).toThrow();
    expect(ChainImpedimentSchema.safeParse({ ...impediment, candidates: [], noCandidateReason: "杠杆集为空" }).success).toBe(true);
    expect(() => ChainImpedimentSchema.parse({ ...impediment, solutions: [] })).toThrow(); // 真·多写字段仍抛
    expect(() => LossAttributionSchema.parse({ stepId: "s", nonValueDays: 1, pctOfChainLoss: 1, rank: 1 })).toThrow();
  });

  it("ChainScope：单数拼写 / 空数组 / 非册基地 一律抛（业务线口子不许再从旁边漏）", () => {
    expect(() => ChainScopeSchema.parse({ businessType: "storage" })).toThrow(); // 单数是历史写法
    expect(() => ChainScopeSchema.parse({ seg: "storage" })).toThrow();
    expect(() => ChainScopeSchema.parse({ businessTypes: [] })).toThrow(); // 空集/全域两可 → 拒
    expect(() => ChainScopeSchema.parse({ baseIds: [] })).toThrow();
    expect(() => ChainScopeSchema.parse({ baseIds: ["__not_a_base__"] })).toThrow();
    expect(() => ChainScopeSchema.parse({ modelIds: [""] })).toThrow();
    expect(ChainScopeSchema.parse({})).toEqual({});
    expect(isChainScopeUnscoped(ChainScopeSchema.parse({}))).toBe(true);
    expect(isChainScopeUnscoped(ChainScopeSchema.parse({ businessTypes: ["storage"] }))).toBe(false);
  });

  it("Cadence 跨字段：everyDays<=0 抛 · offsetDays>=everyDays 抛", () => {
    expect(() => CadenceSchema.parse({ everyDays: 0, kind: "batch" })).toThrow();
    expect(() => CadenceSchema.parse({ everyDays: -1, kind: "batch" })).toThrow();
    expect(() => CadenceSchema.parse({ everyDays: 7, offsetDays: 7, kind: "batch" })).toThrow();
    expect(() => CadenceSchema.parse({ everyDays: 7, offsetDays: 9, kind: "batch" })).toThrow();
    expect(CadenceSchema.safeParse({ everyDays: 7, offsetDays: 6, kind: "batch" }).success).toBe(true);
  });

  it("ChainStep 跨字段：valueAdd 硬绑 kind · cadence 硬绑 kind==cadence", () => {
    const work = { stepId: "s", nodeId: "n", kind: "work", days: 3 };
    expect(() => ChainStepSchema.parse({ ...work, valueAdd: false })).toThrow(); // work 必增值
    expect(ChainStepSchema.safeParse({ ...work, valueAdd: true }).success).toBe(true);
    expect(() => ChainStepSchema.parse({ stepId: "s", nodeId: "n", kind: "queue", days: 3, valueAdd: true })).toThrow(); // 排队不增值
    expect(() => ChainStepSchema.parse({ stepId: "s", nodeId: "n", kind: "cadence", days: 15, valueAdd: false })).toThrow(); // 缺 cadence
    expect(() => ChainStepSchema.parse({ stepId: "s", nodeId: "n", kind: "queue", days: 3, valueAdd: false, cadence: SOP_CADENCE })).toThrow(); // 非节拍段挂节拍
    expect(() => ChainStepSchema.parse({ stepId: "s", nodeId: "n", kind: "queue", days: -1, valueAdd: false })).toThrow();
  });

  it("ChainNode 跨字段：steps.nodeId 必须一致 · stepId 节点内唯一 · steps 不许空", () => {
    expect(() => ChainNodeSchema.parse({ ...nodeA, steps: [] })).toThrow();
    const wrongOwner = { ...nodeA, steps: [{ ...nodeA.steps[0]!, nodeId: "n-other" }, ...nodeA.steps.slice(1)] };
    expect(() => ChainNodeSchema.parse(wrongOwner)).toThrow();
    const dup = { ...nodeA, steps: [nodeA.steps[0]!, { ...nodeA.steps[1]!, stepId: nodeA.steps[0]!.stepId }] };
    expect(() => ChainNodeSchema.parse(dup)).toThrow();
  });

  it("ChainImpediment 跨字段：BREAK⟺breakSubtype · DATA 断必须 dataMode=EMPTY", () => {
    expect(() => ChainImpedimentSchema.parse({ ...impediment, kind: "BREAK" })).toThrow(); // BREAK 缺亚型
    expect(() => ChainImpedimentSchema.parse({ ...impediment, breakSubtype: "MATERIAL" })).toThrow(); // 非 BREAK 带亚型
    expect(ChainImpedimentSchema.safeParse({ ...impediment, kind: "BREAK", breakSubtype: "MATERIAL" }).success).toBe(true);
    // 数据断自称 LIVE = 自相矛盾的假数据
    expect(() => ChainImpedimentSchema.parse({ ...impediment, kind: "BREAK", breakSubtype: "DATA", dataMode: "LIVE" })).toThrow();
    expect(ChainImpedimentSchema.safeParse({ ...impediment, kind: "BREAK", breakSubtype: "DATA", dataMode: "EMPTY" }).success).toBe(true);
    expect(() => ChainImpedimentSchema.parse({ ...impediment, severity: 120 })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, scope: undefined })).toThrow(); // scope 必填·结果须回带范围
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 派生纪律 · 单一来源（零内联字面量）与节点口径
// ══════════════════════════════════════════════════════════════════════════
describe("S0 · 单源派生与节点口径", () => {
  it("基地取值集 == BASE_REGISTRY 派生（改册即改枚举，非抄写）", () => {
    expect(CANONICAL_BASE_IDS).toEqual(BASE_REGISTRY.map((b) => b.baseId));
    expect(CanonicalBaseIdSchema.options).toEqual(BASE_REGISTRY.map((b) => b.baseId));
    expect(CANONICAL_BASE_IDS.length).toBeGreaterThan(0);
    for (const b of BASE_REGISTRY) expect(CanonicalBaseIdSchema.safeParse(b.baseId).success, b.baseId).toBe(true);
    expect(CanonicalBaseIdSchema.safeParse("__not_a_base__").success).toBe(false);
  });

  it("业务线取值集与 SEG_REGISTRY 一一对应（两套词表漂了即红）", () => {
    const bts = BusinessTypeSchema.options;
    expect(bts.length).toBe(SEG_REGISTRY.length);
    const segs = bts.map((bt) => {
      const s = segOfBusinessTypeOrThrow(bt);
      return s.seg;
    });
    expect([...segs].sort()).toEqual(SEG_REGISTRY.map((s) => s.seg).sort());
    expect(new Set(segs).size).toBe(bts.length); // 单射：两个业务线不许映到同一细分
  });

  it("五段中只有 work 增值（增值判据单一来源）", () => {
    expect(CHAIN_STEP_KINDS.filter((k) => isValueAddKind(k))).toEqual([VALUE_ADD_STEP_KIND]);
    expect(CHAIN_STEP_KINDS).toHaveLength(5);
    expect(CADENCE_KINDS).toHaveLength(4);
    // 金值 4 → 5：WO-CHAIN-24 末位追加第 5 段 `DELIVERY`（交付与回款）。
    // 前 4 段逐字不动，所以这里改的只是长度，`CHAIN_STAGES[0..3]` 的取值由下面那条用例咬死。
    expect(CHAIN_STAGES).toHaveLength(5);
    expect(CHAIN_IMPEDIMENT_KINDS).toHaveLength(3);
    expect(CHAIN_BREAK_SUBTYPES).toHaveLength(3);
  });

  /**
   * WO-CHAIN-24 金值门：**5 段 24 节点**，且「只许追加」这条纪律本身可被证伪。
   *
   * 为什么不只断长度：长度对了照样可能是「改了一个已在册 id」凑出来的 —— 而改 id
   * 正是 S0 那次「两套词表交集为 0、链路整条断」的复现形态（`chain-sim.ts` §2.5 记着那笔账）。
   * 故本用例把**前 12 条的 id 与顺序**写死：谁动了其中任何一条，这里当场红。
   */
  it("WO-CHAIN-24 · 5 段 24 节点，且前 12 条注册表条目**逐字未动**（只许末位追加）", () => {
    expect(CHAIN_STAGES).toEqual(["DEMAND", "ORDER", "CAPACITY", "MATERIAL", "DELIVERY"]);
    expect(CHAIN_NODE_REGISTRY).toHaveLength(24);
    // S0 冻结的原 12 条：id 与**顺序**都不许变（下标语义被前端测试按 [4] 取样依赖）。
    expect(CHAIN_NODE_REGISTRY.slice(0, 12).map((n) => n.nodeId)).toEqual([
      "demand.consensus", "order.review", "order.cash", "order.settlement",
      "capacity.schedule", "capacity.qc_batch", "capacity.quality", "capacity.aging", "capacity.maint",
      "material.mrp", "material.replenish", "material.shipping",
    ]);
    // nodeId 全仓唯一，且形如 `<stage 小写>.<名>`（新段 DELIVERY ⇒ 前缀 delivery.）。
    expect(new Set(CHAIN_NODE_REGISTRY.map((n) => n.nodeId)).size).toBe(24);
    for (const n of CHAIN_NODE_REGISTRY) {
      expect(n.nodeId.startsWith(`${n.stage.toLowerCase()}.`), `${n.nodeId} 的前缀与 stage=${n.stage} 不一致`).toBe(true);
      expect(isKnownChainNodeId(n.nodeId), `${n.nodeId} 自己都不被 isKnownChainNodeId 认`).toBe(true);
    }
    // 第 5 段真的有节点（追加了枚举却没有任何节点 = 空段，那是「加了个名字」不是「建了一段模」）。
    expect(CHAIN_NODE_REGISTRY.filter((n) => n.stage === "DELIVERY").map((n) => n.nodeId)).toEqual([
      "delivery.fg_stock", "delivery.transit", "delivery.acceptance",
    ]);
    // 每一段都非空（`CHAIN_STAGES` 里出现的段必须真有在册节点）。
    for (const s of CHAIN_STAGES) {
      expect(CHAIN_NODE_REGISTRY.some((n) => n.stage === s), `段 ${s} 在册 0 个节点`).toBe(true);
    }
  });

  it("节点前置期 = 五段之和；流动效率 = 增值/前置期；前置期 0 → null（诚实缺席）", () => {
    expect(nodeLeadTimeDays(nodeA)).toBe(37);
    expect(nodeValueAddDays(nodeA)).toBe(6);
    expect(nodeFlowEfficiency(nodeA)).toBeCloseTo(6 / 37, 9);
    expect(nodeLeadTimeDays(nodeA) + nodeLeadTimeDays(nodeB)).toBe(LEAD_TOTAL);
    const zero: ChainNode = { nodeId: "z", label: "零耗时", stage: "DEMAND", steps: [{ stepId: "z1", nodeId: "z", kind: "handoff", days: 0, valueAdd: false }] };
    expect(nodeLeadTimeDays(zero)).toBe(0);
    expect(nodeFlowEfficiency(zero)).toBeNull();
  });

  it("阻滞点排序是**全序**：severity 降序 → objectId → impedimentId（同 severity 不靠输入顺序）", () => {
    const mk = (id: string, sev: number, objId: string): ChainImpediment => ({ ...impediment, impedimentId: id, severity: sev, locus: { ...impediment.locus, objectId: objId } });
    const a = mk("imp-b", 50, "obj-2");
    const b = mk("imp-a", 50, "obj-1");
    const c = mk("imp-c", 90, "obj-3");
    const asc = [a, b, c].slice().sort(compareChainImpediment).map((x) => x.impedimentId);
    const desc = [c, b, a].slice().sort(compareChainImpediment).map((x) => x.impedimentId);
    expect(asc).toEqual(["imp-c", "imp-a", "imp-b"]); // 90 先；同 50 时 obj-1 < obj-2
    expect(desc).toEqual(asc); // 与输入顺序无关 ⇒ 全序（R6 重跑字节一致）
    const tie = mk("imp-z", 50, "obj-1");
    expect(compareChainImpediment(b, tie)).toBeLessThan(0); // 同 severity 同 objectId → 落到 impedimentId
    expect(compareChainImpediment(b, b)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S3 · SolutionCandidate（阻滞点 → 方案候选）契约
// ══════════════════════════════════════════════════════════════════════════
describe("S3 · SolutionCandidate 契约（A4 效果层判据的单一来源）", () => {
  const dim = (key: string, value: number | null, baseline: number | null, betterWhen: "lower" | "higher" = "lower") => ({
    key,
    label: key,
    value,
    baseline,
    unit: "",
    betterWhen,
    dataMode: value === null ? ("EMPTY" as const) : ("SYNTHETIC" as const),
    ...(value === null ? { reason: "算不出来" } : {}),
  });
  const cand = (id: string, dims: ReturnType<typeof dim>[], from = 1, to = 2): SolutionCandidate =>
    SolutionCandidateSchema.parse({
      candidateId: id,
      impedimentId: impediment.impedimentId,
      label: `杠杆 ${id}`,
      lever: { objectType: "Line", objectId: "L-1", prop: "utilization", unit: "%" },
      fromValue: from,
      toValue: to,
      join: { kind: "LOCUS_PROP", path: "Line(locus) 自身承载 Line.utilization" },
      rungKind: "THRESHOLD",
      rungSource: "规则 C05 阈值 95",
      effectKind: "METRIC_SELF",
      dims,
      provenance: { solverKey: "chain_impediments", formula: "f", inputs: ["Line.utilization"] },
      dataMode: "SYNTHETIC",
    });

  it("硬约束：拨到原值抛 · 各维与基线逐维相同抛（A4 变异反证的注入点）", () => {
    expect(() => cand("c-same-value", [dim("breach", 1, 2)], 3, 3)).toThrow();
    // ⇐ 这一条就是 A4：掐掉杠杆接线 → 候选各维退化成基线 → schema 当场抛。
    expect(() => cand("c-flat", [dim("breach", 2, 2), dim("cap", 7, 7, "higher")])).toThrow();
    expect(cand("c-ok", [dim("breach", 1, 2)]).candidateId).toBe("c-ok");
    // 全维算不出来（null）也算"没动" → 抛（null 不许冒充改善）
    expect(() => cand("c-null", [dim("breach", null, null)])).toThrow();
  });

  it("改善量口径：betterWhen 决定符号 · 算不出来记 0 不参与排序", () => {
    expect(candidateDimImprovement(dim("d", 1, 3))).toBe(2); // lower better
    expect(candidateDimImprovement(dim("d", 3, 1, "higher"))).toBe(2);
    expect(candidateDimImprovement(dim("d", 3, 1))).toBe(-2); // 变差如实为负
    expect(candidateDimImprovement(dim("d", null, 1))).toBe(0);
    expect(candidateDimMoved(dim("d", 1, 1))).toBe(false);
    expect(candidateDimMoved(dim("d", 1, 2))).toBe(true);
  });

  it("排序是**全序**：逐维改善量降序 → 维数 → candidateId，与输入顺序无关", () => {
    const a = cand("c-a", [dim("breach", 1, 3)]); // 改善 2
    const b = cand("c-b", [dim("breach", 2, 3)]); // 改善 1
    const z = cand("c-z", [dim("breach", 1, 3)]); // 与 a 同改善 → 落 id
    expect([b, z, a].slice().sort(compareSolutionCandidate).map((x) => x.candidateId)).toEqual(["c-a", "c-z", "c-b"]);
    expect([a, b, z].slice().sort(compareSolutionCandidate).map((x) => x.candidateId)).toEqual(["c-a", "c-z", "c-b"]);
    expect(compareSolutionCandidate(a, a)).toBe(0);
  });

  it("A4 效果层判据：KPI 至少一维数值不同才算真不同；雷同对被 firstDuplicateCandidatePair 揪出", () => {
    const a = cand("c-a", [dim("breach", 1, 3), dim("cap", 9, 7, "higher")]);
    const b = cand("c-b", [dim("breach", 2, 3), dim("cap", 9, 7, "higher")]);
    const dup = cand("c-dup", [dim("breach", 1, 3), dim("cap", 9, 7, "higher")]);
    expect(candidatesEffectDistinct(a, b)).toBe(true);
    expect(candidatesEffectDistinct(a, dup)).toBe(false); // 杠杆不同但效果一模一样 = 重复
    expect(firstDuplicateCandidatePair([a, b])).toBeNull();
    expect(firstDuplicateCandidatePair([a, b, dup])).toEqual([0, 2]);
    // 维键不对齐 → 一律按"重复"处理（生成方自己不自洽时放行更危险）
    const odd = cand("c-odd", [dim("other", 1, 3), dim("cap", 9, 7, "higher")]);
    expect(candidatesEffectDistinct(a, odd)).toBe(false);
  });

  it("阻滞点侧硬约束：候选 impedimentId 必须与宿主一致 · 空候选必须说明原因", () => {
    const c = cand("c-a", [dim("breach", 1, 3)]);
    expect(ChainImpedimentSchema.safeParse({ ...impediment, candidates: [c] }).success).toBe(true);
    expect(() => ChainImpedimentSchema.parse({ ...impediment, candidates: [c], noCandidateReason: "空" })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, candidates: [{ ...c, impedimentId: "imp-other" }] })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...impediment, candidates: [] })).toThrow();
  });

  it("join 优先序是显式全序常量（同一 (对象,属性) 被多路命中时取最强那条）", () => {
    expect(CANDIDATE_JOIN_RANK.LOCUS_PROP).toBeLessThan(CANDIDATE_JOIN_RANK.LINK_HOP);
    expect(CANDIDATE_JOIN_RANK.LINK_HOP).toBeLessThan(CANDIDATE_JOIN_RANK.RULE_GATE);
  });
});

/** 桥必须是**全的**：缺一个即带上下文红，而不是静默 undefined 被 `?.` 吞掉。 */
function segOfBusinessTypeOrThrow(bt: BusinessType): CanonicalSeg {
  const s = segOfBusinessType(bt);
  if (!s) throw new Error(`segOfBusinessType("${bt}") 返回 undefined —— BusinessTypeSchema 与 SEG_REGISTRY 两套词表已漂移`);
  return s;
}
