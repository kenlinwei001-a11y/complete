import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, invokeSolver, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { riskTimeline } from "../src/solvers/risk.js";
import { capacityForecast } from "../src/solvers/capacity.js";

/**
 * WO-DATAMODE-UNIFY-PROVENANCE（P0·三症同根·违铁律 0.4 的合成冒充 LIVE）· RUNTIME 真链 teeth。
 *
 * 根因：demo 决策对象是 **MATERIALIZED-from-synthetic**（B 路建模链从 config.synthetic===true 连接物化——
 * provenance 因果真实但底仍是合成源）。旧判据只看 origin.type==="SYNTHETIC" → 漏这一类 → 误标 LIVE/实测。
 *
 * ⚠ 实现遵**已裁决方案**（docs/work-queue.json reviewerRuling·commit ad60266·用户钉死），**非** WO note 里
 * dev4 探路的「下沉 isSyntheticDecision 到 lt.source」——后者被裁决判为**错层**（污染 measurement 维·破 6 测
 * CAP-01 C1 + solvers V5/V5d + FRESHNESS①/①b）。裁决模型：dataMode 是**两正交维**——
 *   ① provenance（合成种子·isSyntheticDecision/synthDatasetIds）
 *   ② measurement-liveness（读真 OEE/util/真供需即 LIVE·即便合成种子）
 * 决策级染红 = provenance(非合成) AND measurement(真实测) 双维。**不动 measurement 维**（liveTightness.source/live·
 * card.dataMode 保持读真值即 LIVE·CAP-01『DemandSegment=LIVE』保留）。
 *
 * 后端职责（本 WO·backend lane）三处：
 *   ① nodeObjectMode（deriveCellMode·app.ts）= provenance 徽标 → 合成物化 **改标 SYNTHETIC**（backend gate·headline）。
 *   ②③ risk 卡 / capacity 行 = 加性透出 **provenanceSynthetic** 位（不改 dataMode/live）供前端 cardDecisionMode（Dev-3）
 *      落 provenance∧measurement 双维决策红——demo 合成世界不冒充决策红。
 * 唯一真相谓词 SolverService.buildSynthProvenancePredicate（isSyntheticDecision 内联判据抽出·三处复用）。
 *
 * 本套是 RUNTIME 真链 teeth（静态 gate/fixture 漏此运行时 bug——fixture 直设干净 origin=SYNTHETIC；真 demo 链
 * 产 origin=MATERIALIZED 且 datasetId∈合成集）：真起 app（makeApp+inject）·真跑 SEED_DEMO 的 viaModelingChain 建模链·
 * 真数据·真读结果。LLM 一律 mock（DC_COMPREHEND_DETERMINISTIC=1）。
 */

/** 真起 SEED_DEMO 的合成-物化链：viaModelingChain=true → 对象 origin=MATERIALIZED（datasetId∈合成源数据集）。 */
const chainSeeded = async (): Promise<TestApp> => {
  const t = await makeApp();
  await t.services.synthetic.runJob(t.adminCtx, {
    industry: "battery-manufacturing",
    scale: "S",
    seed: 42,
    viaModelingChain: true,
  } as Parameters<typeof t.services.synthetic.runJob>[1]);
  await seedDemoPropagationRules(t.repos);
  return t;
};

const setFeatures = (t: TestApp, overrides: Record<string, boolean>) =>
  t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides } });

const enableSim = (t: TestApp, extra: Record<string, boolean> = {}) =>
  setFeatures(t, { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true, "sim.trust_badge": true, ...extra });

type ViewCfg = {
  nodeObjectState: Record<string, Record<string, number>>;
  nodeObjectMode?: Record<string, Record<string, string>>;
};
const getViewCfg = async (t: TestApp): Promise<ViewCfg> =>
  (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as ViewCfg;

/** deriveCellMode 的 C09 关键源滞后位（同源判据·staleHours 默认 2），决定真对象是 LIVE 还是 STALE。 */
const criticalStaleOf = async (t: TestApp): Promise<boolean> => {
  const params = await t.services.solvers.getParams("demo");
  const staleHours = params.health?.staleHours ?? 2;
  const health = await t.repos.objects.listByType("demo", "DataSourceHealth");
  return health.some((h) => h.props.critical === true && typeof h.props.lagHours === "number" && (h.props.lagHours as number) > staleHours);
};

describe("WO-DATAMODE-UNIFY-PROVENANCE · 真链 RUNTIME teeth（两正交维·合成物化不冒充 LIVE/实测）", () => {
  it("齿①（headline·backend gate）: demo view-config.nodeObjectMode 全 SYNTHETIC（非 LIVE）+ red-bite（revert origin.type-only → LIVE）", async () => {
    const t = await chainSeeded();
    await enableSim(t);
    const cfg = await getViewCfg(t);
    expect(cfg.nodeObjectMode).toBeDefined();
    const cells = Object.values(cfg.nodeObjectMode!).flatMap((r) => Object.values(r));
    expect(cells.length).toBeGreaterThan(0);
    // 修复后：每格 SYNTHETIC，零 LIVE（provenance 徽标诚实标合成物化·不冒充实测）。此前 TRUST-BADGE-BE FDE 误报 102/102 LIVE。
    expect(cells.every((m) => m === "SYNTHETIC")).toBe(true);
    expect(cells.includes("LIVE")).toBe(false);

    // 逐格必对应 nodeObjectState 真数值格（透传·非凭空造位）。
    for (const [objId, row] of Object.entries(cfg.nodeObjectMode!)) {
      for (const sv of Object.keys(row)) expect(typeof cfg.nodeObjectState[objId]?.[sv]).toBe("number");
    }

    // 证真链：贡献格的对象 origin 全是 MATERIALIZED（datasetId∈合成源）——正是旧 origin.type-only 判据漏的一类。
    const objIds = Object.keys(cfg.nodeObjectMode!);
    for (const id of objIds) {
      const o = await t.repos.objects.get("demo", id);
      expect(o!.origin.type).toBe("MATERIALIZED");
      expect((o!.origin as { datasetId?: string }).datasetId).toBeTruthy();
    }

    // RED-BITE：复算旧 deriveCellMode 判据（origin.type==="SYNTHETIC" ? SYNTHETIC : criticalStale ? STALE : LIVE）——
    // 对这些 MATERIALIZED 对象 origin.type!=="SYNTHETIC" → 旧判据 **绝不 SYNTHETIC**（新鲜 → LIVE），即 revert 后同批格
    // 从 SYNTHETIC 翻回 LIVE（合成冒充 LIVE·bug 咬住）。
    const criticalStale = await criticalStaleOf(t);
    const oldMode = (originType: string): string => (originType === "SYNTHETIC" ? "SYNTHETIC" : criticalStale ? "STALE" : "LIVE");
    const oldModes: string[] = [];
    for (const id of objIds) {
      const o = await t.repos.objects.get("demo", id);
      oldModes.push(oldMode(String(o!.origin.type)));
    }
    expect(oldModes.filter((m) => m === "SYNTHETIC").length).toBe(0); // 旧判据把合成血缘全丢
    if (!criticalStale) expect(oldModes.every((m) => m === "LIVE")).toBe(true); // 新鲜时 → 全 LIVE（headline 描述之红）
  });

  it("齿②（risk·两正交维）: card.dataMode 保持 LIVE（measurement 不回归）+ provenanceSynthetic=true + 顶层 confidence.synthetic=true（+red-bite）", async () => {
    const t = await chainSeeded();
    // qos.risk_realdemand ON → 需求驱动因素走真供需 demandCapacityTightness（measurement=LIVE·CAP-01 语义保留）。
    await enableSim(t, { "view.risk-board": true, "qos.risk_realdemand": true });

    const res = await invokeSolver(t, "risk_timeline", {});
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { dataMode: string; confidence: { synthetic: boolean }; cards: { dataMode?: string; provenanceSynthetic?: boolean; hasData?: boolean }[] } }).data;
    const dataCards = data.cards.filter((c) => c.hasData !== false);
    expect(dataCards.length).toBeGreaterThan(0);
    // provenance 维：顶层 confidence.synthetic=true + 每卡 provenanceSynthetic=true（demo 合成世界·前端据此双维 gate 静音决策红）。
    expect(data.dataMode).toBe("SYNTHETIC"); // 头条取最审慎（provenance 维·合成优先）
    expect(data.confidence.synthetic).toBe(true);
    expect(dataCards.every((c) => c.provenanceSynthetic === true)).toBe(true);
    // measurement 维不回归：读真供需的卡 dataMode 仍 LIVE（真值出真张力·CAP-01/V5/V5d 语义保留·非冒充——decision-red 由前端双维 gate 收窄）。
    expect(dataCards.some((c) => c.dataMode === "LIVE")).toBe(true);

    // RED-BITE（unit·同真链数据）：唯一真相谓词供给 provenanceSynthetic——去谓词（旧后端）→ provenanceSynthetic 全 false
    // → 前端只剩 card.dataMode===LIVE → 决策级染红（bug）。带谓词 → 全 true → 前端可静音。证「缺的正是 provenance 维信号」。
    const ctx = await t.services.solvers.loadContext("demo", undefined, { withExtended: false });
    expect(ctx.isSynthProvenance).toBeDefined();
    const cardsWith = (riskTimeline(ctx, {}) as { cards: { provenanceSynthetic?: boolean; hasData?: boolean }[] }).cards.filter((c) => c.hasData !== false);
    const cardsWithout = (riskTimeline({ ...ctx, isSynthProvenance: undefined }, {}) as { cards: { provenanceSynthetic?: boolean; hasData?: boolean }[] }).cards.filter((c) => c.hasData !== false);
    expect(cardsWith.every((c) => c.provenanceSynthetic === true)).toBe(true);
    expect(cardsWithout.every((c) => c.provenanceSynthetic === false)).toBe(true); // 去谓词=旧后端缺 provenance 维 → 前端会误染红
  });

  it("齿③（capacity·两正交维）: perBaseRows provenanceSynthetic=true + 顶层 confidence.synthetic=true（live 保持 measurement·+red-bite）", async () => {
    const t = await chainSeeded();
    const ctx = await t.services.solvers.loadContext("demo", undefined, { withExtended: false });
    const modelId = [...ctx.certByModel.keys()][0];
    expect(modelId).toBeTruthy();

    const res = await invokeSolver(t, "capacity_forecast", { modelId, qty: 40, weeks: 6 });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { dataMode: string; confidence: { synthetic: boolean }; perBaseRows: { live: boolean; provenanceSynthetic?: boolean }[] } }).data;
    expect(data.perBaseRows.length).toBeGreaterThan(0);
    expect(data.confidence.synthetic).toBe(true); // provenance 维（跨求解器一致）
    expect(data.perBaseRows.every((r) => r.provenanceSynthetic === true)).toBe(true); // 逐行 provenance 位（demo 合成物化）

    // RED-BITE（unit）：去谓词（旧后端）→ 逐行 provenanceSynthetic 全 false → 前端只剩 live（measurement）→ 合成行冒充实测决策红。
    const rowsWith = (capacityForecast(ctx, { modelId, qty: 40, weeks: 6 }) as { perBaseRows: { provenanceSynthetic?: boolean }[] }).perBaseRows;
    const rowsWithout = (capacityForecast({ ...ctx, isSynthProvenance: undefined }, { modelId, qty: 40, weeks: 6 }) as { perBaseRows: { provenanceSynthetic?: boolean }[] }).perBaseRows;
    expect(rowsWith.every((r) => r.provenanceSynthetic === true)).toBe(true);
    expect(rowsWithout.every((r) => r.provenanceSynthetic === false)).toBe(true);
  });

  it("齿④（honest inverse·非过度纠偏）: 真接入对象（MATERIALIZED·datasetId∉合成集）→ nodeObjectMode 保持 LIVE + provenanceSynthetic=false", async () => {
    const t = await chainSeeded();
    await enableSim(t);
    const before = await getViewCfg(t);
    const objId = Object.keys(before.nodeObjectMode!)[0]!;
    expect(Object.values(before.nodeObjectMode![objId]!).every((m) => m === "SYNTHETIC")).toBe(true);

    // 翻成真实导入血缘：MATERIALIZED 但 datasetId 指向**非合成源**数据集（真 ERP/MES 导入·datasetId∉synthDatasetIds）。
    const o = await t.repos.objects.get("demo", objId);
    await t.repos.objects.put({ ...o!, origin: { type: "MATERIALIZED", datasetId: "ds_realco_imported_not_synth" } });

    const after = await getViewCfg(t);
    const cells = Object.values(after.nodeObjectMode![objId]!);
    expect(cells.length).toBeGreaterThan(0);
    const criticalStale = await criticalStaleOf(t);
    const expected = criticalStale ? "STALE" : "LIVE"; // 真接入 → LIVE（叠关键源滞后才 STALE）·绝非 SYNTHETIC
    expect(cells.every((m) => m === expected)).toBe(true); // 证：非"全盘 SYNTHETIC 锤"（真对象照常 LIVE）
    // 其余合成物化对象仍 SYNTHETIC（逐对象独立派生·未污染）。
    const others = Object.entries(after.nodeObjectMode!).filter(([id]) => id !== objId).flatMap(([, r]) => Object.values(r));
    expect(others.every((m) => m === "SYNTHETIC")).toBe(true);

    // 谓词逐对象诚实：真导入对象 → isSynthProvenance false（合成物化对象 → true）。
    const pred = await t.services.solvers.buildSynthProvenancePredicate("demo");
    const realObj = await t.repos.objects.get("demo", objId);
    expect(pred(realObj!)).toBe(false); // datasetId∉合成集 → 非合成（非过度纠偏）
  });

  it("齿⑤ R6 确定性：同输入双跑 view-config.nodeObjectMode 逐位字节一致", async () => {
    const t = await chainSeeded();
    await enableSim(t);
    const a = await getViewCfg(t);
    const b = await getViewCfg(t);
    expect(a.nodeObjectMode).toEqual(b.nodeObjectMode);
  });
});
