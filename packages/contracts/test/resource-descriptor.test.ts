import { describe, expect, it } from "vitest";
import {
  ResourceDescriptorSchema,
  RESOURCE_KINDS,
  findUndescribed,
  OPERATION_CATALOG,
} from "../src/index.js";

describe("WO-RESOURCE-DESCRIPTOR · 统一资源描述契约 + 发现门核心校验", () => {
  const good = { kind: "solver", key: "capacity_forecast", label: "产能推演", description: "推演产能满足度。" };

  it("合法 descriptor 通过；kind 枚举含全五池类别", () => {
    expect(ResourceDescriptorSchema.safeParse(good).success).toBe(true);
    for (const k of ["solver", "slice", "workflow", "intent", "field", "mcp_tool"]) {
      expect(RESOURCE_KINDS).toContain(k);
    }
  });

  it("description 空 / 缺失 → schema 拒绝（无描述不允许发布）", () => {
    expect(ResourceDescriptorSchema.safeParse({ ...good, description: "" }).success).toBe(false);
    const { description, ...noDesc } = good;
    void description;
    expect(ResourceDescriptorSchema.safeParse(noDesc).success).toBe(false);
  });

  it("findUndescribed 真闸：造无描述资源被捕获，补上即绿（green→red 有牙）", () => {
    // 全绿池 → 无 violation。
    const clean = [good, { kind: "mcp_tool", key: "discover", label: "discover", description: "发现能力目录。" }];
    expect(findUndescribed(clean)).toHaveLength(0);

    // 掺入一个无 description 资源 → 门捕获（红）。
    const dirty = [...clean, { kind: "solver", key: "ghost_solver", label: "幽灵求解器" /* 无 description */ }];
    const v = findUndescribed(dirty);
    expect(v).toHaveLength(1);
    expect(v[0]!.key).toBe("ghost_solver");
    expect(v[0]!.reason).toMatch(/description/);

    // 补上 description → 复绿（真闸非死板）。
    const fixed = dirty.map((c) => (c.key === "ghost_solver" ? { ...c, description: "补齐后的描述。" } : c));
    expect(findUndescribed(fixed)).toHaveLength(0);
  });

  it("操作意图池（工作流·意图）全条带非空 description（回填后全覆盖）", () => {
    expect(OPERATION_CATALOG.length).toBeGreaterThan(0);
    for (const e of OPERATION_CATALOG) {
      expect(e.description.trim().length, `op ${e.op} 缺 description`).toBeGreaterThan(0);
    }
  });
});
