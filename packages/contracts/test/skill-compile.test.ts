import { describe, expect, it } from "vitest";
import {
  SKILL_COMPILE_STAGES,
  SKILL_GRAPH_ENTRY_NODE_ID,
  SKILL_GRAPH_ERROR_EXIT_NODE_ID,
  SKILL_GRAPH_NORMAL_EXIT_NODE_ID,
  SKILL_REASONING_NODE_TYPES,
  SKILL_REF_KIND_BINDING,
  SKILL_REFERENCE_KINDS,
  SkillAstSchema,
  SkillReasoningGraphSchema,
  deriveSkillReasoningGraph,
  parseSkillToAst,
  skillDeclaredRefKeys,
  skillGraphRefKeys,
  type SkillDefinition,
} from "../src/index.js";

/**
 * WO-SKILL-COMPILER-S1 · ① Parser 与 ③ 图派生的纯函数牙测（PRD §4.1 分层纪律：
 * 这两段无 IO 无网络，故可在 contracts 层单测；② Validator 的测试在 agentcore SEAM）。
 */

const BASE: SkillDefinition = {
  id: "skl_unit",
  tenantId: "t1",
  key: "unit_skill",
  version: 1,
  name: "单测技能",
  summary: "当需要单测编译器时使用。不适用：生产。",
  body: "body",
  resources: [],
  status: "PUBLISHED",
};

function skill(patch: Partial<SkillDefinition> = {}): SkillDefinition {
  return { ...BASE, ...patch };
}

describe("WO-SKILL-COMPILER-S1 · ① Parser（SkillDefinition → SkillAst）", () => {
  it("AST 含工单点名的五项：skill.id / ontology[] / agents[] / tools[] / solver，且形状过 zod", () => {
    const ast = parseSkillToAst(
      skill({
        references: [
          { kind: "ontologyType", key: "Base", required: true, role: "context" },
          { kind: "solver", key: "capacity_forecast", required: true, role: "context" },
          { kind: "agent", key: "planner_agent", required: true, role: "context" },
        ],
      }),
    );
    expect(SkillAstSchema.safeParse(ast).success).toBe(true);
    expect(ast.skill.id).toBe("skl_unit");
    expect(ast.ontology.map((r) => r.key)).toEqual(["Base"]);
    expect(ast.agents.map((r) => r.key)).toEqual(["planner_agent"]);
    expect(ast.solver?.key).toBe("capacity_forecast");
    // tools[] 是**派生**的（今天没有 kind:"tool"），且必须自陈来源
    expect(ast.tools.map((t) => t.name)).toEqual(["invoke_solver", "query_objects"]);
    expect(ast.tools.every((t) => t.source === "derived")).toBe(true);
    expect(ast.tools.find((t) => t.name === "invoke_solver")?.impliedBy).toEqual(["solver:capacity_forecast"]);
  });

  it("未实现的段显式标 NOT_IMPLEMENTED，不返回空对象（诚实边界）", () => {
    const ast = parseSkillToAst(skill());
    expect(ast.runtimePackage.status).toBe("NOT_IMPLEMENTED");
    expect(ast.runtimePackage.note.length).toBeGreaterThan(10);
    // 阶段词表覆盖 PRD §4.1 七段管线在本切片的五个落点
    expect([...SKILL_COMPILE_STAGES]).toEqual(["parse", "validate", "graph", "optimize", "package"]);
  });

  it("solver 单数位 = solvers[] 字典序首个；多 solver 不被静默丢弃", () => {
    const ast = parseSkillToAst(
      skill({
        references: [
          { kind: "solver", key: "yield_diagnosis", required: true, role: "context" },
          { kind: "solver", key: "capacity_forecast", required: true, role: "context" },
        ],
      }),
    );
    expect(ast.solvers.map((r) => r.key)).toEqual(["capacity_forecast", "yield_diagnosis"]);
    expect(ast.solver?.key).toBe("capacity_forecast");
  });

  it("writeMode 判定复用 isWriteModeSkill 单一出处：approvalGate≠none 也算写模式", () => {
    expect(parseSkillToAst(skill({ sideEffect: "COMPUTE", approvalGate: "human" })).skill.writeMode).toBe(true);
    expect(parseSkillToAst(skill({ sideEffect: "WRITE" })).skill.writeMode).toBe(true);
    expect(parseSkillToAst(skill({ sideEffect: "READ", approvalGate: "none" })).skill.writeMode).toBe(false);
    // 写模式必须派生出 create_action_draft（R4 真值经 Action）
    expect(parseSkillToAst(skill({ sideEffect: "WRITE" })).tools.map((t) => t.name)).toContain("create_action_draft");
  });

  it("references 与 dependsOn 分开记 origin —— 两者语义不同，不许合成一句", () => {
    const ast = parseSkillToAst(
      skill({
        references: [{ kind: "skill", key: "a", required: true, role: "context" }],
        dependsOn: [{ kind: "skill", key: "b", required: true, role: "context" }],
      }),
    );
    // 排序键是 kind→key→version→origin，故 a 在 b 前；origin 只是标签，不参与分桶
    expect(ast.skills.map((r) => `${r.origin}:${r.key}`)).toEqual(["references:a", "dependsOn:b"]);
    expect(ast.skills.map((r) => r.path)).toEqual(["/references/0", "/dependsOn/0"]);
  });
});

describe("WO-SKILL-COMPILER-S1 · ③ 推理图派生", () => {
  it("节点集合与 references[] 声明的资源逐条一致（SEAM 的对账口径，与 HTTP 层共用同一实现）", () => {
    const s = skill({
      references: [
        { kind: "solver", key: "capacity_forecast", required: true, role: "context" },
        { kind: "rule", key: "C03", required: true, role: "postcheck" },
        { kind: "ontologyType", key: "Base", required: false, role: "precondition" },
      ],
    });
    const graph = deriveSkillReasoningGraph(parseSkillToAst(s));
    expect(SkillReasoningGraphSchema.safeParse(graph).success).toBe(true);
    expect(skillGraphRefKeys(graph)).toEqual(skillDeclaredRefKeys(s));
    expect(skillGraphRefKeys(graph)).toEqual(["ontologyType:Base", "rule:C03", "solver:capacity_forecast"]);
  });

  it("图有入口、正常出口与异常出口，且每条边的两端都是在册节点（无悬空边）", () => {
    const graph = deriveSkillReasoningGraph(
      parseSkillToAst(
        skill({ references: [{ kind: "solver", key: "capacity_forecast", required: true, role: "context" }] }),
      ),
    );
    expect(graph.entry).toBe(SKILL_GRAPH_ENTRY_NODE_ID);
    expect(graph.exits).toEqual([
      { nodeId: SKILL_GRAPH_ERROR_EXIT_NODE_ID, kind: "error" },
      { nodeId: SKILL_GRAPH_NORMAL_EXIT_NODE_ID, kind: "normal" },
    ]);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(ids.has(e.from), `悬空边 from=${e.from}`).toBe(true);
      expect(ids.has(e.to), `悬空边 to=${e.to}`).toBe(true);
    }
  });

  it("GR-EXCEPTION：每个可失败节点都有到异常出口的 on_error 边，且 onError 复用 OnErrorSchema 词表", () => {
    const graph = deriveSkillReasoningGraph(
      parseSkillToAst(
        skill({
          references: [
            { kind: "solver", key: "s1", required: true, role: "context" },
            { kind: "rule", key: "r1", required: false, role: "context" },
          ],
        }),
      ),
    );
    const solverNode = graph.nodes.find((n) => n.ref?.key === "s1")!;
    const ruleNode = graph.nodes.find((n) => n.ref?.key === "r1")!;
    expect(solverNode.onError).toBe("FAIL"); // required:true
    expect(ruleNode.onError).toBe("SKIP"); // required:false → RG-OPTIONAL 降级
    for (const n of [solverNode, ruleNode]) {
      expect(
        graph.edges.some((e) => e.from === n.id && e.to === SKILL_GRAPH_ERROR_EXIT_NODE_ID && e.condition === "on_error"),
      ).toBe(true);
    }
  });

  it("图无环（GR-ACYCLIC）：DFS 三色法直咬", () => {
    const graph = deriveSkillReasoningGraph(
      parseSkillToAst(
        skill({
          sideEffect: "WRITE",
          references: [
            { kind: "ontologyType", key: "Base", required: true, role: "precondition" },
            { kind: "solver", key: "s1", required: true, role: "context" },
            { kind: "rule", key: "C03", required: true, role: "postcheck" },
            { kind: "slice", key: "fallback_slice", required: false, role: "fallback" },
          ],
        }),
      ),
    );
    const out = new Map<string, string[]>();
    for (const n of graph.nodes) out.set(n.id, []);
    for (const e of graph.edges) out.get(e.from)!.push(e.to);
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (done.has(id)) return false;
      visiting.add(id);
      for (const to of out.get(id) ?? []) if (visit(to)) return true;
      visiting.delete(id);
      done.add(id);
      return false;
    };
    expect(graph.nodes.some((n) => visit(n.id))).toBe(false);
    // 写模式 → 图里必须有产 action_draft 的节点（GR-APPROVAL）
    expect(graph.nodes.some((n) => n.type === "create_action_draft")).toBe(true);
  });

  it("R6 确定性：同一 skill 两次编译，ast 与 graph 逐字节一致；引用顺序打乱也不改变产物", () => {
    const a = skill({
      references: [
        { kind: "solver", key: "s2", required: true, role: "context" },
        { kind: "rule", key: "C03", required: true, role: "postcheck" },
        { kind: "solver", key: "s1", required: true, role: "context" },
      ],
    });
    const b = skill({
      references: [
        { kind: "rule", key: "C03", required: true, role: "postcheck" },
        { kind: "solver", key: "s1", required: true, role: "context" },
        { kind: "solver", key: "s2", required: true, role: "context" },
      ],
    });
    const ast1 = parseSkillToAst(a);
    const ast2 = parseSkillToAst(a);
    expect(JSON.stringify(ast1)).toBe(JSON.stringify(ast2));
    expect(JSON.stringify(deriveSkillReasoningGraph(ast1))).toBe(JSON.stringify(deriveSkillReasoningGraph(ast2)));
    // 只有 path 记录声明位置会随顺序变；节点/边/工具集必须与顺序无关
    const g1 = deriveSkillReasoningGraph(parseSkillToAst(a));
    const g2 = deriveSkillReasoningGraph(parseSkillToAst(b));
    expect(g1.nodes.map((n) => `${n.id}|${n.type}|${n.onError}`)).toEqual(g2.nodes.map((n) => `${n.id}|${n.type}|${n.onError}`));
    expect(g1.edges).toEqual(g2.edges);
    expect(parseSkillToAst(a).tools).toEqual(parseSkillToAst(b).tools);
  });
});

describe("WO-SKILL-COMPILER-S1 · 词表不漂移（机器守，不靠人记得）", () => {
  it("每个 SKILL_REFERENCE_KINDS 成员都有 AST 桶 + 图节点类型绑定（新增 kind 漏映射 = TS 编译失败 + 本例红）", () => {
    for (const kind of SKILL_REFERENCE_KINDS) {
      const binding = SKILL_REF_KIND_BINDING[kind];
      expect(binding, `kind「${kind}」未登记 SKILL_REF_KIND_BINDING`).toBeDefined();
      expect(SKILL_REASONING_NODE_TYPES).toContain(binding.node);
    }
    expect(Object.keys(SKILL_REF_KIND_BINDING).sort()).toEqual([...SKILL_REFERENCE_KINDS].sort());
  });

  it("命名红线（PRD §3.1 红线 1）：导出名与节点词表不得占用 QOS 已有的那两个名字", () => {
    const exported = [...SKILL_REASONING_NODE_TYPES, ...SKILL_COMPILE_STAGES];
    for (const name of exported) {
      expect(name).not.toMatch(/ExecutionPlan|ExecutionGraph/);
    }
  });
});
