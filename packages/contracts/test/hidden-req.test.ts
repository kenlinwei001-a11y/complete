import { describe, expect, it } from "vitest";
import {
  DATADEP_ROLE_CANONICAL,
  HIDDEN_REQ_COVERAGE_THRESHOLD,
  SOLVER_DATADEP,
  expandHiddenRequirements,
  type HiddenReqBindings,
  type HiddenReqGraph,
} from "../src/index.js";

// C1（UPG-L0-HIDDENREQ · PRD-gap-analysis-engine §15 V8）：喂含 order 的显式需求 + 真实电池本体图
// → 断言 expandHiddenRequirements 扩展出的**每个 key ∈ 真实注册表**（三白名单 by-construction·零幽灵）。
// R6：同输入字节级一致。R14：只认抽象角色 + 图结构（bindings 经 canonical 解析真类型）。

// —— 真实电池本体图（节点 = DATADEP_ROLE_CANONICAL 的真类型键；边 = 真链路 linkKey）——
const BATTERY_TYPES = [...new Set(Object.values(DATADEP_ROLE_CANONICAL))];
const BATTERY_GRAPH: HiddenReqGraph = {
  nodes: BATTERY_TYPES.map((key) => ({ key })),
  edges: [
    { from: "n-Order", to: "n-Model", label: "order_uses_model" },
    { from: "n-Order", to: "n-Line", label: "order_on_line" },
    { from: "n-Order", to: "n-Shipment", label: "order_ships_via" },
    { from: "n-Model", to: "n-Base", label: "model_at_base" },
    { from: "n-Line", to: "n-Process", label: "line_has_process" },
    { from: "n-Process", to: "n-Equipment", label: "process_uses_equipment" },
  ],
};

// bindings.resolve：抽象角色 → 租户真实类型（无租户绑定时回退 canonical·对齐 solver-binding 门约定）。
const CANONICAL_BINDINGS: HiddenReqBindings = {
  resolve: (roleType) => DATADEP_ROLE_CANONICAL[roleType],
};

const typeKeys = new Set(BATTERY_GRAPH.nodes.map((n) => n.key));
const linkKeys = new Set(BATTERY_GRAPH.edges.map((e) => e.label));
const solverKeys = new Set(Object.keys(SOLVER_DATADEP));

describe("expandHiddenRequirements 三白名单 by-construction（R6·R14·零幽灵 key）", () => {
  it("C1/V8：含 order 显式需求 + 真电池图 → 每个扩展 key ∈ 真实注册表", () => {
    const out = expandHiddenRequirements(
      { objectTypes: ["Order"], solvers: ["affected_orders"] }, // affected_orders requires base/order/model
      BATTERY_GRAPH,
      SOLVER_DATADEP,
      CANONICAL_BINDINGS,
    );
    // 核心断言：三类输出 key 逐个 ∈ 各自真实注册表（by-construction 保证·此处坐实）。
    for (const t of out.requiredObjectTypes) expect(typeKeys.has(t), `type ${t} ∈ ontology graph`).toBe(true);
    for (const s of out.requiredSolvers) expect(solverKeys.has(s), `solver ${s} ∈ SOLVER_DATADEP`).toBe(true);
    for (const lk of out.requiredLinks) expect(linkKeys.has(lk), `link ${lk} ∈ ontology graph`).toBe(true);
    // trace 每条 added 亦 ∈ 对应注册表（R13 溯源无幽灵）。
    for (const tr of out.trace) {
      const reg = tr.kind === "objectType" ? typeKeys : tr.kind === "solver" ? solverKeys : linkKeys;
      expect(reg.has(tr.added), `trace ${tr.kind} ${tr.added} ∈ registry`).toBe(true);
    }
    // ① 求解器依赖闭包真发生：affected_orders 的 base/order/model 角色 → Base/Order/Model 真类型纳入。
    expect(out.requiredObjectTypes).toEqual(expect.arrayContaining(["Base", "Order", "Model"]));
    // ② 图一跳真发生：Order --order_ships_via--> Shipment（真边真邻居）纳入 + 链路纳入。
    expect(out.requiredObjectTypes).toContain("Shipment");
    expect(out.requiredLinks).toEqual(expect.arrayContaining(["order_uses_model", "order_ships_via"]));
  });

  it("C1/V8·R6：同输入字节级一致（JSON.stringify 相等·无时钟/随机）", () => {
    const args = () =>
      expandHiddenRequirements(
        { objectTypes: ["Order"], solvers: ["affected_orders"] },
        BATTERY_GRAPH,
        SOLVER_DATADEP,
        CANONICAL_BINDINGS,
      );
    expect(JSON.stringify(args())).toBe(JSON.stringify(args()));
  });

  it("幽灵 key 过滤（零造假）：显式含幽灵类型/求解器 → 不进输出（filter(has) 外进不来）", () => {
    const out = expandHiddenRequirements(
      { objectTypes: ["capacity_loss", "production_line", "Order"], solvers: ["ghost_solver", "affected_orders"] },
      BATTERY_GRAPH,
      SOLVER_DATADEP,
      CANONICAL_BINDINGS,
    );
    expect(out.requiredObjectTypes).not.toContain("capacity_loss");
    expect(out.requiredObjectTypes).not.toContain("production_line");
    expect(out.requiredSolvers).not.toContain("ghost_solver");
    // 真 key 仍在（幽灵剔除不误伤真需求）。
    expect(out.requiredObjectTypes).toContain("Order");
    expect(out.requiredSolvers).toContain("affected_orders");
  });

  it("无真实扩展路径 → 诚实空集（不编）", () => {
    const out = expandHiddenRequirements(
      { objectTypes: [], solvers: [] },
      { nodes: [], edges: [] },
      SOLVER_DATADEP,
      CANONICAL_BINDINGS,
    );
    expect(out).toEqual({ requiredObjectTypes: [], requiredSolvers: [], requiredLinks: [], trace: [] });
  });

  it("反查阈值为命名常量（非内联魔数·R14）且落在 [0,1]", () => {
    expect(HIDDEN_REQ_COVERAGE_THRESHOLD).toBeGreaterThan(0);
    expect(HIDDEN_REQ_COVERAGE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
