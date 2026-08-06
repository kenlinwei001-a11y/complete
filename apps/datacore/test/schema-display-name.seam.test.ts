import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { PROP_DISPLAY_NAMES, propDisplayName } from "../src/synthetic/battery.js";
import type { PropertyDef } from "../src/domain.js";

/**
 * WO-SCHEMA-ZH · SEAM-GATE：本体 Schema 的属性中文业务名（PropertyDef.displayName）真下发。
 *
 * 判据是**效果层**，不是"字段定义了"：
 *  ① 断言 displayName 出现在**接口响应里**（GET /a/v1/ontology/object-types 与 /a/v1/ontology/type-semantics），
 *     经真链（合成种子 → 本体仓储 → REST 投影）拿到，不是读源码常量。
 *  ② 断言**诚实回落**：未登记中文名的属性响应里**没有** displayName 键（不是 null/""/"undefined"），
 *     下游据此回落 propKey。
 *  ③ 断言**单源收敛**：求解器杠杆标签（LEVER_PROP_META.label，形如「物料·到货周期」）的 "·" 后缀
 *     === 同一属性的 displayName。同一属性不得存在两份中文名——改任一侧此断言即红。
 *  ④ 断言 propKey **零改**：接线名（求解器/规则/派生公式引用）必须原样保留，展示名是加法不是改名。
 */

const ONTOLOGY_TYPES = "/a/v1/ontology/object-types";

interface TypeRow { key: string; displayName: string; properties: PropertyDef[] }

async function fetchTypes(t: TestApp): Promise<TypeRow[]> {
  const res = await t.app.inject({ method: "GET", url: ONTOLOGY_TYPES, headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return res.json() as TypeRow[];
}

function propOf(types: TypeRow[], typeKey: string, propKey: string): PropertyDef {
  const t = types.find((x) => x.key === typeKey);
  expect(t, `本体应含对象类型 ${typeKey}`).toBeTruthy();
  const p = t!.properties.find((x) => x.propKey === propKey);
  expect(p, `${typeKey} 应含属性 ${propKey}`).toBeTruthy();
  return p!;
}

describe("WO-SCHEMA-ZH · 属性中文业务名经接口真下发（SEAM）", () => {
  it("① GET /a/v1/ontology/object-types 响应里带 displayName（用户原话点名的 Material.leadTime 等）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // 用户原话："把截屏里面非必要的英文词汇调整为中文，比如 Material.leadTime"
    expect(propOf(types, "Material", "leadTime").displayName).toBe("到货周期");
    expect(propOf(types, "Equipment", "oee_current").displayName).toBe("OEE");
    expect(propOf(types, "Process", "yield_baseline").displayName).toBe("良率基线");
    // 「系统所有类似的数字，需要配套它的意义」：中文名与既有 unit 并存，两者都在同一条响应里。
    const util = propOf(types, "Base", "util");
    expect(util.displayName).toBe("产能利用率");
    expect(util.unit).toBe("%");
  });

  it("② 诚实回落：未登记中文名的属性**不带** displayName 键（不是 null/空串），下游回落 propKey", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // Base.position 与 Base.kind 同值（生成处 `position: b.kind`），业务语义待确认 → 故意留白。
    const pos = propOf(types, "Base", "position");
    expect(propDisplayName("Base", "position"), "留白项不得偷偷登记").toBeUndefined();
    expect("displayName" in pos, "留白应表现为键缺失，不是 null/空串").toBe(false);

    // Material.devPct 无消费方、口径不明 → 同样留白（宁可让界面显裸键，也不臆造中文名）。
    expect("displayName" in propOf(types, "Material", "devPct")).toBe(false);

    // 全局：不允许任何属性带空串/空白 displayName（"编个空的"比留白更坏）。
    for (const ty of types) {
      for (const p of ty.properties ?? []) {
        if (p.displayName !== undefined) {
          expect(typeof p.displayName, `${ty.key}.${p.propKey}`).toBe("string");
          expect(p.displayName.trim(), `${ty.key}.${p.propKey} 不得为空白中文名`).not.toBe("");
        }
      }
    }
  });

  it("③ 单源收敛：求解器杠杆标签「类型·属性」的属性段 === PropertyDef.displayName（同属性只有一份中文名）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 走 capacity 金字塔反推（grain 分支）——杠杆标签 factor 即由 LEVER_PROP_META 下发。
    const cap = await invokeSolver(t, "capacity_forecast", { modelId: "2170-NCM", granularity: "process-model" });
    expect(cap.statusCode).toBe(200);
    const rows = (cap.json() as { data: { byProcessModel?: { process: string }[] } }).data.byProcessModel ?? [];
    expect(rows.length, "应有工序×型号颗粒行").toBeGreaterThan(0);
    const res = await invokeSolver(t, "generic_inference", {
      mode: "levers", grain: "process-model", modelId: "2170-NCM", processKey: rows[0]!.process,
    });
    expect(res.statusCode).toBe(200);
    const levers = (res.json() as { data: { levers: { objectType: string; prop: string; factor?: string }[] } }).data.levers;
    expect(levers.length, "应能反推出杠杆").toBeGreaterThan(0);

    let checked = 0;
    for (const l of levers) {
      const zh = propDisplayName(l.objectType, l.prop);
      if (!zh || !l.factor || !l.factor.includes("·")) continue;
      // 杠杆标签 = 类型简称 + "·" + 属性中文名；属性段必须与本体 displayName 逐字一致。
      expect(l.factor.slice(l.factor.lastIndexOf("·") + 1), `${l.objectType}.${l.prop} 杠杆标签与本体展示名分叉`).toBe(zh);
      checked++;
    }
    expect(checked, "至少应覆盖到一个既有杠杆标签又有 displayName 的属性").toBeGreaterThan(0);
  });

  it("④ propKey 零改 + 展示名表键形合法：只加展示层，不动接线名", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const types = await fetchTypes(t);

    // 接线名原样（求解器 / 规则 DSL / 派生公式 / golden 都引用这些串）。
    for (const [typeKey, propKey] of [
      ["Material", "leadTime"], ["Material", "onHand"], ["Equipment", "oee_current"],
      ["Process", "yield_baseline"], ["Line", "utilization"], ["Order", "outsourceRatio"],
    ] as const) {
      expect(propOf(types, typeKey, propKey).propKey).toBe(propKey);
    }

    // 表里每个键都得对上真属性（防拼错类型/属性名导致"登记了但永不生效"的假绿）。
    const known = new Map(types.map((ty) => [ty.key, new Set((ty.properties ?? []).map((p) => p.propKey))]));
    const orphans = Object.keys(PROP_DISPLAY_NAMES).filter((k) => {
      const i = k.indexOf(".");
      const [ty, prop] = [k.slice(0, i), k.slice(i + 1)];
      const props = known.get(ty);
      return props !== undefined && !props.has(prop); // 类型未种进本租户则不判（合成子集不含）
    });
    expect(orphans, "PROP_DISPLAY_NAMES 有键指向不存在的属性").toEqual([]);
  });

  it("⑤ type-semantics（喂 B 侧 LLM 的口径投影）同样带中文名，缺则整键不下发", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/type-semantics?types=Material,Base", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { types: { typeKey: string; props: { propKey: string; displayName?: string }[] }[] };
    const mat = body.types.find((x) => x.typeKey === "Material");
    expect(mat?.props.find((p) => p.propKey === "leadTime")?.displayName).toBe("到货周期");
    const pos = body.types.find((x) => x.typeKey === "Base")?.props.find((p) => p.propKey === "position");
    expect(pos, "Base.position 应在投影里").toBeTruthy();
    expect("displayName" in pos!, "留白项在 B 侧也表现为键缺失").toBe(false);
  });
});
