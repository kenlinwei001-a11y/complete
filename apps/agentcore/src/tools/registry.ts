import type { ToolDefinition } from "@platform/contracts";

/** Built-in tool registry (QOS-PRD §7.1). Shared by path A steps and path B agent loop. */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    // 能力发现与路由 §1：统一目录发现。slices/solvers 来自 DataCore 目录（权限/功能开通过滤），
    // mcp_tools 列出未加载的 MCP 工具（>24 按需加载模式）。不确定用什么时先调本工具。
    name: "discover",
    descriptionForLLM:
      "发现当前可用的能力目录。kind=slices 返回可用本体切片（含用途说明与参数）；kind=solvers 返回求解器；kind=mcp_tools 返回未加载的 MCP 工具。当不确定该用哪个切片/求解器/工具时先调用本工具拿到准确的 key。",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["slices", "solvers", "mcp_tools"] },
        query: { type: "string", description: "可选关键词过滤" },
      },
      required: ["kind"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
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
    name: "aggregate_objects",
    descriptionForLLM:
      "对本体对象做聚合下推（按维度分组 + count/sum/avg/min/max 度量），用于回答对比/汇总类问题（如『对比储能与动力基地平均利用率』）。优先于拉全量后本地聚合 —— 避免拉全量行。",
    inputSchema: {
      type: "object",
      properties: {
        typeKey: { type: "string" },
        filter: { type: "object" },
        groupBy: { type: "array", items: { type: "string" }, maxItems: 2 },
        metrics: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: { prop: { type: "string" }, fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] } },
            required: ["prop", "fn"],
          },
        },
      },
      required: ["typeKey", "metrics"],
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
    // S4.1 知识库语义检索（QOS-PRD §7.1 注册表新增；路径 B 白名单）
    name: "search_knowledge",
    descriptionForLLM:
      "知识库语义检索：按自然语言问题检索已同步的文档分块（SOP/工艺文件/物流说明等）。命中可作为回答的 KB_CHUNK 溯源。topK ≤ 10。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索问题" },
        topK: { type: "number", maximum: 10, description: "返回条数，默认 5，上限 10" },
        connId: { type: "string", description: "可选：限定知识库连接器实例" },
      },
      required: ["query"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    // A8.4 时序聚合查询（QOS-PRD §7.1 注册表新增）。LLM 隔离红线（A8 §0）：
    // 该工具只返回聚合桶（bucket 数 ≤120），任何参数组合都无法取得 ts_points 原始行。
    name: "query_timeseries_agg",
    descriptionForLLM:
      "时序聚合查询：按 seriesKey/实体/时间窗/粒度返回聚合桶（如设备日 OEE、产线实绩）。仅返回聚合值，绝不返回原始时序行；窗口超过 120 桶会要求加大 grain。",
    inputSchema: {
      type: "object",
      properties: {
        seriesKey: { type: "string", description: "时序系列 key，如 oee:base" },
        entityIds: { type: "array", items: { type: "string" }, maxItems: 20 },
        window: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            grain: { type: "string", enum: ["shift", "day", "week"] },
          },
          required: ["from", "to", "grain"],
        },
        agg: { type: "string", enum: ["avg", "sum", "min", "max", "p95", "weighted_avg"] },
      },
      required: ["seriesKey", "entityIds", "window", "agg"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    // 增量 §3：技能附件可消费（渐进披露第三级：summary → body → resource）。
    // 文本类（md/txt/csv/json）返回内容（≤64KB 截断+提示）；二进制类仅返回元信息。
    name: "read_skill_resource",
    descriptionForLLM:
      "读取技能附件资源：按 skillId + resourceName 读取。文本类（md/txt/csv/json）返回内容（超 64KB 截断）；二进制类只返回元信息（无法直接读取）。load_skill 返回的资源清单告诉你有哪些附件可读。",
    inputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string" },
        resourceName: { type: "string", description: "load_skill 资源清单中的附件名" },
      },
      required: ["skillId", "resourceName"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    // 运营态出厂配置增量 §3：经验记忆库检索（只读、全审计）。出厂 50 例自回放期
    // 任务史沉淀（问句+解法+结果）；检索 = 确定性伪向量余弦排序（util/embedding），
    // 「越用越聪明」出厂即有底料。
    name: "search_experience",
    descriptionForLLM:
      "经验记忆库检索：按自然语言问题检索历史任务沉淀的案例（问句+解法+结果）。在选择分析路径前调用，可借鉴过往有效解法；结果仅供参考，业务数字仍须经工具溯源。topK ≤ 10。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索问题" },
        topK: { type: "number", maximum: 10, description: "返回条数，默认 3，上限 10" },
      },
      required: ["query"],
    },
    sideEffect: "READ",
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
