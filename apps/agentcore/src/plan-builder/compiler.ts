import type { ExecutionPlan, PlanBuilderNode, PlanDSL, PlanStep } from "@platform/contracts";
import { validatePlanSteps } from "../workflow/validate.js";

export interface CompileError {
  code: string;
  message: string;
  nodeId?: string;
}

export interface CompileResult {
  ok: boolean;
  plan?: Pick<ExecutionPlan, "key" | "steps">;
  errors: CompileError[];
}

/**
 * 编译 PlanDSL → ExecutionPlan 形状（无 id/packageId/version/status）。
 * Phase 1 仅支持线性链：INPUT / SOLVER / TRANSFORM / OUTPUT；
 * CONDITION / LOOP / MERGE 占位返回不支持错误。
 */
export function compilePlanDSL(dsl: PlanDSL): CompileResult {
  const errors: CompileError[] = [];
  const nodes = dsl.nodes;
  const nodeById = new Map<string, PlanBuilderNode>();
  const seenIds = new Set<string>();
  for (const n of nodes) {
    if (seenIds.has(n.id)) {
      errors.push({ code: "DUPLICATE_NODE_ID", message: `节点 id 重复: ${n.id}`, nodeId: n.id });
    }
    seenIds.add(n.id);
    nodeById.set(n.id, n);
  }

  // 建邻接表 + 入度表
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of dsl.edges) {
    if (!nodeById.has(e.from)) {
      errors.push({ code: "MISSING_NODE", message: `边引用了不存在的源节点: ${e.from}` });
      continue;
    }
    if (!nodeById.has(e.to)) {
      errors.push({ code: "MISSING_NODE", message: `边引用了不存在的目标节点: ${e.to}` });
      continue;
    }
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // Kahn 拓扑排序
  const queue: string[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) queue.push(id);
  }
  // DSL 顺序稳定：同层按 nodes 数组序
  const dslOrder = new Map(nodes.map((n, i) => [n.id, i]));
  queue.sort((a, b) => dslOrder.get(a)! - dslOrder.get(b)!);

  const topo: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topo.push(cur);
    const next = adj.get(cur) ?? [];
    next.sort((a, b) => dslOrder.get(a)! - dslOrder.get(b)!);
    for (const nxt of next) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if (indeg.get(nxt) === 0) queue.push(nxt);
    }
  }

  // 未入拓扑的节点存在环
  if (topo.length !== nodes.length) {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const cycleNodes: string[] = [];
    const dfs = (id: string): boolean => {
      if (visiting.has(id)) {
        cycleNodes.push(id);
        return true;
      }
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const nxt of adj.get(id) ?? []) {
        if (dfs(nxt)) {
          cycleNodes.unshift(id);
          return true;
        }
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    for (const n of nodes) {
      if (!visited.has(n.id) && dfs(n.id)) break;
    }
    const cyclePath = cycleNodes.length > 0 ? cycleNodes.join(" -> ") : "(unknown)";
    errors.push({ code: "CYCLIC_GRAPH", message: `画布存在环: ${cyclePath}` });
  }

  if (errors.length > 0) return { ok: false, errors };

  // 不连通节点按 DSL 顺序追加到拓扑末尾（保证全节点都被编译）
  const ordered = [...topo];
  for (const n of nodes) {
    if (!ordered.includes(n.id)) ordered.push(n.id);
  }

  const steps: PlanStep[] = [];
  for (const id of ordered) {
    const node = nodeById.get(id)!;
    if (node.type === "CONDITION" || node.type === "LOOP" || node.type === "MERGE") {
      errors.push({
        code: "UNSUPPORTED_NODE_TYPE",
        message: `Phase 1 暂不支持 ${node.type} 节点`,
        nodeId: node.id,
      });
      continue;
    }
    const step = nodeToStep(node);
    if (step) steps.push(step);
  }

  if (errors.length > 0) return { ok: false, errors };

  const validationErrors = validatePlanSteps(steps, { requireRenderAnswer: true });
  for (const msg of validationErrors) {
    const nodeId = /步骤 (?:id 重复:)? ?([\w-]+)/.exec(msg)?.[1];
    errors.push({ code: "PLAN_VALIDATION_ERROR", message: msg, nodeId });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      key: "from-canvas", // service 会覆盖为 canvas.key
      steps,
    },
    errors: [],
  };
}

function nodeToStep(node: PlanBuilderNode): PlanStep | null {
  switch (node.type) {
    case "INPUT":
      // INPUT 合并到执行计划 inputs（由 service 按需处理）；不在 steps 中生成占位步。
      return null;
    case "SOLVER":
      return {
        id: node.id,
        type: "invoke_solver",
        params: { solverKey: node.solverKey, args: node.args },
        ...(node.timeoutMs !== undefined ? { timeoutMs: node.timeoutMs } : {}),
        ...(node.onError ? { onError: node.onError } : {}),
      };
    case "TRANSFORM": {
      const params: Record<string, unknown> = { ...node.params };
      return {
        id: node.id,
        type: node.stepType,
        params,
        ...(node.timeoutMs !== undefined ? { timeoutMs: node.timeoutMs } : {}),
        ...(node.onError ? { onError: node.onError } : {}),
      } as PlanStep;
    }
    case "OUTPUT":
      return {
        id: node.id,
        type: "render_answer",
        params: { blocks: node.blocks },
      };
    case "CONDITION":
    case "LOOP":
    case "MERGE":
      // Phase 1 不支持分支/循环/汇聚语义。
      return null;
  }
}

