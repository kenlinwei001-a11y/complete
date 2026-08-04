import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-PROV-DRILLFIELD（欠账 #96）· R13「结论可溯源」效果层门：
 * **provenance 标签所指字段的真值 == 溯源里回的 drillValue**。
 *
 * ── 病灶取证（本单亲手跑出来的真数字·seed=42·scale=S·`test/prov-drillfield-truth.test.ts` 前身探针）──
 *   `SO-3391`：qty=7259 套 × unitPrice=21626 元/套 → 本体派生属性 `Order.value = 156983134`（**元**）
 *   旧 `provenance.drillValue = orderVal(o) = 15698.31`（**万元**）—— 恰差 1e4。
 *   前端 `components/ProvenanceDag.tsx:105` 的 evidence 叶照标签渲染
 *   `label = ${drillType}.${drillField}` / `value = drillValue` → 用户看到「Order.value = 15698.31」，
 *   `views/DashboardView.tsx:323` 同理渲染「下钻 Order.SO-3391.value = 15698.31」——**比真值小一万倍**。
 *   全局路 9 个订单叶 + 敞口路（xiamen/zaozhuang/zigong/jinhua）逐叶皆错，比值 9999.99~10000.01
 *   （不是整 1e4，因为旧值先 `round(…/1e4, 2)` 了 → 所以修法**不能**拿 `drillValue*1e4` 反推）。
 *   同一棵树里其余 7 类下钻（MaterialBalance.gapTon / DecisionGap.severity / ExternalSignal.value /
 *   BackupSupplierPool.certWeeks·memberCount / CommodityPriceTrend.pctChange / LongTermAgreement.actualDeliveredTon /
 *   Supplier.actualSupplyTon）**全部 MATCH** —— `Order.value` 是这棵树里**唯一**的口径错标。
 *
 * ── 本门为什么不是运输层 ──
 *   不检查「有没有 provenance 字段 / drillValue 是不是 number」（那是 gap-attribution.test.ts C4 已有的运输层），
 *   而是**拿 drillType/drillId/drillField 去仓储里把那个对象那个字段的真值捞出来，逐叶对拍 drillValue**。
 *   解析主键走本体 `properties.find(isPrimaryKey)`（非硬编码类型→PK 映射表），所以新增下钻类型自动进门。
 *   并额外覆盖**前端显示这一跳**：按 ProvenanceDag / DashboardView 的渲染式拼串，断言用户眼前那个数 == DB 真值。
 */

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

/** 元口径隔离带：万元值约 1.5e4 量级，真 `Order.value` 约 5e7~3e8 量级；掉进 1e6 以下 = 又把归因权重当字段真值。 */
const YUAN_BAND_MIN = 1e6;

type Prov = { kind?: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number };
type Node = { id: string; factor?: string; share?: number; contribution?: number; provenance?: Prov };
type GA = {
  levels: { depth: number; nodes: Node[] }[];
  atomicLeaves: Node[];
  reconciled: boolean;
  residualPct: number;
  scope?: Record<string, unknown>;
};

const run = (t: TestApp, args: Record<string, unknown>) =>
  t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_ess", ...args }) as unknown as Promise<GA>;

const allNodes = (ga: GA): Node[] => [...(ga.levels ?? []).flatMap((L) => L.nodes ?? []), ...(ga.atomicLeaves ?? [])];

/** 本体声明的主键属性（单一出处 = 已发布本体·非硬编码映射表）。 */
async function pkPropOf(t: TestApp, typeKey: string): Promise<string | undefined> {
  const ty = (await t.services.ontology.listTypes(ADMIN)).find((x) => x.key === typeKey);
  return ty?.properties.find((p) => p.isPrimaryKey)?.propKey;
}

/** 按 provenance 三元组去仓储捞「标签所指字段」的真值；对象不存在（聚合节点）→ undefined。 */
async function truthOf(t: TestApp, pv: Prov): Promise<number | undefined> {
  if (!pv.drillType || !pv.drillId || !pv.drillField) return undefined;
  const pk = await pkPropOf(t, pv.drillType);
  if (!pk) return undefined;
  const rows = (await t.repos.objects.listByType(ADMIN.tenantId, pv.drillType)).map((o) => o.props);
  const row = rows.find((r) => String(r[pk]) === String(pv.drillId));
  const v = row?.[pv.drillField];
  return typeof v === "number" ? v : undefined;
}

/**
 * 逐叶对拍：凡 (drillType, drillId) 能解析到真对象、且该字段是数值 → drillValue 必须 === 真值。
 * 返回命中条数，供调用方做**非空洞**断言（0 命中 = 门空转，必须红）。
 */
async function assertProvenanceTellsTruth(t: TestApp, ga: GA, tag: string): Promise<{ checked: number; orderValue: number }> {
  let checked = 0;
  let orderValue = 0;
  for (const n of allNodes(ga)) {
    const pv = n.provenance;
    if (!pv?.drillType) continue;
    const truth = await truthOf(t, pv);
    if (truth === undefined) continue; // 聚合节点（drillId=基地键·非该类型主键）→ 本门不判，已在交接单上报
    checked++;
    expect(
      pv.drillValue,
      `${tag} ${n.id}：标签写着 ${pv.drillType}.${pv.drillId}.${pv.drillField}，那个字段的真值是 ${truth}，溯源却回了 ${pv.drillValue}`,
    ).toBe(truth);
    if (pv.drillType === "Order" && pv.drillField === "value") {
      orderValue++;
      expect(
        pv.drillValue,
        `${tag} ${n.id}：Order.value 单位是元（qty×unitPrice），drillValue=${pv.drillValue} 掉进万元带 = 又把归因权重当字段真值`,
      ).toBeGreaterThan(YUAN_BAND_MIN);
    }
  }
  return { checked, orderValue };
}

describe("WO-PROV-DRILLFIELD · gap_attribution provenance 口径真值门（R13·标签所指字段真值 == 回的值）", () => {
  it("口径锚（数据半）：`Order.value` = qty×unitPrice = **元**，与万元归因权重 orderVal 恰差 1e4", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = (await t.repos.objects.listByType(ADMIN.tenantId, "Order")).map((o) => o.props);
    expect(orders.length).toBeGreaterThan(0);
    // 派生属性真的物化了（battery.ts `orderDerived: value = qty*unitPrice` → synthetic/service.ts:222 runDerivations）。
    const missing = orders.filter((o) => typeof o.value !== "number");
    expect(missing.map((o) => String(o.so)), "每张 Order 都应物化 value（缺 = 派生管线没跑·本门失去对拍基准）").toEqual([]);
    for (const o of orders) {
      expect(o.value, `Order.${String(o.so)}.value 必须 == qty×unitPrice`).toBe(Number(o.qty) * Number(o.unitPrice));
      expect(Number(o.value), "Order.value 必须落在元带（掉到万元带即口径被改）").toBeGreaterThan(YUAN_BAND_MIN);
    }
    // 取证记录：SO-3391 qty=7259 × 21626 = 156983134 元；万元权重 15698.31 —— 比值 1e4。
    const so3391 = orders.find((o) => String(o.so) === "SO-3391")!;
    expect(so3391, "取证锚订单 SO-3391 应在种子里").toBeTruthy();
    const wan = Math.round((Number(so3391.qty) * Number(so3391.unitPrice)) / 1e4 * 100) / 100;
    expect(Number(so3391.value) / wan).toBeGreaterThan(9990);
    expect(Number(so3391.value) / wan).toBeLessThan(10010);
  });

  it("效果层①（全局路）：每个可解析下钻叶的 drillValue == 该对象该字段真值（订单叶 ≥5·非空洞）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ga = await run(t, {});
    const { checked, orderValue } = await assertProvenanceTellsTruth(t, ga, "global");
    expect(orderValue, "全局路必须有订单叶被真对拍（0 = 门空转）").toBeGreaterThanOrEqual(5);
    expect(checked, "可解析下钻节点总数（订单/物料/因果链）").toBeGreaterThanOrEqual(10);
    // 归因数值面不受影响（drillValue 只作展示·勾稽/残差不动）。
    expect(ga.reconciled).toBe(true);
    expect(ga.residualPct).toBeLessThan(15);
  });

  it("效果层②（基地作用域路 + 敞口路）：scoped/exposure 两条支路逐叶同样对拍真值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // hefei = OPEN 订单首基地（走 scoped 复用全局子树支路）；xiamen 从不当首基地（走 exposure 敞口支路）。
    const scoped = await run(t, { scope: { baseId: "hefei" } });
    const r1 = await assertProvenanceTellsTruth(t, scoped, "scope:hefei");
    expect(r1.orderValue, "hefei 专属树应含订单叶").toBeGreaterThanOrEqual(1);

    const exposure = await run(t, { scope: { baseId: "xiamen" } });
    expect(exposure.scope?.exposure, "xiamen 应走敞口支路（非首基地）").toBe(true);
    const r2 = await assertProvenanceTellsTruth(t, exposure, "scope:xiamen(exposure)");
    expect(r2.orderValue, "xiamen 敞口树应含订单叶").toBeGreaterThanOrEqual(2);
  });

  it("效果层③（前端显示这一跳）：ProvenanceDag / DashboardView 渲染出的那个数 == DB 里 Order.value 真值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ga = await run(t, {});
    const orderLeaves = (ga.atomicLeaves ?? []).filter((l) => l.provenance?.drillType === "Order" && l.provenance?.drillField === "value");
    expect(orderLeaves.length).toBeGreaterThanOrEqual(5);
    for (const leaf of orderLeaves) {
      const pv = leaf.provenance!;
      const truth = await truthOf(t, pv);
      expect(truth, `${leaf.id} 的下钻对象应真实存在`).toBeTypeOf("number");
      // ① ProvenanceDag.tsx:105 evidence 叶投影（label = `${drillType}.${drillField}`，value = drillValue）。
      const evidenceLabel = `${pv.drillType}.${pv.drillField ?? ""}`;
      const evidenceValue = pv.drillValue;
      expect(evidenceLabel).toBe("Order.value");
      expect(evidenceValue, `前端 evidence 叶「${evidenceLabel}」显示 ${evidenceValue}，DB 真值却是 ${truth}`).toBe(truth);
      // ② ProvenanceDag.tsx:242 drillPath（弹窗"数据源"）+ 299-303（弹窗"当前值"）。
      const drillPath = [pv.drillType, pv.drillId, pv.drillField].filter(Boolean).join(".");
      expect(drillPath).toBe(`Order.${pv.drillId}.value`);
      // ③ DashboardView.tsx:323 双向归因叶表串。
      const dashboardLine = `下钻 ${pv.drillType}.${pv.drillId}.${pv.drillField} = ${pv.drillValue}`;
      expect(dashboardLine).toBe(`下钻 Order.${pv.drillId}.value = ${truth}`);
      // 反证：用户眼前那串里绝不能出现万元数（旧病灶就是它）。
      const wan = Math.round(Number(truth) / 1e4 * 100) / 100;
      expect(dashboardLine.includes(String(wan)), `前端串里出现万元值 ${wan} = 口径错标复发`).toBe(false);
    }
  });

  it("接缝（数据半×引擎半）：改订单颗粒 → 重跑派生 → drillValue 跟着 `Order.value` 一起变，且再次逐叶相等", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await run(t, {});
    const leaf0 = (before.atomicLeaves ?? []).find((l) => l.provenance?.drillType === "Order" && l.provenance?.drillField === "value")!;
    expect(leaf0).toBeTruthy();
    const so = String(leaf0.provenance!.drillId);
    const objId = `obj_order_${so}`;
    const cur = await t.repos.objects.get(ADMIN.tenantId, objId);
    expect(cur, `${objId} 应存在`).toBeTruthy();

    // 数据半：改真颗粒（qty ×3）→ 走本体派生管线重算 `Order.value`（非手改派生值）。
    await t.repos.objects.put({ ...cur!, props: { ...cur!.props, qty: Number(cur!.props.qty) * 3 } });
    await t.services.ontology.runDerivations(ADMIN);
    const dbAfter = (await t.repos.objects.get(ADMIN.tenantId, objId))!.props;
    expect(Number(dbAfter.value)).toBe(Number(cur!.props.value) * 3);

    // 引擎半：溯源必须跟着真值走（既不冻住旧数、也不回一个差 1e4 的数）。
    const after = await run(t, {});
    const leaf1 = (after.atomicLeaves ?? []).find((l) => l.id === leaf0.id)!;
    expect(leaf1, "同一订单叶应仍在").toBeTruthy();
    expect(leaf1.provenance!.drillValue, "改颗粒后 drillValue 必须变（不变 = 写死作假）").not.toBe(leaf0.provenance!.drillValue);
    expect(leaf1.provenance!.drillValue, "改颗粒重跑派生后，drillValue 必须仍 == DB `Order.value`").toBe(Number(dbAfter.value));
    await assertProvenanceTellsTruth(t, after, "after-mutation");
  });

  it("R6 确定性：两跑 gap_attribution 字节一致（本单只改展示口径·不引入非确定性）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t, {});
    const b = await run(t, {});
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
