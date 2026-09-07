import { describe, it, expect, beforeAll } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { PROPERTY_UNITS } from "../src/domain.js";
import {
  UNIT_DIMENSIONS,
  explainUnitMismatch,
  inferFormulaDimensionIssues,
  isRateUnit,
  resolveParametricUnit,
  resolvePropertyUnit,
  sameUnitFamily,
  unitConversionFactor,
  unitFamily,
} from "../src/units.js";
import { extendedObjectTypes } from "../src/synthetic/battery-extended.js";
import { batteryObjectTypes } from "../src/synthetic/battery.js";
import { seedMaterials } from "../src/synthetic/materials-seed.js";

/**
 * WO-RATE-DIMENSION · **速率 / 复合量纲**接缝测试。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 * **X（改前）**：单位是 50 条闭合字符串，REST 建类型只做**成员判定**。字典里虽已有 10 条
 * 带斜杠的词条，但斜杠只是一个字符 —— 没有任何代码能判断 `件/日` 与 `套/日` 是否同族、
 * `件` 与 `件/日` 是否同一个量。于是「存量比速率」「跨计数名词比较」**静默出数、四包全绿**。
 * **Y（改后）**：单位有结构（分子/分母 kind + 倍数），跨族、异阶、异倍数在**提交那一刻**被拦下。
 *
 * ⚠ 本文件断的是**接缝**不是函数：三组对照全部经 `POST /a/v1/ontology/object-types`
 * 真路由提交，断 4xx / 2xx 与错误原文。纯函数级断言只作为族划分的证据补充。
 */

/** 造一个只为本测试存在的类型：两个属性 + 一条派生公式，其余最小化。 */
function typeBody(key: string, props: { propKey: string; unit: string }[], formula: string, derivedUnit: string) {
  return {
    key,
    displayName: key,
    properties: [
      { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
      ...props.map((p) => ({ propKey: p.propKey, dataType: "number", isPrimaryKey: false, unit: p.unit })),
    ],
    derivedProperties: [{ propKey: "d", formula, unit: derivedUnit }],
  };
}

/** 本测试专用租户 —— 不动 demo 的电池种子。 */
const RD = { "x-debug-user": "ratedim:admin:admin|catalog_admin" };

describe("WO-RATE-DIMENSION · 速率/复合量纲维度", () => {
  let t: TestApp;
  const post = (body: unknown) =>
    t.app.inject({ method: "POST", url: "/a/v1/ontology/object-types", headers: RD, payload: body });

  beforeAll(async () => {
    t = await makeApp();
  }, 120_000);

  // ── 组① 跨族被拦下（真路由 → 4xx）─────────────────────────────────────────
  it("组①：`件/日` 与 `套/日` 跨族相减 → 真路由 400 且原文点名两个单位与病因", async () => {
    const res = await post(
      typeBody("RD_CrossFamily", [{ propKey: "a", unit: "件/日" }, { propKey: "b", unit: "套/日" }], "a - b", "件/日"),
    );
    expect(res.statusCode, `跨族相减必须被拦下，实际 body=${res.body}`).toBe(400);
    const msg = JSON.parse(res.body).error.message as string;
    expect(msg).toContain("件/日");
    expect(msg).toContain("套/日");
    expect(msg).toContain("量纲跨族");
    // 分子 kind 必须被点名到具体名词，而不是笼统一句「单位不一致」——
    // 修法完全不同：跨族要先裁决口径，异倍数只要补换算。
    expect(msg).toContain("count:件");
    expect(msg).toContain("count:套");
  });

  // ── 组② 同族仍通（金丝雀：证明不是一刀切全拦）─────────────────────────────
  it("组②（金丝雀）：`件/日` 与 `件/日` 同族相减 → 真路由 201，未误伤", async () => {
    const res = await post(
      typeBody("RD_SameFamily", [{ propKey: "a", unit: "件/日" }, { propKey: "b", unit: "件/日" }], "a - b", "件/日"),
    );
    expect(res.statusCode, `同族相减必须放行，实际 body=${res.body}`).toBe(201);
  });

  it("组②b（金丝雀）：`套/天` 与 `套/日` 是同一单位的两种写法（1:1，非口径选择）→ 201", async () => {
    const res = await post(
      typeBody("RD_DayAlias", [{ propKey: "a", unit: "套/天" }, { propKey: "b", unit: "套/日" }], "a - b", "套/日"),
    );
    expect(res.statusCode, `日≡天 必须放行，实际 body=${res.body}`).toBe(201);
    expect(unitConversionFactor("套/天", "套/日")).toBe(1);
  });

  // ── 组③ 存量 vs 速率（第四态：接对了、跑通了、但算错了）──────────────────────
  it("组③：`件`(存量) 与 `件/日`(速率) 相减 → 真路由 400，点名「量纲阶不同」", async () => {
    const res = await post(
      typeBody("RD_StockVsRate", [{ propKey: "a", unit: "件" }, { propKey: "b", unit: "件/日" }], "a - b", "件"),
    );
    expect(res.statusCode, `存量比速率必须被拦下，实际 body=${res.body}`).toBe(400);
    const msg = JSON.parse(res.body).error.message as string;
    expect(msg).toContain("量纲阶不同");
    expect(msg).toContain("存量");
    expect(msg).toContain("速率");
    // 两个数：族键必须不同（存量 `count:件` vs 速率 `count:件/time`）。
    expect(unitFamily("件")).toBe("count:件");
    expect(unitFamily("件/日")).toBe("count:件/time");
    expect(sameUnitFamily("件", "件/日")).toBe(false);
    expect(isRateUnit("件")).toBe(false);
    expect(isRateUnit("件/日")).toBe(true);
  });

  // ── 变异反证：把校验去掉 ⇒ 组① 必须重新静默通过 ────────────────────────────
  it("变异反证：绕开量纲推断（模拟把新校验删掉）⇒ 组① 那个跨族比较重新静默通过", () => {
    // 主逻辑：`件/日 - 套/日` 报 1 条问题。
    const unitOf = (id: string) => (id === "a" ? ("件/日" as const) : id === "b" ? ("套/日" as const) : undefined);
    expect(inferFormulaDimensionIssues("a - b", unitOf)).toHaveLength(1);
    // 变异体 = 改前的行为（单位只做成员判定，不看结构）：两个单位都在词表内 ⇒ 零问题。
    const preChangeGate = (units: string[]) => units.filter((u) => !(PROPERTY_UNITS as readonly string[]).includes(u));
    expect(preChangeGate(["件/日", "套/日"]), "变异未生效：改前的门本就该放行这两个单位").toHaveLength(0);
    // 变异反证的判据：同一条式子，改前放行、改后拦下 —— 差别只可能来自新校验本身。
    expect(inferFormulaDimensionIssues("a - b", unitOf).length).toBeGreaterThan(preChangeGate(["件/日", "套/日"]).length);
  });

  // ── 存量不误伤：本仓 6 条既有加减派生式必须全部仍然合法 ──────────────────────
  it("存量误伤 = 0：既有派生公式里的加减法逐条过新门，一条不红", () => {
    const types = extendedObjectTypesAll();
    let additive = 0;
    const hurt: string[] = [];
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
    // 金丝雀：遍历真的走到了加减式（数到 0 与「遍历坏了」在屏上一模一样）。
    expect(additive, "金丝雀：一条加减派生式都没数到 ⇒ 遍历坏了，不是「没有加减式」").toBeGreaterThanOrEqual(6);
    expect(hurt, `误伤必须为 0，实际：${hurt.join(" | ")}`).toHaveLength(0);
  });

  // ── ③ `Material.unitPrice` 的参数化量纲 —— 逐行解析出四种真实单位 ────────────
  it("Material.unitPrice：声明 `元/计量单位` + unitRefProp，逐行解析出 元/kg · 元/㎡ · 元/L · 元/个", () => {
    const material = extendedObjectTypes().find((x) => x.key === "Material")!;
    const prop = material.properties.find((p) => p.propKey === "unitPrice")!;
    expect(prop.unit).toBe("元/计量单位");
    expect(prop.unitRefProp).toBe("unit");
    const resolved = new Set<string>();
    for (const m of seedMaterials(42).materials) {
      const u = resolvePropertyUnit(prop, m as unknown as Record<string, unknown>);
      expect(u, `物料 ${m.matId} 的量纲解析不出（unit='${m.unit}'）`).toBeDefined();
      resolved.add(u!);
    }
    // 四种真实量纲必须**全部**出现（缺一个就说明某类物料的分母被吞了）。
    expect([...resolved].sort()).toEqual(["元/L", "元/kg", "元/个", "元/㎡"].sort());
    // 解析不出时必须是 undefined，**不许回落成声明值**（把「不知道」读成占位符本身）。
    expect(resolveParametricUnit("元/计量单位", "卷")).toBeUndefined();
    expect(resolvePropertyUnit(prop, { unit: "卷" })).toBeUndefined();
    expect(resolvePropertyUnit(prop, {})).toBeUndefined();
  });

  // ── 参数化量纲的双向一致性（单向声明 = 永远解析不出来的哑弹）──────────────────
  it("参数化量纲：声明了占位符却不给 unitRefProp → 400；给了 unitRefProp 却不是参数化单位 → 400", async () => {
    const a = await post({
      key: "RD_ParamHalfA",
      displayName: "RD_ParamHalfA",
      properties: [
        { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
        { propKey: "price", dataType: "number", isPrimaryKey: false, unit: "元/计量单位" },
      ],
      derivedProperties: [],
    });
    expect(a.statusCode).toBe(400);
    expect(JSON.parse(a.body).error.message).toContain("unitRefProp");

    const b = await post({
      key: "RD_ParamHalfB",
      displayName: "RD_ParamHalfB",
      properties: [
        { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
        { propKey: "u", dataType: "string", isPrimaryKey: false, unit: "dimensionless" },
        { propKey: "price", dataType: "number", isPrimaryKey: false, unit: "元", unitRefProp: "u" },
      ],
      derivedProperties: [],
    });
    expect(b.statusCode).toBe(400);
    expect(JSON.parse(b.body).error.message).toContain("永远不被读取");

    const c = await post({
      key: "RD_ParamOk",
      displayName: "RD_ParamOk",
      properties: [
        { propKey: "id", dataType: "string", isPrimaryKey: true, unit: "dimensionless" },
        { propKey: "u", dataType: "string", isPrimaryKey: false, unit: "dimensionless" },
        { propKey: "price", dataType: "number", isPrimaryKey: false, unit: "元/计量单位", unitRefProp: "u" },
      ],
      derivedProperties: [],
    });
    expect(c.statusCode, `成对声明必须放行，实际 body=${c.body}`).toBe(201);
  });

  // ── 派生属性的单位此前完全不过字典门 ────────────────────────────────────────
  it("派生属性单位也过字典门（改前只查 properties，derivedProperties 想写什么写什么）", async () => {
    const res = await post(
      typeBody("RD_DerivedUnit", [{ propKey: "a", unit: "件" }, { propKey: "b", unit: "件" }], "a - b", "根本不存在的单位"),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain("未知单位");
  });

  // ── 词表与量纲表由 `satisfies` 绑死：加词条不登记量纲 = 编译失败 ──────────────
  it("量纲表覆盖全部词条（机制：`satisfies Record<PropertyUnit, …>`，加词条忘登记即编译失败）", () => {
    const missing = PROPERTY_UNITS.filter((u) => !(u in UNIT_DIMENSIONS));
    // 金丝雀：先证明这个「in 判定」真的能判出缺失，再报「零缺失」。
    expect("这个单位不存在" in UNIT_DIMENSIONS, "金丝雀：in 判定失灵").toBe(false);
    expect(missing, `未登记量纲的词条：${missing.join("/")}`).toHaveLength(0);
    expect(PROPERTY_UNITS.length).toBe(Object.keys(UNIT_DIMENSIONS).length);
  });

  // ── 计数名词各自成族：不替任何人做口径裁决 ──────────────────────────────────
  it("同义/近义单位分开保留：`个`≠`件`、`h`≠`秒`(可换算) —— 口径不由本模块裁决", () => {
    // `个` 与 `件` 是**不同族**：并成一个就固化了一个没人拍板的口径。
    expect(sameUnitFamily("个", "件")).toBe(false);
    expect(explainUnitMismatch("个", "件")).toContain("量纲跨族");
    // `h` 与 `秒` 同族且倍数**精确**（不是口径问题）⇒ 可换算，系数给得出。
    expect(sameUnitFamily("h", "秒")).toBe(true);
    expect(unitConversionFactor("h", "秒")).toBeCloseTo(3600, 6);
    // `年`/`月` 的天数是日历口径 ⇒ 同族但**换算系数未裁决**，必须与「跨族」分开说。
    expect(sameUnitFamily("年", "天")).toBe(true);
    expect(unitConversionFactor("年", "天")).toBeUndefined();
    expect(explainUnitMismatch("年", "天")).toContain("换算系数未裁决");
    // 同族异倍数（元 vs 万元）报的是第四种原因 —— 这正是 `gap_attribution` 差 1e4 那个病。
    expect(explainUnitMismatch("元", "万元")).toContain("同族异倍数");
    expect(unitConversionFactor("万元", "元")).toBe(1e4);
  });
});

/** 全量类型（电池 + 扩展）—— 与 `check-ontology-descriptions.mjs` 同一真值集。 */
function extendedObjectTypesAll() {
  return [...batteryObjectTypes(), ...extendedObjectTypes()] as unknown as {
    key: string;
    properties: { propKey: string; unit: string }[];
    derivedProperties?: { propKey: string; formula: string; unit: string }[];
  }[];
}
