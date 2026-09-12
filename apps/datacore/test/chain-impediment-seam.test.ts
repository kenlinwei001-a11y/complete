import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { ChainImpedimentSchema, ruleParamRef, type ChainImpediment } from "@platform/contracts";
import {
  IMPEDIMENT_RULE_BINDINGS,
  arbitrateByLocus,
  breachAmount,
  detectChainImpediments,
  readRuleThreshold,
  type ImpedimentCandidate,
} from "../src/solvers/chain-impediment.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * WO-SANDBOX-E3 · 阻滞点判定器 **SEAM**（规则半 × 引擎半）——**效果层**验收，不是运输层。
 *
 * 头号判据（缺则本单退回）：**改规则 params 的阈值（走规则编辑/发布真路径，一行代码不改）
 * → 阻滞点判定结果真的跟着变。** 只断言"读到了规则/传下去了"一律不算，所以每条都去比
 * `counts` / `impediments[].severity` / `evidence.threshold` 这种**判定结论**。
 *
 * 接缝的两半：
 *  · 规则半 = `POST /a/v1/rules` + `POST /a/v1/rules/:id/publish`（RulesService 真发布路径，
 *    含 `assertValidExpression` 的 expression×params 闭包校验）。
 *  · 引擎半 = `POST /a/v1/solvers/chain_impediments/invoke`（SolverService.loadContext 注入已发布
 *    规则快照 → `detectChainImpediments` 判定）。
 * 数据是 `seedBattery` 播下的**真合成种子**（650 工序 / 130 产线 / 24 物料批次 / 9 物料平衡 / 9 数据源），
 * 不是手捏的 fixture。
 *
 * 变异反证注入点（见交付说明）：把 `readRuleThreshold` 换成写死字面量 → 本文件 SEAM-1..4 必红。
 */

interface ScanOut {
  scanId: string;
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  impediments: ChainImpediment[];
  unresolved: { bindingId: string; kind: string; ruleKey?: string; status: string; reason: string }[];
  caveats: { bindingId: string; ruleKey: string; note: string }[];
  thresholds: { bindingId: string; ruleKey: string; source: string; ruleParamKey?: string; fieldPath?: string; value: number; unit: string }[];
}

async function scan(t: TestApp, args: Record<string, unknown> = {}): Promise<ScanOut> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/chain_impediments/invoke",
    headers: ADMIN,
    payload: { args },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as ScanOut;
}

/** 经**规则编辑路径**改规则（新版本 → 发布），全程不碰任何源码常量。 */
async function editRule(
  t: TestApp,
  patch: {
    key: string;
    name: string;
    expression: string;
    scopeObjectTypes: string[];
    severity: string;
    params?: Record<string, number>;
  },
): Promise<string> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: patch });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode, pub.body).toBe(200);
  return id;
}

const th = (s: ScanOut, bindingId: string) => s.thresholds.find((x) => x.bindingId === bindingId);
const ofRule = (s: ScanOut, ruleKey: string) => s.impediments.filter((i) => i.evidence.ruleKey === ruleKey);

describe("WO-SANDBOX-E3 · 阻滞点判定 SEAM（规则半 × 引擎半 · 改阈值即改推演）", () => {
  it("BASE · 真种子上三类都判得出来，且每条阻滞点的阈值都指得出出处（R13）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 三类都有（不是只做了一类）。
    expect(s.counts.BOTTLENECK).toBeGreaterThan(0);
    expect(s.counts.CONGESTION).toBeGreaterThan(0);
    expect(s.counts.BREAK).toBeGreaterThan(0);
    expect(s.counts.total).toBe(s.impediments.length);

    // 每条阻滞点都能回答「凭什么」：规则码 + 实测值 + 阈值 + 单位，且落在真对象上。
    for (const i of s.impediments) {
      expect(ChainImpedimentSchema.safeParse(i).success).toBe(true);
      expect(i.evidence.solverKey).toBe("chain_impediments");
      expect(i.evidence.ruleKey).toBeTruthy();
      expect(i.evidence.unit.length).toBeGreaterThan(0);
      expect(Number.isFinite(i.evidence.metricValue)).toBe(true);
      expect(Number.isFinite(i.evidence.threshold)).toBe(true);
      expect(i.locus.objectId.length).toBeGreaterThan(0);
      expect(i.tenantId).toBe("demo"); // R2
    }

    // 阈值出处逐条亮出，且**必须**分得清是 params / 字面量 / 对象字段。
    expect(th(s, "BREAK.DATA.datasource-stale")).toMatchObject({ ruleKey: "C09", source: "param", ruleParamKey: "staleHours", value: 2 });
    expect(th(s, "BOTTLENECK.CAPACITY.line-utilization-redline")).toMatchObject({ ruleKey: "C05", source: "literal", value: 95 });
    expect(th(s, "CONGESTION.MATERIAL.batch-idle")).toMatchObject({ ruleKey: "C28", source: "literal", value: 90 });
    expect(th(s, "BOTTLENECK.CAPACITY.process-hard-capacity")).toMatchObject({ ruleKey: "C02", source: "field", fieldPath: "Process.requiredThroughput" });

    // 三类互斥：同一个 locus 不许出两条（裁决在 arbitrateByLocus 一处，不靠 if 顺序）。
    const loci = s.impediments.map((i) => `${i.locus.objectType}|${i.locus.objectId}`);
    expect(new Set(loci).size).toBe(loci.length);
  }, 180000);

  it("SEAM-1 · 断点·数据：只改 C09 的 params.staleHours（纯 param，一个字的 expression 都不动）→ 数据断从 0 条变成真出条", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 基线：关键数据源最大延迟 1.8h ≤ C09.staleHours(2) → 一条数据断都没有。
    const before = await scan(t);
    const dataBreakBefore = before.impediments.filter((i) => i.breakSubtype === "DATA");
    expect(dataBreakBefore.length).toBe(0);
    expect(th(before, "BREAK.DATA.datasource-stale")?.value).toBe(2);

    // 只把阈值 2h 调到 1h —— expression 一字不改（它引用的就是 params.staleHours）。
    await editRule(t, {
      key: "C09",
      name: "数据时延临时降级",
      expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`,
      scopeObjectTypes: ["DataSourceHealth"],
      severity: "WARN",
      params: { staleHours: 1, degradedFactor: 0.9 },
    });

    const after = await scan(t);
    const dataBreakAfter = after.impediments.filter((i) => i.breakSubtype === "DATA");
    // ① 判定结论真的变了：0 条 → 多条（critical 且 lag>1h 的数据源）。
    expect(dataBreakAfter.length).toBeGreaterThan(0);
    expect(after.counts.BREAK).toBeGreaterThan(before.counts.BREAK);
    // ② 每条都溯源到那个被改的旋钮，且阈值就是新值。
    for (const i of dataBreakAfter) {
      expect(i.evidence.ruleKey).toBe("C09");
      expect(i.evidence.ruleParamKey).toBe("staleHours");
      expect(i.evidence.threshold).toBe(1);
      expect(i.evidence.metricValue).toBeGreaterThan(1);
      expect(i.dataMode).toBe("EMPTY"); // 数据断 = 算不出来（contracts 硬约束）
    }
    // ③ 非 critical 的数据源即使更晚（LIMS 4.1h）也不许被判成数据断 —— 整条表达式生效，不是只比阈值。
    expect(dataBreakAfter.some((i) => i.locus.objectId === "lims")).toBe(false);
    // ④ 阈值回调到 3h → 又全部消失（双向可动，不是单向棘轮）。
    await editRule(t, {
      key: "C09",
      name: "数据时延临时降级",
      expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`,
      scopeObjectTypes: ["DataSourceHealth"],
      severity: "WARN",
      params: { staleHours: 3, degradedFactor: 0.9 },
    });
    const back = await scan(t);
    expect(back.impediments.filter((i) => i.breakSubtype === "DATA").length).toBe(0);
  }, 180000);

  it("SEAM-2 · 堵点：把 C28 的呆滞天数搬进 params 再改它 → 堵点条数与 severity 真的跟着走", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    const congBefore = ofRule(before, "C28");
    expect(congBefore.length).toBeGreaterThan(0);
    expect(th(before, "CONGESTION.MATERIAL.batch-idle")).toMatchObject({ source: "literal", value: 90 });

    // 把阈值从 expression 里的字面量搬进 params（WO-RULE-EXPR-PARAMS 的标准迁移形态），值先保持 90。
    await editRule(t, {
      key: "C28",
      name: "呆滞预警",
      expression: `Batch.idleDays > ${ruleParamRef("idleDaysMax")}`,
      scopeObjectTypes: ["MaterialBatch"],
      severity: "WARN",
      params: { idleDaysMax: 90 },
    });
    const migrated = await scan(t);
    // 迁移本身不改判定（同值），但**溯源**从"字面量"变成"哪个旋钮"。
    expect(ofRule(migrated, "C28").length).toBe(congBefore.length);
    expect(th(migrated, "CONGESTION.MATERIAL.batch-idle")).toMatchObject({ source: "param", ruleParamKey: "idleDaysMax", value: 90 });
    for (const i of ofRule(migrated, "C28")) expect(i.evidence.ruleParamKey).toBe("idleDaysMax");

    // 现在只改这一个数：90 → 110。
    await editRule(t, {
      key: "C28",
      name: "呆滞预警",
      expression: `Batch.idleDays > ${ruleParamRef("idleDaysMax")}`,
      scopeObjectTypes: ["MaterialBatch"],
      severity: "WARN",
      params: { idleDaysMax: 110 },
    });
    const loosened = await scan(t);
    const congLoose = ofRule(loosened, "C28");
    expect(congLoose.length).toBeLessThan(congBefore.length); // 门槛抬高 → 堵点变少
    expect(congLoose.length).toBeGreaterThan(0);
    for (const i of congLoose) {
      expect(i.evidence.threshold).toBe(110);
      expect(i.evidence.metricValue).toBeGreaterThan(110);
    }
    // severity 是**算出来的**（超阈幅度/阈值），不是固定权重表：同一个批次，门槛抬高 → severity 必降。
    const pick = congLoose[0]!;
    const sameBefore = congBefore.find((i) => i.locus.objectId === pick.locus.objectId)!;
    expect(sameBefore).toBeDefined();
    expect(pick.severity).toBeLessThan(sameBefore.severity);

    // 收紧到 30 → 堵点变多（双向可动，不是单向棘轮）。
    await editRule(t, {
      key: "C28",
      name: "呆滞预警",
      expression: `Batch.idleDays > ${ruleParamRef("idleDaysMax")}`,
      scopeObjectTypes: ["MaterialBatch"],
      severity: "WARN",
      params: { idleDaysMax: 30 },
    });
    expect(ofRule(await scan(t), "C28").length).toBeGreaterThan(congBefore.length);
  }, 180000);

  it("SEAM-3 · 卡点·利用率红线：把 C05 的红线搬进 params 再压低 → 卡点条数真的暴涨（且红线同时是三类互斥的裁决线）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    const bnBefore = ofRule(before, "C05");
    expect(th(before, "BOTTLENECK.CAPACITY.line-utilization-redline")).toMatchObject({ source: "literal", value: 95 });

    await editRule(t, {
      key: "C05",
      name: "产线利用率持续越线",
      expression: `SUSTAIN(Line.utilization > ${ruleParamRef("utilizationRedlinePct")}, 3)`,
      scopeObjectTypes: ["Line"],
      severity: "WARN",
      params: { utilizationRedlinePct: 88 },
    });

    const after = await scan(t);
    const bnAfter = ofRule(after, "C05");
    expect(bnAfter.length).toBeGreaterThan(bnBefore.length);
    expect(after.counts.BOTTLENECK).toBeGreaterThan(before.counts.BOTTLENECK);
    for (const i of bnAfter) {
      expect(i.kind).toBe("BOTTLENECK");
      expect(i.evidence.ruleKey).toBe("C05");
      expect(i.evidence.ruleParamKey).toBe("utilizationRedlinePct");
      expect(i.evidence.threshold).toBe(88);
      expect(i.evidence.metricValue).toBeGreaterThan(88);
      // SUSTAIN 的持续天数没校验就标 PARTIAL —— 诚实降级，不冒充全量判定。
      expect(i.dataMode).toBe("PARTIAL");
    }
    expect(after.caveats.some((c) => c.ruleKey === "C05" && c.note.includes("未校验持续天数"))).toBe(true);
  }, 180000);

  it("SEAM-4 · 卡点·硬容量夹定：C02 阈值从「对象字段」搬到 params 并抬高 → 化成/老化工序真的被判成卡点（D3 数据半 × E3 引擎半）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    // 基线：柜位数是按目标反解出来的（余量 +0.7%~2%），故硬容量恰好够用 → 0 条卡点。
    expect(ofRule(before, "C02").length).toBe(0);
    const baselineThreshold = th(before, "BOTTLENECK.CAPACITY.process-hard-capacity")!;
    expect(baselineThreshold.source).toBe("field"); // 阈值 = Process.requiredThroughput（真对象属性）

    // 把 C02 的比较基准换成命名阈值，并抬到基线之上 → 同一批工序立刻被判夹定。
    const higher = Math.round(baselineThreshold.value * 1.5);
    await editRule(t, {
      key: "C02",
      name: "化成/老化串并产能口径",
      expression: `Process.parallelThroughput < ${ruleParamRef("minParallelThroughput")}`,
      scopeObjectTypes: ["Process"],
      severity: "WARN",
      params: { minParallelThroughput: higher },
    });

    const after = await scan(t);
    const bn = ofRule(after, "C02");
    expect(bn.length).toBeGreaterThan(0);
    for (const i of bn) {
      expect(i.kind).toBe("BOTTLENECK");
      expect(i.stage).toBe("CAPACITY");
      expect(i.locus.objectType).toBe("Process");
      expect(i.evidence.ruleParamKey).toBe("minParallelThroughput");
      expect(i.evidence.threshold).toBe(higher);
      // 实测值 = D3 的硬容量日通过量（柜位数 × 单柜位日产 × 良率），不是别处抄来的数。
      expect(i.evidence.metricValue).toBeLessThan(higher);
      expect(i.evidence.unit).toBe("电芯/天");
    }
  }, 180000);

  it("HONEST-1 · 规则退役 → 该判据诚实落 UNKNOWN 并说明原因，绝不退回默认阈值继续判", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    expect(ofRule(before, "C28").length).toBeGreaterThan(0);

    const list = (await t.app.inject({ method: "GET", url: "/a/v1/rules?status=PUBLISHED", headers: ADMIN })).json() as
      | { id: string; key: string }[]
      | { items: { id: string; key: string }[] };
    const rows = Array.isArray(list) ? list : list.items;
    const c28 = rows.find((r) => r.key === "C28")!;
    expect(c28).toBeDefined();
    const ret = await t.app.inject({ method: "POST", url: `/a/v1/rules/${c28.id}/retire`, headers: ADMIN, payload: {} });
    expect(ret.statusCode, ret.body).toBe(200);

    const after = await scan(t);
    expect(ofRule(after, "C28").length).toBe(0); // 没有阈值就一条都不判
    const u = after.unresolved.find((x) => x.bindingId === "CONGESTION.MATERIAL.batch-idle");
    expect(u).toBeDefined();
    expect(u!.status).toBe("UNKNOWN");
    expect(u!.reason).toContain("C28");
    expect(after.thresholds.some((x) => x.bindingId === "CONGESTION.MATERIAL.batch-idle")).toBe(false);
  }, 180000);

  it("HONEST-2 · 判不出来的判据全在 unresolved 里说清「为什么」（换型无对象承载 / 时间断无规则承载）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const changeover = s.unresolved.find((u) => u.bindingId === "CONGESTION.CAPACITY.order-changeover")!;
    expect(changeover).toBeDefined();
    expect(changeover.ruleKey).toBe("C22");
    expect(changeover.reason).toContain("changeoverMin");
    expect(changeover.reason).toContain("接了线没数据"); // 三分法定性写进结论，不含糊
    const leadtime = s.unresolved.find((u) => u.bindingId === "UNBOUND.BREAK.LEADTIME")!;
    expect(leadtime).toBeDefined();
    expect(leadtime.reason).toContain("规则库");
    // 没有任何一条阻滞点是这两个判据产出的（诚实缺席 ≠ 悄悄补一条）。
    expect(s.impediments.some((i) => i.evidence.ruleKey === "C22")).toBe(false);
    expect(s.impediments.some((i) => i.breakSubtype === "LEADTIME")).toBe(false);
  }, 180000);

  it("R6 · 同输入连跑两次字节一致（scanId/排序/severity 全稳）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await scan(t);
    const b = await scan(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // 排序是全序（severity 降序 → objectId → impedimentId），不靠输入顺序的巧合。
    for (let i = 1; i < a.impediments.length; i++) {
      const p = a.impediments[i - 1]!;
      const c = a.impediments[i]!;
      expect(p.severity >= c.severity).toBe(true);
      if (p.severity === c.severity) expect(p.locus.objectId <= c.locus.objectId).toBe(true);
    }
  }, 180000);

  /**
   * ⚠ **本条的 businessTypes 那一段在 WO-A6-CONTENTION 里改判了，改的是"怎么诚实"，不是"要不要诚实"。**
   *
   * 原断言：`businessTypes` 一律 400。当时这是对的 —— 判定器**一个 locus 都不读这一维**，
   * 放开就等于静默返全域（"以为筛了、其实没筛"）。
   * 现在判定器真读了：承载业务线的 locus（`Order` / 争用面 `Base`）**真裁**，
   * 不承载的**保留但逐条标 UNKNOWN 归属**（caveat + `segmentAttribution` + dataMode 降 PARTIAL）。
   * 于是同一条纪律的落点从「整维拒绝」挪到「逐条出声」——**更精确，不是更松**：
   * 400 那会儿用户连能筛的那一半也拿不到，而筛不动的部分当时也无从知晓。
   * 放行后的效果层判据全在 `a6-cross-segment-contention.seam.test.ts` CONTENTION-5，此处只守两件事：
   *   ① `modelIds` **仍然 400**（无 contracts 级型号册 + 无 locus 承载 ⇒ 放开仍是静默全域）；
   *   ② `businessTypes` 放行后**不许静默** —— 必须带 `segmentAttribution` 账且账上真有 UNKNOWN 条目。
   */
  it("R-ARG-FIDELITY · scope.baseIds 真过滤；modelIds 仍显式拒绝；businessTypes 放行但筛不动的地方必须出声", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await editRule(t, {
      key: "C05",
      name: "产线利用率持续越线",
      expression: `SUSTAIN(Line.utilization > ${ruleParamRef("utilizationRedlinePct")}, 3)`,
      scopeObjectTypes: ["Line"],
      severity: "WARN",
      params: { utilizationRedlinePct: 80 }, // 压低红线，保证每个基地都有产线卡点可筛
    });
    const all = await scan(t);
    const lineAll = all.impediments.filter((i) => i.locus.objectType === "Line");
    expect(lineAll.length).toBeGreaterThan(0);

    const scoped = await scan(t, { scope: { baseIds: ["changzhou"] } });
    const lineScoped = scoped.impediments.filter((i) => i.locus.objectType === "Line");
    expect(lineScoped.length).toBeGreaterThan(0);
    expect(lineScoped.length).toBeLessThan(lineAll.length); // 真收窄了
    expect(scoped.impediments.every((i) => i.scope.baseIds?.[0] === "changzhou")).toBe(true); // 结果回带 scope

    // ① 型号维仍然诚实拒绝。
    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/chain_impediments/invoke",
      headers: ADMIN,
      payload: { args: { scope: { modelIds: ["4680-NCM"] } } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("R-ARG-FIDELITY");

    // ② 业务线维放行 —— 但**筛不动的必须出声**。这条断言就是原来那道 400 的接班人：
    //    若哪天有人把「保留不承载的 locus」改成静默放行，`segmentAttribution` 会消失或归零 ⇒ 当场红。
    const bt = await scan(t, { scope: { businessTypes: ["storage"] } });
    const att = (bt as unknown as { segmentAttribution?: { rows: { carriesSegment: boolean; unattributed: number }[]; unattributedTotal: number } }).segmentAttribution;
    expect(att, "限了业务线却不给作用面账 = 静默（正是原 400 要防的形态）").toBeDefined();
    expect(att!.unattributedTotal, "13 条不承载业务线的 locus 必须被记成 UNKNOWN，而不是当作「属于所选业务线」").toBeGreaterThan(0);
    expect(att!.rows.some((r) => !r.carriesSegment && r.unattributed > 0)).toBe(true);
    // 归属 UNKNOWN 的那些，诚实位必须降级（不许仍自称 LIVE/SYNTHETIC）。
    const unattributedModes = new Set(
      bt.impediments.filter((i) => !["Order", "Base"].includes(i.locus.objectType)).map((i) => i.dataMode),
    );
    expect([...unattributedModes]).toEqual(["PARTIAL"]);
  }, 180000);
});

/**
 * WO-IMP-CARRIER · 承载对象 **SEAM**（本体数据半 × 遍历/计分引擎半）。
 *
 * 接缝的两半，任一半漏即红：
 *  · **数据半** = 种子里的一等关系行（`material_has_balance` / `material_has_batch` /
 *    `material_used_by_model` / `line_runs_work_order` / `fulfills`）+ `OrderLine` 对象。
 *  · **引擎半** = `buildCarrierIndex` / `resolveCarriers` 的逐跳遍历 + severity 第二因子。
 *
 * ⚠ 本组**刻意不写死任何一个绝对数**（订单条数/金额随种子规模走）。
 * 咬的是**关系**：去重后 ≤ 可阻塞订单簿 · 承载多的那条 severity 必须更高 · 遍历路径不是按基地 join。
 * 写死数字的断言在这个仓里被换过种子规模之后必红，而红的理由与被测行为无关。
 */
describe("WO-IMP-CARRIER · 阻滞点承载对象 SEAM（它到底卡住了哪些订单）", () => {
  it("① 重复计数自证 · 逐条承载订单**去重后**不得超过可阻塞订单簿（按基地 join 会当场爆掉这条）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const withCarriers = s.impediments.filter((i) => i.carriers !== undefined);

    // 金丝雀先行：遍历若整个坏掉（一条都解析不出），下面的「没有超额」会**恒真**地绿。
    // 报否定结论前先证明量法有鉴别力 —— 这正是本仓记过账的那条纪律。
    expect(withCarriers.length, "金丝雀：一条承载对象都解析不出 ⇒ 是遍历坏了，不是「没有承载对象」").toBeGreaterThan(0);

    const book = withCarriers[0]!.carriers!.bookAmount;
    expect(book, "归一化分母必须为正，否则 exposureFactor 无意义").toBeGreaterThan(0);

    // Σ 逐条（会重复计数，因为一张单可以同时被多处卡住）vs 去重后（必须收敛）。
    const sigma = withCarriers.reduce((a, i) => a + i.carriers!.orderCount, 0);
    const maxOne = Math.max(...withCarriers.map((i) => i.carriers!.orderCount));
    expect(sigma, "Σ 逐条应当大于单条最大值，否则说明各条承载集合其实是同一个（遍历没按 locus 分开）").toBeGreaterThan(maxOne);

    // 单条上界：任何一条阻滞点的承载订单数/金额都不得超过可阻塞订单簿本身。
    // 「同基地 join」会让某一条挂上该基地全部订单，虽然仍 ≤ 全书，但会把 exposureFactor 顶到 1，
    // 故这里再加一条更硬的：**不是所有条目都能顶到 1**（否则就是在按大面积广播）。
    for (const i of withCarriers) {
      expect(i.carriers!.orderAmount, `${i.impedimentId} 承载金额超过了可阻塞订单簿`).toBeLessThanOrEqual(book + 1e-6);
      expect(i.carriers!.exposureFactor).toBeLessThanOrEqual(1);
    }
    const distinctExposure = new Set(withCarriers.map((i) => i.carriers!.exposureFactor));
    expect(distinctExposure.size, "所有阻滞点的敞口都一样 ⇒ 承载集合没有按 locus 真正分开（广播嫌疑）").toBeGreaterThan(1);
  }, 180000);

  it("② 遍历是**沿本体的边**走的，不是按基地 join（path 逐跳可核对）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    const matBal = s.impediments.find((i) => i.locus.objectType === "MaterialBalance" && i.carriers);
    expect(matBal, "金丝雀：物料平衡这一类今天必有阻滞点且必可解析承载对象").toBeDefined();
    // 物料缺口 → 物料 → 用它的型号 → 那些型号的订单行。三跳，缺一跳就不是这条路。
    expect(matBal!.carriers!.path).toEqual(["material_has_balance", "material_used_by_model", "orderline_for_model"]);
    expect(matBal!.carriers!.amountBasis, "缺料只卡真用到它的订单行，不整单算").toBe("ORDER_LINE");

    const line = s.impediments.find((i) => i.locus.objectType === "Line" && i.carriers);
    expect(line, "金丝雀：产线这一类今天必有阻滞点").toBeDefined();
    // 产线 → 它在跑的工单 → 工单履行的订单。**不是**「该基地的全体订单」。
    expect(line!.carriers!.path).toContain("line_runs_work_order");
    expect(line!.carriers!.path).toContain("fulfills");

    // 决定性判据：产线那条的承载订单数必须**远小于**同基地订单总数 —— 按基地 join 会让两者相等。
    const baseOfLine = s.impediments.find((i) => i.locus.objectType === "Base" && i.carriers);
    expect(line!.carriers!.orderCount).toBeLessThan(baseOfLine!.carriers!.orderCount);

    // 物料类不同物料的承载面必须**真的不同**（正极只喂一半型号，铝箔喂全部）——
    // 全都一样就说明遍历没走到 `material_used_by_model` 这一跳。
    const matCounts = new Set(
      s.impediments.filter((i) => i.locus.objectType === "MaterialBatch" && i.carriers).map((i) => i.carriers!.orderCount),
    );
    expect(matCounts.size, "所有物料批次承载面一样 ⇒ `material_used_by_model` 这一跳没走").toBeGreaterThan(1);
  }, 180000);

  it("③ 对照实验 · 超阈幅度相近但承载量差一个量级 ⇒ severity 必须拉开（第二因子真的进了公式）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const withCarriers = s.impediments.filter((i) => i.carriers !== undefined);

    // 在**实测数据里找**这一对，不写死 id：找 breachFactor 相近（≤25% 相对差）而承载金额差 ≥10× 的两条。
    let pair: [ChainImpediment, ChainImpediment] | undefined;
    for (const a of withCarriers) {
      for (const b of withCarriers) {
        const fa = a.carriers!, fb = b.carriers!;
        const rel = Math.abs(fa.breachFactor - fb.breachFactor) / Math.max(fa.breachFactor, fb.breachFactor);
        if (rel <= 0.25 && fa.orderAmount >= fb.orderAmount * 10) {
          pair = [a, b];
          break;
        }
      }
      if (pair) break;
    }
    expect(pair, "金丝雀：实测种子上必须存在「超阈幅度相近、承载量差一个量级」的一对（找不到则本判据无法验收）").toBeDefined();
    const [big, small] = pair!;

    // 这就是本单要消灭的病：两者超阈幅度几乎一样 ——
    // 单因子口径下它们的 severity 会**相同**（实测修前双双为 1）。
    // 第二因子进公式后，承载 150 单的那条必须明显高于承载 1 单的那条。
    expect(big.severity, `${big.impedimentId}(${big.carriers!.orderCount}单) 必须严于 ${small.impedimentId}(${small.carriers!.orderCount}单)`).toBeGreaterThan(
      small.severity,
    );
    // 且不是仅差 1 的噪声级差别 —— 承载差一个量级，分数要真的拉开。
    expect(big.severity - small.severity).toBeGreaterThanOrEqual(5);

    // severity 必须**可复算**：两个因子原样回带，谁都能自己验，不必信实现。
    for (const i of withCarriers) {
      const f = i.carriers!;
      expect(f.exposureFactor).toBeCloseTo(f.orderAmount / f.bookAmount, 5);
      expect(i.severity).toBe(Math.max(0, Math.min(100, Math.round(Math.sqrt(f.breachFactor * f.exposureFactor) * 100))));
    }
  }, 180000);

  it("④ R6 · 承载对象判不出来时 severity 退回单因子口径，且不带该字段（既有回包逐字节不变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const withCarriers = s.impediments.filter((i) => i.carriers !== undefined);
    expect(withCarriers.length).toBeGreaterThan(0);

    /**
     * ⚠ 本租户今天 **18/18 条都解析得出承载对象**，所以「遍历 impediments 里 carriers===undefined 的那些」
     * 是一个**空循环** —— 那种断言恒绿，证明不了任何事（本仓记过账的"路径开关类假绿"：
     * 生产走的那个分支根本没被测试覆盖）。故这里**直接把回落路径驱动起来**：
     * 用 `detectChainImpediments` 在**不注入订单行**的条件下跑一遍 —— 那正是
     * `orderLines` 缺省（老租户/未播种）时生产会走的那条路。
     */
    const svc = t.services.solvers as unknown as {
      loadContext: (tid: string, vo?: unknown, o?: Record<string, unknown>) => Promise<SolverContext>;
    };
    const c = await svc.loadContext("demo", undefined, { withExtended: true });
    const materialBalances = await t.repos.objects.listByType("demo", "MaterialBalance");
    const links = await t.repos.links.list("demo", () => true);
    // 刻意**不传** `orderLines` —— 这就是生产上老租户/未播种订单行时走的那条路。
    const fallback = detectChainImpediments({ c, materialBalances, links, scope: {} });
    expect(fallback.impediments.length, "金丝雀：回落路径一条阻滞点都没产出 ⇒ 是这次构造坏了，不是回落对了").toBeGreaterThan(0);
    for (const i of fallback.impediments) {
      expect(i.carriers, `${i.impedimentId} 在无订单行时仍带 carriers —— 承载对象是凭空造的`).toBeUndefined();
      const denom = Math.abs(i.evidence.threshold);
      if (!(denom > 0)) continue; // 阈值为 0 的走规模基准，不在本断言的可复算面内
      const breach = breachAmount(i.evidence.metricValue, i.evidence.threshold, ">", true);
      expect(i.severity, `${i.impedimentId} 回落口径的 severity 与单因子算法不一致`).toBe(
        Math.max(0, Math.min(100, Math.round(Math.min(1, breach / denom) * 100))),
      );
    }
    // 回落态的这批 severity 必须与**本字段上线前**的口径一致 —— 即「带不带承载对象」是唯一变量。
    const byId = new Map(s.impediments.map((i) => [i.impedimentId, i]));
    const moved = fallback.impediments.filter((f) => byId.get(f.impedimentId)?.severity !== f.severity);
    expect(moved.length, "金丝雀：双因子与单因子给出了完全相同的排序 ⇒ 第二因子没起作用").toBeGreaterThan(0);

    // 同输入连跑两次，承载对象逐字节一致（遍历里任何一处用了 Set/Map 的偶然序都会在这里翻车）。
    const again = await scan(t);
    expect(JSON.stringify(again.impediments.map((i) => i.carriers))).toBe(
      JSON.stringify(s.impediments.map((i) => i.carriers)),
    );
  }, 180000);
});

describe("WO-SANDBOX-E3 · 判定内核（纯函数 · 判据不靠 if 顺序的巧合）", () => {
  const mk = (kind: "BOTTLENECK" | "CONGESTION", objectId: string, severity: number): ChainImpediment =>
    ChainImpedimentSchema.parse({
      impedimentId: `imp_${kind}_${objectId}`,
      tenantId: "demo",
      scanId: "scan_x",
      kind,
      stage: "CAPACITY",
      scope: {},
      locus: { objectType: "Line", objectId, label: objectId },
      severity,
      evidence: { solverKey: "chain_impediments", ruleKey: kind === "BOTTLENECK" ? "C05" : "C22", metricValue: 1, threshold: 1, unit: "%" },
      dataMode: "LIVE",
    });

  it("互斥裁决 · 利用率达红线 ⇒ 判卡点（不是堵点）", () => {
    const cands: ImpedimentCandidate[] = [
      { impediment: mk("CONGESTION", "L1", 90), bindingId: "cg", utilization: 97 },
      { impediment: mk("BOTTLENECK", "L1", 10), bindingId: "bn", utilization: 97 },
    ];
    const kept = arbitrateByLocus(cands, 95);
    expect(kept.length).toBe(1);
    expect(kept[0]!.kind).toBe("BOTTLENECK"); // 注意：堵点 severity 更高也不许赢 —— 裁决线说了算，不是排序说了算
  });

  it("互斥裁决 · 利用率未达红线 ⇒ 判堵点（同一批候选、只改利用率读数，结论翻转）", () => {
    const cands: ImpedimentCandidate[] = [
      { impediment: mk("CONGESTION", "L1", 10), bindingId: "cg", utilization: 80 },
      { impediment: mk("BOTTLENECK", "L1", 90), bindingId: "bn", utilization: 80 },
    ];
    const kept = arbitrateByLocus(cands, 95);
    expect(kept.length).toBe(1);
    expect(kept[0]!.kind).toBe("CONGESTION"); // 卡点 severity 更高也不许赢
  });

  it("互斥裁决 · 改的是红线本身（候选一字不动）⇒ 结论也翻 —— 红线来自规则，故改规则即改裁决", () => {
    const cands: ImpedimentCandidate[] = [
      { impediment: mk("CONGESTION", "L1", 50), bindingId: "cg", utilization: 91 },
      { impediment: mk("BOTTLENECK", "L1", 50), bindingId: "bn", utilization: 91 },
    ];
    expect(arbitrateByLocus(cands, 95)[0]!.kind).toBe("CONGESTION");
    expect(arbitrateByLocus(cands, 90)[0]!.kind).toBe("BOTTLENECK");
  });

  it("阈值读回 · params / 字面量 / 对象字段三种来源都认，且 params 缺声明时诚实 UNKNOWN（不按缺省值判）", () => {
    const asParam = readRuleThreshold(
      { key: "C09", expression: `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`, params: { staleHours: 2 } },
      "DataSourceHealth.lagHours",
      {},
    );
    expect(asParam).toMatchObject({ status: "OK", value: 2, source: "param", ruleParamKey: "staleHours", op: ">" });

    const asLiteral = readRuleThreshold({ key: "C28", expression: "Batch.idleDays > 90", params: {} }, "Batch.idleDays", {});
    expect(asLiteral).toMatchObject({ status: "OK", value: 90, source: "literal" });

    const asField = readRuleThreshold(
      { key: "C02", expression: "Process.parallelThroughput < Process.requiredThroughput", params: {} },
      "Process.parallelThroughput",
      { Process: { requiredThroughput: 166768 } },
    );
    expect(asField).toMatchObject({ status: "OK", value: 166768, source: "field", fieldPath: "Process.requiredThroughput", op: "<" });

    // 引用了但没声明 → UNKNOWN，不是 0、不是 undefined 比较后的假 PASS。
    const undeclared = readRuleThreshold(
      { key: "C09", expression: `DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}`, params: {} },
      "DataSourceHealth.lagHours",
      {},
    );
    expect(undeclared.status).toBe("UNKNOWN");
    expect((undeclared as { reason: string }).reason).toContain("staleHours");

    // SUSTAIN 里的红线也读得出来（这是 C05 唯一能被诚实使用的方式）。
    const inSustain = readRuleThreshold({ key: "C05", expression: "SUSTAIN(Line.utilization > 95, 3)", params: {} }, "Line.utilization", {});
    expect(inSustain).toMatchObject({ status: "OK", value: 95, source: "literal" });

    // 规则口径与判据不符 → UNKNOWN，不硬凑。
    const mismatch = readRuleThreshold({ key: "C13", expression: "Order.creditUsedRatio > 1", params: {} }, "Line.utilization", {});
    expect(mismatch.status).toBe("UNKNOWN");
  });

  it("超阈幅度 · 方向由规则的比较符决定（引擎不假设方向），未违规恒 0", () => {
    expect(breachAmount(121, 90, ">", true)).toBe(31); // idleDays > 90
    expect(breachAmount(80, 90, ">", true)).toBe(0);
    expect(breachAmount(100, 166768, "<", true)).toBe(166668); // parallelThroughput < required
    expect(breachAmount(200000, 166768, "<", true)).toBe(0);
    // 实测值写在右边的规则（threshold < metric）方向必须自动翻过来。
    expect(breachAmount(121, 90, "<", false)).toBe(31);
  });

  it("判据声明表 · 三类齐备，且 BREAK 必带 breakSubtype（contracts 硬约束的前置自检）", () => {
    const kinds = new Set(IMPEDIMENT_RULE_BINDINGS.map((b) => b.kind));
    expect(kinds).toEqual(new Set(["BOTTLENECK", "CONGESTION", "BREAK"]));
    for (const b of IMPEDIMENT_RULE_BINDINGS) {
      expect(b.kind === "BREAK" ? b.breakSubtype !== undefined : b.breakSubtype === undefined).toBe(true);
      expect(b.bindingId.length).toBeGreaterThan(0);
      expect(b.ruleKey).toMatch(/^C\d+$/); // 一律指向规则库真实存在的规则码，不虚构
    }
    // 判据 id 唯一（impedimentId 靠它拼，重了就会串条）。
    expect(new Set(IMPEDIMENT_RULE_BINDINGS.map((b) => b.bindingId)).size).toBe(IMPEDIMENT_RULE_BINDINGS.length);
  });
});
