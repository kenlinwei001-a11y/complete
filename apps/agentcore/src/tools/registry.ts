import type { ToolDefinition } from "@platform/contracts";

/** Built-in tool registry (QOS-PRD §7.1). Shared by path A steps and path B agent loop. */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: "resolve_slice",
    descriptionForLLM:
      "解析一个预定义的本体切片（子图）。当需要某型号的可产基地网络或某基地的风险画像等预定义视图时调用。",
    inputSchema: {
      type: "object",
      properties: {
        sliceKey: { type: "string", description: "切片 key，如 model_capacity_network / base_risk_profile" },
        args: { type: "object", description: "切片参数" },
      },
      required: ["sliceKey", "args"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "query_objects",
    descriptionForLLM:
      "按对象类型与过滤条件查询本体对象列表。当需要原始业务对象（基地/型号/订单等）数据时调用。limit 上限 200。",
    inputSchema: {
      type: "object",
      properties: {
        objectType: { type: "string" },
        filter: { type: "object" },
        limit: { type: "number", maximum: 200 },
      },
      required: ["objectType", "filter"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "get_object",
    descriptionForLLM: "按类型与 ID 获取单个本体对象。当已知对象 ID 需要详情时调用。",
    inputSchema: {
      type: "object",
      properties: { objectType: { type: "string" }, objectId: { type: "string" } },
      required: ["objectType", "objectId"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "invoke_solver",
    descriptionForLLM:
      "调用确定性求解器进行计算（如产能推演 capacity_forecast、受影响订单 affected_orders）。计算成本高，仅在确有必要时调用。",
    inputSchema: {
      type: "object",
      properties: { solverKey: { type: "string" }, args: { type: "object" } },
      required: ["solverKey", "args"],
    },
    sideEffect: "COMPUTE",
    costClass: "EXPENSIVE",
  },
  {
    name: "evaluate_rules",
    descriptionForLLM: "按规则库评估给定 payload 是否违反业务规则（C01–C23）。在给出结论或生成草稿前调用。",
    inputSchema: {
      type: "object",
      properties: {
        ruleIds: {
          anyOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["ALL_APPLICABLE"] }],
        },
        payload: { type: "object" },
      },
      required: ["ruleIds", "payload"],
    },
    sideEffect: "COMPUTE",
    costClass: "CHEAP",
  },
  {
    name: "create_action_draft",
    descriptionForLLM:
      "唯一的写出口：为用户的修改/下达/调整请求生成 Action 草稿交下游审批。绝不直接执行写操作；生成后必须告知用户需审批。",
    inputSchema: {
      type: "object",
      properties: { actionType: { type: "string" }, payload: { type: "object" } },
      required: ["actionType", "payload"],
    },
    sideEffect: "ACTION_DRAFT",
    costClass: "CHEAP",
  },
];

export const FINAL_ANSWER_TOOL = {
  name: "final_answer",
  descriptionForLLM:
    "终止工具：当你已经收集到足够事实时调用，输出结构化回答 blocks 与 provenance（每个数字必须有 ⟦ref:N⟧ 指向 provenance 下标）。",
  inputSchema: {
    type: "object",
    properties: {
      blocks: { type: "array" },
      provenance: {
        type: "array",
        items: {
          type: "object",
          properties: { toolCallId: { type: "string" }, outputPath: { type: "string" } },
          required: ["toolCallId", "outputPath"],
        },
      },
    },
    required: ["blocks", "provenance"],
  },
} as const;

export const LOAD_SKILL_TOOL = {
  name: "load_skill",
  descriptionForLLM: "按 skillId 加载技能全文（渐进披露）。当 system 提示中的技能摘要与当前任务相关时调用。",
  inputSchema: {
    type: "object",
    properties: { skillId: { type: "string" } },
    required: ["skillId"],
  },
} as const;

export function builtinTool(name: string): ToolDefinition | undefined {
  return BUILTIN_TOOLS.find((t) => t.name === name);
}
