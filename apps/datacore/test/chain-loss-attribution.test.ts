import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { ChainNodeSchema, LossAttributionSchema, isValueAddKind } from "@platform/contracts";
import { daysFromDrill, MINUTES_PER_DAY, type ChainLossEmpty, type ChainLossEvidence, type ChainLossResult } from "../src/solvers/chain-loss.js";
import { SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";

/**
 * WO-SANDBOX-E1 · 环节级损失归因 `chain_loss_attribution` 的门。
 *
 * ── 这个文件咬三件事（都在**效果层**，不是「函数被调用了/字段存在」的运输层）──
 *  ① **守恒（SEAM·命门）**：全链所有非增值环节的 `pctOfChainLoss` 之和 == 100 ±0.1，**增值段不进分母**。
 *     接缝在哪：数据半（种子里的 Operation/Process/Supplier/Customer 真字段）× 引擎半（S0 契约的
 *     `chainNonValueDays`/`computeLossAttribution`）。任一半漏 → 和不再是 100。
 *     本门另加一条**非空洞**断言：拿「含增值段」的错分母重算一遍，必须**明显偏离 100**（> 容差 0.1）——
 *     否则这条守恒测在本数据集上根本咬不住任何东西（数据里增值段太小 = 门无牙），得先修数据再谈通过。
 *  ② **溯源对拍（R13·效果层）**：拿 `evidence` 里的 `drillType.drillId.drillField` **回仓储把那个字段捞出来**，
 *     与 `drillValue` **逐位相等**；并且 `days === daysFromDrill(drillValue, drillUnit)`。
 *     病史：`gap_attribution` 曾标 `Order.value`（元）却回万元权重，**恰差 1e4**，用户看到的溯源数字小一万倍
 *     （`61a1d9f0` 已修）。所以本门不看「有没有 provenance 字段」，只看**标签所指字段的真值 == 回的值**。
 *     主键解析走已发布本体 `properties.find(isPrimaryKey)`（**不硬编码类型→PK 映射表**），新增下钻类型自动进门。
 *  ③ **诚实缺席**：本体无承载的段（清关 / 到货检验 / 返工工时 / 节拍 / 物料入厂在途）必须是 `EMPTY` + 原因；
 *     且**删掉承载对象 → 该段从「有值」变成 `EMPTY`，不是变成 0**（这条才真正证明没有静默兜底）。
 *
 * ── 变异反证（本单亲手跑过，原文见交付说明）──
 *  ① 把 `chain-loss.ts` 里的 `computeLossAttribution(steps)` 换成「用全链前置期（含增值段）当分母」的本地实现
 *     → 守恒用例真红（`Σ pct=98.33`，residual −1.67）。还原 → 绿。
 *  ② 把某条 evidence 的 `drillField` 与 `drillValue` 故意错配（标 `standardTime` 回 `setupTime`）
 *     → 溯源对拍用例真红（打印「标签写着 …standardTime，那个字段的真值是 30，溯源却回了 5」）。还原 → 绿。
 */

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const SOLVER_KEY = "chain_loss_attribution";

/** 守恒容差（百分点）——WO 判据写死 ±0.1；契约自带的 `LOSS_CONSERVATION_TOLERANCE_PCT` 更严（0.001），两条都断。 */
const WO_TOLERANCE_PCT = 0.1;

const run = (t: TestApp, args: Record<string, unknown> = {}) =>
  t.services.solvers.invoke(ADMIN, SOLVER_KEY, args) as unknown as Promise<ChainLossResult>;

/** 本体声明的主键属性（单一出处 = 已发布本体·非硬编码映射表）。 */
async function pkPropOf(t: TestApp, typeKey: string): Promise<string | undefined> {
  const ty = (await t.services.ontology.listTypes(ADMIN)).find((x) => x.key === typeKey);
  return ty?.properties.find((p) => p.isPrimaryKey)?.propKey;
}

/** 按 `drillType.drillId.drillField` 回仓储捞「标签所指字段」的真值。捞不到 → undefined（调用方必须判为失败）。 */
async function truthOf(t: TestApp, e: Pick<ChainLossEvidence, "drillType" | "drillId" | "drillField">): Promise<number | undefined> {
  const pk = await pkPropOf(t, e.drillType);
  if (!pk) return undefined;
  const rows = (await t.repos.objects.listByType(ADMIN.tenantId, e.drillType)).map((o) => o.props);
  const row = rows.find((r) => String(r[pk]) === e.drillId);
  const v = row?.[e.drillField];
  return typeof v === "number" ? v : undefined;
}

const nonValue = (r: ChainLossResult) => r.evidence.filter((e) => !e.valueAdd);
const emptyOf = (r: ChainLossResult, stepId: string): ChainLossEmpty | undefined => r.empty.find((e) => e.stepId === stepId);

describe("WO-SANDBOX-E1 · 环节级损失归因（chain_loss_attribution）", () => {
  // ════════════════════════════════════════════════════════════════════════
  // ① SEAM 守恒（命门）
  // ════════════════════════════════════════════════════════════════════════
  it("SEAM 守恒：全链非增值环节 pctOfChainLoss 之和 == 100 ±0.1，且增值段不进分母（错分母必须明显偏离 → 门有牙）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);

    // 非空洞前置：链上真有环节、真有增值段、真有非增值段——三者任缺一，这条守恒测就变成空转。
    expect(r.attribution.length, "归因表为空 = 门空转（不是通过）").toBeGreaterThan(0);
    expect(r.totals.valueAddDays, "链上必须真有增值段，否则「分母排除增值段」这条口径无从被证伪").toBeGreaterThan(0);
    expect(r.totals.nonValueDays, "链上必须真有非增值段").toBeGreaterThan(0);

    // 守恒本体：Σ pct == 100（WO 判据 ±0.1；契约容差 0.001 一并断）。
    const sum = r.attribution.reduce((a, x) => a + x.pctOfChainLoss, 0);
    expect(Math.abs(sum - 100), `Σ pctOfChainLoss = ${sum}，偏离 100 超过 ±${WO_TOLERANCE_PCT}`).toBeLessThanOrEqual(WO_TOLERANCE_PCT);
    expect(r.conservation.ok, `求解器自报守恒未通过：residual=${r.conservation.residual}`).toBe(true);
    expect(Math.abs(r.conservation.residual ?? Number.NaN)).toBeLessThanOrEqual(r.conservation.tolerancePct);

    // 分母口径：Σ nonValueDays === totals.nonValueDays === 全链前置期 − 增值天数（三者互相咬死）。
    const sumNv = r.attribution.reduce((a, x) => a + x.nonValueDays, 0);
    expect(sumNv).toBeCloseTo(r.totals.nonValueDays, 9);
    expect(r.totals.leadTimeDays).toBeCloseTo(r.totals.valueAddDays + r.totals.nonValueDays, 9);

    // 增值段**一个都不许**出现在归因表里（分母排除增值段的可观测后果）。
    const attributed = new Set(r.attribution.map((x) => x.stepId));
    const leakedValueAdd = r.evidence.filter((e) => e.valueAdd && attributed.has(e.stepId)).map((e) => e.stepId);
    expect(leakedValueAdd, "增值段泄漏进损失归因表 = 分母口径破了").toEqual([]);
    // 反向：每条非增值环节都必须在归因表里（少算一段 → 和仍是 100 但那段被吞了，此断言抓这种）。
    expect(new Set(nonValue(r).map((e) => e.stepId))).toEqual(attributed);

    // 门有牙自检：把增值段也塞进分母（= 用「全链前置期」当分母，正是 S0 §5 点名的错法）
    // → Σ 必须**明显**偏离 100，否则说明本数据集里增值段小到守恒测咬不住任何东西。
    const wrongSum = r.attribution.reduce((a, x) => a + (x.nonValueDays / r.totals.leadTimeDays) * 100, 0);
    expect(
      Math.abs(wrongSum - 100),
      `含增值段的错分母只让 Σ 变成 ${wrongSum}（偏离 ${Math.abs(wrongSum - 100)} < 容差 ${WO_TOLERANCE_PCT}）→ 这条守恒测在本数据集上无牙`,
    ).toBeGreaterThan(WO_TOLERANCE_PCT);
  });

  it("输出形状 = S0 冻结契约（nodes 过 ChainNodeSchema strict / attribution 过 LossAttributionSchema strict）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);
    expect(r.nodes.length).toBeGreaterThan(0);
    for (const n of r.nodes) expect(() => ChainNodeSchema.parse(n), `节点 ${n.nodeId} 不符合 S0 ChainNodeSchema`).not.toThrow();
    for (const a of r.attribution) expect(() => LossAttributionSchema.parse(a), `归因行 ${a.stepId} 不符合 S0 LossAttributionSchema`).not.toThrow();
    // `valueAdd` 硬绑 `isValueAddKind(kind)`（S0 schema 已锁，这里再从求解器侧断一次，防绕过 schema 直出）。
    for (const e of r.evidence) expect(e.valueAdd, `${e.stepId} 的 valueAdd 与 kind=${e.kind} 不一致`).toBe(isValueAddKind(e.kind));
    // 每个 step 必有且只有一条 evidence（有步没证据 = R13 断）。
    const stepIds = r.nodes.flatMap((n) => n.steps.map((s) => s.stepId)).sort();
    expect(r.evidence.map((e) => e.stepId).sort()).toEqual(stepIds);
    expect(r.totals.stepCount).toBe(stepIds.length);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ② 溯源对拍（R13·效果层）
  // ════════════════════════════════════════════════════════════════════════
  it("溯源对拍：每条 evidence 的 drillType.drillId.drillField 回仓储捞真值 == drillValue（逐位相等），且 days == 换算(drillValue)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);

    let checked = 0;
    for (const e of r.evidence) {
      const truth = await truthOf(t, e);
      expect(
        truth,
        `${e.stepId}：溯源标签指向 ${e.drillType}.${e.drillId}.${e.drillField}，但这个对象/字段在仓储里根本捞不到（下钻点不开 = 假溯源）`,
      ).not.toBeUndefined();
      checked++;
      // 头号判据：标签所指字段的真值 == 回的值（差任何倍数——尤其 1e4 这种单位差——即不通过）。
      expect(
        e.drillValue,
        `${e.stepId}：标签写着 ${e.drillType}.${e.drillId}.${e.drillField}，那个字段的真值是 ${truth}，溯源却回了 ${e.drillValue}`,
      ).toBe(truth);
      // 换算也必须机器可校：days 只能由 drillValue 按声明的单位换出来，不许是别处算的另一个数。
      expect(
        e.days,
        `${e.stepId}：days=${e.days} 不等于 ${e.drillValue} ${e.drillUnit} 的换算值 ${daysFromDrill(e.drillValue, e.drillUnit)}（${e.conversion}）`,
      ).toBe(daysFromDrill(e.drillValue, e.drillUnit));
      // 单位与换算文案必须自洽（防「文案说分钟、实际按天算」的第二种错标）。
      if (e.drillUnit === "min") expect(e.conversion).toContain(String(MINUTES_PER_DAY));
    }
    expect(checked, "0 条被真对拍 = 门空转").toBeGreaterThanOrEqual(20);

    // 逐条抽查（写死真值·换 seed/换数据即红）：本单亲手跑出来的锚点链。
    const byStep = new Map(r.evidence.map((e) => [e.stepId, e]));
    expect(r.anchor.so).toBe("SO-3391");
    expect(byStep.get("order.settlement_terms")).toMatchObject({ drillType: "Customer", drillId: "cust_0", drillField: "termDays", drillValue: 60, days: 60 });
    expect(byStep.get("capacity.op.OP-002#work")).toMatchObject({ drillType: "Operation", drillId: "RT-4680-NCM-V1.0-OP-002", drillField: "standardTime", drillValue: 120 });
    expect(byStep.get("capacity.op.OP-002#work")!.days).toBe(120 / MINUTES_PER_DAY);
    expect(byStep.get("material.supplier_leadtime")).toMatchObject({ drillType: "Supplier", drillId: "SUP-001", drillField: "leadTime", drillValue: 5, days: 5 });
    expect(byStep.get("capacity.aging#dwell")).toMatchObject({ drillType: "Process", drillField: "agingDays", drillValue: 5, days: 5 });
  });

  it("溯源对拍（接缝驱动）：改仓储里的颗粒 → drillValue 与 days 与该环节的 pctOfChainLoss 一起变，且再次逐位相等、Σ 仍 == 100", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    const beforeEv = before.evidence.find((e) => e.stepId === "material.supplier_leadtime")!;
    const beforePct = before.attribution.find((a) => a.stepId === "material.supplier_leadtime")!.pctOfChainLoss;

    // 只动**数据半**（把供应商交期 5 天改成 25 天），一个字的引擎代码都不动。
    const sup = (await t.repos.objects.listByType(ADMIN.tenantId, "Supplier")).find((o) => String(o.props.supplierId) === beforeEv.drillId)!;
    await t.repos.objects.put({ ...sup, props: { ...sup.props, leadTime: 25 } });

    const after = await run(t);
    const afterEv = after.evidence.find((e) => e.stepId === "material.supplier_leadtime")!;
    const afterPct = after.attribution.find((a) => a.stepId === "material.supplier_leadtime")!.pctOfChainLoss;

    expect(afterEv.drillValue, "改了 Supplier.leadTime，溯源回的值必须跟着变（不变 = 溯源是渲染写死的）").toBe(25);
    expect(afterEv.drillValue).toBe(await truthOf(t, afterEv)); // 再次与仓储真值逐位对拍
    expect(afterEv.days).toBe(25);
    expect(afterPct, "该环节占损失的比必须真的上升").toBeGreaterThan(beforePct);
    // 守恒必须仍然成立（只有一个环节的百分比变了而总和不再是 100 = 分母算错了）。
    const sum = after.attribution.reduce((a, x) => a + x.pctOfChainLoss, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(WO_TOLERANCE_PCT);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ③ 诚实缺席
  // ════════════════════════════════════════════════════════════════════════
  it("诚实缺席（本体无承载）：清关 / 到货检验 / 返工 / 两处节拍 / 物料入厂在途 一律 EMPTY + 原因 + 取证，且不出现在链上", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);

    const MUST_BE_EMPTY = ["material.customs", "material.iqc", "chain.rework", "demand.sop_cadence", "order.review_cadence", "material.in_transit"];
    for (const stepId of MUST_BE_EMPTY) {
      const e = emptyOf(r, stepId);
      expect(e, `${stepId} 必须诚实标 EMPTY（今天本体里没有承载物）`).toBeDefined();
      expect(e!.dataMode).toBe("EMPTY");
      expect(e!.emptyKind).toBe("NO_CARRIER");
      expect(e!.reason.length, `${stepId} 的 EMPTY 必须说明缺什么（只标 EMPTY 不说原因 = 半个诚实）`).toBeGreaterThan(10);
      expect(e!.probe.length, `${stepId} 的 EMPTY 必须写明取证方式（下一个人要能复核）`).toBeGreaterThan(10);
    }
    // 关键：这些位置**不许**在链上冒出一个 0 天的环节来（那正是「补 0」的样子）。
    const chainStepIds = new Set(r.nodes.flatMap((n) => n.steps.map((s) => s.stepId)));
    for (const stepId of MUST_BE_EMPTY) expect(chainStepIds.has(stepId), `${stepId} 既标了 EMPTY 又出现在链上 = 自相矛盾`).toBe(false);
    for (const stepId of MUST_BE_EMPTY) expect(r.attribution.some((a) => a.stepId === stepId), `${stepId} 不该出现在归因表里`).toBe(false);

    // 全链**没有** 0 天环节：本仓「静默兜底」的典型长相就是缺数据时塞一个 0 进去装作算过。
    const zeros = r.nodes.flatMap((n) => n.steps).filter((s) => s.days === 0).map((s) => s.stepId);
    expect(zeros, "出现 0 天环节：要么是真 0（那也该说清楚），要么是缺数据补 0（静默兜底）").toEqual([]);
  });

  it("诚实缺席（承载对象被删）：删掉锚点客户 → 账期段从「60 天」变成 EMPTY(NO_INSTANCE)，不是变成 0；Σ 仍 == 100", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t);
    expect(before.evidence.some((e) => e.stepId === "order.settlement_terms"), "前置：账期段本来有值").toBe(true);
    expect(before.empty.some((e) => e.stepId === "order.settlement_terms")).toBe(false);

    // 删掉锚点订单对应的那个客户对象（模拟「数据没上来」）。
    const custId = before.anchor.customerId!;
    const removed = await t.repos.objects.removeWhere(ADMIN.tenantId, (o) => o.type === "Customer" && String(o.props.custId) === custId);
    expect(removed, "前置：确实删掉了 1 个 Customer").toBe(1);

    const after = await run(t);
    const gap = emptyOf(after, "order.settlement_terms");
    expect(gap, "承载对象没了 → 该环节必须诚实标 EMPTY").toBeDefined();
    expect(gap!.emptyKind, "对象存在于本体、只是这条链上取不到 → NO_INSTANCE（与 NO_CARRIER 修法不同，不许混为一谈）").toBe("NO_INSTANCE");
    expect(after.evidence.some((e) => e.stepId === "order.settlement_terms"), "不许还留着一条证据行").toBe(false);
    expect(after.nodes.flatMap((n) => n.steps).some((s) => s.stepId === "order.settlement_terms"), "不许在链上留一个 0 天的账期段").toBe(false);
    expect(after.anchor.customerId).toBeNull();

    // 剩下的环节仍然守恒（分母跟着缩小，不是留着 60 天的洞）。
    const sum = after.attribution.reduce((a, x) => a + x.pctOfChainLoss, 0);
    expect(Math.abs(sum - 100), `删了一段之后 Σ=${sum}`).toBeLessThanOrEqual(WO_TOLERANCE_PCT);
    expect(after.totals.nonValueDays).toBeCloseTo(before.totals.nonValueDays - 60, 9);
    // 且损失结构真的重排（账期本来占 85%，删掉后老化/供应商交期升到 Top）。
    const top = [...after.attribution].sort((a, b) => b.pctOfChainLoss - a.pctOfChainLoss)[0]!;
    expect(top.stepId).not.toBe("order.settlement_terms");
    expect(top.pctOfChainLoss).toBeGreaterThan(40);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ④ R6 确定性 + 注册/金值
  // ════════════════════════════════════════════════════════════════════════
  it("R6 确定性：同 (seed=42, 场景, 参数版本) 两跑字节一致；显式 args.so 与缺省锚点一致", async () => {
    const t = await makeApp();
    await seedBattery(t, 42);
    const a = await run(t);
    const b = await run(t);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // 锚点选取是字典序而非「碰巧第一条」：显式点名同一张单，结果必须逐字节相同。
    const c = await run(t, { so: a.anchor.so });
    expect(JSON.stringify({ ...c, anchor: { ...c.anchor, selection: "" } })).toBe(JSON.stringify({ ...a, anchor: { ...a.anchor, selection: "" } }));
  });

  it("注册即更：SOLVER_KEYS / 目录 / 输出形状 三处登记齐（漏一处即前端或 Agent 侧断线）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((SOLVER_KEYS as readonly string[]).includes(SOLVER_KEY), "未进 SOLVER_KEYS → invoke 走沙箱路径").toBe(true);
    expect(ALL_SOLVER_CATALOG.some((c) => c.key === SOLVER_KEY), "未进目录 → catalog.test 的注册表 parity 会红").toBe(true);
    const shape = SOLVER_OUTPUT_SHAPES[SOLVER_KEY];
    expect(shape?.length ?? 0, "未声明输出形状 → chain:check R11-SHAPE 门红").toBeGreaterThan(0);
    // 形状不是抄的：必须与求解器真实返回的顶层 key 完全一致（声明漂移 = 渲染契约失效）。
    const r = (await run(t)) as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual([...shape!].sort());
    // 注册表（REST）也要能看见它，且带描述。
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: { "x-debug-user": "demo:admin:admin" } })).json() as {
      solvers: { key: string; description: string }[];
    };
    const hit = reg.solvers.find((s) => s.key === SOLVER_KEY);
    expect(hit, "注册表 REST 看不见 → Agent 侧发现不到").toBeDefined();
    expect(hit!.description.trim().length).toBeGreaterThan(0);
  });

  it("锚点不存在 → 诚实报错（不静默回落到别的订单）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await expect(run(t, { so: "SO-NOT-EXIST" })).rejects.toThrow();
  });
});
