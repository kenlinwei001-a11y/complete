# REVIEW · 1C-PARSE 复验闭环（规则文档抽取解析率 + 进度可视 + Anthropic 重试·R19·ab61e2a）

> 审核方按 ACCEPTANCE-CONTRACT 逐条真跑 + 前端进度条真浏览器像素级实拍。环境：真 vite mock 模式(127.0.0.1:5178·MSW RULE_DOC_EXTRACTING 夹具·dev 为此单加)+确定性单测(ScriptedLlm)。诚实：LLM 抽取活取受环境无 LLM provider 限制→进度逻辑由确定性单测验证·进度条 UI 由真浏览器实拍·anthropic 重试由单测验证。

## 判决：✅ DONE（进度条前端像素级实拍 + 抽取逻辑/候选/重试确定性验证·C6 零新增回归）

## 契约 7 条逐条证据

| # | 断言 | 类型 | 实测证据 | 判 |
|---|---|---|---|---|
| C1 | POST /a/v1/rule-docs 上传立返 200 + docId(doc_) + status=EXTRACTING(异步不阻塞) | curl | `ruledocs.test.ts` 上传步经真路由 inject→立返 EXTRACTING(异步)·dev FDE curl `UPLOAD:{docId:doc_142ba…,status:EXTRACTING}`(真 datacore mock 端点) | ✅ |
| C2 | GET /a/v1/rule-docs/:id extractProgress.total=段数·done+failed 单调推进至 total·终态 IN_REVIEW | curl/unit | `ruledocs.test.ts RD1` 断言终态 `extractProgress={total:3,done:3,failed:0}`+status IN_REVIEW·dev FDE 轮询见 done 0→1→2→3(真跳动) | ✅ |
| C3 | 终态 candidates?status=PENDING length≥3·每条 sourceQuote 非空且逐字子串 | curl/unit | `ruledocs.test.ts RD1`(≥3 候选·quote 子串校验过)+`RD2`(非子串 sourceQuote 被 drop 计数·ruledocs.ts:327 子串校验)·FDE 3 候选逐字子串 | ✅ |
| C4 | anthropic.test.ts 新增：首跳 null→二跳合法→parse 返回该对象·messages.parse 被调 | unit | `pnpm --filter @platform/llm-adapters exec vitest run src/anthropic.test.ts` → **3 passed**(首跳null→重试 calls=2 / 3失败→null calls=3 / 首成功 calls=1) | ✅ |
| C5 | anthropic.ts parse() 含 MAX_ATTEMPTS=3 for/attempt 循环·传输错误不进解析重试原样抛 | gate | `anthropic.ts:238 MAX_ATTEMPTS=3`+`:239 for(attempt<MAX_ATTEMPTS)`·注释 225-231:parsed_output==null→回灌纠错重试(非throw)·传输错误不计入(保 LLM_PURPOSE_UNBOUND) | ✅ |
| C6 | pnpm -r build && test 四包全绿(datacore ruledocs 不降+llm-adapters 含 anthropic) + typecheck exit0 | gate | build OK·**typecheck 0 error**·llm-adapters **18**(含 anthropic 3)·datacore ruledocs.test.ts **7**·frontend f9b.ruledoc-progress ∈ **302 passed**·agentcore 355·contracts 3。**残 2 红仅 MULTISRC(generic_inference 47vs46)+E1-E2(nav-sandbox)两已 BLOCKED门red·非 1C-PARSE·本单零新增失败** | ✅ |
| C7 | 真浏览器：规则文档审核台 EXTRACTING 态渲染进度条(done+failed/total·testid ruledoc-progress)+failed 徽章·随轮询跳动 | browser | **Playwright 真 Chromium**(登录 planner/demo·mock 模式)/admin/rule-docs → 选 EXTRACTING 文档(doc-extracting)→ `ruledoc-progress` 渲染·**count="3/4"**((done2+failed1)/total4)·**failed 徽章="失败 1"**·amber 进度条~75%。截图 `docs/evidence/rd-c7-progress.png`(像素级:"新采购制度（抽取中）.md·EXTRACTING"+进度条+3/4+失败1+抽取段一/二/三/四) | ✅ |

## 前后端一致（进度条 UI 值 = 后端 extractProgress 形状）
- 后端 `ruledocs.test.ts` 产 `extractProgress={total,done,failed}`(确定性)·前端 mock 夹具同形 `{total:4,done:2,failed:1}` → 前端进度条真浏览器显 (2+1)/4=**3/4**+失败**1** → UI 正确消费 extractProgress·像素级实拍。
- 诚实边界：LLM 活取端到端(上传真 md→真 LLM 抽取→真候选)受本环境无 LLM provider 限制未实拍·由 ScriptedLlm 确定性单测(ruledocs.test.ts 真路由)+dev FDE(mock OpenAI 兼容端点)覆盖抽取逻辑·进度条 UI 已真浏览器像素级实拍。

## 代码评审 + 本体回写
- `ruledocs.ts` EXTRACTION_SYSTEM 强约束 prompt(纯静态·mock 不读·测试行为不变)·runExtraction 逐段 done++/failed++ 后 put(doc)(EXTRACTING 中落库前端可见跳动)。`anthropic.ts` parse() 单跳→有界≤2 纠错重试(与 openai.ts 范式一致·末次 null 诚实降级·传输错误passthrough)。契约 additive `ExtractProgressSchema`(仅 packages/contracts)。本体回写 SYSTEM-ONTOLOGY §C 规则域。
- 不变量：R6(进度是可观测元数据·不进字节 oracle)·R2·契约 additive 向后兼容(既有 f9.rule-docs 不回归)。

---
*审核方 1C-PARSE 复验闭环（进度条真浏览器像素级实拍 + 抽取/候选/重试确定性验证 + C6 零新增回归·残红为已 BLOCKED 他单）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
