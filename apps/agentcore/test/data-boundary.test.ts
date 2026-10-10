import { describe, expect, it } from "vitest";
import { decideDataGap, groundingVocab } from "../src/growth/data-boundary.js";
import { BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";

/**
 * DF.9 真人正门 HARD/SOFT 分流（PRD 生成接地层 §3.5，接地核心）：
 * 缺数据涉及真实业务实体（命中已发布业务词表）→ HARD：不静默合成、出精确 DataRequest 走真人正门；
 * 否则 SOFT：可经管线确定性合成 PROVISIONAL。词表与 DF.8 同源（BASE/SEG 单一来源 R14），确定性（R6）。
 */
describe("DF.9 · 真人正门 HARD/SOFT 分流（data boundary）", () => {
  it("groundingVocab = 基地名 + 应用细分名（与 DF.8 同源单一来源）", () => {
    const v = groundingVocab();
    expect(v).toEqual(expect.arrayContaining(["常州", "厦门", "乘用车", "储能"]));
    expect(v.length).toBe(BASE_REGISTRY.length + SEG_REGISTRY.length);
  });

  it("HARD：问句涉真实基地「常州」→ 不合成、出精确 DataRequest（typeKey/columns/entities/reason）", () => {
    const d = decideDataGap("常州基地的产能利用率是多少？", "", groundingVocab(), { typeKey: "Base", columns: ["baseId", "util"] });
    expect(d.mode).toBe("HARD");
    expect(d.entities).toContain("常州");
    expect(d.dataRequest).toBeDefined();
    expect(d.dataRequest!.typeKey).toBe("Base");
    expect(d.dataRequest!.columns).toEqual(["baseId", "util"]);
    expect(d.dataRequest!.reason).toContain("真人正门");
    expect(d.dataRequest!.reason).toContain("不静默合成");
  });

  it("HARD：实体出现在上下文（选中对象/过滤值）也命中", () => {
    const d = decideDataGap("这个的需求", "乘用车 east", groundingVocab(), { typeKey: "DemandSegment" });
    expect(d.mode).toBe("HARD");
    expect(d.entities).toContain("乘用车");
  });

  it("SOFT：通用缺数据（无具体真实实体）→ 可经管线合成（无 dataRequest）", () => {
    const d = decideDataGap("给我一些示例订单数据", "east Q3", groundingVocab());
    expect(d.mode).toBe("SOFT");
    expect(d.entities).toEqual([]);
    expect(d.dataRequest).toBeUndefined();
  });

  it("确定性（R6）+ 实体去重：同输入同输出、命中实体不重复", () => {
    const a = decideDataGap("常州 常州 储能的对比", "常州", groundingVocab(), { typeKey: "Base" });
    const b = decideDataGap("常州 常州 储能的对比", "常州", groundingVocab(), { typeKey: "Base" });
    expect(a).toEqual(b);
    expect(a.entities.filter((e) => e === "常州").length).toBe(1); // 去重
    expect(a.entities).toContain("储能");
  });

  it("columns 缺省 → 给出真人可读占位（指向对象类型已发布字段），不臆造列名", () => {
    const d = decideDataGap("厦门的良率", "", groundingVocab(), { typeKey: "Base" });
    expect(d.dataRequest!.columns[0]).toContain("已发布字段");
  });
});
