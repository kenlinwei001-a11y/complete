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

/**
 * ═══ WO-R13-DRILLFIELD（欠账 #96 复验加固）· 溯源口径**通用**判据 ═══
 *
 * ── 为什么上面那套还不够（本单实测出来的洞，不是推测）──
 *   上面的 `assertProvenanceTellsTruth` 遇到解析不出真值的节点就 `continue` **静默跳过**，
 *   于是它只咬得住「**取值**取错了」，咬不住「**字段名/对象 id** 标错了」——而这两者恰是同一族病的两半，
 *   且 WO 明写「这两者修法相反」。实测变异反证（本单亲手跑）：
 *     把 `drillField:"value"` 改成本体里根本不存在的 `"valueWan"`（同时保留错的万元取值）→
 *     通用断言 `expect(pv.drillValue).toBe(truth)` **一次都没触发**（truthOf 返回 undefined → continue），
 *     整套测之所以还是红，只是因为上面几处**硬编码了字面量 `"value"`** 当非空洞计数器
 *     （`orderValue >= 5` / `orderLeaves.length >= 5`）。换成任何**没被硬编码**的字段，同样的错标就是全绿。
 *   普查坐实（8 条 gap_attribution 路径·84 个 provenance 节点）：**24 个（29%）**落在这条缝里被跳过——
 *     `Order.hefei.value`（Order 主键是 `so`）· `Equipment.hefei.oee_current`（主键是 `equipId`）。
 *
 * ── 本门的判据：**没有第三类** ──
 *   每个 provenance 三元组必须落入且仅落入两类，**两类都断言**：
 *     ① SINGLE（drillId ≠ "*"）：该对象必须真存在 → drillValue **恒等**该字段真值（布尔真值按 0/1 对齐）。
 *     ② AGGREGATE（drillId === "*"·契约 GapProvenanceSchema 的「按类型聚合」约定）：
 *        drillValue 必须落在该字段全类真值的**量纲带** [min, Σ] 内 —— #96 那种差 1e4 的口径错标必出带。
 *   落不进这两类的一律**红**（类型不在本体 / 字段不在类型声明 / 对象 id 查无此物）。
 *   「跳过」这个动作被删掉了，所以它没法再空转 —— 这正是上面那套的病。
 *
 * ── 通用在哪 ──
 *   ① 不认任何字面字段名：类型/字段/主键全部现查**已发布本体**（properties ∪ derivedProperties）；
 *   ② 深走整个输出收 provenance（不只 levels/atomicLeaves），新长出来的挂点自动进门；
 *   ③ 扫**全部 8 条** gap_attribution 路径（全局 / scoped / exposure / 5 个专属因果域），
 *      新增指标域只要产 provenance 就自动被咬。
 */
type AnyProv = { kind?: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: number };
const AGG = "*"; // 契约约定的「按类型聚合」标记

/** 深走任意求解器输出，收全部 provenance（新挂点自动进门·不靠枚举字段名）。 */
function collectProvenance(root: unknown, at = "$", out: { at: string; pv: AnyProv }[] = []): { at: string; pv: AnyProv }[] {
  if (root === null || typeof root !== "object") return out;
  if (Array.isArray(root)) {
    root.forEach((v, i) => collectProvenance(v, `${at}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    if (k === "provenance" && v && typeof v === "object" && !Array.isArray(v)) out.push({ at: `${at}.${k}`, pv: v as AnyProv });
    collectProvenance(v, `${at}.${k}`, out);
  }
  return out;
}

describe("WO-R13-DRILLFIELD · 溯源口径通用判据（标签所指字段 → 回的值真出自该字段·无静默跳过）", () => {
  it("全部 8 条 gap_attribution 路径：每个 provenance 非 SINGLE 即 AGGREGATE，两类都被断言，无第三类", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 已发布本体 = 类型/字段/主键的单一出处（不硬编码任何映射表）。
    const types = await t.services.ontology.listTypes(ADMIN);
    const typeByKey = new Map(types.map((x) => [x.key, x]));
    const objCache = new Map<string, Record<string, unknown>[]>();
    const rowsOf = async (tk: string): Promise<Record<string, unknown>[]> => {
      if (!objCache.has(tk)) objCache.set(tk, (await t.repos.objects.listByType(ADMIN.tenantId, tk)).map((o) => o.props));
      return objCache.get(tk)!;
    };

    const paths: [string, Record<string, unknown>][] = [
      ["global(seg_attain_ess)", {}],
      ["scope:hefei(复用全局子树)", { scope: { baseId: "hefei" } }],
      ["scope:xiamen(敞口支路)", { scope: { baseId: "xiamen" } }],
      ["market_share(专属因果域)", { metricKey: "market_share" }],
      ["cash(专属因果域)", { metricKey: "cash" }],
      ["revenue(专属因果域)", { metricKey: "revenue" }],
      ["gross_profit(通用结构分摊)", { metricKey: "gross_profit" }],
      ["demand_attain(专属因果域)", { metricKey: "demand_attain" }],
    ];

    let single = 0;
    let aggregate = 0;
    const typeFieldSeen = new Set<string>();

    for (const [tag, args] of paths) {
      const out = await run(t, args);
      const found = collectProvenance(out);
      expect(found.length, `${tag}：这条路一个 provenance 都没有 = 门在这条路上空转`).toBeGreaterThan(0);

      for (const { at, pv } of found) {
        const where = `${tag} ${at}`;
        const dt = pv.drillType;
        const df = pv.drillField;
        // ── 落不进两类的一律红 ──────────────────────────────────────────
        expect(dt, `${where}：provenance 无 drillType，出处无从谈起（R13）`).toBeTruthy();
        const ty = typeByKey.get(dt!);
        expect(ty, `${where}：drillType「${dt}」不是已发布本体里的对象类型（幽灵类型·下钻必点不开）`).toBeTruthy();
        expect(df, `${where}：${dt} 有 drillType 却无 drillField，说不出这个数来自哪个字段（R13）`).toBeTruthy();
        const declared = new Set<string>([
          ...ty!.properties.map((p) => p.propKey),
          ...((ty as unknown as { derivedProperties?: { propKey: string }[] }).derivedProperties ?? []).map((p) => p.propKey),
        ]);
        expect(
          declared.has(df!),
          `${where}：标签写着 ${dt}.${df}，但「${df}」不在 ${dt} 的本体声明里（properties ∪ derivedProperties = ${[...declared].join(",")}）` +
            ` —— 这是「把谎话从值搬到字段名」那种修法，本门专治`,
        ).toBe(true);
        typeFieldSeen.add(`${dt}.${df}`);

        const vals = (await rowsOf(dt!)).map((r) => r[df!]).filter((v): v is number => typeof v === "number");

        if (pv.drillId === AGG) {
          // ── ② AGGREGATE：量纲带 [min, Σ] —— #96 那种差 1e4 的口径错标必出带 ──
          aggregate++;
          expect(vals.length, `${where}：聚合标 ${dt}.*.${df}，但全类没有一条该字段的数值真值可作包络`).toBeGreaterThan(0);
          const lo = Math.min(...vals);
          const hi = vals.reduce((a, b) => a + b, 0);
          expect(typeof pv.drillValue, `${where}：聚合 drillValue 必须是数`).toBe("number");
          expect(
            pv.drillValue! >= lo && pv.drillValue! <= hi,
            `${where}：聚合标 ${dt}.*.${df} 回了 ${pv.drillValue}，而该字段全类真值带是 [${lo}, Σ=${hi}]` +
              ` —— 出带 = 回的根本不是这个字段的口径（#96 就是差 1e4 掉出带）`,
          ).toBe(true);
          continue;
        }

        // ── ① SINGLE：对象必须真存在，drillValue 恒等该字段真值 ──
        single++;
        const pk = ty!.properties.find((p) => p.isPrimaryKey)?.propKey;
        expect(pk, `${where}：${dt} 本体未声明主键，下钻路径无从解析`).toBeTruthy();
        const rows = await rowsOf(dt!);
        const row = rows.find((r) => String(r[pk!]) === String(pv.drillId));
        expect(
          row,
          `${where}：标签写着 ${dt}.${pv.drillId}.${df}，但 ${dt} 主键 ${pk} 里查无「${pv.drillId}」` +
            `（现有样例 ${rows.slice(0, 3).map((r) => String(r[pk!])).join("/")}）—— 悬空下钻路径；` +
            `若这本来就是聚合，请按契约标 drillId:"*"，不要拿别的键冒充对象主键`,
        ).toBeTruthy();
        const truth = row![df!];
        // 布尔真值（如 BidRecord.win）允许按 0/1 编码回，但必须**对得上**，不许静默放行。
        const expected = typeof truth === "boolean" ? (truth ? 1 : 0) : truth;
        expect(
          typeof expected,
          `${where}：${dt}.${pv.drillId}.${df} 的真值是 ${JSON.stringify(truth)}（非数非布尔），无法与 drillValue 对拍`,
        ).toBe("number");
        expect(
          pv.drillValue,
          `${where}：标签写着 ${dt}.${pv.drillId}.${df}，那个字段的真值是 ${JSON.stringify(truth)}，溯源却回了 ${pv.drillValue}`,
        ).toBe(expected);
      }
    }

    // ── 非空洞：两类都必须真有货（否则"没有第三类"是靠没有节点凑出来的）──
    expect(single, "SINGLE 类必须真被断言过（0 = 门空转）").toBeGreaterThanOrEqual(40);
    expect(aggregate, "AGGREGATE 类必须真被断言过（0 = 聚合分支从没跑到）").toBeGreaterThanOrEqual(8);
    expect(typeFieldSeen.size, "覆盖的 类型.字段 组合数（太少 = 只咬了一两个字段·不是通用判据）").toBeGreaterThanOrEqual(12);
  }, 300_000);
});
