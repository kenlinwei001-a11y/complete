import { describe, expect, it } from "vitest";
import {
  SLICE_CONVERGE_THRESHOLD,
  SLICE_SAMPLE_PER_TYPE,
  SLICE_SAMPLE_TOTAL_CAP,
  shapeSliceReceipt,
  type ShapedSliceReceipt,
} from "../src/tools/slice-receipt.js";

/**
 * WO-SLICE-CONSUMPTION-20260912 · resolve_slice 收敛回执（前置 C1）。
 * 判据锚点：AC5（改后 < 改前 1/10 且 < 12KB · 改前实测 296,657B 是 534 节点真图，
 * 本测试用 534 节点合成图同口径压）+ 透传规则（遗留定制形/小图形不动）。
 */

/**
 * 合成 534 节点图：1 Order(根) → 4 Base → 40 Line → 200 Process → 289 Equipment（对齐实测分布）。
 * ⚠ 边朝向对齐**线上真实回包**：Equipment→Process 是**反向边**（2026-09-12 AC5 实测：
 * /a/v1/slices/order_fulfillment_360/resolve 零入度 241 = 真根 Order×1 + 上游叶子 Equipment×240）。
 * 若按顺向合成，「零入度=根」会把 240 个伪根全量 props 塞进回执（实测 79,336B 破 12KB 判据）——
 * 这正是旧实现线上红而单测绿的原因：合成图朝向与真实回包不一致。
 */
function bigGraph() {
  const nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[] = [];
  const edges: { from: string; to: string; linkKey: string }[] = [];
  nodes.push({ id: "obj_order_SO-3391", typeKey: "Order", objectKey: "SO-3391", props: { so: "SO-3391", qty: 7259, due: "2026-06-24", cust: "广汽集团", model: "4680-NCM", value: 1888888.5 } });
  let eqLeft = 289;
  for (let b = 0; b < 4; b++) {
    const base = `obj_base_B${b}`;
    nodes.push({ id: base, typeKey: "Base", objectKey: `B${b}`, props: { baseId: `B${b}`, name: `基地${b}` } });
    edges.push({ from: "obj_order_SO-3391", to: base, linkKey: "order_producible_at" });
    for (let l = 0; l < 10; l++) {
      const line = `obj_line_${base}_L${l}`;
      nodes.push({ id: line, typeKey: "Line", objectKey: `L${l}`, props: { lineId: `L${l}` } });
      edges.push({ from: base, to: line, linkKey: "line_belongs_to_base" });
      for (let p = 0; p < 5; p++) {
        const proc = `obj_process_${line}_P${p}`;
        nodes.push({ id: proc, typeKey: "Process", objectKey: `P${p}`, props: { processId: `P${p}`, ctSeconds: 42 } });
        edges.push({ from: line, to: proc, linkKey: "line_has_process" });
        // 289 台设备摊到 200 个 Process：前 89 个每席位 2 台，其余 1 台
        const seats = b * 50 + l * 5 + p < 89 ? 2 : 1;
        for (let e = 0; e < seats && eqLeft > 0; e++, eqLeft--) {
          const eq = `obj_equipment_${proc}_E${e}`;
          nodes.push({ id: eq, typeKey: "Equipment", objectKey: `E${e}`, props: { equipId: `E${e}`, oeeA: 0.87, oeeP: 0.91, oeeQ: 0.99 } });
          edges.push({ from: eq, to: proc, linkKey: "process_uses_equipment" }); // 反向边（对齐线上回包朝向）
        }
      }
    }
  }
  return { data: { nodes, edges, truncated: false }, snapshotVersion: "snap-test-1" };
}

describe("shapeSliceReceipt · 透传规则", () => {
  it("遗留定制形（无 nodes/edges 数组）原样透传", () => {
    const legacy = { data: { model: { modelId: "4680-NCM" }, bases: [{ base: "常州", util: 0.8 }] }, snapshotVersion: "s1" };
    expect(shapeSliceReceipt("model_capacity_network", legacy)).toBe(legacy);
  });

  it("小图形（nodes ≤ 阈值）原样透传", () => {
    const small = {
      data: {
        nodes: Array.from({ length: SLICE_CONVERGE_THRESHOLD }, (_, i) => ({ id: `n${i}`, typeKey: "T", props: { id: i } })),
        edges: [],
      },
    };
    expect(shapeSliceReceipt("small", small)).toBe(small);
  });
});

describe("shapeSliceReceipt · 大图形收敛（C1）", () => {
  const shaped = shapeSliceReceipt("order_fulfillment_360", bigGraph()) as ShapedSliceReceipt;

  it("标记 + 全量计数 + snapshotVersion/truncated 保留", () => {
    expect(shaped.shape).toBe("SLICE_RECEIPT_V1");
    expect(shaped.sliceKey).toBe("order_fulfillment_360");
    expect(shaped.snapshotVersion).toBe("snap-test-1");
    expect(shaped.truncated).toBe(false);
    expect(shaped.summary.totalNodes).toBe(534);
    expect(shaped.summary.byType).toEqual({ Order: 1, Base: 4, Line: 40, Process: 200, Equipment: 289 });
  });

  it("根节点全量 props 保留（锚点）", () => {
    expect(shaped.rootNodes).toHaveLength(1);
    expect(shaped.rootNodes[0]!.id).toBe("obj_order_SO-3391");
    expect(shaped.rootNodes[0]!.props?.so).toBe("SO-3391");
  });

  it("类型×跳数计数表（BFS 深度）", () => {
    expect(shaped.summary.byTypeDepth.Order).toEqual({ "0": 1 });
    expect(shaped.summary.byTypeDepth.Base).toEqual({ "1": 4 });
    expect(shaped.summary.byTypeDepth.Line).toEqual({ "2": 40 });
    expect(shaped.summary.byTypeDepth.Process).toEqual({ "3": 200 });
  });

  it("深层样本：每类型 ≤8、无 props、omitted 计数闭合", () => {
    const byType = new Map<string, number>();
    for (const s of shaped.sampleNodes) {
      expect(s).not.toHaveProperty("props");
      byType.set(s.typeKey, (byType.get(s.typeKey) ?? 0) + 1);
    }
    expect(shaped.sampleNodes.length).toBeLessThanOrEqual(SLICE_SAMPLE_TOTAL_CAP);
    for (const [t, n] of byType) expect(n).toBeLessThanOrEqual(SLICE_SAMPLE_PER_TYPE);
    // omitted = byType − 根 − 样本（Equipment 289 全深层：289−8=281）
    expect(shaped.drilldown.omittedByType.Equipment).toBe(289 - SLICE_SAMPLE_PER_TYPE);
    expect(shaped.drilldown.omittedByType.Process).toBe(200 - SLICE_SAMPLE_PER_TYPE);
    expect(shaped.drilldown.tools).toEqual(["get_object", "query_objects"]);
    expect(shaped.drilldown.hint).toContain("get_object");
    expect(shaped.drilldown.hint).toContain("query_objects");
  });

  it("AC5 同口径：534 节点收敛后回包 < 12KB 且 < 296,657B 的 1/10", () => {
    const bytes = Buffer.byteLength(JSON.stringify(shaped), "utf8");
    expect(bytes).toBeLessThan(12 * 1024);
    expect(bytes).toBeLessThan(296_657 / 10);
  });

  it("反向边（线上朝向）：伪根不进 rootNodes、Equipment 进样本且带逐字可用 filter", () => {
    // 真根只有 Order；240+ 个零入度 Equipment 是上游叶子，不许带全量 props 进 rootNodes
    expect(shaped.rootNodes).toHaveLength(1);
    expect(shaped.rootNodes[0]!.typeKey).toBe("Order");
    const eqSamples = shaped.sampleNodes.filter((n) => n.typeKey === "Equipment");
    expect(eqSamples.length).toBe(SLICE_SAMPLE_PER_TYPE);
    // 下钻 filter = props 里值 === objectKey 的那个字段（equipId），query_objects 逐字可用
    expect(eqSamples[0]!.filter).toEqual({ equipId: eqSamples[0]!.objectKey });
    // 无向跳数：反向边叶子同样是深层（Order0→Base1→Line2→Process3→Equipment4）
    expect(eqSamples.every((n) => n.depth === 4)).toBe(true);
  });

  it("环图（全部节点被指向）→ 根退化为首节点，rootNodes 非空", () => {
    const ring = {
      data: {
        nodes: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, typeKey: "T", props: { i } })),
        edges: Array.from({ length: 50 }, (_, i) => ({ from: `r${i}`, to: `r${(i + 1) % 50}`, linkKey: "ring" })),
      },
    };
    const out = shapeSliceReceipt("ring", ring) as ShapedSliceReceipt;
    expect(out.rootNodes.length).toBeGreaterThan(0);
    expect(out.summary.byTypeDepth.T).toBeDefined();
  });
});
