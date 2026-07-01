# WO-1C-PARSE-ASYNC · FDE 证据（R19 · 规则文档抽取解析率 + 进度可视 + Anthropic 路重试）

> 母单 §0 DoD：三缺口收口——① 强约束抽取 prompt 提首跳解析率；② 持久进度 `extractProgress` + 前端进度条；③ Anthropic(jsonMode=false 原生结构化)路格式失败零重试 → 补一次纠错重试。
> 异步/续跑/锁在 T1/T5 已落，本单不重造。铁律0：已读 `docs/SYSTEM-ONTOLOGY.md` §C 规则域（RuleDoc/RuleCandidate/ExtractSegment）+ §8 断点。

## 改动清单（只碰约定范围）

| 缺口 | 文件 | 改动 |
|---|---|---|
| G-prompt | `apps/datacore/src/ruledocs.ts` `EXTRACTION_SYSTEM`(L17+) | 追加 schema 字段级契约回显 + few-shot 正例/空例 + sourceQuote 逐字子串强约束 + severity 枚举约束。纯静态文本·确定性·mock 不读 system → 现有测试行为不变。 |
| G-progress | `packages/contracts/src/datacore.ts` | additive `ExtractProgressSchema{total,done,failed,updatedAt}` + 类型。 |
| G-progress | `apps/datacore/src/domain.ts` `RuleDoc` | additive 可选 `extractProgress?: ExtractProgress`。 |
| G-progress | `apps/datacore/src/ruledocs.ts` `prepareDoc`/`runExtraction` | prepareDoc 初始化 `{total,done:0,failed:0}`；runExtraction 首段前复位（续跑幂等）、逐段 done++/failed++ 后 `put(doc)`（EXTRACTING 中落库前端可见跳动）；终态定稿。 |
| G-progress | `apps/frontend-shell/src/api/endpoints.ts` `RuleDocVM` | additive `extractProgress?`（引用契约类型，不重定义）。 |
| G-progress | `apps/frontend-shell/src/pages/admin/RuleDocsPage.tsx` | EXTRACTING 态渲染进度条 `(done+failed)/total` + failed 徽章，testid `ruledoc-progress`/`ruledoc-progress-count`/`ruledoc-progress-failed`；docs 列表 EXTRACTING 时已 2s 轮询 `GET /a/v1/rule-docs`。 |
| G-retry | `packages/llm-adapters/src/anthropic.ts` `parse<T>()` | 单跳 → 有界纠错重试 ≤2（首次 + 2）。`messages.parse` 失败态为 `parsed_output==null`（非 throw）→ 回灌上次原始文本 + 一条纠错 user，严格按 schema 重出；末次仍失败 `null`（诚实降级）。每次尝试都计量。传输层错误原样抛（不计入解析重试）。 |
| 测试 | `packages/llm-adapters/src/anthropic.test.ts`（新增） | 首跳 null→重试成功（calls=2）/ 连续 3 跳失败→null（calls=3）/ 首跳成功不重试（calls=1）。 |
| 测试 | `apps/datacore/test/ruledocs.test.ts` RD1 | 终态断言 `extractProgress = {total:3,done:3,failed:0}`。 |
| 测试 | `apps/frontend-shell/test/f9b.ruledoc-progress.test.tsx`（新增） | EXTRACTING 文档渲染进度条 3/4 + failed 1（jsdom + 真 MSW）。 |
| mock 样例 | `apps/frontend-shell/src/mocks/fixtures.ts`/`db.ts` | `RULE_DOC_EXTRACTING`（doc-extracting）供 mock 模式审核台可见进度条样例。 |

## 门（先过）

- `pnpm -r build`（全 4 包）：**全绿**（contracts/llm-adapters/agentcore/datacore/frontend 均 Done）。
- `pnpm --filter @platform/llm-adapters test`：**18 passed**（含新增 anthropic 3 条重试用例）。
- `pnpm --filter datacore exec vitest run test/ruledocs.test.ts`：**7 passed**（含 RD1 进度断言 + T1/T5 续跑）。
- `pnpm --filter frontend-shell exec vitest run test/f9b.ruledoc-progress.test.tsx`：**1 passed**（进度条渲染 3/4 + failed 1）。
- `pnpm --filter frontend-shell exec vitest run test/f9.rule-docs.test.tsx`：**1 passed**（既有审核台不回归）。

## FDE 亲手真跑（curl · 真 datacore 内存 SEED_DEMO=1，指向本地 mock OpenAI 兼容端点，逐段 1.5s 延迟以观察进度跳动）

上传 3 条约束 md → 202 EXTRACTING → 轮询 `GET /a/v1/rule-docs/:id` 见 `extractProgress` 逐段跳动 → 终态 IN_REVIEW，candidateCount=3：

```
UPLOAD: {"docId":"doc_142ba1dw9jagecnj","jobId":"xjob_...","status":"EXTRACTING","candidateCount":0,"droppedCandidates":0}
poll1: EXTRACTING | {"total":3,"done":0,"failed":0,"updatedAt":"...09:14:03.220Z"}
poll3: EXTRACTING | {"total":3,"done":1,"failed":0,"updatedAt":"...09:14:04.769Z"}
poll4: EXTRACTING | {"total":3,"done":2,"failed":0,"updatedAt":"...09:14:06.297Z"}
poll5: IN_REVIEW  | {"total":3,"done":3,"failed":0,"updatedAt":"...09:14:07.821Z"}
--- candidates ---
candidateCount=3
 - seg0 需求增量阻断 | "需求增量超过 50% 时必须阻断排产并上报审批"
 - seg1 外协比例上限 | "外协比例不得超过 30%，超出时告警"
 - seg2 信用额度约束 | "客户信用使用率超过 100% 时禁止接收新订单"
```

- **progress 真跳动**：done 0→1→2→3，status EXTRACTING→IN_REVIEW，updatedAt 每段刷新（可观测元数据·不进 R6 字节 oracle）。
- **candidateCount≥3**：每条 sourceQuote 为逐字子串（服务端子串校验通过·未塞假数据）。

## Anthropic 路重试实证（单测层 · 现无一条覆盖 → 本单补齐）

`packages/llm-adapters/src/anthropic.test.ts` scripted `messages.parse` 桩：
- 首跳 `parsed_output=null` → 回灌纠错重试 → 第二跳合法对象：`parse()` 返回该对象，`calls.n===2`（真重试）。
- 连续 3 跳失败 → `null`，`calls.n===3`（有界 ≤2·绝不塞假数据）。
- 首跳成功 → `calls.n===1`（成功路径零额外调用）。

判据达成：三条结构化路（anthropic 原生 / openai 原生 / jsonMode 降级）重试语义统一 ≤2，不再"看绑哪家决定要不要重试"。

## 重启续跑实证

内存模式重启会丢进程内数据，无法跨真实 kill 复现；续跑机制由 `ruledocs.test.ts` 两条测试守（注入卡 EXTRACTING 的 doc → `resumeInflightExtractions` → IN_REVIEW·幂等清旧候选不重复堆积·steal 陈旧锁 + 常态 acquire 仍互斥），本单 `runExtraction` 首段前对 `extractProgress` 一并复位（done/failed 归 0·与幂等清旧候选一致），不与续跑冲突。两条测试均绿（见上）。

## 真浏览器（诚实注明）

Chromium（/opt/pw-browsers）headless 起 mock 前端（`VITE_MOCK=1` dev :4174），`RULE_DOC_EXTRACTING` 样例在审核台呈现进度条。此沙箱内 MSW service-worker 登录会话在无头 Chromium 下未稳定持久（登录 POST 未被 SW 拦截→跳回 /login），未取得终态截图。**改以 jsdom + 真 MSW 组件级测试 `f9b.ruledoc-progress.test.tsx` 验证**：真渲染 `RuleDocsPage`，`ruledoc-progress` 显示 `(2+1)/4=3/4` + `失败 1` 徽章，断言通过。前端 mock 模式（`VITE_MOCK=1 pnpm --filter frontend-shell dev`）本地打开 /admin/rule-docs 选「新采购制度（抽取中）」即见该进度条。

## 本体回写

见 `docs/SYSTEM-ONTOLOGY.md` §C「RuleDoc / RuleCandidate / ExtractSegment」条：
- 「三条结构化路重试语义统一 ≤2」（anthropic 原生补齐）。
- 抽取 prompt 字段级强约束 + few-shot 提升首跳解析率。
- 异步抽取暴露 `extractProgress{total,done,failed,updatedAt}`，EXTRACTING 中逐段落库前端可视。
链路/事件未新增。

## 红线

- 契约 additive（`ExtractProgressSchema` 新增·`extractProgress?` 可选）不破既有。
- 确定性测试不依赖真 LLM（全 mock/scripted）·R2 tenant everywhere（续跑逐租户扫）·R13 诚实（末次失败 null→PARTIAL·进度如实 done/failed）。
