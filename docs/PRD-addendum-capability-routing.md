# PRD 增量 · 能力发现与路由（切片目录 / MCP 工具集规模 / 等价能力故障转移）

| 项 | 值 |
|---|---|
| 版本 | v1.0（修订 QOS-PRD §7.1 工具注册表、Agent 运行时增量 §4、平台 §8.3；基线 Part B 追加裁决 #23） |
| 解决问题 | ① 路径 B Agent 无法发现可用切片/求解器目录（resolve_slice 工具实际不可用）；② 多 MCP server 场景工具 schema 全量进上下文（定义膨胀，与"结果截断"对称的另一半没管）；③ 等价能力多 server 的故障转移；④ Skill 大库路由的边界声明 |

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及不变量**（§5）：R6
- **触及断点**（§8）：G-7
- **范畴**：能力发现与路由：切片/工具目录 + 等价能力故障转移（用途枚举 G-7）

## 1. 资源目录发现（Agent 侧，新增统一工具 `discover`）

```ts
// 工具定义（READ，缺省进路径 B 白名单）
{ name: "discover",
  description: "发现当前可用的能力目录。kind=slices 返回可用本体切片（含用途说明与参数）；kind=solvers 返回求解器；kind=mcp_tools 返回未加载的 MCP 工具（见 §2）。当不确定该用什么切片/求解器/工具时先调用本工具。",
  input_schema: { type:"object", properties:{
    kind: { type:"string", enum:["slices","solvers","mcp_tools"] },
    query: { type:"string", description:"可选关键词过滤" } }, required:["kind"] } }
```

- **返回**（≤20 条，关键词 trigram 过滤+排序）：`{ items: [{ key, name, description, argsSchema摘要, domain? }] }`——内容来自切片/求解器注册表的元数据（SliceSpec/求解器注册新增 `description` 与 `argHints` 字段，发布校验必填——**没有给 LLM 看的描述就不允许发布**，这是目录可发现性的供给侧纪律）；
- 权限与功能开通过滤在目录层即生效（用户无权/租户未开通的能力不出现在目录——与"404 不泄露存在性"一致）；
- 替代方案声明：**不采用**把全部切片枚举塞进 resolve_slice 工具描述的做法（目录会增长，描述膨胀同 §2 问题）；discover 是统一出口；
- 路径 A 不受影响（设计期绑定不查目录）。

## 2. MCP 工具集规模管理（按需加载，修订 Agent 运行时 §4）

1. **阈值**：agent 解析后的工具总数（内置+MCP）≤ **24** 个时维持现状（全量 schema 进请求）；超过则启用**按需加载模式**：
   - 进入上下文的只有：内置工具 + 各 MCP server 的**占位摘要**（每 server 一行："mcp__erp__* 共 18 个工具：采购/库存/凭证类操作——用 discover(kind=mcp_tools) 查看并用 load_tools 加载"）+ 两个管理工具 `discover` / `load_tools`；
   - `load_tools { names: string[] ≤6 }`：把指定 MCP 工具的完整 schema 追加进本任务后续请求的工具列表（任务级生效，不跨任务；追加不替换——保护 Anthropic 通道的 prompt cache 前缀）；
2. 已加载工具计入上下文预算（Agent 运行时 §1 的 token 预算器把工具定义计入）；加载上限：单任务追加 ≤12 个，超出 → is_error 提示"先用 discover 缩小范围"；
3. 审计：AgentRunRecord 增加 `loadedTools: string[]`——哪些工具被动态加载是评测（OC2 套件）关注的行为信号。

## 3. 等价能力组与故障转移（MCP 高可用，可选配置）

```ts
// McpServerConfig 新增
capabilityGroup?: string;     // 同组 = 等价能力（如两个 ERP 网关实例）
groupPriority?: number;       // 组内优先级，小者优先
```

- 同 `capabilityGroup` 的 server 暴露**一套**命名空间工具（取组内 priority 最高且 ACTIVE 者的 schema；组内 schema 不一致 → 配置校验拒绝入组）；
- 调用路由：按 priority 取首个非 ERROR/非熔断 server；调用失败按执行语义 §5 同款熔断规则后**组内切换**（审计记 `routedTo`）；全组不可用 → is_error；
- 不配 capabilityGroup 的 server 行为不变（单实例语义）。

## 4. Skill 路由边界声明

本期维持"≤20 技能 + summary 常驻 + load_skill 渐进披露"——该规模下 LLM 按摘要自选即最优路由，**不引入**额外路由层（复杂度不偿失）。**v2 触发条件**（写入路线图）：单 agent 技能需求 >20 或出现跨 agent 共享技能库诉求时，启用语义相关性注入（pgvector 底座已备：skill summary 向量化，按任务上下文 top-k 注入替代全量常驻）。届时 discover 工具增加 `kind=skills`。

## 5. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| CR1 | Agent 问需要切片的问题（Mock 脚本） | discover(slices) → 目录含 description；resolve_slice 以目录返回的 key 成功调用；无 description 的切片发布被拒 |
| CR2 | 目录权限过滤 | base_manager 的 discover 结果不含其无权切片；关闭某 feature 后关联求解器从目录消失 |
| CR3 | 工具集 >24 | 上下文中仅占位摘要+管理工具（请求体断言）；load_tools 后该工具可用且 prompt cache 前缀未失效（Anthropic 通道 cache_read 断言）；超 12 个加载被拒 |
| CR4 | 能力组故障转移 | 组内主 server 注入 5xx → 熔断 → 自动路由次 server（审计 routedTo）；schema 不一致入组被配置校验拒绝 |
| CR5 | 评测联动 | OC2 套件可断言 toolSequence 含 discover→load_tools→目标工具 的发现链 |
