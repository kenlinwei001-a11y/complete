// WO-WORKFLOW-MCP · 工作流 MCP 面（DSH 原生「MCP 模式」载荷）。
//
// ⛔ **本文件刻意不住在 `dsh-runtime/` 下**（WO-DORMANCY-D3-FIX）：`engine.ts` 原生臂与
// `mocks/seed.ts` 都要**静态** import 这些助手（工具名 / 配置行 id / 载荷构造），而
// `dsh-runtime/` 是 `dsh-dormancy:check` D3 的白名单目录 —— 「从目录外静态 import 它」= 裸入口，
// 会在**链接期**把该目录拖进启动图，绕过 `DSH_HARNESS` flag 判断（休眠护栏的不变量）。
// 判据落在**内容性质**上：本模块是纯常量 + 纯函数、**零 `@deepseek-ai/*` 依赖**（金丝雀：
// 同串查该文件命中 0），所以它既不该当入口、也不需要 flag 保护。中性位置与 `mcp/solvers-catalog.ts`、
// `tools/ontology-mcp.ts` 同族。**改回 `dsh-runtime/` 下会让 D3 当场变红。**
//
// 【为什么有它】仓主 2026-10-05 令：每一类资源都要落到 DSH 的三种原生模式之一
// （plugin / MCP / skill），而不是靠我方逐 run 推的数据。工作流此前**只**能靠
// `agent.tools` 里的 WORKFLOW 授予 + `hostWorkflowTools` 专用字段逐 run 推给 DSH ——
// DSH 自己**不知道**有这个资源，配置面里配不了、发现不了、也没有命名空间隔离。
// 本模块把它搬上 MCP 面。
//
// 【形状照抄正线先例】`tools/ontology-mcp.ts`（本体切片 2026-10-05 刚用同型方式迁完）：
// 内置 MCP server + `mcp__{server}__{tool}` 命名 + **调用归一回既有执行路径（零重写）**。
// 差别只有一处，且是**数据性质**带来的：本体工具集是平台固定的（静态投影即可），
// 工作流是**租户数据**（随工作流发布变），故工具清单必须**逐 run 从仓储现算**后注入
// 子进程 env（见下 `PLATFORM_WORKFLOW_MCP_TOOLS`）。命名/解析两半仍与本体同形，
// 不另发明一套。
//
// 【单一来源】工具描述/入参模式全部取自既有 workflow 定义（`WorkflowDefinition.name/
// description/inputs`）——⛔ 本文件不重抄一份 schema 也不改文案（改了就是第二套真相源，
// 且会让同一工具在 native 臂与 DSH 臂上文本漂移）。

import type { WorkflowDefinition } from "@platform/contracts";

/** DSH 侧命名空间标识（进 `mcp__{server}__{tool}` 公开名；须过 ^[a-z0-9_]{2,24}$）。 */
export const WORKFLOW_MCP_SERVER = "workflow";

/**
 * 平台内置工作流 MCP server 的**配置行 id**（`seedMcpConfigs()` 的主键 /
 * `agent.tools[].mcpConfigId` / `agent.mcpServers[].mcpConfigId` 三处同值）。
 * **单源放这里**：授予面、挂载面、以及 engine 的运行期注入都要写它 ——
 * 各写各的字面量就是会漂的第二来源（改一处漏一处 ⇒ 静默零工具）。
 */
export const WORKFLOW_MCP_CONFIG_ID = "mcp_builtin_workflow";

/**
 * 子进程 env 键：逐 run 的工作流工具目录（JSON 数组，`WorkflowMcpToolSpec[]`）。
 *
 * 为什么走 env 而不是让子进程自己连宿主查：与 ontology-mcp-server 同一条纪律 ——
 * 该进程**不含任何执行逻辑、不读凭据、不碰仓储**，只做「MCP 面 ↔ 宿主反向通道」的
 * 协议适配。目录是**配置**不是执行，随 setup 帧同源下发（真源仍是 engine 的授予面，
 * 与 `toolAllowlist` 同一份 `expanded`）。
 */
export const WORKFLOW_MCP_TOOLS_ENV = "PLATFORM_WORKFLOW_MCP_TOOLS";

/** 暴露给模型/scopeDeclaration/审计的 MCP 全名（增量 §4.2：一律用全名）。 */
export function workflowMcpToolName(key: string): string {
  return `mcp__${WORKFLOW_MCP_SERVER}__${key}`;
}

/** 解析工作流 MCP 全名 → 工作流 key；非本 server 形态返回 undefined（与 ontology 同形）。 */
export function parseWorkflowMcpToolName(fullName: string): string | undefined {
  const prefix = `mcp__${WORKFLOW_MCP_SERVER}__`;
  if (!fullName.startsWith(prefix)) return undefined;
  const raw = fullName.slice(prefix.length);
  return raw.length > 0 ? raw : undefined;
}

/**
 * 工具描述的来源标注前缀（模型面可见）。**单源放这里**，理由与
 * `ONTOLOGY_MCP_DESC_PREFIX` 逐字相同：同一段描述有两条出线（① 宿主静态投影
 * `expandAgentTools`，原生臂的模型面 ② MCP wire `tools/list`，DSH 臂的模型面），
 * 各写各的前缀 = 两内核模型面文本漂移。
 */
export const WORKFLOW_MCP_DESC_PREFIX = "[MCP·工作流] ";

export interface WorkflowMcpToolSpec {
  /** 模型可见全名 mcp__workflow__{key} */
  name: string;
  /** MCP server 上的裸工具名（wire 上 tools/call 用这个）——就是工作流 key */
  rawName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const WORKFLOW_MCP_SERVER_INFO = {
  name: WORKFLOW_MCP_SERVER,
  displayName: "工作流（平台内置）",
  builtin: true as const,
  sideEffect: "READ" as const,
};

/**
 * 工作流定义 → MCP 工具条目。
 *
 * 描述文案**逐字**保持迁移前 hostWorkflowTools 那条通道的拼法
 * （`${name}（这是一个多步流程，将按声明式步骤执行并返回结果）${description ?? ""}`）——
 * 只加来源前缀。理由：描述是模型面文本，改文案 = 改行为，不是本单要动的东西；
 * 前缀则必须加，否则「这个工具来自 MCP 面」在模型面上不可辨（本体先例同款）。
 *
 * 入参模式直取 `wf.inputs`（工作流定义的单一来源），不重抄。
 */
export function workflowMcpTool(wf: Pick<WorkflowDefinition, "key" | "name" | "description" | "inputs">): WorkflowMcpToolSpec {
  return {
    name: workflowMcpToolName(wf.key),
    rawName: wf.key,
    description: `${WORKFLOW_MCP_DESC_PREFIX}${wf.name}（这是一个多步流程，将按声明式步骤执行并返回结果）${wf.description ?? ""}`,
    inputSchema: (wf.inputs ?? { type: "object", properties: {} }) as Record<string, unknown>,
  };
}

/**
 * 构建工作流 MCP 工具清单（确定性 R6：按 key 排序，不随仓储返回次序漂）。
 *
 * ⚠ **不按 status 过滤**：这是刻意的，不是漏了。迁移前 `expandAgentTools` 对 WORKFLOW
 * 授予**不做**发布态检查（授予面即闸），本单只换传输面 ⇒ 必须保持同一可授予集，
 * 否则「同一个授予，迁完少一件」会被读成迁移副作用。发布态闸若该有，是另一单的事。
 */
export function buildWorkflowMcpTools(
  workflows: readonly Pick<WorkflowDefinition, "key" | "name" | "description" | "inputs">[],
): WorkflowMcpToolSpec[] {
  return workflows
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(workflowMcpTool);
}

/**
 * 子进程侧解析注入目录。**畸形一律 fail-closed 成空表**（不编一个空壳工具，也不
 * 静默半读）——空表 ⇒ `tools/list` 空 ⇒ 模型面看不到工作流，屏上表现是「这个能力
 * 不存在」，与 §工具面诚实缺席的纪律一致（ontology server 头注同款论证）。
 */
export function parseWorkflowMcpToolsEnv(raw: string | undefined): WorkflowMcpToolSpec[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is WorkflowMcpToolSpec =>
        !!t &&
        typeof t === "object" &&
        typeof (t as WorkflowMcpToolSpec).name === "string" &&
        typeof (t as WorkflowMcpToolSpec).rawName === "string" &&
        typeof (t as WorkflowMcpToolSpec).description === "string" &&
        !!(t as WorkflowMcpToolSpec).inputSchema &&
        typeof (t as WorkflowMcpToolSpec).inputSchema === "object",
    );
  } catch {
    return [];
  }
}
