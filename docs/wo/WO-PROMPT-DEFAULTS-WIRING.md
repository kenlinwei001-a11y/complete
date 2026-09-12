# WO-PROMPT-DEFAULTS-WIRING · AgentCore 消费 DataCore 可配提示词模板（消硬编码漂移）

> 一句话：DataCore 已有可配置提示词模板（classifier/answer_compose 等），但 AgentCore 还在硬编码——两处会漂移。让 AgentCore 经 REST 读 DataCore 模板，硬编码降为兜底默认。

## 背景（审核方已核实属实）
- DataCore：`PLATFORM_PROMPT_DEFAULTS` + `PROMPT_KEYS` 契约 + `prompt_templates` 表（migration018·OC6 提示词配置化）+ 端点 `GET /a/v1/prompt-templates[/:key/resolve]`、`PUT /a/v1/prompt-templates/:key`（`app.ts:941-955`）。
- AgentCore：**零消费**（grep `PLATFORM_PROMPT_DEFAULTS`/`prompt-templates` 在 agentcore/src 无命中）→ `AGENT_SYSTEM_CORE`/`buildClassifierSystem` 等全硬编码。
- 风险：admin 在 DataCore 改了 classifier/compose 模板，AgentCore 不生效 → 口径漂移、配置化形同虚设。

## 🚦 文件边界（只碰这些）
- `apps/agentcore/src/agent/prompts.ts`（模板取值改为"先读 DataCore·失败兜底硬编码"）
- `apps/agentcore/src/llm/providers.ts` 或 `router/orchestrator.ts`（注入 prompt-template 读取客户端）
- `apps/agentcore/src/tools/clients.ts` / `datacore-http.ts`（加 `getPromptTemplate(key)` OBO 读取 + TTL 缓存）
- 对应 test
- **禁碰**：DataCore 侧（模板真值源已在，不动）；勿与 WO-HARNESS-PROMPT 同一 dev 抢 prompts.ts（**二选一先后做**，见下"依赖"）。

## 产出
1. **读取客户端**：AgentCore 经 OBO REST `GET /a/v1/prompt-templates/:key/resolve` 取模板；TTL 60s + `prompt.updated` 事件失效（对齐 type-semantics 缓存纪律）。
2. **消费点**：`classifier` / `answer_compose` 等 `PROMPT_KEYS` 覆盖的模板改为**先读 DataCore·A 不可达/无配置→兜底现有硬编码**（fail-open·不阻断）。
3. **单一真值**：DataCore 是模板真值源（R1·B 经 REST 读不 import A 源）；硬编码降为"平台默认兜底"。

## 硬约束
- **fail-open**：A 不可达 / mock 客户端无该端点 → 用硬编码默认，**绝不阻断查询**。
- **锁定短语不丢**：无论走 DataCore 模板还是兜底，最终 prompt 仍须含 `本题导航图/数字红线/写降级/能力边界/注入防护`；`[预算耗尽·诚实摘要]` 保留（否则 `lived-in.test.ts`/`qos-b.test.ts` 红）。→ 建议：DataCore 默认模板本身就含这些短语（把 harness 基线也纳入 `PLATFORM_PROMPT_DEFAULTS`）。
- **R6/字节兼容**：无配置时行为与现在逐字节一致。

## SEAM 门 / 验收
- SEAM（灭漂移）：DataCore 改 classifier 模板 + 失效 → AgentCore 分类 prompt **同步变**（真 HTTP 驱动组合测·非快照）；A 不可达 → 兜底硬编码不炸。
- 四包全绿；handoff 分支 `claude/handoff-wo-prompt-defaults-wiring`。

## 依赖 / 顺序
- 与 **WO-HARNESS-PROMPT 抢 `prompts.ts`** → **不并行**：先做 WO-HARNESS-PROMPT（把七要素叠加进硬编码基线），再做本 WO（把基线搬进 DataCore 默认模板 + AgentCore 读取）。或同一 dev 顺序整两单。

## 参考
`docs/PRD-agent-react-harness.md`（Harness 标准）；DataCore `app.ts:941` prompt-templates 端点。
