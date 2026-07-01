# WO-A2-EXTRACT-ROBUST · A2 规则文档抽取解析鲁棒性与异步作业闭环

> 由来(R19·母单 L7134/7161/7939 标"1C 诚实未闭·需独立单")：母单声称「parse() 零重试→≤2 重试」「同步长抽取→异步 job」两处已闭，但沿链核实——**重试只落在 `openai.ts`/`degrade.ts` 两条路，默认 Anthropic 原生结构化路 `anthropic.ts parse()` 仍零重试**(L224-236)；强约束 prompt 未随重试同步加固；异步"job"实为 `doc.status=EXTRACTING` + 内存 fire-and-forget，无持久作业实体/无进度可视。本单把这三处诚实收口。
> 依赖：`packages/llm-adapters`(Anthropic/OpenAI/degrade)、`apps/datacore`(ruledocs.ts / app.ts / config.ts)、`@platform/contracts`(RuleDocStatus)。铁律0 已读 `docs/SYSTEM-ONTOLOGY.md` L85-88(RuleDoc/Rule 域)、L508(D3)、§8 断点表。

---

## §0 目标 + DoD-as-experience(用户视角 · 亲手走一遍能用 · 非测试绿)

**目标**：让"上传一份规则制度文档 → 抽出候选规则"这件事，在**默认部署(Anthropic)** 与**任意绑定 provider** 下都：① 首解析失败能自动纠错重试(≤2)而非一跳即死；② 靠强约束 prompt 提升首跳解析率；③ 长文档抽取走异步作业、前端可见真实进度、进程重启不丢。

**DoD(FDE 亲手走一遍)**：
1. 我用 demo/admin 登录，进规则文档审核台，上传一份 3-5 条约束的 `.md`(或参考真实制度 PDF)。上传**立即**返回、页面不转圈卡死(202 已在)，doc 落 **EXTRACTING**。
2. 页面能看到**逐段进度**(第 x/共 y 段、每段 OK/FAILED)，而非只有一个静止的"抽取中"——进度随后台真实推进跳动。
3. 抽取完成 → doc 进 **IN_REVIEW**，候选列表出现 ≥3 条，每条能看到逐字 sourceQuote 高亮。
4. **默认 Anthropic 路**：当模型首跳吐出不合 schema 的输出(可用 mock/真 Kimi 复现)时，服务端**回灌 zod 错误重试**，最终仍能拿到候选(candidateCount 0→N)，而不是静默 0 候选 + doc 卡 PARTIAL。
5. 我在抽取进行中**重启 datacore 进程**，重新打开该 doc——它**不会永久卡 EXTRACTING**，续跑后进终态、候选齐全(幂等不重复堆积)。
6. 若某段确实抽不出(LLM 连续失败)，doc 诚实进 **PARTIAL**、该段标 FAILED、可单段重试——**绝不塞假候选**。

> 反例(算没完成)：只在 openai 路加了重试就宣称"parse 鲁棒"；prompt 没动；"异步"只是 status 改名、前端仍只能看到一个不动的 EXTRACTING;Anthropic 首跳失败直接 0 候选。

---

## §1 现状盘点(钉真实 file:line · grep/read 核实 · ✅已在/◐部分/🔴缺)

| 能力 | 证据(file:line) | 状态 | 说明 |
|---|---|---|---|
| A2 抽取服务主流程(upload→prepare→segment→extractSegment→候选) | `apps/datacore/src/ruledocs.ts:270` `runExtraction` / `:308` `extractSegment` | ✅已在 | 逐段抽取、sourceQuote 子串校验、dropped 计数 |
| 异步入口 202 + EXTRACTING | `apps/datacore/src/app.ts:3014-3038`(`uploadAndStartExtraction`) / `ruledocs.ts:179` | ✅已在 | 准备 doc 后立即 202，抽取后台跑 |
| `RuleDocStatus += EXTRACTING/PARTIAL` 契约 | `packages/contracts/src/datacore.ts:123-132` | ✅已在 | 枚举已补齐 |
| 重启续跑(扫 EXTRACTING 重跑·幂等清旧) | `ruledocs.ts:228` `resumeInflightExtractions` / test `ruledocs.test.ts:220` | ✅已在 | T1 续跑，测试覆盖 |
| 多实例互斥 + 短租约心跳 + steal | `ruledocs.ts:195-217` `fireExtraction` / `execlock.ts` / `config.ts:66` `EXECUTION_SINGLETON` | ✅已在 | WO-T5-LEASE-HEARTBEAT |
| **OpenAI-compat 原生结构化路 ≤2 纠错重试** | `packages/llm-adapters/src/openai.ts:393-446`(`MAX_ATTEMPTS=3`) | ✅已在 | 回灌 zod 错误重提 |
| **jsonMode 降级路 ≤2 重试**(无原生 structuredOutput 的 provider) | `packages/llm-adapters/src/degrade.ts:54-89`(`JSON_MODE_MAX_RETRIES=2`) | ✅已在 | `parseVia` 在 `structuredOutput:false` 时选此路(`llmproviders.ts:415-416`) |
| **默认 Anthropic 原生结构化路重试** | `packages/llm-adapters/src/anthropic.ts:224-236` | 🔴**缺** | 单次 `messages.parse` → 失败即返回 null，**零重试无纠错回灌**；无 for/attempt 循环(grep 证)。`createLlmClient` 默认走 `AnthropicAdapter`(`llm.ts:84-87`)、默认模型 `claude-opus-4-8`(`config.ts:21`) → **默认部署抽取路首跳失败即 0 候选** |
| 抽取用途路由(A2 extraction → provider 绑定) | `apps/datacore/src/llmproviders.ts:340-416`(`purpose:"extraction"`) `ruledocs.ts:317-320` | ✅已在 | 绑定 Anthropic+structuredOutput 时 `jsonMode=false` → 命中上面 🔴 零重试路 |
| **强约束抽取 prompt(提升首跳解析率)** | `ruledocs.ts:17-21` `EXTRACTION_SYSTEM` | ◐部分 | 有 1C 输出纪律(只 JSON/空数组不省字段)，但**无 schema 回显/无字段级约束示例/无 few-shot**——首跳解析率靠 prompt 提升这一半未做 |
| **异步作业持久实体 + 进度可视** | `ruledocs.ts:115-121`(`pendingExtractions` 内存 Set) / `extractSegments` 记录 `:351` / 端点 `/segments` `app.ts:3066` | ◐部分 | "job"= `doc.status` + 内存句柄；**无持久 job 记录、无进度字段(x/y 段)、前端只能轮询 status 与 /segments 各自拼**。重启靠扫 status 续跑(可用)，但**在途进度百分比/预估无处可读** |
| ruledocs 测试(段偏移/候选/丢弃/重传 diff/续跑/锁) | `apps/datacore/test/ruledocs.test.ts:65-272` | ✅已在 | **但无一条覆盖 Anthropic 路首跳失败→重试成功** |

**核实结论**：R19 母单两诉求**在部分 provider 路已闭**，但存在三处真诚实缺：(A) 默认 Anthropic 结构化路零重试;(B) 强约束 prompt 未加固;(C) 异步作业进度不可视/无持久 job 实体。本单只补这三处，不重造已有的段级三态/续跑/锁。

---

## §2 施工范围(dev 可直接照做 · 具体文件/端点/组件/契约)

### G-a 统一重试到 Anthropic 原生结构化路(核心·修 🔴)

**文件** `packages/llm-adapters/src/anthropic.ts` — `parse<T>()`(现 L224-236)。

改为**有界纠错重试 ≤2**，范式与 `openai.ts:393` 对齐(不新造机制)：
- 引入 `const MAX_ATTEMPTS = 3;`(首次 + 2 纠错重试)。
- 循环内调 `this.client.messages.parse({...})`;`resp.parsed_output == null` 或抛出 schema 校验类错误时，**回灌上次原始输出 + 校验错误摘要**追加为 `assistant` + `user` 两条 message，要求"严格按 schema 重出，只输出 JSON"。
  - 注意 Anthropic `messages.parse` 走 `output_config.format`(zodOutputFormat)，失败态是 `parsed_output=null`(非 throw)。取 `resp.content` 文本作为回灌上下文;若 SDK 有解析异常则 catch 后同样回灌。
  - 传输层错误(鉴权/网络)**不算解析重试**——原样抛(保 `llmproviders.ts:373` 的 `LLM_PURPOSE_UNBOUND` 归一语义)。
- 末次仍失败 → `return null`(保诚实降级,绝不塞假数据)。
- 保留 `requireUsage`/`this.track` 计量(每次尝试都计,与 openai 一致)。

**测试** `packages/llm-adapters/src/anthropic.test.ts` 新增：scripted client 首跳返回 `parsed_output=null`(或不合 schema)、第二跳返回合法对象 → 断言 `parse()` 最终返回该对象、且调用了 2 次(证真重试)。对照:连续 3 跳失败 → 返回 null。

> 判据:三条结构化路(anthropic 原生 / openai 原生 / jsonMode 降级)重试语义**一致 ≤2**,不再有"看你绑了哪家决定要不要重试"的暗坑。

### G-b 强约束抽取 prompt(修 ◐)

**文件** `apps/datacore/src/ruledocs.ts` — `EXTRACTION_SYSTEM`(L17-21)。

在既有 1C 纪律基础上追加(纯 prompt 文本、确定性、不引入随机)：
- **schema 字段级契约回显**:显式列出每条候选必填字段与取值域——`name`(短语)/`description`/`expression`(DSL 或空串)/`expressionConfidence`(0-1)/`scopeObjectTypes`(数组,可空)/`severity`(枚举 `BLOCK|WARN|INFO`)/`sourceQuote`(**逐字子串**)。
- **1 个 few-shot 正例**(输入片段 → 合法 `{"candidates":[{...}]}`)与 **1 个空例**(无规则段 → `{"candidates":[]}`),压低首跳格式漂移。
- 强化 `sourceQuote` 约束措辞:必须是输入段落的**连续逐字子串**(服务端子串校验,不过即丢——`ruledocs.ts:327` 现状),不得改写/合并/补标点。
- `severity` 只允许三枚举值之一,不得臆造。

> 边界:prompt 是**候选质量/首跳解析率**手段,与 G-a 重试正交(重试兜格式失败,prompt 减少失败发生)。改后需重跑 `ruledocs.test.ts`(mock 不读 system,行为不变;真跑观察 candidateCount 提升)。

### G-c 异步作业进度可视 + 轻量持久进度(修 ◐)

不引入 job 队列(与母单 T5 "真多实例吞吐分发仍需 job 队列·未引入"边界一致),只把**进度做成可读真值**:

1. **契约**(`packages/contracts/src/datacore.ts`,RuleDoc schema 附近,additive 可选,向后兼容):
   `RuleDoc += extractProgress?: { total: number; done: number; failed: number; updatedAt: string }`。
2. **服务端**(`ruledocs.ts:270` `runExtraction`):循环逐段后写 `doc.extractProgress`——`total=doc.segments.length`,每段成功/失败后 `done++/failed++` 并 `put(doc)`(EXTRACTING 中即落库,前端轮询可见跳动);进入终态时定稿。`prepareDoc`(`:245`) 初始化 `extractProgress={total, done:0, failed:0}`。
   - 确定性:进度纯由段循环推进,无时钟随机(`updatedAt` 除外,属可观测元数据不进 R6 字节 oracle)。
3. **端点**:复用 `GET /a/v1/rule-docs/:id`(`app.ts:3051`) 下发的 `ruleDocVM` 自动带 `extractProgress`(spread `...d`);无需新端点。`GET /a/v1/rule-docs/:id/segments`(`:3066`) 段级明细已在,前端二者合并展示。
4. **前端**(规则文档审核台页,定位:`Grep "rule-docs" apps/frontend-shell/src` 找到消费页):EXTRACTING 态渲染进度条 `done+failed / total` + failed 计数徽章;轮询 `GET /a/v1/rule-docs/:id` 直至终态(IN_REVIEW/PARTIAL/EXTRACTED)。data-testid 建议 `ruledoc-progress`。

> 说明:重启续跑(`resumeInflightExtractions`)已在,`runExtraction` 幂等清旧候选并复位计数(`:274-277`),此处 `extractProgress` 一并在续跑首段前复位(done/failed 归 0),不与续跑冲突。

---

## §3 验收(FDE 亲手 · curl + 真浏览器 + 门)

**门(先过)**
```bash
pnpm -r build && pnpm -r test    # 4 包全绿底线；重点 datacore ruledocs + llm-adapters anthropic
pnpm -r typecheck
```

**curl(默认内存模式,mock LLM 不出网;真跑另配 provider)**
```bash
# 起 datacore(内存·seed)
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=$(openssl rand -hex 32) \
  node apps/datacore/dist/server.js &

DBG='X-Debug-User: demo:admin:admin|planner|catalog_admin'

# 1) 上传 → 立即 202 + EXTRACTING
DOC=$(printf '# 产能管理制度\n\n第一条 需求增量超过 50%% 时必须阻断排产并上报审批。\n\n第二条 外协比例不得超过 30%%，超出时告警。\n' | base64 -w0)
RESP=$(curl -s -XPOST localhost:4001/a/v1/rule-docs -H "$DBG" -H 'content-type: application/json' \
  -d "{\"filename\":\"cap.md\",\"contentBase64\":\"$DOC\"}")
echo "$RESP"            # 期望 status=EXTRACTING, docId=doc_...
ID=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["docId"])')

# 2) 轮询进度(应见 extractProgress.total/done 推进 → 终态 IN_REVIEW)
curl -s localhost:4001/a/v1/rule-docs/$ID -H "$DBG"          # 看 status + extractProgress
curl -s localhost:4001/a/v1/rule-docs/$ID/segments -H "$DBG" # 逐段 OK/FAILED

# 3) 候选齐全 + sourceQuote 逐字
curl -s "localhost:4001/a/v1/rule-docs/$ID/candidates?status=PENDING" -H "$DBG"

# 4) 审核采纳一条 → 进 A5 规则库(origin=DOCUMENT 溯源)
CID=$(curl -s "localhost:4001/a/v1/rule-docs/$ID/candidates" -H "$DBG" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
curl -s -XPOST localhost:4001/a/v1/rule-candidates/$CID/review -H "$DBG" -H 'content-type: application/json' \
  -d '{"action":"APPROVE"}'
```
- **重试实证(单测层)**:`pnpm --filter @platform/llm-adapters test` 中新增的 anthropic 首跳失败→重试成功用例绿。
- **重启续跑实证**:抽取途中 `kill` datacore → 重起 → `GET /a/v1/rule-docs/$ID` 不为 EXTRACTING、候选齐全、无重复堆积(`ruledocs.test.ts:220/243` 已守机制,FDE 手动复现一次)。

**真浏览器(FDE 走一遍)**
- demo/admin 登录 → 规则文档审核台 → 上传 md/PDF → **看进度条真跳动**(非静止转圈)→ 终态候选列表 → 高亮 sourceQuote → 采纳后去规则库看到该规则 origin 溯源回文档。
- 制造首跳失败(真 Kimi/或临时绑不合规模型)观察:不再 0 候选卡死,重试后出候选。

---

## §4 不在本次范围(诚实边界)

- **真多实例吞吐分发/并行抽不同 doc 的 job 队列**:与母单 T5 边界一致,锁只保正确性、不做分发,本单不引入队列。
- **`custom_http` 适配器 parse 实现**:`custom-http.ts:31` 现为预留 `NotImplemented`,本单不实现(非抽取默认路)。
- **段级流式(SSE 逐段推候选到前端)**:本单只做**轮询进度可视**;真流式(EventSubscription/SSE)延后。
- **抽取质量本身的语义评测/DSL 表达式正确率提升**:prompt 加固只压首跳格式解析率,不做 expression 语义校验器扩展。
- **PDF/DOCX 解析器增强**:`extractText`(`ruledocs.ts:24`)沿用 pdf-parse/mammoth,不在本单。
- **重试次数上限调参化(env)**:沿用现有常量 `≤2`(与 openai/degrade 齐),不做可配置化。

---

## 本体引用与影响(链路/对象类型/不变量/断点/回写)

- **对象类型**(§2.C 规则域 D3):`RuleDoc` / `RuleCandidate` / `ExtractSegment`(`ruleDocs`,`ruleCandidates`,`extractSegments` 仓储);产出经审核采纳流入 `Rule`(A5,origin=DOCUMENT 溯源,R13)。
- **链路**:数据接入(文档上传)→ A2 抽取(prepare→segment→**LLM extraction[本单加固处]**→候选)→ 人审(review)→ A5 规则库发布 → 下游求解器/校验消费。断点在**接缝**:LLM 结构化解析(provider 路差异)与"异步作业进度可读性"两处接缝。
- **不变量**:
  - **R6 确定性**:进度推进纯由段循环驱动、prompt 为静态文本、重试为确定性回灌策略——不引入时钟/随机(`extractProgress.updatedAt` 属可观测元数据,不进字节 oracle)。
  - **R13 诚实**:重试末次仍失败 → `null` → doc 诚实进 PARTIAL,**绝不塞假候选**;进度如实反映 done/failed;规则 origin 溯源回文档 span。
  - **R2 tenant everywhere**:全经 `AuthCtx.tenantId`,续跑 `resumeInflightExtractions` 逐租户扫。
  - **R7 错误信封**:传输层鉴权失败保持 `LLM_PURPOSE_UNBOUND` 归一,不泄漏 SDK 内部串。
- **断点(§8)**:本单收口 §2.C L88 "1C 解析鲁棒性" 的**诚实未闭部分**——把重试从"仅 openai.ts"扩到 Anthropic 原生结构化路,补强约束 prompt,补异步作业进度可视。
- **回写(改完必做)**:更新 `docs/SYSTEM-ONTOLOGY.md` **L88**(RuleDoc/RuleCandidate/ExtractSegment 条)——将"`openai.ts parse()` 复杂抽取 schema 此前零重试 → 有界纠错重试 ≤2"修正为"**三条结构化路(anthropic 原生 / openai 原生 / jsonMode 降级)重试语义统一 ≤2**",并追加"抽取 prompt 字段级强约束 + few-shot 提升首跳解析率""异步抽取暴露 `extractProgress`(total/done/failed)前端可视"。链路/事件未新增,无需改 §3/§4 事件表。

*审核方自包含施工单(design+review · 铁律0.5 · 钉真实 file:line)· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
