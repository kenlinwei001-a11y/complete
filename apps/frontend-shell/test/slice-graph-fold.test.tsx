import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import {
  buildDag,
  SLICE_GRAPH_BUCKET_MIN,
  SLICE_GRAPH_EXPAND_HOPS,
} from "@/pages/admin/SliceInspector";
import type { SliceGraph } from "@/api/endpoints";

/**
 * WO-SLICE-CONSUMPTION-20260912 · WO-1③：内联子图按跳折叠（AC4 对照实验规则钉死）。
 *
 * AC4 四个数的改后两数由本文件锁（分布 = 2026-09-12 demo 实测分层）：
 *  · domain_d06_capacity（834 节点：L0 Base×13+Model×6 / L1 Line×130+IBT×17+Order×18 /
 *    L2 WorkOrder×260+Process×260 / L3 CapacityPool×130）→ 首屏 19（改前盲 cap 48）
 *  · order_to_material_bom（101 节点：L0 Order×1+BOMDetail×49 / L1 19 / L2 29 / L3 Model×3）
 *    → 首屏 49（改前 48）—— 小切片**几乎不变**且 49≠50：证明按跳/按桶走，不是一刀切砍到阈值。
 */

/** 按「layer → [{typeKey, count}]」合成确定性图（同层内逐节点链到上一层第一个节点，保证分层确定）。 */
function synth(dist: { typeKey: string; count: number }[][]): SliceGraph {
  const nodes: SliceGraph["nodes"] = [];
  const edges: SliceGraph["edges"] = [];
  let prevLayerFirst: string | null = null;
  dist.forEach((buckets, layer) => {
    let firstOfLayer: string | null = null;
    for (const b of buckets) {
      for (let i = 0; i < b.count; i++) {
        const id = `L${layer}_${b.typeKey}_${i}`;
        nodes.push({ id, typeKey: b.typeKey, objectKey: id, props: {} });
        firstOfLayer ??= id;
        if (prevLayerFirst) edges.push({ linkKey: "lk", from: prevLayerFirst, to: id });
      }
    }
    prevLayerFirst = firstOfLayer;
  });
  return { nodes, edges, truncated: false, snapshotVersion: "t" };
}

// demo 实测分布（2026-09-12 · SEED_DEMO=1）
const D06 = synth([
  [{ typeKey: "Base", count: 13 }, { typeKey: "Model", count: 6 }],
  [{ typeKey: "Line", count: 130 }, { typeKey: "InterBaseTransfer", count: 17 }, { typeKey: "Order", count: 18 }],
  [{ typeKey: "WorkOrder", count: 260 }, { typeKey: "Process", count: 260 }],
  [{ typeKey: "CapacityPool", count: 130 }],
]);
const BOM = synth([
  [{ typeKey: "Order", count: 1 }, { typeKey: "BOMDetail", count: 49 }],
  [{ typeKey: "OrderLine", count: 3 }, { typeKey: "BOMHeader", count: 7 }, { typeKey: "Material", count: 8 }, { typeKey: "OrderPromise", count: 1 }],
  [{ typeKey: "ProductVersion", count: 7 }, { typeKey: "Supplier", count: 14 }, { typeKey: "MaterialBalance", count: 8 }],
  [{ typeKey: "Model", count: 3 }],
]);

describe("buildDag 按跳折叠（AC4 改后两数）", () => {
  it("大切片 domain_d06_capacity 分布：首屏 19（改前盲 cap 48 → 显著下降）", () => {
    const dag = buildDag(D06);
    expect(dag.total).toBe(834);
    // L0 两桶都 ≤16 → 全个显；L1 三桶 >16 全折；L2/L3 深层全折
    expect(dag.shown).toBe(19);
    expect(dag.folded).toBe(834 - 19);
    expect(dag.groups.map((g) => `${g.layer}:${g.typeKey}×${g.count}`)).toEqual([
      "1:InterBaseTransfer×17",
      "1:Line×130",
      "1:Order×18",
      "2:Process×260",
      "2:WorkOrder×260",
      "3:CapacityPool×130",
    ]);
    // 深层组标 deep=true；宽层组（浅层但超桶阈值）deep=false
    expect(dag.groups.find((g) => g.typeKey === "Line")!.deep).toBe(false);
    expect(dag.groups.find((g) => g.typeKey === "CapacityPool")!.deep).toBe(true);
  });

  it("小切片 order_to_material_bom 分布：首屏 49（≈改前 48 且 ≠50 ⇒ 非一刀切）", () => {
    const dag = buildDag(BOM);
    expect(dag.total).toBe(101);
    expect(dag.shown).toBe(49); // 1 + (3+7+8+1) + (7+14+8)
    expect(dag.folded).toBe(52); // BOMDetail×49 + Model×3
    expect(dag.groups.map((g) => `${g.layer}:${g.typeKey}×${g.count}`)).toEqual([
      "0:BOMDetail×49",
      "3:Model×3",
    ]);
  });

  it("展开一个组 → 该组节点个显、folded 收缩、边只在个显节点间", () => {
    const dag = buildDag(D06, new Set([`1|Line`]));
    expect(dag.shown).toBe(19 + 130);
    expect(dag.folded).toBe(834 - 149);
    expect(dag.groups).toHaveLength(5);
    const ids = new Set(dag.nodes.map((n) => n.id));
    for (const e of dag.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("折叠阈值边界：桶 =16 个显，=17 折（SLICE_GRAPH_BUCKET_MIN）", () => {
    expect(SLICE_GRAPH_EXPAND_HOPS).toBe(2);
    expect(SLICE_GRAPH_BUCKET_MIN).toBe(16);
    const at16 = synth([[{ typeKey: "A", count: 1 }], [{ typeKey: "B", count: 16 }]]);
    const at17 = synth([[{ typeKey: "A", count: 1 }], [{ typeKey: "B", count: 17 }]]);
    expect(buildDag(at16).shown).toBe(17);
    expect(buildDag(at16).groups).toHaveLength(0);
    expect(buildDag(at17).shown).toBe(1);
    expect(buildDag(at17).groups).toHaveLength(1);
  });
});

describe("内联子图折叠 UI（真路由 · mock 宽扇出图）", () => {
  it("宽扇出切片：首屏 1 节点 + Base×20 组 chip → 点开 21 节点 → 收起回 1", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/slices?tab=plan");
    // 路径规划页签建一条 wide_* 切片（mock PUT 真登记；wide_ 键触发 mock 宽扇出图）
    const builder = await screen.findByTestId("slice-builder");
    const root = within(builder).getByTestId("slice-root") as HTMLSelectElement;
    // 根类型清单异步拉取（types 接口），等它真的挂上选项再选
    await waitFor(() => expect(root.options.length).toBeGreaterThan(1));
    await user.selectOptions(root, root.options[1]!.value);
    const targets = await within(builder).findByTestId("slice-targets");
    await user.click(within(targets).getAllByRole("button")[0]!);
    await user.click(within(builder).getByTestId("slice-plan"));
    await screen.findByTestId("slice-plan-result");
    const keyInput = within(builder).getByTestId("slice-key") as HTMLInputElement;
    await user.clear(keyInput);
    await user.type(keyInput, "wide_fanout_demo");
    await user.click(within(builder).getByTestId("slice-save"));

    // 已登记页签 → 展开该切片行 → 内联子图按跳折叠
    await user.click(await screen.findByTestId("slices-tab-registered"));
    await user.click(await screen.findByTestId("slice-row-wide_fanout_demo"));
    expect((await screen.findByTestId("slice-graph-shown-wide_fanout_demo")).textContent).toBe("1");
    expect(screen.getByTestId("slice-graph-folded-wide_fanout_demo").textContent).toBe("20");
    const chip = screen.getByTestId("slice-graph-group-wide_fanout_demo-1-Base");
    expect(chip.textContent).toContain("Base 20 个");

    // 点开组 → 21 节点全显；收起 → 回 1
    await user.click(chip);
    expect((await screen.findByTestId("slice-graph-shown-wide_fanout_demo")).textContent).toBe("21");
    await user.click(await screen.findByTestId("slice-graph-ungroup-wide_fanout_demo-1-Base"));
    expect((await screen.findByTestId("slice-graph-shown-wide_fanout_demo")).textContent).toBe("1");
  });
});
