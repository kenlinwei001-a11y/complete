import { describe, expect, it } from "vitest";
import { DecisionFieldMappingSchema, DerivedFieldResultSchema } from "@platform/contracts";
import {
  deriveDecisionFields,
  weakestDataMode,
  validateDerivedFields,
  type ObjectsByType,
  type DeriveSourceObject,
} from "../src/decision/derive-fields.js";

/**
 * WO-DB-DERIVE-DECISION-FIELDS (G4) 齿：导入记录字段 → 决策字段 派生引擎。
 * 验：① 决策字段从**真源值**算（逐值·非 hash）；② R14 config-driven（换 mapping 就换域·引擎零常数）；
 * ③ R6 确定性（同输入字节同结果）；④ green→red 自证（注入伪造值 → validateDerivedFields 逮住）。
 */

// 真源记录（记录型导入·真值·factory 键关联）——电池只是**数据实例**·非引擎内联。
function batteryLikeWorld(): ObjectsByType {
  const bases: DeriveSourceObject[] = [
    { id: "obj_Base_F001", props: { factory_id: "F001", name: "厂一" }, real: true },
    { id: "obj_Base_F002", props: { factory_id: "F002", name: "厂二" }, real: true },
  ];
  const lines: DeriveSourceObject[] = [
    { id: "obj_PL_L1", props: { factory_id: "F001", oee: 90, capacity: 100 }, real: true },
    { id: "obj_PL_L2", props: { factory_id: "F001", oee: 80, capacity: 100 }, real: true },
    { id: "obj_PL_L3", props: { factory_id: "F002", oee: 70, capacity: 200 }, real: true },
  ];
  const equip: DeriveSourceObject[] = [
    { id: "obj_EQ_E1", props: { baseId: "F001", oee_current: 0.88 }, real: true },
    { id: "obj_EQ_E2", props: { baseId: "F001", oee_current: 0.82 }, real: true },
  ];
  return new Map([
    ["Base", bases],
    ["ProductionLine", lines],
    ["Equipment", equip],
  ]);
}

const UTIL_MAPPING = DecisionFieldMappingSchema.parse({
  rules: [
    {
      target: { objectType: "Base", field: "util" },
      source: { objectType: "ProductionLine", field: "oee", groupByField: "factory_id" },
      op: "avg",
      targetKeyField: "factory_id",
      scale: 0.01,
      clampMin: 0,
      clampMax: 1,
      precision: 4,
    },
    {
      target: { objectType: "Base", field: "oeeIndex" },
      source: { objectType: "Equipment", field: "oee_current", groupByField: "baseId" },
      op: "avg",
      targetKeyField: "factory_id",
      precision: 4,
    },
  ],
});

describe("derive-fields · 决策字段从真源派生", () => {
  it("① util = 真 oee 均值 ×0.01（逐值·非 hash）·oeeIndex = 真设备 oee_current 均值", () => {
    const world = batteryLikeWorld();
    const results = deriveDecisionFields(UTIL_MAPPING, world);
    for (const r of results) DerivedFieldResultSchema.parse(r);

    const utilF001 = results.find((r) => r.field === "util" && r.targetKey === "F001")!;
    // 真算：(90+80)/2 = 85 → ×0.01 = 0.85（不是 hash("F001")%N）
    expect(utilF001.value).toBe(0.85);
    expect(utilF001.dataMode).toBe("LIVE");
    expect(utilF001.sourceObjectIds).toEqual(["obj_PL_L1", "obj_PL_L2"]); // R13 溯源

    const utilF002 = results.find((r) => r.field === "util" && r.targetKey === "F002")!;
    expect(utilF002.value).toBe(0.7); // 70×0.01

    const oeeF001 = results.find((r) => r.field === "oeeIndex" && r.targetKey === "F001")!;
    expect(oeeF001.value).toBe(0.85); // (0.88+0.82)/2

    // F002 无设备记录 → 诚实空态（EMPTY·不造）
    const oeeF002 = results.find((r) => r.field === "oeeIndex" && r.targetKey === "F002")!;
    expect(oeeF002.value).toBeNull();
    expect(oeeF002.dataMode).toBe("EMPTY");
  });

  it("② R14 config-driven：换 mapping 到别的域/算子·引擎不动即工作（ratio 口径）", () => {
    const world = batteryLikeWorld();
    // util 改用 ratio = Σoee / Σcapacity（完全不同口径·只改数据）
    const mapping = DecisionFieldMappingSchema.parse({
      rules: [
        {
          target: { objectType: "Base", field: "loadRatio" },
          source: { objectType: "ProductionLine", field: "oee", denomField: "capacity", groupByField: "factory_id" },
          op: "ratio",
          targetKeyField: "factory_id",
          precision: 4,
        },
      ],
    });
    const r = deriveDecisionFields(mapping, world).find((x) => x.targetKey === "F001")!;
    // (90+80)/(100+100) = 0.85
    expect(r.value).toBe(0.85);
    expect(r.op).toBe("ratio");
  });

  it("③ R6 确定性：同输入字节级同结果", () => {
    const a = JSON.stringify(deriveDecisionFields(UTIL_MAPPING, batteryLikeWorld()));
    const b = JSON.stringify(deriveDecisionFields(UTIL_MAPPING, batteryLikeWorld()));
    expect(a).toBe(b);
  });

  it("④ green→red 自证：注入伪造/hash 值 → validateDerivedFields 逮住（KILL-MOCK-RED）", () => {
    const world = batteryLikeWorld();
    const results = deriveDecisionFields(UTIL_MAPPING, world);
    // 真结果干净
    expect(validateDerivedFields(UTIL_MAPPING, world, results)).toEqual([]);

    // 伪造：把 F001 util 改成臆造值（模拟 hash/写死冒充）
    const poisoned = results.map((r) => (r.field === "util" && r.targetKey === "F001" ? { ...r, value: 0.999 } : r));
    const caught = validateDerivedFields(UTIL_MAPPING, world, poisoned);
    expect(caught.length).toBeGreaterThan(0);
    expect(caught.join("")).toContain("真源重算");

    // 无溯源的数字（R13 死角）也被逮
    const noProv = results.map((r) => (r.field === "util" && r.targetKey === "F001" ? { ...r, sourceObjectIds: [] } : r));
    expect(validateDerivedFields(UTIL_MAPPING, world, noProv).length).toBeGreaterThan(0);
  });

  it("⑤ 合成物化源 → dataMode SYNTHETIC（不冒充 LIVE·世界态诚实）", () => {
    const world: ObjectsByType = new Map([
      ["Base", [{ id: "obj_Base_F001", props: { factory_id: "F001" }, real: true }]],
      ["ProductionLine", [{ id: "obj_PL_L1", props: { factory_id: "F001", oee: 90 }, real: false }]],
    ]);
    const r = deriveDecisionFields(UTIL_MAPPING, world).find((x) => x.field === "util")!;
    expect(r.value).toBe(0.9); // 值仍真算
    expect(r.dataMode).toBe("SYNTHETIC"); // 但源是合成物化 → 不上 LIVE
    expect(weakestDataMode([r])).toBe("SYNTHETIC");
  });
});
