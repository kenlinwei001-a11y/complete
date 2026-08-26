import type { ToolDefinition } from "@platform/contracts";

/** Built-in tool registry (QOS-PRD §7.1). Shared by path A steps and path B agent loop. */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    // 能力发现与路由 §1：统一目录发现。slices/solvers 来自 DataCore 目录（权限/功能开通过滤），
    // mcp_tools 列出未加载的 MCP 工具（>24 按需加载模式）。不确定用什么时先调本工具。
    name: "discover",
    descriptionForLLM:
      "发现当前可用的能力目录。kind=object_types 返回本租户真实已发布对象类型（key+中文标签+域+实例数）——查对象前先用本工具拿真实类型名，勿凭空猜英文名（如 plan_version/production_target 多半不存在）；kind=slices 返回可用本体切片；kind=solvers 返回求解器；kind=mcp_tools 返回未加载的 MCP 工具。不确定用什么时先调本工具。",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["object_types", "slices", "solvers", "mcp_tools"] },
        query: { type: "string", description: "可选关键词过滤" },
      },
      required: ["kind"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    // WO-DRIL-P2 · DRIL 混合检索：一次跨 7+ 类智能资源（求解器/切片/规则/技能/工作流/Agent/意图）按 NL 选型。
    // 不确定该用哪个 solver/slice/rule 时先调本工具（比 discover 更强：五级标签 + 语义 + 确定性加权排序 + 打分解释），
    // 再据 top 结果 invoke_solver / resolve_slice / evaluate_rules。
    name: "retrieve_knowledge",
    descriptionForLLM:
      "DRIL 智能资源混合检索：按自然语言 query 跨求解器/切片/规则/技能/工作流/Agent/意图检索最相关资源，返回排序结果（含 scoreBreakdown 语义/域/本体/历史/成本分项 + 解释）。选型不确定时先调本工具再执行；比 discover 更精准（五级标签+语义+确定性加权）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "自然语言检索问题" },
        kinds: {
          type: "array",
          items: { type: "string" },
          description: "可选：限定资源类别（solver/slice/rule/skill/workflow/agent/intent/mcp_tool/field）",
        },
        maxResults: { type: "number", description: "返回条数上限，默认 8" },
      },
      required: ["query"],
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
    // A3.3 多跳切片规划器：意图需要跨域数据且预置切片不匹配时，先调本工具动态规划切片；
    // 返回含 planned/reused/sliceKey 等显式 trace 标记，下游 resolve_slice / invoke_solver 可消费。
    name: "plan_slice",
    descriptionForLLM:
      "动态规划一个本体切片。当用户问题需要跨越多个对象类型（如订单→基地→物料→客户）且预置切片不满足时调用；返回的 sliceKey 可传给 resolve_slice 或作为 solver 上下文。",
    inputSchema: {
      type: "object",
      properties: {
        rootType: { type: "string", description: "根对象类型，如 Order" },
        targets: { type: "array", items: { type: "string" }, description: "需覆盖的目标类型列表，如 [Base, Material, Customer]" },
        maxHops: { type: "number", description: "最大跳数（可选，默认 6）" },
        question: { type: "string", description: "原始问句（可选，用于切片复用索引匹配）" },
      },
      required: ["rootType", "targets"],
    },
    sideEffect: "COMPUTE",
    costClass: "CHEAP",
  },
  {
    // WO-Phase3-B §3.2：本体多跳遍历查询（一次 query 顶多次 query_objects）。走 DataCore ontology_query 求解器。
    name: "query_ontology",
    descriptionForLLM:
      "本体多跳遍历查询：给定 rootType(+rootFilter) 沿 hops（或自动最短路）走到目标类型，select 投影字段并可做简单聚合(sum/count/avg/max)。回答『某基地关联哪些订单』『某供应商断供影响哪些客户』『某基地产线总产能』等跨类型关联问题——一次调用顶多次 query_objects。每行带 {typeKey,objId,linkPath} 溯源。仅遍历+简单聚合；复杂业务推演(能不能接/供需归因/组合最优)请用对应 invoke_solver。",
    inputSchema: {
      type: "object",
      properties: {
        rootType: { type: "string", description: "起点对象类型，如 Base" },
        rootFilter: { type: "array", items: { type: "object" }, description: "根过滤 [{field,op,value}]" },
        hops: { type: "array", items: { type: "object" }, description: "多跳 [{linkKey,direction:forward|backward,targetType?,filter?}]；省略则自动规划最短路" },
        select: { type: "array", items: { type: "object" }, description: "投影 [{type,fields[],aggregate?,groupBy?}]" },
        orderBy: { type: "object", description: "{field,direction:asc|desc}" },
        limit: { type: "number" },
      },
      required: ["rootType", "select"],
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
  // Dogfooding P3：问运行中的系统自己（元本体活查询;受 DataCore MetaAccessPolicy 白名单门控,默认仅 admin）。
  {
    name: "query_system_ontology",
    descriptionForLLM: "查询平台自身的系统本体落库摘要（八类元对象计数：不变量/断点/事件/域/对象类型/门禁/切片）。回答『系统本体里有哪些断点/不变量』类元问题时调用。",
    inputSchema: { type: "object", properties: {} },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "get_breakpoint",
    descriptionForLLM: "取某断点（G-1..G-8）的状态 + 关联不变量 + 覆盖它的 PRD。回答『G-8 修了没/谁覆盖它』时调用。",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "断点 id，如 G-8" } }, required: ["id"] },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "impact_of",
    descriptionForLLM: "影响分析：以某节点（R14 / G-5 / SystemObjectType:Solver …）为根在系统本体图上 BFS，返回受影响节点集（『改 X 影响什么』= 图查询，自动化铁律0 read-first）。",
    inputSchema: { type: "object", properties: { node: { type: "string", description: "R14 / G-5 / SystemObjectType:<key>" } }, required: ["node"] },
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
      "调用确定性求解器进行计算。计算成本高，仅在确有必要时调用。**入参口径（缺必填即报错，勿空调）**：" +
      "capacity_forecast（型号需求增量产能可行性/能不能接）必填 args={modelId(型号如 4680-NCM),demandDelta(需求增量比例，如上浮10%→0.1),weeks(周数)}——" +
      "modelId 从当前选中对象/问句里的型号显式取，把「上浮X%」换算成 demandDelta=X/100、「N周」换算成 weeks=N；" +
      "affected_orders（某基地受影响订单）args={baseId}；gap_attribution（指标缺口反向归因）args={metricKey?,factorId?,scope?}。" +
      "「某型号加X%、N周能不能接」这类可承接性问题一律直接调 capacity_forecast，不要先反复 query_objects 盲扫。",
    inputSchema: {
      type: "object",
      properties: {
        solverKey: { type: "string", description: "求解器 key，如 capacity_forecast / affected_orders / gap_attribution" },
        args: {
          type: "object",
          description: "求解器入参。capacity_forecast 必填 {modelId, demandDelta, weeks}；缺必填求解器会返回明确参数错误，不要空调。",
        },
      },
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
  // CL.2 合规数据生成（fill_data / run_synthetic / build_domain）：在"信息不足/空租户"时
  // 触发确定性、走管线、可溯源的合成（**触发合成 ≠ 伪造**）。回执只含元信息（jobId/runId/counts），
  // 业务数字必须由你随后用 query_objects/query_timeseries_agg 读回真实物化值；产出落未审核态
  // （PROVISIONAL），答案须显式标注"基于本轮合成的未审核数据"，转正经 create_action_draft 走 R4。
  {
    name: "fill_data",
    descriptionForLLM:
      "缺某对象类型的数据时，按字段确定性补一批数据（经唯一上传口入管线，未审核态）。入参 typeKey/fields[]/rows?/seed?。回执只含 {connId,rowCount}；补完后用 query_objects 读回真实值再分析。不要把回执当业务数字。",
    inputSchema: {
      type: "object",
      properties: {
        typeKey: { type: "string", description: "对象类型 key（先用 discover 取真实类型名，勿猜）" },
        fields: { type: "array", items: { type: "string" } },
        rows: { type: "number", description: "可选，行数" },
        seed: { type: "number", description: "可选，确定性种子" },
      },
      required: ["typeKey", "fields"],
    },
    sideEffect: "COMPUTE",
    costClass: "EXPENSIVE",
  },
  {
    name: "run_synthetic",
    descriptionForLLM:
      "触发合成数据作业（industry×scale×seed 确定性，可选 livedIn 回放一年运营态），物化计划域/时序等对象到未审核态。回执只含 {jobId,...}；随后用 query_objects/query_timeseries_agg 读回真实物化值再分析。空租户问'达成率/未达成原因'缺数据时优先用本工具，而非拒绝或编造。",
    inputSchema: {
      type: "object",
      properties: {
        industry: { type: "string", description: "行业模板 key，如 battery-manufacturing" },
        scale: { type: "string", enum: ["S", "M", "L", "XL"] },
        seed: { type: "number", description: "可选，确定性种子（默认 42）" },
        livedIn: { type: "boolean", description: "可选，true=合成后回放 T−365→T0 一年运营态时序" },
      },
      required: ["industry", "scale"],
    },
    sideEffect: "COMPUTE",
    costClass: "EXPENSIVE",
  },
  {
    name: "build_domain",
    descriptionForLLM:
      "故事驱动建域：以用户问句为故事，倒推全栈 BuildPlan 并建出对象/规则/求解器骨架（未审核态 PROVISIONAL）。回执只含 {runId,...}；建好后用 query_objects/invoke_solver 读回/推演。需要新业务域而非仅补数据时用本工具。",
    inputSchema: {
      type: "object",
      properties: {
        story: { type: "string", description: "建域故事（通常=用户问句）" },
        seed: { type: "number", description: "可选，确定性种子" },
      },
      required: ["story"],
    },
    sideEffect: "COMPUTE",
    costClass: "EXPENSIVE",
  },
  // 增量4 §5：AI 推演指挥台 —— 让 path B agent 把沙盘当工具驱动（NL「开个沙盘，tick 3 次看风险」→ 调本组工具）。
  // 仅在租户开通 sim.commander(+sim.sandbox) 时对 agent 可见/可用（关→工具不存在，R3 暗发；门在 orchestrator 过滤层）。
  // R4 安全：sim tick/act 是**模拟态，绝不写真值**（DataCore 已保证：只动沙盘 TickState，采纳才出 ActionDraft 走审批）。
  // 回执只含会话态元信息（sessionId/curTick/state 模拟值），不是真值写出口，不绕审批。
  {
    name: "sim_init",
    descriptionForLLM:
      "开一个推演沙盘会话（模拟态，绝不写真值）。可选 baseSnapshot（初始世界态）/scope（推演范围）。回执 {id,status,curTick}——把 id 作为后续 sim_tick/sim_world/sim_certify 的 sessionId。要做『假设/推演/沙盘/tick』类探索时用本工具开局。",
    inputSchema: {
      type: "object",
      properties: {
        baseSnapshot: { type: "object", description: "可选：初始世界态快照（对象→状态变量）" },
        scope: { type: "object", description: "可选：推演范围（如限定基地/型号）" },
      },
    },
    sideEffect: "COMPUTE",
    costClass: "CHEAP",
  },
  {
    name: "sim_tick",
    descriptionForLLM:
      "推进沙盘 n 个 tick（模拟态传导，**不写真值**，R4）。入参 sessionId（sim_init 返回的 id）+ n（步数，默认 1）。回执 {curTick,state}——state 是模拟值非真值，须显式标注『沙盘推演结果（模拟态）』，落地仍须经 create_action_draft 走审批。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "sim_init 返回的会话 id" },
        n: { type: "number", description: "推进步数，默认 1" },
      },
      required: ["sessionId"],
    },
    sideEffect: "COMPUTE",
    costClass: "CHEAP",
  },
  {
    name: "sim_world",
    descriptionForLLM:
      "读沙盘当前世界态（模拟态）。入参 sessionId。回执 {tick,state}。用于 tick 后查看推演到了哪一步、各状态变量的模拟值。",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "sim_init 返回的会话 id" } },
      required: ["sessionId"],
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "sim_certify",
    descriptionForLLM:
      "对沙盘会话做就绪认证（L0–L4，只读评估，不写真值）。入参 sessionId + 可选 scope(GLOBAL|LOCAL)/target。回执含世界完整度/可否进入推演/缺件清单，用于判断该会话推演结论是否可采纳。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "sim_init 返回的会话 id" },
        scope: { type: "string", enum: ["GLOBAL", "LOCAL"], description: "认证范围，默认 GLOBAL" },
        target: { type: "string", description: "可选：LOCAL 时的目标对象引用" },
      },
      required: ["sessionId"],
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
  // 自成长发动机 A4 · 厂商中立 code-agent 施工面（与 REST/CLI 同源操作，经工具接口暴露）：
  // 让任意被授予这些工具的 agent（含外部 MCP 客户端走同一执行器）发现/认领/提交成长工单。
  {
    name: "discover_growth_tickets",
    descriptionForLLM:
      "发现待施工的成长工单（缺功能 → 带 I/O 契约 + 本体引用 + 验收 + 已建 DRAFT 骨架）。可按 status 过滤（OPEN/IN_PROGRESS/IN_REVIEW）。施工 agent 先调本工具拿到要建什么、骨架建到哪了。",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "IN_REVIEW", "MERGED", "VERIFIED"], description: "可选状态过滤" } },
    },
    sideEffect: "READ",
    costClass: "CHEAP",
  },
  {
    name: "claim_growth_ticket",
    descriptionForLLM: "认领一张成长工单（OPEN→IN_PROGRESS），登记施工者。厂商中立：任意 code agent 均可认领。",
    inputSchema: {
      type: "object",
      properties: { ticketId: { type: "string" }, assignee: { type: "string", description: "可选：施工者标识，缺省取当前用户" } },
      required: ["ticketId"],
    },
    sideEffect: "ACTION_DRAFT",
    costClass: "CHEAP",
  },
  {
    name: "submit_growth_ticket",
    descriptionForLLM: "提交施工成果待验证（IN_PROGRESS→IN_REVIEW）。提交后由 verify（重跑问句）判定是否 VERIFIED。",
    inputSchema: {
      type: "object",
      properties: { ticketId: { type: "string" }, note: { type: "string", description: "可选：施工说明/PR 链接" } },
      required: ["ticketId"],
    },
    sideEffect: "ACTION_DRAFT",
    costClass: "CHEAP",
  },
];

/**
 * 增量4 §5：AI 推演指挥台工具集。仅在租户开通 sim.commander(+sim.sandbox) 时对 path B agent 暴露
 * （关→工具不存在，R3 暗发）。orchestrator runPathB 据此做 entitlement 过滤。
 */
export const SIM_COMMANDER_TOOLS = ["sim_init", "sim_tick", "sim_world", "sim_certify"] as const;

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
