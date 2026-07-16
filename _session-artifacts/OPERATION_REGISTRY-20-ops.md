# OPERATION_REGISTRY — 20 缺区 op 草案（CLI 全覆盖 · DF.2 产物）

> 这是什么：`PRD-cli-full-coverage.md` 里 **DF.2** 的具体内容——把 PRD §2 契约里那个占位数组 `OPERATION_REGISTRY = [ /* 缺区 */ ]` 用 **DF.1 审计**实测的 20 个缺口能力域**填满**。
> 形态：**纯数据**（符合 `OperationRegistryEntrySchema`），无执行代码。实现 agent 在 DF.2 直接转抄进 `packages/contracts/src/operation-registry.ts`；DF.3 `deriveOperationCatalog` 把它 ⊕ `SOLVER_KEYS` ⊕ `FEATURE_REGISTRY` 合并成完整 `OPERATION_CATALOG`；DF.4 `cli-coverage:check` 守全覆盖。
> 端点：全部取自 DF.1 审计实测路由（grounded）。`r4`：仅 `sop`(定稿走 Action S2)/`boundary`(DRAFT→PUBLISH 经审批) 为 true，其余配置 CRUD 直写。`cliCommand` 全给（保证 CLI 可达），少数可视域附 `uiDeepLink`。

---

## 一、可直接转抄的条目（`contracts/operation-registry.ts`）

```ts
import { z } from "zod";

export const OperationRegistryEntrySchema = z.object({
  op: z.string(), label: z.string(), keywords: z.array(z.string()),
  endpoint: z.string(), requiredSlots: z.array(z.string()).default([]),
  r4: z.boolean().default(false),
  cliCommand: z.string().optional(), uiDeepLink: z.string().optional(),  // 至少其一（cli-coverage:check 强制）
});
export type OperationRegistryEntry = z.infer<typeof OperationRegistryEntrySchema>;

// DF.2 产物：20 缺区 op（grounded DF.1 审计 · 端点取自实测路由）
export const OPERATION_REGISTRY: OperationRegistryEntry[] = [
  { op: "workflow",        label: "工作流编排·建/发布/列",            keywords: ["工作流","编排","workflow","流程","步骤"],                          endpoint: "/b/v1/workflows",        requiredSlots: [],    r4: false, cliCommand: "workflow" },
  { op: "skill",           label: "技能·建/绑定/列",                  keywords: ["技能","skill","能力句","解读"],                                   endpoint: "/b/v1/skills",           requiredSlots: [],    r4: false, cliCommand: "skill" },
  { op: "mcp",             label: "MCP·服务/工具配置",                keywords: ["mcp","外部工具","工具服务","server","tool"],                      endpoint: "/b/v1/mcp-configs",      requiredSlots: [],    r4: false, cliCommand: "mcp" },
  { op: "eval",            label: "评测套件·跑/历史/parity",          keywords: ["评测","eval","用例","套件","回归","parity"],                       endpoint: "/b/v1/evals",            requiredSlots: [],    r4: false, cliCommand: "eval" },
  { op: "llm",             label: "LLM 供应商/用途绑定/预算",         keywords: ["llm","供应商","provider","模型","绑定","binding","预算","budget"], endpoint: "/a/v1/llm-providers",    requiredSlots: [],    r4: false, cliCommand: "llm" },
  { op: "ops",             label: "运营/调度/模拟时钟/回放",          keywords: ["运营","调度","scheduler","时钟","tick","回放","replay","persona"], endpoint: "/a/v1/scheduler/jobs",   requiredSlots: [],    r4: false, cliCommand: "ops" },
  { op: "tenant",          label: "租户/用户/角色 IAM",               keywords: ["租户","tenant","用户","user","角色","role","账号"],                endpoint: "/a/v1/tenants",          requiredSlots: [],    r4: false, cliCommand: "tenant", uiDeepLink: "/admin/tenants" },
  { op: "catalog",         label: "语义目录·检索（schema-linking）",   keywords: ["目录","catalog","检索","schema","找列","找表","描述"],             endpoint: "/a/v1/catalog/search",   requiredSlots: ["q"], r4: false, cliCommand: "catalog" },
  { op: "scene-config",    label: "场景/视图配置·入口/包/视图",        keywords: ["场景配置","视图配置","scene","入口","包","view-config"],           endpoint: "/b/v1/scene-entries",    requiredSlots: [],    r4: false, cliCommand: "scene-config", uiDeepLink: "/admin/scenes" },
  { op: "connection",      label: "连接器实例·校验策略/分类/模版",     keywords: ["连接器实例","连接","connection","校验策略","数据分类","模版"],      endpoint: "/a/v1/connections",      requiredSlots: [],    r4: false, cliCommand: "connection" },
  { op: "meta",            label: "系统自我本体·同步/影响分析",        keywords: ["meta","系统本体","元本体","影响分析","dogfooding","impact"],       endpoint: "/a/v1/meta/sync",        requiredSlots: [],    r4: false, cliCommand: "meta" },
  { op: "slice",           label: "本体切片·规划/库/索引",            keywords: ["切片","slice","路径","子图","规划器"],                            endpoint: "/a/v1/slices",           requiredSlots: [],    r4: false, cliCommand: "slice" },
  { op: "rule-extract",    label: "规则文档抽取·上传/候选审核",        keywords: ["规则抽取","规则文档","ruledoc","抽取","候选","审核规则"],          endpoint: "/a/v1/rule-docs",        requiredSlots: [],    r4: false, cliCommand: "rule-extract" },
  { op: "sop",             label: "S&OP 月度平衡·版本/定稿",          keywords: ["sop","产销平衡","月度平衡","版本","定稿","五步法"],                endpoint: "/a/v1/sop/versions",     requiredSlots: [],    r4: true,  cliCommand: "sop" },
  { op: "platform-config", label: "平台配置·提示词/工厂日历/写回回声", keywords: ["平台配置","提示词","prompt","日历","calendar","写回","writeback"], endpoint: "/a/v1/prompt-templates", requiredSlots: [],    r4: false, cliCommand: "platform-config" },
  { op: "validate",        label: "校验/VLE·跑验证",                  keywords: ["校验","validation","vle","验证","查全查准","参照"],                endpoint: "/a/v1/validation/runs",  requiredSlots: [],    r4: false, cliCommand: "validate" },
  { op: "metric",          label: "经营指标/KSF/责任主体（SPINE）",    keywords: ["指标","metric","ksf","责任主体","principal","达成"],               endpoint: "/a/v1/metrics",          requiredSlots: [],    r4: false, cliCommand: "metric", uiDeepLink: "/admin/metrics" },
  { op: "notify",          label: "通知中心·列/已读",                 keywords: ["通知","notification","消息","收件箱","提醒"],                      endpoint: "/a/v1/notifications",    requiredSlots: [],    r4: false, cliCommand: "notify" },
  { op: "config-bundle",   label: "配置迁移·导出/导入（环境间 Saga）", keywords: ["配置迁移","config bundle","导出配置","导入配置","环境迁移","saga"], endpoint: "/a/v1/config-bundles",   requiredSlots: [],    r4: false, cliCommand: "config-bundle" },
  { op: "boundary",        label: "生成边界·词表/影响/发布",          keywords: ["生成边界","boundary","业务词表","边界","接地","发布边界"],         endpoint: "/a/v1/boundary",         requiredSlots: [],    r4: true,  cliCommand: "boundary" },
];
```

---

## 二、速览表（人读）

| # | op | 能力域 | endpoint | r4 | cliCommand | uiDeepLink |
|---|---|---|---|---|---|---|
| 1 | `workflow` | 工作流编排 | `/b/v1/workflows` | – | `workflow` | |
| 2 | `skill` | 技能 | `/b/v1/skills` | – | `skill` | |
| 3 | `mcp` | MCP 配置 | `/b/v1/mcp-configs` | – | `mcp` | |
| 4 | `eval` | 评测套件 | `/b/v1/evals` | – | `eval` | |
| 5 | `llm` | LLM 供应商/绑定/预算 (G-7) | `/a/v1/llm-providers` | – | `llm` | |
| 6 | `ops` | 运营/调度/时钟/回放 (A8) | `/a/v1/scheduler/jobs` | – | `ops` | |
| 7 | `tenant` | 租户/用户/角色 IAM | `/a/v1/tenants` | – | `tenant` | `/admin/tenants` |
| 8 | `catalog` | 语义目录检索 | `/a/v1/catalog/search` | – | `catalog` | |
| 9 | `scene-config` | 场景/视图配置 | `/b/v1/scene-entries` | – | `scene-config` | `/admin/scenes` |
| 10 | `connection` | 连接器实例/分类/模版 | `/a/v1/connections` | – | `connection` | |
| 11 | `meta` | 系统自我本体/影响分析 | `/a/v1/meta/sync` | – | `meta` | |
| 12 | `slice` | 本体切片/规划器 | `/a/v1/slices` | – | `slice` | |
| 13 | `rule-extract` | 规则文档抽取 (A2) | `/a/v1/rule-docs` | – | `rule-extract` | |
| 14 | `sop` | S&OP 月度平衡 | `/a/v1/sop/versions` | **✓** | `sop` | |
| 15 | `platform-config` | 提示词/日历/写回回声 (OC5/6/9) | `/a/v1/prompt-templates` | – | `platform-config` | |
| 16 | `validate` | 校验/VLE | `/a/v1/validation/runs` | – | `validate` | |
| 17 | `metric` | 指标/KSF/责任主体 (SPINE) | `/a/v1/metrics` | – | `metric` | `/admin/metrics` |
| 18 | `notify` | 通知中心 | `/a/v1/notifications` | – | `notify` | |
| 19 | `config-bundle` | 配置迁移 (OC3) | `/a/v1/config-bundles` | – | `config-bundle` | |
| 20 | `boundary` | 生成边界 GenerationBoundary | `/a/v1/boundary` | **✓** | `boundary` | |

---

## 三、说明（给实现 agent）

- **这 20 是"非 solver/非 view"缺区**——`deriveOperationCatalog`（DF.3）对求解器（`SOLVER_KEYS`→`solve <key>`）和视图（`FEATURE_REGISTRY`→`scenarios`/`ask`）自动派生，**它们不在这张表**；这 20 是注册表派生不出、必须显式登记的部分。
- **多资源归一**：部分 op 覆盖一簇资源（如 `llm` = providers+bindings+budgets；`ops` = ops+scheduler+sync-jobs；`tenant` = tenants+users+roles；`connection` = connections+data-categories+raw-datasets+data-templates；`scene-config` = scene-entries+scenario-packages+view-configs+scenes；`platform-config` = prompt-templates+calendars+writeback-echoes）。子动作由 `cliCommand` 的参数/子命令分发。
- **`requiredSlots`**：默认动作为 list/get 故多为 `[]`；`catalog` 需 `q`（检索词）。create/act 子动作的入参由各 `cliCommand` 自带。
- **落 DF.2 后必跑 DF.4 `cli-coverage:check`**：枚举 `SOLVER_KEYS ∪ FEATURE_REGISTRY ∪ OPERATION_REGISTRY ∪ 端点` 验全覆盖——这张表补完，覆盖门才可能转绿。
- **落地前再 grep 核对一遍端点**（并发分支在动，资源名/路由会漂）。

> 状态：DF.2 数据草案（无执行代码）。属 `PRD-cli-full-coverage.md` 的 DF.2 内容补全。
