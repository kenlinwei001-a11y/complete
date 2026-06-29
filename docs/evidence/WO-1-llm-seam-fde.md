# WO-1 · LLM 用途接缝根治 — FDE 真跑证据（dev 自验·真打 Kimi）

> 施工单：`docs/HANDOFF-deep-scan-buildorders.md` WO-1（P0×2 同根 + P2 次生）。
> 角色：dev 自验贴真证据；审核方按 §6 独立真跑复验后核发闭合。
> 环境：datacore :4001（SEED_DEMO=1·KIMI_API_KEY operator 提供·CREDENTIAL_KEY dev）+ agentcore :4002（同 SERVICE_TOKEN/CREDENTIAL_KEY）。LLM=Kimi(Moonshot) kimi-k2.6（openai_compatible）。密钥仅运行期 env，**不入 git/不回显**（R5）。

## 根因纠正（与原 WO 假设的差异·已与审核方对齐）

WO-1B 原假设：「路径B agent-loop 用了不识 `dcp:` 前缀的 client → 换成 RoutingLlmClient」。**实勘推翻**：路径 A(classifier) 与路径 B(agent) **都经同一 `RoutingLlmClient.{classify,agent}` → `registry.resolve(dcp:…)`**（`apps/agentcore/src/llm/providers.ts:363-393`、`main.ts:60`），不是「换 client」。真正根因与 1A **同一道**：**用途/角色未解析到带凭据的 provider 时，解析层静默回落到无凭据内置客户端 → LLM SDK 在调用时抛原始鉴权串**（DataCore=A2 抽取/合成段 FAILED；AgentCore=路径B 3ms AGENT_ERROR·SDK 串）。故 1A/1B 是「同一接缝在两个代码库」，修法是**两服务统一：未解析到凭据→抛结构化错误，绝不裸调无凭据 SDK**。

## 改动文件

| 文件 | 改动 |
|---|---|
| `apps/datacore/src/llmproviders.ts` | `TenantRoutedLlmClient` 加 `fallbackHasCredentials` 构造参 + `fallbackOrThrow`：无用途绑定且 env 无凭据 → 抛 `AppError('LLM_PURPOSE_UNBOUND', 中文引导, 400)`，不裸调无凭据 SDK（1A） |
| `apps/datacore/src/app.ts` | 构造 `routedLlm` 时算 `envLlmHasCredentials`（anthropic→ANTHROPIC_API_KEY / openai 系→DC_LLM_API_KEY_ENV·OPENAI_API_KEY）传入（1A） |
| `apps/agentcore/src/llm/providers.ts` | 新增 `LlmPurposeUnboundError`（code=LLM_PURPOSE_UNBOUND）；`clientFor` 回落内置默认且无凭据且非测试 factory → 抛之，不返无凭据 client（1B 根因） |
| `apps/agentcore/src/router/orchestrator.ts` | `failTask` 加 `sanitizeLlmAuthLeak` 兜底：任何残留 SDK 鉴权签名 → 归一为 LLM_PURPOSE_UNBOUND + 中文引导（1B 红线·防任意泄漏路径） |
| `apps/datacore/src/seed.ts` | `seedDemoLlmProvider` capabilities `structuredOutput` false→true（1C·提升 classifier/modeling 解析率） |

## FDE 真值判据 · 逐条真实结果

### 1A（P0）✅ 未绑用途 → 结构化错误·不泄漏 SDK 串
```
curl -H 'X-Debug-User: t1:u1:admin' -X POST :4001/a/v1/synthetic/jobs -d '{"industry":"foobar-unknown","scale":"S"}'
→ {"error":{"code":"LLM_PURPOSE_UNBOUND","message":"用途 template_gen 未绑定 LLM provider，请在 设置→LLM 用途绑定 配置","requestId":"..."}}
```
判据：`error.code=LLM_PURPOSE_UNBOUND` ✓ · 响应体**不含** "Could not resolve authentication method" ✓（t1 无 provider/binding 且 env 无凭据 → 走 fallbackOrThrow 抛结构化错误）。

### 1B（P0）✅ 路径B agent 真打 Kimi·出真答案·不泄漏 SDK 串
demo（已配 Kimi）目录外问句 `POST /api/v1/queries`（path B）：
```
query: "用 discover 工具看一下本租户有哪些对象类型，挑其中实例最多的一个类型，简要说明它代表什么。"
→ status=COMPLETED · path=AGENT · trustLevel=AGENT_EXPLORATORY · elapsed=39.8s（真打 Kimi 多轮·非 3ms）
→ 真答案：「本租户当前共有 35 种对象类型…实例数量最多的是 Equipment（设备），共 72 条实例⟦ref:0⟧… Equipment 属于 equip（设备）域，代表…生产设备/资产」
→ decision-trace 含 kimi-k2.6 ✓
```
判据全过：COMPLETED ✓ · AGENT_EXPLORATORY ✓ · 真答案（带 ⟦ref⟧ 溯源）✓ · >5s ✓ · trace 含 kimi-k2.6 ✓ · 无 SDK 串 ✓。

**诚实补充**：另一条**开放式**问句（"综合分析维护策略与备件库存权衡 + 三条建议"）跑 122.5s、真打 Kimi 多轮工具调用（search_experience/discover/query_objects×6 全 OK），但在 agent **时间预算耗尽（BUDGET_EXCEEDED）** 前未收敛出 final answer → 答案为占位「探索模式未能产出回答」。这是 **agent 时间预算/收敛**问题（Kimi 单轮 10-30s × 多轮即触顶），**非 WO-1 的用途接缝缺陷**——接缝已修（真打 LLM、无 3ms、无 SDK 串）。预算调优属另一议题，未擅自扩大范围改动。

### 1C（P2 次生）❌ 未达判据（诚实）——capability 翻转不足以解决复杂抽取 schema
```
demo POST /a/v1/rule-docs（3 条中文规则·真打 Kimi）→ status=PARTIAL · candidateCount=0
段 0 status=FAILED「LLM returned unparseable output」
```
诊断：`structuredOutput:true` 走原生 `parse()`（`openai.ts:294`）= response_format json_schema(strict:false) + 单次 zod safeParse，**无重试**；Kimi-k2.6 对**复杂抽取 schema**（嵌套规则候选数组）的 json_schema 保真度不足 → safeParse 失败 → null → LlmParseError。`structuredOutput:false`（JSON-mode 降级·retry≤2）据深扫亦 unparseable。**结论**：用途接缝（1A/1B）已解，但 1C 抽取解析率是 **Kimi 复杂 schema 保真**的独立问题，capability 翻转（对 classifier/modeling 有效，1B 已证 classifier 工作）**不足以**闭合抽取。根因解需**降抽取 schema 复杂度 / 原生 parse 加重试 / 抽取 prompt 强约束**（WO 已列为备选）——属后续工单，本单未伪造 candidateCount。

## 本体回写

按红线⑥：仅当改了链路/事件/对象/不变量/门禁才回写。本单**未改 QOS 路径B 解析接线**（`dcp:` 解析经 RoutingLlmClient 原已正确），只把「未解析到凭据」的失败语义从「裸泄漏 SDK 串」硬化为「结构化 LLM_PURPOSE_UNBOUND（R7 信封）」——属错误信封语义，非链路/对象/门禁变更。故**不回写本体**（与 WO「若改了路径B解析的接线→回写」条件不符：接线未变）。

## 距北极星 / happy-path 标注
- ✅ 真做到：1A 结构化错误（任意未绑用途·真 curl）、1B 路径B 真打 Kimi 出真答案（真 SSE 任务·39.8s·⟦ref⟧）。两 P0 接缝根治、活系统真跑。
- 📏 距北极星：① 1C 抽取解析率（Kimi 复杂 schema）未闭——A2 规则抽取仍 0 候选；② 1B 开放式深推演受 agent 时间预算限（Kimi 慢 → 复杂问句易 BUDGET_EXCEEDED），"任意复杂问句都出富答案"需预算/收敛调优（非本单）。
- ⚠️ happy-path：1B 真答案在**可快速收敛**的问句上达成；开放式复杂问句当前会预算耗尽降级（诚实占位，不泄漏、不假答）。
