# FDE 实证 · SELF-SURFACES-SLICE（WO-5 · PRD-trustworthy-self-accounting §3.6）

**目标**：散落自测/补面归一为**同一 Capability/Gap 自我模型上的 slice 视图**（增量收敛·非阻塞项）。
本增量**真接入 1 个面：Agent 评测（evals）**——每套件最新运行投影为一项 Capability（复用 WO-2 派生态
`verifiedStatus`·禁手打）+ 关联 **actionable Gap 三元**（what/where/acceptance·复用 GAP-ACTIONABLE 口径）。

## 诚实边界（钉死·非 fake-done）
- **真接入 1 个面**：Agent 评测（`surface=evals`）。
- **后续增量（诚实占位·`unwiredSlice` wired=false）**：兜底统计 / 规划体检 / 校准报告 / VLE 闭环验证 / 工单中心。
  **不假装已全归一**——那正是本 PRD 根治的 claim>实 诈账。真值证在此文件的真跑输出 + 齿测试。

## 反 fake-done 核心红线（本增量的"齿"）
evals 用例本身经 `orchestrator.submitQuery` 走**真实 NL 路径**跑（`evals.run:runCase`），故 passRate 是真实信号；
但 **MOCK 跑分仅证评测框架、非真实质量**（契约 `EvalRunReport.llmMode` 注）。故投影器
`buildEvalCapabilitySlice`（`apps/agentcore/src/capability/slice.ts`）的 `representativeAnswered` **要求
`llmMode==="REAL"`**：MOCK 高分（passRate=0.95）一律**诚实 UNVERIFIED**（绝不假 VERIFIED），并挂"接真模型"
的 actionable Gap 指明真值证在何处。verifiedStatus **恒经 WO-2 `buildCapability`/`deriveVerifiedStatus` 派生**（唯一产出路径·禁手打）。

## 齿 revert→红（亲跑实证）
把投影器判据 `representativeAnswered = latest.llmMode === "REAL" && latest.passRate >= EVAL_GATE`
改成去掉 llmMode 要求（`= latest.passRate >= EVAL_GATE`），重跑 `capability-slice.test.ts`：

```
× 齿①：MOCK 高分（passRate=0.95）也**诚实 UNVERIFIED**——绝不假 VERIFIED（anti-fake-done 根线）
  AssertionError: expected 'VERIFIED' to be 'UNVERIFIED'
  Expected: "UNVERIFIED"   Received: "VERIFIED"
EXIT=1
```
恢复判据后 8 tests 全绿（EXIT=0）。→ **该齿真守"MOCK 不假 VERIFIED"红线**。

## 真跑 · 后端 HTTP（真起 agentcore 服务）
```
$ PORT=4102 node apps/agentcore/dist/main.js &
# 空租户（尚无评测运行）→ 诚实空 slice（wired=true·rows=[]）
$ curl -s '.../b/v1/self/capability-slice?surface=evals' -H 'X-Debug-User: demo:u1:planner'
{"surface":"evals","wired":true,"generatedAt":"2026-07-06T12:40:59.627Z","rows":[],
 "note":"尚无评测运行——跑一次评测套件后即在此以 Capability/verifiedStatus + actionable Gap 呈现。"}

# 未接入面 → 诚实占位（wired=false·不 fake）
$ curl -s '.../b/v1/self/capability-slice?surface=fallback' -H 'X-Debug-User: demo:u1:planner'
{"surface":"fallback","wired":false,...,"note":"「fallback」面尚未接入统一 Capability/Gap 模型——后续增量（本增量先打穿 evals 证模式成立）。"}
```
→ 路由真实存在·空态诚实·未接入面不假装归一。

## 真跑 · 后端投影逐值（`agentcore/test/capability-slice.test.ts`·8 绿·EXIT=0）
固件 `erun_1`（classifier·MOCK·passRate 0.95·parity INTENT:1）→ 投影：
- Capability `eval:classifier`·kind=feature·**verifiedStatus=UNVERIFIED**（MOCK 不假 VERIFIED）。
- Gap①`LLM_PURPOSE_UNBOUND`：缺"真实 LLM 未接入（llmMode=MOCK）…" · 补在"LLM Provider 绑定…以 REAL 重跑" · 验收"接真模型后「分类器」passRate≥90% 且 llmMode=REAL" · blocking。
- Gap②`NO_INTENT`：缺"意图错分 1 例与 PRD 期望不符" · 补在"评测套件「分类器」用例（parity byCase 下钻）" · 验收"修复后重跑「分类器」，意图错分归零"。
- 另证：REAL+passRate≥门禁+parity 全对 → VERIFIED·无 Gap；REAL 但通过率不足 → UNVERIFIED+通过率 Gap；曾 REAL 达门禁·最新跌破 → STALE。

## 真渲染 · 前端逐值对后端（jsdom renderApp + MSW·`frontend-shell/test/self-surfaces-slice.test.tsx`·1 绿·EXIT=0）
`/admin/evals` 真渲染统一切片组件 `CapabilitySliceView`（EvalsPage 接入）。测试**先取后端真值**
（同一 MSW 端点 `fetchCapabilitySlice("evals")`），再断言前端所见 **逐值 ==** 后端：
- verifiedStatus 徽章文案 == 后端 `UNVERIFIED` → 渲染"未验证"（中性灰·诚实空态不报红）。
- Capability.claim 逐字渲染。
- 每条 Gap 的 `what`/`where`/`acceptance`/`gapCode` 逐值出现在对应 `slice-gap-*` 节点（永不"人工核实内部错误/dash"）。
- 诚实注 `slice-note.textContent === backend.note`（含"MOCK 跑分仅证框架"·指明真值证在何处）。

MSW 响应**镜像后端 `buildEvalCapabilitySlice` 对 eval-runs 固件的真实投影**（handler 注明），
故前端所见 == 后端契约真值。**真浏览器栈**（Playwright 真起前端逐值截图）待环境恢复补——本轮以
jsdom+MSW 逐值 + 真起 agentcore HTTP 双证覆盖（诚实注）。

## 本体回写
`docs/SYSTEM-ONTOLOGY.md` §Capability 条目追加 WO-5 SELF-SURFACES-SLICE 段（slice 契约/投影器/端点/
共享组件/反 fake-done 红线/齿/诚实边界）；`pnpm ontology:slices` 已重生成（母体 hash 56ecdae49642f0b8）。

## 触及（本体引用）
- 对象类型：`Capability`（WO-2·复用派生 `verifiedStatus`）；`CapabilitySlice`/`CapabilityGap`（新增共享形状）。
- 链路：evals 运行（QOS NL 路径）→ 投影 → slice 视图。
- 不变量：R-NO-FAKE-DONE（MOCK 不假 VERIFIED）· R6（投影器纯函数确定性）· R2/R9（元租户复用 objects 语义·本增量为只读投影不落库）。
- 门禁：未新增门（本增量为视图收敛·非门）。
