import { describe, expect, it } from "vitest";
import { generateBattery } from "../src/synthetic/battery.js";

/**
 * WO-SA-4/5/6 台账（ledger/record）字段 green→red teeth。
 * 覆盖：Base 工厂台账 6 字段（常量映射真事实）· Line 产线台账 4 字段（含 rngTopo 末位追加数值）·
 * Equipment 设备台账 5 字段（确定性派生·equipment_type 在声明 enum 域内）。
 * 并断言 R6：同 (seed, scale) 双跑 byte-identical（JSON.stringify 相等）。
 */

const BASE_LEDGER_ENUM = { factory_type: ["CELL", "PACK", "MATERIAL"], status: ["ACTIVE", "CONSTRUCTION", "PLANNED", "SUSPENDED"] };
const LINE_STATUS_ENUM = ["RUNNING", "IDLE", "MAINTENANCE"];
const EQUIP_STATUS_ENUM = ["RUNNING", "IDLE", "MAINTENANCE"];
// equipment_type 声明域 = WORKSHOP_TYPES.code（10 工艺码）；合成只用其中 3（COATING/WINDING/ASSEMBLY）——须 ⊆ 声明域。
const EQUIP_TYPE_ENUM = ["SLURRY", "COATING", "CALENDER", "SLITTING", "WINDING", "ASSEMBLY", "ELECTROLYTE", "FORMATION", "AGING", "PACK"];

describe("WO-SA-4/5/6 台账字段合成 + R6", () => {
  it("SA-4: Base 携带工厂台账 6 字段·常州→江苏省/常州市/CELL（常量映射真事实·非 rng）", () => {
    const g = generateBattery(42, "S");
    const cz = g.bases.find((b) => (b as Record<string, unknown>).baseId === "changzhou") as Record<string, unknown>;
    expect(cz).toBeTruthy();
    // 判据②Base.province 等——红：仅声明未合成则 undefined。
    expect(cz.factory_code).toBe("FAC-CZ01");
    expect(cz.province).toBe("江苏省");
    expect(cz.city).toBe("常州市");
    expect(cz.factory_type).toBe("CELL");
    expect(cz.status).toBe("ACTIVE");
    expect(cz.start_date).toBe("2015-01-01"); // 对齐 BASE_REGISTRY.prodYear=2015

    // 另证一座异省基地映射正确（枣庄→山东省）。
    const zz = g.bases.find((b) => (b as Record<string, unknown>).baseId === "zaozhuang") as Record<string, unknown>;
    expect(zz.province).toBe("山东省");
    expect(zz.city).toBe("枣庄市");

    // 全 12 基地 6 字段齐全 + enum 在域内。
    for (const b of g.bases as Record<string, unknown>[]) {
      for (const k of ["factory_code", "province", "city", "factory_type", "status", "start_date"]) {
        expect(b[k], `Base.${k} 未合成`).toBeDefined();
      }
      expect(BASE_LEDGER_ENUM.factory_type).toContain(b.factory_type);
      expect(BASE_LEDGER_ENUM.status).toContain(b.status);
      expect(String(b.start_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("SA-5: Line 携带 line_code/max_capacity_day/target_yield/status（含 rngTopo 末位追加数值）", () => {
    const g = generateBattery(42, "S");
    expect(g.lines.length).toBeGreaterThan(0);
    for (const l of g.lines as Record<string, unknown>[]) {
      // 红：合成跳过则 undefined。
      expect(l.line_code, "Line.line_code 未合成").toBeDefined();
      expect(String(l.line_code)).toMatch(/^LN-.+-01$/);
      expect(typeof l.max_capacity_day, "Line.max_capacity_day 未合成").toBe("number");
      expect(typeof l.target_yield, "Line.target_yield 未合成").toBe("number");
      expect(LINE_STATUS_ENUM).toContain(l.status);
      // 台账语义：设计铭牌 ≥ 运营日产能（capacityDaily）。
      expect(Number(l.max_capacity_day)).toBeGreaterThanOrEqual(Number(l.capacityDaily));
      // 目标良率合理域。
      expect(Number(l.target_yield)).toBeGreaterThanOrEqual(0.95);
      expect(Number(l.target_yield)).toBeLessThanOrEqual(0.99);
    }
  });

  it("SA-6: Equipment 携带 5 台账字段·equipment_type 在声明 enum 域内（越域即红）", () => {
    const g = generateBattery(42, "S");
    expect(g.equipment.length).toBeGreaterThan(0);
    for (const eq of g.equipment as Record<string, unknown>[]) {
      for (const k of ["equipment_code", "equipment_type", "manufacturer", "install_date", "status"]) {
        expect(eq[k], `Equipment.${k} 未合成`).toBeDefined();
      }
      expect(String(eq.equipment_code)).toMatch(/^EQP-\d{6}$/);
      // enum 校验红：值落在声明 enumValues 之外即失败。
      expect(EQUIP_TYPE_ENUM, `equipment_type=${String(eq.equipment_type)} 越出声明域`).toContain(eq.equipment_type);
      expect(EQUIP_STATUS_ENUM).toContain(eq.status);
      expect(String(eq.install_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(eq.manufacturer).length).toBeGreaterThan(0);
      // equipment_type 由 processId 工序确定性派生（coating→COATING …）。
      const pid = String(eq.processId);
      if (pid.endsWith("-coating")) expect(eq.equipment_type).toBe("COATING");
      if (pid.endsWith("-winding")) expect(eq.equipment_type).toBe("WINDING");
      if (pid.endsWith("-assembly")) expect(eq.equipment_type).toBe("ASSEMBLY");
    }
    // equipment_type 至少覆盖三工序（证真派生而非常量）。
    const types = new Set((g.equipment as Record<string, unknown>[]).map((e) => e.equipment_type));
    expect(types).toEqual(new Set(["COATING", "WINDING", "ASSEMBLY"]));
  });

  it("R6: 同 (seed=42, scale=S) 双跑 byte-identical（bases/lines/equipment）", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(JSON.stringify(a.bases)).toBe(JSON.stringify(b.bases));
    expect(JSON.stringify(a.lines)).toBe(JSON.stringify(b.lines));
    expect(JSON.stringify(a.equipment)).toBe(JSON.stringify(b.equipment));
    // 整体产物字节一致（含 processes/orders 等下游·证 SA-5 rngTopo 追加未位移既有字节）。
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
