import { describe, expect, it } from "vitest";
import { auditSliceConnectivity, type SliceLibEntry, type LibType, type LibLink } from "../src/ontology/slice-library.js";

// 最小夹具工厂：只填连通性关心的 sliceKey + spannedTypes（其余字段占位）。
function slice(sliceKey: string, spannedTypes: string[]): SliceLibEntry {
  return {
    sliceKey,
    scope: "intra",
    rootType: spannedTypes[0] ?? "",
    domain: "d",
    spannedTypes: [...spannedTypes].sort(),
    spannedDomains: ["d"],
    paths: [],
  };
}
function type(key: string, domain: string): LibType {
  return { key, domain };
}
function link(linkKey: string, from: string, to: string): LibLink {
  return { linkKey, fromTypeKey: from, toTypeKey: to };
}

describe("WO-SLICE-CONNECTIVITY · SEAM 守门（切片可 join 真语义·R6·堵 G-BUILD-LINK）", () => {
  it("孤岛检出：无共享类型、无桥接 link 的两切片都是孤岛", () => {
    // X{A,B}、Y{C,D}，{A,B} 与 {C,D} 间无任何 link → 两者互不可 join。
    const entries = [slice("X", ["A", "B"]), slice("Y", ["C", "D"])];
    const types = [type("A", "d1"), type("B", "d1"), type("C", "d2"), type("D", "d2")];
    const links: LibLink[] = []; // 无桥接
    const rep = auditSliceConnectivity(entries, types, links);
    const islandKeys = rep.islands.map((i) => i.sliceKey);
    expect(islandKeys).toContain("X");
    expect(islandKeys).toContain("Y");
    expect(rep.edges).toEqual([]);
    expect(rep.degree).toEqual({ X: 0, Y: 0 });
  });

  it("共享类型连通：切片共享一个 spannedType → via:shared-type，二者度≥1，非孤岛", () => {
    // X{A,B}、Z{B,E} 共享 B。
    const entries = [slice("X", ["A", "B"]), slice("Z", ["B", "E"])];
    const types = [type("A", "d"), type("B", "d"), type("E", "d")];
    const rep = auditSliceConnectivity(entries, types, []);
    const edge = rep.edges.find((e) => e.a === "X" && e.b === "Z");
    expect(edge).toBeDefined();
    expect(edge!.via).toBe("shared-type");
    expect(edge!.detail).toBe("B"); // 记共享的类型
    expect(rep.degree.X).toBeGreaterThanOrEqual(1);
    expect(rep.degree.Z).toBeGreaterThanOrEqual(1);
    expect(rep.islands).toEqual([]);
  });

  it("桥接 link 连通：切片无共享类型，但有 link A→F 桥接 → via:bridge-link（跨切片可 join 真语义）", () => {
    // X{A}、W{F}，无共享类型，但 link ab_to_f: A→F 桥接。
    const entries = [slice("X", ["A"]), slice("W", ["F"])];
    const types = [type("A", "d1"), type("F", "d2")];
    const links = [link("ab_to_f", "A", "F")];
    const rep = auditSliceConnectivity(entries, types, links);
    const edge = rep.edges.find((e) => e.a === "W" && e.b === "X"); // a<b 字典序：W<X
    expect(edge).toBeDefined();
    expect(edge!.via).toBe("bridge-link");
    expect(edge!.detail).toBe("ab_to_f: A→F"); // linkKey + join 字段 from→to type
    expect(rep.islands).toEqual([]);
  });

  it("共享类型优先于桥接 link：一对切片至多一条边（degree 不重复计）", () => {
    // X{A,B}、Y{B,C} 共享 B，同时 link a_to_c: A→C 也桥接 → 只出 shared-type 一条边。
    const entries = [slice("X", ["A", "B"]), slice("Y", ["B", "C"])];
    const types = [type("A", "d"), type("B", "d"), type("C", "d")];
    const links = [link("a_to_c", "A", "C")];
    const rep = auditSliceConnectivity(entries, types, links);
    const pair = rep.edges.filter((e) => e.a === "X" && e.b === "Y");
    expect(pair).toHaveLength(1);
    expect(pair[0]!.via).toBe("shared-type");
    expect(rep.degree).toEqual({ X: 1, Y: 1 });
  });

  it("自环不算边：切片自身类型间的 link 不使其脱离孤岛", () => {
    // X{A}，link self: A→A（自指），无其它切片 → X 仍是孤岛。
    const entries = [slice("X", ["A"]), slice("Y", ["C"])];
    const types = [type("A", "d"), type("C", "d")];
    const links = [link("self", "A", "A")];
    const rep = auditSliceConnectivity(entries, types, links);
    expect(rep.islands.map((i) => i.sliceKey)).toEqual(["X", "Y"]);
    expect(rep.edges).toEqual([]);
  });

  it("R6 确定性：同图两次调用 edges/islands/degree 字节一致", () => {
    const entries = [slice("X", ["A", "B"]), slice("Y", ["B", "C"]), slice("Z", ["D"])];
    const types = [type("A", "d"), type("B", "d"), type("C", "d"), type("D", "e")];
    const links = [link("c_to_d", "C", "D")];
    const one = JSON.stringify(auditSliceConnectivity(entries, types, links));
    const two = JSON.stringify(auditSliceConnectivity(entries, types, links));
    expect(one).toBe(two);
    // 具体结构：X-Y 共享 B；Y-Z 经 c_to_d 桥接；X-Z 无边。
    const rep = auditSliceConnectivity(entries, types, links);
    expect(rep.slices).toEqual(["X", "Y", "Z"]);
    expect(rep.islands).toEqual([]);
    expect(rep.edges.map((e) => `${e.a}-${e.b}:${e.via}`)).toEqual(["X-Y:shared-type", "Y-Z:bridge-link"]);
  });
});
