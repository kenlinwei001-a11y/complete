import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { ChainImpedimentSchema, ruleParamRef, type ChainImpediment } from "@platform/contracts";
import {
  IMPEDIMENT_RULE_BINDINGS,
  arbitrateByLocus,
  breachAmount,
  readRuleThreshold,
  type ImpedimentCandidate,
} from "../src/solvers/chain-impediment.js";

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

  it("R-ARG-FIDELITY · scope.baseIds 真过滤；businessTypes/modelIds 显式拒绝而不是静默返全域", async () => {
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

    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/chain_impediments/invoke",
      headers: ADMIN,
      payload: { args: { scope: { businessTypes: ["storage"] } } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("R-ARG-FIDELITY");
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
