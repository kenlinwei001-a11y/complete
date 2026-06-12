# PRD 增量 · LLM 多厂商配置 + 统一引用模式（变更传播）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：修订 QOS-PRD §6.1/§4.1、平台 PRD §8.1、管理平台增量 §4；新增 /admin/llm-providers 页与引用语义总规范） |
| 解决问题 | ① 中台可配置多个 LLM 厂商与密钥（含国产/本地模型），按用途绑定；② agent/workflow 对规则/约束/skill 等统一为**引用模式**——源头一改、引用方全部生效，降低运营成本 |

---

# Part 1 · LLM Provider 配置体系

## 1.1 模型与落位

```ts
interface LlmProvider {                  // 表 llm_providers（DataCore；密文设施与连接器凭据同套 AES-GCM）
  id: string; tenantId: string;          // 支持租户级；platform 级模板由 platform_admin 维护可克隆
  name: string;                          // 如 "Anthropic 官方" / "本地 vLLM-Qwen"
  kind: "anthropic" | "openai_compatible" | "custom_http";
  baseUrl?: string;                      // anthropic 可空（官方端点）；openai_compatible 必填
  apiKey: string;                        // 写入即密文，API/日志永不回显（同连接器凭据规则）
  models: { modelId: string; displayName: string;
            capabilities: { tools: boolean; structuredOutput: boolean; maxContext: number } }[];
  status: "ACTIVE" | "DISABLED";
  fallbackProviderId?: string;           // 不可用时的降级目标（≤1 级，禁止链式）
}
```

- **落位 DataCore**（与凭据加密、租户管理同处）；AgentCore 与 DataCore 内部的 LLM 调用方（A2 抽取/A3 建模/A7 模板）共同消费。
- **密钥跨系统传递**：AgentCore 经**服务间凭证**（环境变量 `SERVICE_TOKEN`，仅服务间路由接受）调 `GET /a/v1/llm-providers/{id}/credential` 获取解密密钥，内存缓存 5min，调用全审计；该端点对用户 JWT 一律 403——密钥永不到前端、永不落 B 库。

## 1.2 适配器层（packages/llm-adapters，两系统共享）

```ts
interface LlmClient {
  complete(req: CompletionReq): Promise<CompletionResp>;
  parse<T>(req: ParseReq<T>): Promise<T | null>;          // 结构化输出
  toolLoop(req: ToolLoopReq): AsyncIterable<ToolLoopEvent>; // 工具循环原语
}
```

- 实现：`AnthropicAdapter`（现 QOS-PRD §6 实现收编于此，行为不变）；`OpenAICompatAdapter`（覆盖 vLLM/主流国产模型的 OpenAI 风格端点）；`custom_http` 留接口。
- **能力降级规则**（按 provider.capabilities 声明自动选择）：无原生结构化输出 → JSON-mode 提示 + zod 校验失败重试 ≤2 次，仍失败按该调用点的既有失败语义处理（如分类失败→路径 B）；无原生 tools → 该 provider **不可绑定 Agent 用途**（绑定时校验拒绝），而非运行期降级——工具循环不做提示词模拟（质量不可控）。

## 1.3 用途绑定（修订 QOS-PRD §6.1 / 场景包）

模型引用从字符串升级为 `{ providerId, modelId }`。**用途矩阵**（租户级默认 + 场景包覆盖）：

| 用途 key | 调用点 | 默认能力要求 |
|---|---|---|
| `classifier` | QOS 意图分类 | structuredOutput |
| `agent` | 路径 B 工具循环 | tools + structuredOutput |
| `extraction` | A2 规则文档抽取 | structuredOutput |
| `modeling` | A3 建模建议 | structuredOutput |
| `template_gen` | A7 行业模板生成 | structuredOutput |
| `compose` | workflow llm_compose 步骤 | （无硬要求） |

每次 LLM 调用的审计记录补 `{providerId, modelId}`；指标 `qos_llm_tokens_total` 增加 `provider` 标签。

## 1.4 中台页面 /admin/llm-providers（tenant_admin）

Provider 列表（kind 徽章/状态/模型数/近 7 日 token 用量）→ 编辑器：连接参数、**密钥输入框（write-only，保存后显示 `••• 已配置` + "更换"）**、模型清单管理（增删行 + 能力勾选）、**连接测试按钮**（发一条最小请求，返回延迟与可用模型探测结果）、降级目标选择。第二个 Tab：**用途绑定矩阵**（6 用途 × provider/model 下拉，能力不满足的选项禁用并注明缺什么）。

---

# Part 2 · 统一引用模式（变更传播规范）

## 2.1 引用语义总规范（所有跨模块引用一律遵守）

```ts
type Ref = { kind: "rule"|"skill"|"workflow"|"plan"|"agent"|"mcp"; key: string;
             version: number | "latest" };          // 缺省 "latest"
```

| 引用关系 | 现状 | 本增量修订 |
|---|---|---|
| agent → skill / workflow | 已支持 `latest` ✅ | 缺省值明确为 `latest` |
| agent / 计划步骤 → 规则（ruleKeys） | 按 key 引用 | **明确语义：求值永远取该 key 当前 PUBLISHED 最新版**（规则天然 latest，不可 pin——约束必须全局一致，pin 旧规则等于留后门） |
| **意图 → 执行计划** | ❌ 绑定具体 planId（钉死版本） | **修订 QOS-PRD §4.1**：`planId` → `planRef: { planKey, version: number\|"latest" }`，缺省 latest |
| workflow 步骤 → agent | `version: latest` 可选 ✅ | 缺省 latest |
| feature bindings → intents/solvers | 按 key ✅ | 不变 |

**解析时点**：一律**执行时解析**（每次任务/求值/加载时取当前生效版本）——源头发布新版本后，所有引用方下一次执行即生效，**零运营动作**。需要稳定性的场景（如对外承诺过的回归口径）才显式 pin 数字版本。

## 2.2 可复算性保障（latest 不牺牲审计）

每次执行把**解析到的实际版本**写入留痕：QueryTask 增加 `resolvedRefs: {kind,key,version}[]`；规则求值结果（RuleVerdict）带 `ruleVersion`；任务详情页显示"当时生效：C03 v1.2 / plan capacity_feasibility v3"。重放/争议追溯用留痕版本，不受后续变更影响。

## 2.3 变更影响分析与发布门禁

1. **publish 响应必须附影响面**：`{ impact: { agents: n, plans: n, intents: n, refs: Ref[] } }`（references API 反查，规则/skill/workflow/计划全部支持——管理平台增量 §4 的 references 端点从 B 资源推广到 A 的规则库）。
2. **中台发布确认页**：展示影响面清单 + 「发布并立即生效于 n 个引用方」确认语；影响面 >10 时要求输入资源 key 二次确认。
3. **兼容性门禁**：workflow 新版本的 inputs/输出 schema 与上一版**不兼容**（字段删除/类型变更）时——若存在 latest 引用方 → 发布被拒（`BREAKING_CHANGE_WITH_LATEST_REFS`，列出引用方），只能选择：改为兼容、或让引用方先 pin、或同步升级引用方后用 `force=true`（需 catalog_admin，全审计）。规则的 scope 缩窄同理给警告（非阻断）。
4. **变更通知**：发布即发 outbox 事件 `{kind}.updated`（复用平台 PRD C-2 webhook 机制）；订阅方（B 对 A 资源）据此**主动失效缓存**。

## 2.4 缓存一致性（传播延迟上限）

B 侧对 A 资源（规则定义/功能集/provider 配置）缓存统一规则：TTL 60s + 收到 `{kind}.updated` 事件立即失效。**传播延迟 SLO：≤60s**（事件通路故障时由 TTL 兜底）。前端资源编辑器保存后提示"约 1 分钟内对所有引用方生效"。

## 2.5 验收用例

| # | 用例 | 预期 |
|---|---|---|
| L1 | 新建 openai_compatible provider（mock 端点）+ 连接测试 | 密钥 write-only 不回显；测试返回延迟；绑定 `classifier` 用途后分类调用走该端点（审计含 providerId） |
| L2 | provider 无 tools 能力绑定 `agent` 用途 | 绑定被拒并注明缺失能力 |
| L3 | 无结构化输出的 provider 做分类 | JSON-mode 降级 + zod 重试；两次失败 → 既有失败语义（转路径 B） |
| L4 | provider 故障 → fallback | 降级目标接管且指标/审计可见；禁止链式（fallback 的 fallback 不生效） |
| L5 | 改规则 C08 阈值并发布 | 发布响应含影响面；60s 内（事件即时）所有绑定该规则的 agent/计划求值用新阈值；既有任务留痕仍显示旧版本号 |
| L6 | 意图 planRef=latest，计划发新版 | 下一次命中该意图即执行新版；pin=2 的另一意图不变 |
| L7 | workflow 破坏性变更 + 存在 latest 引用 | 发布被拒并列引用方；force 发布走审计 |
| L8 | skill 更新 | 引用 latest 的 agent 下次加载即新内容；任务留痕含 skill 版本 |
