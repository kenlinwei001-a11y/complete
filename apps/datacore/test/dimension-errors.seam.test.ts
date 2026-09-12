import { describe, it, expect, beforeAll } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import { cancelingProductUnit, resolvedProductUnit } from "../src/units.js";
import { inventoryOptimize, quoteMargin } from "../src/solvers/extended.js";
import { extendedObjectTypes } from "../src/synthetic/battery-extended.js";
import { batteryObjectTypes } from "../src/synthetic/battery.js";
import { seedMaterials } from "../src/synthetic/materials-seed.js";

/**
 * WO-DIMENSION-ERRORS · **装上量纲之后当场抓到的 6 条既有量纲错**的接缝测试。
 *
 * ══ 本文件断的是什么（以及不断什么）════════════════════════════════════════════
 * 上一单（`rate-dimension.seam.test.ts`）断的是**门本身能不能工作**；本文件断的是
 * **本仓那 6 处具体声明改对了没有**，以及**改回错的那一个会不会当场红**。
 * 两者缺一不可：门是好的但没人用它去核对既有声明，等于装了个没接线的报警器。
 *
 * ⚠ 反向对照一律走 `POST /a/v1/ontology/object-types` **真路由**，用的是**本仓真实的那两个
 * 属性配对**（产能−产出、收入+存量…），不是编出来的 `a - b`：编出来的两端必然报红，
 * 那只证明门会响，证明不了**它对准了这 6 条**。
 */

/** 本测试专用租户 —— 不动 demo 的电池种子。 */
const DE = { "x-debug-user": "dimerr:admin:admin|catalog_admin" };

/** 全量类型（电池 + 扩展）—— 与 `rate-dimension.seam.test.ts` 同一真值集。 */
function allTypes() {
  return [...batteryObjectTypes(), ...extendedObjectTypes()] as unknown as {
    key: string;
    properties: { propKey: string; unit: string; unitRefProp?: string }[];
    derivedProperties?: { propKey: string; formula: string; unit: string }[];
  }[];
}

function propOf(typeKey: string, propKey: string) {
  const ty = allTypes().find((t) => t.key === typeKey);
  expect(ty, `金丝雀：类型 '${typeKey}' 取不到 ⇒ 遍历坏了，不是「它不存在」`).toBeDefined();
  const p = ty!.properties.find((x) => x.propKey === propKey) ?? ty!.derivedProperties?.find((x) => x.propKey === propKey);
  expect(p, `金丝雀：'${typeKey}.${propKey}' 取不到 ⇒ 遍历坏了`).toBeDefined();
  return p as { propKey: string; unit: string; unitRefProp?: string };
}

describe("WO-DIMENSION-ERRORS · 6 条既有量纲错 + 反向对照", () => {
  let t: TestApp;
  const post = async (body: Record<string, unknown>) =>
    await t.app.inject({ method: "POST", url: "/a/v1/ontology/object-types", headers: DE, payload: body });

  /** 两个数值属性 + 一条派生式的最小类型（两端单位由入参给）。 */
  const twoProp = (key: string, a: { k: string; u: string }, b: { k: string; u: string }, formula: string, du: string) => ({
    key,
    displayName: key,
    properties: [
      { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
      { propKey: a.k, dataType: "number", isPrimaryKey: false, unit: a.u },
      { propKey: b.k, dataType: "number", isPrimaryKey: false, unit: b.u },
    ],
    derivedProperties: [{ propKey: "d", formula, unit: du }],
  });

  beforeAll(async () => {
    t = await makeApp();
  }, 120_000);

  // ══ ① 六条声明的现状断言（改回旧值 ⇒ 本组当场红）═══════════════════════════════
  it("①-2 `Material.{dailyUse,onHand,inTransit}`：不再是 `吨`，且三条都成对声明了 unitRefProp", () => {
    // 金丝雀：同对象上确有一格 `unit`（否则参数化声明是永远解析不出来的哑弹）。
    expect(propOf("Material", "unit").propKey).toBe("unit");
    for (const k of ["onHand", "inTransit"] as const) {
      const p = propOf("Material", k);
      expect(p.unit, `${k} 仍声明 '吨' ⇒ 8 料里 3 料（㎡/L/个）压根没有质量口径`).toBe("计量单位");
      expect(p.unitRefProp).toBe("unit");
    }
    const du = propOf("Material", "dailyUse");
    // 阶错：`日耗` 是速率，声明成存量则 `dailyUse × (leadTime+safety)` 与
    // `onHand − dailyUse×d` 两式两端不同阶。
    expect(du.unit).toBe("计量单位/日");
    expect(du.unitRefProp).toBe("unit");
    // 逐行解析必须落到四个**互不同族**的具体速率（族错在这一层才看得见）。
    const resolved = new Set<string>();
    for (const m of seedMaterials(42).materials) {
      const u = resolvedProductUnit({ unit: "计量单位", refValue: m.unit }, { unit: "元/计量单位", refValue: m.unit });
      expect(u, `物料 ${m.matId}（unit='${m.unit}'）的 量×价 抵不掉`).toBe("元");
      resolved.add(m.unit);
    }
    expect([...resolved].sort()).toEqual(["L", "kg", "个", "㎡"].sort());
  });

  it("①-4 `DemandSegment.{revenueWan,marginWan}`：`亿元/年`（速率），不是 `亿元`（存量）", () => {
    for (const k of ["revenueWan", "marginWan"] as const) {
      expect(propOf("DemandSegment", k).unit, `${k} 仍声明存量 '亿元' —— 左因子是 万套/**年**`).toBe("亿元/年");
    }
    // `priceWan` 刻意**不动**：真实分母是「套」，而 DECISION-unit-of-account §1.5 明令
    // 「套/电芯不得充当金额的分母」⇒ 词库里没有 `万元/套`。本单只收时间这一半的分母。
    expect(propOf("DemandSegment", "priceWan").unit).toBe("万元");
  });

  it("①-5 `Line.actual_output_daily`：`件/日`（cell），不是 `套/日`（pack）", () => {
    expect(propOf("Line", "actual_output_daily").unit).toBe("件/日");
    // 同对象的两个产能字段是**刻意**分属两族（cell 与 pack），本单不动它们 ——
    // 断在这里是为了让「顺手把它们并了」这件事当场红。
    expect(propOf("Line", "max_capacity_day").unit).toBe("件/日");
    expect(propOf("Line", "capacityDaily").unit).toBe("套/日");
  });

  it("①-6 `Order.qty`：`套`（pack），且两处勾稽等式的另一端同族", () => {
    expect(propOf("Order", "qty").unit).toBe("套");
    expect(propOf("Base", "committedQty").unit, "committedQty 字面就是 SUM(Order.qty)，两端必须同族").toBe("套");
    expect(propOf("OrderLine", "qty").unit, "注释自陈 Σ BY orderRef === Order.qty，是一条等式").toBe("套");
    // `unitPrice` / `value` 保持 `元`：`元/套` 被 DECISION-unit-of-account §1.5 明令排除。
    expect(propOf("Order", "unitPrice").unit).toBe("元");
    expect(propOf("Order", "value").unit).toBe("元");
  });

  // ══ ② 反向对照：把声明改回错的那个 ⇒ 真路由当场 400 ════════════════════════════
  it("②-5 反向对照（真路由）：产能−产出 —— `件/日` 减 `套/日` 400；改对后 201", async () => {
    // 改前的形态：`max_capacity_day`(件/日) − `actual_output_daily`(套/日)。
    const bad = await post(twoProp("DE_LineRevert", { k: "cap", u: "件/日" }, { k: "out", u: "套/日" }, "cap - out", "件/日"));
    expect(bad.statusCode, `跨计数族相减必须被拦下，实际 body=${bad.body}`).toBe(400);
    const msg = JSON.parse(bad.body).error.message as string;
    expect(msg).toContain("量纲跨族");
    expect(msg).toContain("count:件");
    expect(msg).toContain("count:套");
    // 金丝雀 = 改后的形态：同为 `件/日` ⇒ 放行（证明不是一刀切全拦）。
    const good = await post(twoProp("DE_LineFixed", { k: "cap", u: "件/日" }, { k: "out", u: "件/日" }, "cap - out", "件/日"));
    expect(good.statusCode, `同族相减必须放行，实际 body=${good.body}`).toBe(201);
  });

  it("②-4 反向对照（真路由）：收入 + 存量 —— `亿元/年` 加 `亿元` 400，点名「量纲阶不同」", async () => {
    // 这一条正是 `revenueWan` 改前**无法与存量区分**的证据：改前两端都是 `亿元` ⇒ 静默通过。
    const bad = await post(twoProp("DE_SegRevert", { k: "rev", u: "亿元/年" }, { k: "cash", u: "亿元" }, "rev + cash", "亿元"));
    expect(bad.statusCode, `存量加速率必须被拦下，实际 body=${bad.body}`).toBe(400);
    const msg = JSON.parse(bad.body).error.message as string;
    expect(msg).toContain("量纲阶不同");
    // 变异反证：把 `亿元/年` 换回改前的 `亿元`（= 旧声明）⇒ 同一条式子**重新静默通过**。
    // 差别只可能来自那一处声明本身 —— 这就是「改回错的那个会不会红」的直接证据。
    const preChange = await post(twoProp("DE_SegPreChange", { k: "rev", u: "亿元" }, { k: "cash", u: "亿元" }, "rev + cash", "亿元"));
    expect(preChange.statusCode, `改前那份声明本就该放行（否则本反证没生效）`).toBe(201);
  });

  it("②-6 反向对照（真路由）：在手量 − 已承接量 —— `套` 减 `件` 400", async () => {
    const bad = await post(twoProp("DE_OrderRevert", { k: "q", u: "套" }, { k: "committed", u: "件" }, "q - committed", "套"));
    expect(bad.statusCode, `套 减 件 必须被拦下，实际 body=${bad.body}`).toBe(400);
    expect(JSON.parse(bad.body).error.message).toContain("量纲跨族");
    const good = await post(twoProp("DE_OrderFixed", { k: "q", u: "套" }, { k: "committed", u: "套" }, "q - committed", "套"));
    expect(good.statusCode, `同族相减必须放行，实际 body=${good.body}`).toBe(201);
  });

  it("②-2 反向对照（真路由）：把 `dailyUse` 改回 `吨` 却留着 unitRefProp ⇒ 400「永远不被读取」", async () => {
    const bad = await post({
      key: "DE_MatRevert",
      displayName: "DE_MatRevert",
      properties: [
        { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
        { propKey: "unit", dataType: "string", isPrimaryKey: false, unit: "dimensionless" },
        { propKey: "dailyUse", dataType: "number", isPrimaryKey: false, unit: "吨", unitRefProp: "unit" },
      ],
      derivedProperties: [],
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).error.message).toContain("永远不被读取");
    // 改后的成对声明必须放行。
    const good = await post({
      key: "DE_MatFixed",
      displayName: "DE_MatFixed",
      properties: [
        { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
        { propKey: "unit", dataType: "string", isPrimaryKey: false, unit: "dimensionless" },
        { propKey: "dailyUse", dataType: "number", isPrimaryKey: false, unit: "计量单位/日", unitRefProp: "unit" },
      ],
      derivedProperties: [],
    });
    expect(good.statusCode, `成对声明必须放行，实际 body=${good.body}`).toBe(201);
  });

  // ══ ③ 乘法许可（#1 / #3）—— 真正花钱的那两处乘法 ══════════════════════════════
  it("③ `cancelingProductUnit`：抵得掉给单位、抵不掉给 undefined（四种 undefined 各一例）", () => {
    // 抵得掉（金丝雀：先证明它真的会给出答案，再报 undefined）。
    expect(cancelingProductUnit("kg", "元/kg")).toBe("元");
    expect(cancelingProductUnit("㎡", "元/㎡")).toBe("元");
    expect(cancelingProductUnit("L", "元/L")).toBe("元");
    expect(cancelingProductUnit("个", "元/个")).toBe("元");
    // ⚠ 这一条就是那个「1000× 的钱」的判据：吨 × 元/kg **抵不掉**（倍数 1e3 ≠ 1 ⇒ 落不到 `元`）。
    //   改前若 onHand 真是吨，这一乘就是 1000× 低估；抵消模型让它**说不出结果**而不是给个小 1000 倍的数。
    expect(cancelingProductUnit("吨", "元/kg")).toBeUndefined();
    // 跨族：质量 × 元/面积。
    expect(cancelingProductUnit("吨", "元/㎡")).toBeUndefined();
    // 未解析的参数化占位符不许当成任何具体 kind。
    expect(cancelingProductUnit("计量单位", "元/计量单位")).toBeUndefined();
    // qty 自己是速率 ⇒ 本函数不处理（不硬凑）。
    expect(cancelingProductUnit("件/日", "元/kg")).toBeUndefined();
    // 参数化两端由**两个不同的** refValue 解析：相等才抵得掉。
    expect(resolvedProductUnit({ unit: "计量单位", refValue: "kg" }, { unit: "元/计量单位", refValue: "kg" })).toBe("元");
    expect(resolvedProductUnit({ unit: "计量单位", refValue: "㎡" }, { unit: "元/计量单位", refValue: "kg" })).toBeUndefined();
    expect(resolvedProductUnit({ unit: "计量单位", refValue: "卷" }, { unit: "元/计量单位", refValue: "卷" })).toBeUndefined();
  });

  it("③-1 `inventory_optimize`：unit 对 ⇒ value+valueUnit；unit 错 ⇒ 不给 value 且不计入可释放资金", () => {
    // 逼出 over：onHand = 3 × 目标水位。
    const row = (unit: string | undefined) => [{
      matId: "m1", dailyUse: 100, leadTime: 10, onHand: 100 * 15 * 3, unitPrice: 50, idleDays: 0,
      ...(unit === undefined ? {} : { unit }),
    }];
    const ok = inventoryOptimize({ materials: row("kg"), safetyDays: 5 }) as {
      over: { value?: number; valueUnit?: string | null }[]; releasableCash: number;
    };
    expect(ok.over).toHaveLength(1);
    expect(ok.over[0]!.valueUnit).toBe("元");
    // 目标水位 = 100 ×(10+5) = 1500；overQty = 4500 − 1.5×1500 = 2250；value = 2250 × 50。
    expect(ok.over[0]!.value).toBeCloseTo(2250 * 50, 4);
    expect(ok.releasableCash).toBeGreaterThan(0);
    const cash = ok.releasableCash;

    // 变异①：单位换成词表外的 `卷` —— **同样的三个数字**，只有 unit 这一格变了。
    // 改前这里输出与上面**逐字节相同**（真起后端实测：base 树 B/C 两格 hash 同为 1d15cce601ddfeee）。
    const bad = inventoryOptimize({ materials: row("卷"), safetyDays: 5 }) as {
      over: { value?: number; valueUnit?: string | null; valueOmittedReason?: string }[]; releasableCash: number;
    };
    expect(bad.over).toHaveLength(1);
    expect(bad.over[0]!.value, "抵不掉就不许给 value").toBeUndefined();
    expect(bad.over[0]!.valueUnit).toBeNull();
    expect(bad.over[0]!.valueOmittedReason).toContain("卷");
    expect(bad.releasableCash, "不计入可释放资金").toBe(0);
    // 变异②：整格缺席 ⇒ 同样拒绝（缺席不等于「就是对的」）。
    const missing = inventoryOptimize({ materials: row(undefined), safetyDays: 5 }) as { releasableCash: number };
    expect(missing.releasableCash).toBe(0);
    // 变异反证的判据：三次调用**只有 unit 这一格不同**，而结果分成了两类。
    expect(cash).toBeGreaterThan(0);
  });

  it("③-3 `quote_margin`：BOM 行的 qtyUnit 与 priceUnit 不等 ⇒ 该行不计入 bomCost 并点名", () => {
    const base = { price: 1000, mfgRate: 0.1, logistics: 8 };
    const rows = (priceUnit: string) => [
      { material: "pos_ncm", unit: 1.05, spotPrice: 100, processRate: 0, qtyUnit: "kg", priceUnit },
      { material: "sep_film", unit: 12, spotPrice: 30, processRate: 0, qtyUnit: "㎡", priceUnit: "㎡" },
    ];
    const ok = quoteMargin({ ...base, bom: rows("kg") }) as { breakdown: { bomCost: number; bomSkipped?: unknown[] } };
    expect(ok.breakdown.bomCost).toBeCloseTo(1.05 * 100 + 12 * 30, 4);
    expect(ok.breakdown.bomSkipped, "全行都合法时不出这个键（逐字节同改前）").toBeUndefined();

    // 变异：第一行的物料单价改按 `㎡` 计（= BOMDetail 与 Material 两格不一致的那个形态）。
    const bad = quoteMargin({ ...base, bom: rows("㎡") }) as {
      breakdown: { bomCost: number; bomSkipped?: { material: string; reason: string }[] };
    };
    expect(bad.breakdown.bomCost, "不合法的那一行必须被剔除").toBeCloseTo(12 * 30, 4);
    expect(bad.breakdown.bomSkipped).toHaveLength(1);
    expect(bad.breakdown.bomSkipped![0]!.material).toBe("pos_ncm");
    // 不带这两格的旧调用形态（EXPLICIT 路 / 既有测试）必须逐字节同改前 —— 不制造假红。
    const legacy = quoteMargin({ ...base, bom: [{ unit: 1.05, spotPrice: 100, processRate: 0 }] }) as {
      breakdown: { bomCost: number; bomSkipped?: unknown[] };
    };
    expect(legacy.breakdown.bomCost).toBeCloseTo(105, 4);
    expect(legacy.breakdown.bomSkipped).toBeUndefined();
  });

  // ══ ④ 既有加减派生式仍然零误伤（改了 4 个类型的声明之后重跑）════════════════════
  it("④ 误伤 = 0：改完这 6 条之后，全仓既有加减派生式一条不红", async () => {
    const types = allTypes();
    let additive = 0;
    const hurt: string[] = [];
    const { inferFormulaDimensionIssues } = await import("../src/units.js");
    const { PROPERTY_UNITS } = await import("../src/domain.js");
    for (const ty of types) {
      const unitOfProp = new Map<string, string>();
      for (const p of ty.properties ?? []) unitOfProp.set(p.propKey, p.unit);
      for (const d of ty.derivedProperties ?? []) unitOfProp.set(d.propKey, d.unit);
      for (const d of ty.derivedProperties ?? []) {
        if (!/[+\-]/.test(d.formula)) continue;
        additive++;
        const issues = inferFormulaDimensionIssues(d.formula, (id) => {
          const u = unitOfProp.get(id);
          return u !== undefined && (PROPERTY_UNITS as readonly string[]).includes(u) ? (u as never) : undefined;
        });
        if (issues.length > 0) hurt.push(`${ty.key}.${d.propKey}: ${issues[0]!.reason}`);
      }
    }
    expect(additive, "金丝雀：一条加减派生式都没数到 ⇒ 遍历坏了").toBeGreaterThanOrEqual(6);
    expect(hurt, `误伤必须为 0，实际：${hurt.join(" | ")}`).toHaveLength(0);
  });
});
