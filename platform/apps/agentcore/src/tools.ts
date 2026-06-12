/** 工具层：路径 A 步骤与路径 B Agent 共用同一实现；OBO——每次调用透传用户 JWT 到 DataCore */
import type { AuthCtx, RuleVerdict, ToolPayload } from "@platform/contracts";
import { randomUUID } from "node:crypto";

const A = process.env.DATACORE_URL || "http://127.0.0.1:8081";

async function aPost(token: string, path: string, body: unknown) {
  const r = await fetch(A + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(`DataCore ${path} ${r.status}`), { code: r.status === 401 ? "UNAUTHORIZED" : "DATACORE_ERROR", status: r.status });
  return r.json() as Promise<any>;
}
export const dc = (token: string, objectType: string, filter: any, limit?: number): Promise<ToolPayload> =>
  aPost(token, "/a/v1/objects/query", { objectType, filter, limit });

export interface ToolCallRecord { toolCallId: string; toolName: string; input: unknown; outcome: "OK" | "DENIED" | "ERROR"; durationMs: number; outputDigest: string }

export interface ToolResult { ok: boolean; payload: any; toolCallId: string }

/** 内置工具注册表（描述给 LLM 用——写明触发条件） */
export const TOOL_DEFS = [
  { name: "query_objects", sideEffect: "READ", description: "按对象类型查询本体对象（Base 基地 / Model 型号 / Order 订单）。当需要基地利用率、订单清单、型号可产基地等事实数据时调用。filter 为字段等值过滤。", input_schema: { type: "object", properties: { objectType: { type: "string", enum: ["Base", "Model", "Order"] }, filter: { type: "object" }, limit: { type: "number" } }, required: ["objectType"] } },
  { name: "invoke_solver", sideEffect: "COMPUTE", description: "调用确定性求解器。capacity_forecast(modelId, qty, weeks, whatif?) 产能可承接性；affected_orders(baseName?, fromDay, toDay) 受影响订单；risk_timeline(baseName, factor, horizon) 风险时序；plan_audit(计划字段) 规划体检；plan_generate(目标) 经营方案。任何需要计算/推演的数字都必须经此获得。", input_schema: { type: "object", properties: { solverKey: { type: "string" }, args: { type: "object" } }, required: ["solverKey", "args"] } },
  { name: "evaluate_rules", sideEffect: "COMPUTE", description: "对载荷执行业务规则校验（C03 产能上限/C08 外协红线/C15 毛利线/C18 现金垫）。", input_schema: { type: "object", properties: { ruleIds: { type: "array", items: { type: "string" } }, payload: { type: "object" } }, required: ["payload"] } },
  { name: "create_action_draft", sideEffect: "ACTION_DRAFT", description: "用户要求采纳/下达/调整时，生成待审批的 Action 草稿。绝不直接执行变更。", input_schema: { type: "object", properties: { actionType: { type: "string" }, payload: { type: "object" } }, required: ["actionType", "payload"] } },
] as const;

export class ToolExecutor {
  audit: ToolCallRecord[] = [];
  constructor(private ctx: AuthCtx, private token: string, private solvers: Record<string, Function>, private scopeTools?: string[]) {}

  async run(toolName: string, input: any): Promise<ToolResult> {
    const toolCallId = "tc_" + randomUUID().slice(0, 8);
    const t0 = Date.now();
    const done = (ok: boolean, payload: any, outcome: ToolCallRecord["outcome"]): ToolResult => {
      this.audit.push({ toolCallId, toolName, input, outcome, durationMs: Date.now() - t0, outputDigest: JSON.stringify(payload).slice(0, 120) });
      return { ok, payload, toolCallId };
    };
    if (this.scopeTools && !this.scopeTools.includes(toolName))
      return done(false, { error: "AGENT_SCOPE_VIOLATION", message: `工具 ${toolName} 不在该 Agent 的授权范围内` }, "DENIED");
    try {
      if (toolName === "query_objects") return done(true, await dc(this.token, input.objectType, input.filter || {}, input.limit), "OK");
      if (toolName === "invoke_solver") {
        const fn = this.solvers[input.solverKey];
        if (!fn) return done(false, { error: "SOLVER_NOT_FOUND", message: `求解器 ${input.solverKey} 不存在` }, "ERROR");
        return done(true, { data: await fn(this.ctx, this.token, input.args || {}), snapshotVersion: "snap-seed-v1" }, "OK");
      }
      if (toolName === "evaluate_rules") {
        const r = await aPost(this.token, "/a/v1/rules/evaluate", { ruleIds: input.ruleIds || [], payload: input.payload });
        return done(true, r, "OK");
      }
      if (toolName === "create_action_draft") {
        const d = await aPost(this.token, "/a/v1/action-drafts", { actionType: input.actionType, payload: input.payload, origin: {} });
        return done(true, { draftId: d.id, status: d.status }, "OK");
      }
      return done(false, { error: "UNKNOWN_TOOL", message: toolName }, "ERROR");
    } catch (e: any) {
      return done(false, { error: e.code || "TOOL_ERROR", message: e.message }, "ERROR");
    }
  }
}

export function verdictBlock(verdicts: RuleVerdict[]) {
  return verdicts.find(v => !v.passed && v.severity === "BLOCK") || null;
}
