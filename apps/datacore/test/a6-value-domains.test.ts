import { describe, expect, it } from "vitest";
import type { GenSpec, PlantSpec } from "@platform/contracts";
import { mulberry32 } from "../src/prng.js";
import { sampleValueDomain, applyPlantCrossings, violatesPlant, derivePlantFromRule, resolveDomainByProp } from "../src/synthetic/value-domains.js";

const vd = (o: Partial<Extract<GenSpec, { kind: "valueDomain" }>>): Extract<GenSpec, { kind: "valueDomain" }> => ({ kind: "valueDomain", ...o });

describe("A6 · 拟真值域采样（确定性 R6 + 落业务区间）", () => {
  it("normal/banded/uniform 三形采样都落 band，且同 seed 字节一致（R6）", () => {
    for (const shape of ["uniform", "normal", "banded"] as const) {
      const spec = vd({ band: [0.62, 0.95], shape });
      const a = Array.from({ length: 50 }, (_, i) => sampleValueDomain(spec, "util", mulberry32(42 + i)));
      const b = Array.from({ length: 50 }, (_, i) => sampleValueDomain(spec, "util", mulberry32(42 + i)));
      expect(a).toEqual(b); // 同 seed 重算字节一致
      expect(a.every((v) => v >= 0.62 && v <= 0.95)).toBe(true); // 全落业务区间
    }
  });

  it("domainKey 命中值域库 → 用库的 band（毛利率 0.11–0.20）", () => {
    const spec = vd({ domainKey: "marginpct", shape: "normal" });
    const vals = Array.from({ length: 40 }, (_, i) => sampleValueDomain(spec, "x", mulberry32(7 + i)));
    expect(vals.every((v) => v >= 0.11 && v <= 0.2)).toBe(true);
  });

  it("属性名语义匹配值域库（util/yield/coverDays 命中）", () => {
    expect(resolveDomainByProp("schedule_attainment")?.band).toEqual([0.8, 1.02]);
    expect(resolveDomainByProp("yield_baseline")?.band).toEqual([0.9, 0.99]);
    expect(resolveDomainByProp("randomXyz")).toBeUndefined();
  });
});

describe("A6 · 确定性越线植入（固定索引 + 查准素材）", () => {
  const rows = (): Record<string, unknown>[] => Array.from({ length: 10 }, (_, i) => ({ id: i, util: 0.7 }));
  const plant: PlantSpec = { ruleKey: "C_UTIL", typeKey: "Line", field: "util", op: "gt", threshold: 0.95, crossCount: 2, nearCount: 2, delta: 0.03 };

  it("crossCount 行越线（独立谓词捕获）+ nearCount 行近边界（合规）", () => {
    const rs = rows();
    const { crossedIdx, nearIdx } = applyPlantCrossings(rs, plant);
    expect(crossedIdx).toEqual([0, 1]);
    expect(nearIdx).toEqual([2, 3]);
    // 越线行被独立谓词捕获（VLE ④查准素材）
    expect(rs.filter((r) => violatesPlant(r, plant)).length).toBe(2);
    // 近边界行恰好合规（不越线）
    expect(violatesPlant(rs[2]!, plant)).toBe(false);
    expect(Number(rs[2]!.util)).toBeLessThan(0.95);
  });

  it("植入确定性可复算（同输入同输出 R6）", () => {
    const a = rows(); applyPlantCrossings(a, plant);
    const b = rows(); applyPlantCrossings(b, plant);
    expect(a).toEqual(b);
  });

  it("lt 方向：值需 < 阈值才违规 → 植 < 阈值的越线", () => {
    const rs = Array.from({ length: 6 }, () => ({ yield: 0.95 } as Record<string, unknown>));
    const p: PlantSpec = { ruleKey: "C_YIELD", typeKey: "Proc", field: "yield", op: "lt", threshold: 0.9, crossCount: 1, nearCount: 1, delta: 0.02 };
    applyPlantCrossings(rs, p);
    expect(Number(rs[0]!.yield)).toBeLessThan(0.9); // 越线
    expect(violatesPlant(rs[0]!, p)).toBe(true);
    expect(violatesPlant(rs[1]!, p)).toBe(false); // 近边界合规
  });
});

describe("A6 · 规则反推默认 PlantSpec（违规谓词 → 植入规约）", () => {
  it("简单形 Type.field <op> number 反推；复杂表达式跳过", () => {
    const p = derivePlantFromRule({ key: "C03", expression: "Order.demandDelta > 0.5" }, "Order");
    expect(p).toMatchObject({ ruleKey: "C03", typeKey: "Order", field: "demandDelta", op: "gt", threshold: 0.5 });
    // 表达式对象类型不匹配 → 不植
    expect(derivePlantFromRule({ key: "C03", expression: "Order.demandDelta > 0.5" }, "Line")).toBeUndefined();
    // 复杂表达式（无简单比较）→ 跳过
    expect(derivePlantFromRule({ key: "Cx", expression: "SUSTAIN(Line.util, 3)" }, "Line")).toBeUndefined();
  });
});

