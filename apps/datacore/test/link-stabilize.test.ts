import { describe, expect, it } from "vitest";
import { deriveSliceHops } from "../src/databuilder/comprehend.js";
import type { BuildPlan } from "@platform/contracts";

/**
 * WO-DB-LINK-STABILIZE 齿（洞E·链路派生稳定·FK 兜底补链·真 BFS 多跳·green→red·R6）：
 *  ① 显式 refToTypeKey → planSlice 派生真 hops（非恒 []·多跳可达）；
 *  ② **LLM 丢链**（refToTypeKey 缺·仅属性名 <Type>ref/id）→ FK 名启发兜底补 → hops 非空（门绿）；
 *  ③ 关兜底（fkFallback=false）+ 丢链 → hops 空（门红·证兜底真生效·非死板 green→red）；
 *  ④ R6：同 objectTypes 双跑字节一致命中 hops。
 */
type OT = BuildPlan["objectTypes"];
const ot = (typeKey: string, domain: string, props: { propKey: string; ref?: string; pk?: boolean }[]): OT[number] => ({
  typeKey, displayName: typeKey, domain, sourceDataset: typeKey.toLowerCase(),
  properties: props.map((p) => ({ propKey: p.propKey, sourceField: p.propKey, dataType: p.ref ? "ref" : "string", isPrimaryKey: !!p.pk, refToTypeKey: p.ref ?? null })),
});

describe("WO-DB-LINK-STABILIZE · 链路派生稳定（FK 兜底 + planSlice 真多跳）", () => {
  it("① 显式 refToTypeKey → 派生真 hops（非恒 []）", () => {
    const types: OT = [
      ot("Order", "sales", [{ propKey: "order_id", pk: true }]),
      ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef", ref: "Order" }]),
    ];
    const hops = deriveSliceHops(types);
    expect(hops.get("Process")).toContain("Process_orderRef_ref"); // Process→Order 真链
    expect(hops.get("Process")!.length).toBeGreaterThan(0);
  });

  it("② LLM 丢链（refToTypeKey 缺·仅属性名 orderRef）→ FK 名启发兜底补 → hops 非空（门绿）", () => {
    const dropped: OT = [
      ot("Order", "sales", [{ propKey: "order_id", pk: true }]),
      ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef" }]), // ref 缺（LLM 丢）
    ];
    const withFallback = deriveSliceHops(dropped); // 默认 fkFallback 开
    expect(withFallback.get("Process")!.length).toBeGreaterThan(0); // 名启发补回 Process→Order
    expect(withFallback.get("Process")).toContain("Process_orderRef_ref");
  });

  it("③ 关兜底 + 丢链 → hops 空（门红·证兜底真生效·green→red 有牙）", () => {
    const dropped: OT = [
      ot("Order", "sales", [{ propKey: "order_id", pk: true }]),
      ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef" }]),
    ];
    const noFallback = deriveSliceHops(dropped, { fkFallback: false });
    expect(noFallback.get("Process")).toEqual([]); // 不补 → 空（对照②证兜底非死板）
  });

  it("④ R6：同 objectTypes 双跑字节一致", () => {
    const types: OT = [
      ot("Order", "sales", [{ propKey: "order_id", pk: true }]),
      ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef", ref: "Order" }]),
      ot("Equipment", "factory", [{ propKey: "eq_id", pk: true }, { propKey: "processRef", ref: "Process" }]),
    ];
    const a = JSON.stringify([...deriveSliceHops(types)].sort());
    const b = JSON.stringify([...deriveSliceHops(types)].sort());
    expect(a).toBe(b);
    // 多跳：Equipment→Process→Order 链（真 BFS 穿越）。
    expect(deriveSliceHops(types).get("Equipment")!.length).toBeGreaterThanOrEqual(1);
  });
});
