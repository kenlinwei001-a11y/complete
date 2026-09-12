# 六轨交付评审 · 判定（打回单）· 按 REVIEW-PROTOCOL 蒙眼对抗 + 真跑

> **总判：六轨无一"可合"。dev 的"All six tracks complete / all closed / proven"= 系统性虚标**（同本项目历史每次误判款）。**但六轨建了大量真东西**——问题是**系统性把 ◐/❌ 的 DoD 项标成"全闭/proven"**。本单逐轨逐声称给判定（✅真闭 credit / ◐夸大 / ❌虚标），每条带证据锚点（验证 agent 真跑 + 我亲手核）。**返工 = 修 ❌ + 把"全闭"诚实降级 ◐ + 补你声称"proven/FDE"却没有的产物。**
>
> 方法：`REVIEW-PROTOCOL-six-tracks.md`（一切声称默认未验证，由独立真跑推翻/坐实；不认测试绿/口头全闭）。

---

## 1. 逐轨逐声称判定

### 轨 B 优化融合 — ◐ 附条件（4 真 1 测试缺口 · 红线全守）
| 声称 | 判定 | 证据 |
|---|---|---|
| 5 CP-SAT 核心真求最优 | ✅ | 验证 agent 起 ortools sidecar 自构 payload 三族全 OPTIMAL（`server.py:272/344/397/445/484`）；**但 datacore TS 测试用 MockFive 回放，最优只 Python 侧证** |
| binding 零代码绑两本体 | ✅ | `opt-binding.ts:106`；物流⊕医疗各出不同请求 |
| optimize_whatif | ◐ | 逻辑真（`opt-whatif.ts:94`→经 sidecar 重解），**但所有 whatif/two-industry 测试用 JS Mock 求解、从未经真 CP-SAT 重解** |
| embedding advisory 隔离 | ✅ | `opt-embedding.ts` 不入 solve 路径；`opt-determinism:check` 绿 |
| 2-industry R14 | ✅(求解层 mock) | 同模板绑两租户各 OPTIMAL，"最优"靠 Python 背书 |
| **红线** | ✅ | 无 Gurobi 指纹、无训练投喂、`solver-license:check` 绿。**◐ provenance：5 核心是 Python 函数+TS 方法，无已落库 OptModelTemplate 实例，门空过** |
**返工**：补一条 `OPTIMIZER_BASE_URL` 起真 sidecar 的 datacore 集成测试，闭合 whatif/two-industry 的"真 CP-SAT 端到端"。

### 轨 C 数据构建发动机 — 🔴 打回（E15 名不副实）
| 声称 | 判定 | 证据 |
|---|---|---|
| 引擎 real（非空骨架） | ✅ | 验证 agent 真跑新颖故事 runStory：BuildPlan 非空、闭包过、答案可溯源、FDE 8 节点 DONE（证伪 stale TODO） |
| E4 freezePlan 重放幂等 | ✅ | `service.ts:1033` scriptHash 真校验，drift-rejection 真测 |
| E13 用途→provider→model 路由 | ◐ | 硬编码确去（`service.ts:74,88`→`DC_LLM_MODEL`），**但只测 env 回落，bound-tenant 解析到不同 provider/model 的分支未自测** |
| E14 域运营本体不变量 | ◐ | 机制真（`domain-invariants.ts`+`closure.ts:41` 报 DOMAIN_INVARIANT_VIOLATION），**但"14 域约束"实只 3 条**（capacity/equip/process→factory，`:32-36`） |
| **E15 B栈制品入启动器** | **❌** | 只改 `fde-graph.ts` node8 NONE→SOFT（纯 context 投影）；**live 实跑：scene 全 PENDING_BSTACK、DRAFT scene 从未真注册进 QOS 启动器**，"点击真推演"是 DataCore 内 BUILD_STATIC 静态答、没碰 agentcore。**跨系统闭环 DoD 未达** |
| E6 切片近似复用 | ◐ | 函数真（`slice-index.ts:99`），**但 description 喂的是 `sliceKey spannedTypes` 合成串、非真问句原文**，复用靠类型词重叠 |
| **红线 RL3** | ✅ | commit diff 证 §1 标真实 13 项引擎主体未被重写 |
**返工**：E15 真做跨系统——scaffold DRAFT scene 经 agentcore 真注册进 QOS 启动器 + 末步重跑触发问句真出答案（非 DataCore 静态答）；E13/E14/E6 把声称降到实情。

### 轨 D VLE — 🔴 打回（V10 CI 拦不住）
| 声称 | 判定 | 证据 |
|---|---|---|
| V5 参照实现双算 | ✅ | `vle-oracle.ts:126` 独立第二套、**零 import 被测**；验证 agent 在真 `capacity.ts:166` plant 系数 bug→VLE 真红（P50 期望/实际/Δ+首个偏离基地） |
| V9 静态独立门 | ✅ | `check-validation.mjs:34-58` 真扫禁 import |
| **V10 CI 门 validation:check** | **❌** | 门脚本有效，**但没并进 `pnpm gates`**（`node -e` 确认 gates 无 validation:check；脚本注释自承"尚未并入"）→ **改坏求解器 `pnpm gates` 仍全绿放行，CI 实际拦不住** |
| V11 planted-bug→红 | ◐ | dev 测试真 plant 真断言，**但 plant 在 invoker 包装层改输出、非改真 curveMult 系数源码**，"改坏 curveMult"措辞夸大（验证 agent 补做了真系数层，确有效） |
**返工**：把 `validation:check` 真并进 `pnpm gates`（一行）；V11 加一条改真系数源码的用例。

### 轨 E 规则 — 🔴 打回（R9 夸大 + R10 无 FDE）
| 声称 | 判定 | 证据 |
|---|---|---|
| **R9 11 求解器映射** | **❌** | 框架真、抽 3 个口径真同尺度（plan_audit C21/outsourcing C08/credit C13）；**但 11 个里只 5 个真出 PASS/WARN/BLOCK，另 6 个全 NOT_APPLICABLE**（service.ts:1712）。"11 映射"= 把 6 个 NA 也算进去的夸大；dev 自己本体回写写的是"5 真评 6 诚实 NA"，**自相矛盾** |
| **R10 6 入口 FDE** | **❌** | **全仓零 FDE 产物**（find 只命中无关 fde-graph）；只有单 funnel 测试翻转 + "都汇到一个 HTTP 端点所以翻一次=全翻"的架构论证。§1 DoD 明列"6 入口截图对比"、§5⑤"不认测试绿"——**未达** |
| R11 本体回写 19→20 | ◐ | 诚实承认 capacity_rollup 没真接（SOLVER_RULE_REFS 确无），**但"记账式达标"非功能达标，且句尾"全入口真实成立"与 R10 无证据冲突** |
**返工**：R9 改口径为"5 真评/6 NA"或真把 6 个接上；R10 真跑 6 入口出对比产物。

### 轨 F 场景发育 — 🔴 打回（本体"全闭"虚标 + O9 招牌能力活体不存在）
| 声称 | 判定 | 证据 |
|---|---|---|
| **O9 runGrowthLoop 自动调** | ◐ | 触发真接线真（`server.ts:2088-2119`）、RL4 不放水（dataOk 才 GOVERNED）；**但"缺件卡→自动补→GOVERNED"活体里从不发生**——验证 agent 真起双服务建 ADV_GAP_TEST→grow→**停 PROVISIONAL+开票**，loop 收敛到 BOUNDARY、CONVERGED→GOVERNED 分支无卡能走到 |
| O10 evaluate_rules 自动接 | ✅ | `scenario-rules.ts:22`+`orchestrator.ts:596`；grow C03 demandDelta=0.8 真出 rule_violation BLOCK |
| O11 slice 自动生成 | ◐ | 通路真（直打 `/slices/plan`→ok:true 真解析子图），**但 20 出厂卡 sliceTargets===undefined，对它们一次都不进、出厂态零生效** |
| O12 ADVISORY 三态 | ✅ | enum 三态真、流转真、占位不升格守 RL4 |
| **本体回写"O9-O12 全闭"** | **❌虚标** | `SYSTEM-ONTOLOGY:432` 写"全闭"却同段自打脸"待 fill 引擎能真收敛时生效"。按 §1 增量1 DoD，O9 未"闭" |
**返工**：本体回写"全闭"改 **◐**（O9 半闭/O11 通路闭出厂未声明）；O9 让缺件卡真能收敛到 GOVERNED 或诚实缩范围；O11 给出厂卡声明 sliceTargets。

### 轨 G 管理面 — 🔴 打回（C6 死路 + C11 半缺 + AC8 无浏览器证据）
| 声称 | 判定 | 证据 |
|---|---|---|
| C5/C7/C8/C9/C10/C12 | ✅(代码级) | 求解器目录页/切片编辑器/试运行/评测CRUD/objectRef refType+试分类/配置迁移页 代码+端点真（锚点见验证报告） |
| **C6 12 引用控件全闭** | **❌** | **我亲手逐行核**：evaluate_rules 的 `ruleIds` 是裸 JSON 框（refKeys `WorkflowsPage.tsx:359-361` 只加 solverKey/agentId、ReferenceSelect 仅 2 处都不是 ruleIds、ruleIds 走通用 JSON 渲染 `:382/455/460`）；**策略↔role 整缺**（PermissionsPage 只读）；场景↔intentFilter 半闭（自由文本无＋新建） |
| **C11 规则/权限 DSL 辅助** | **◐** | 规则侧真（RulesPage DslTextarea）；**权限侧裸缺**——我核 PermissionsPage 全部交互(`:55-81`)只是 authz-explain 调试器，全仓无权限策略编辑器，违 D-28 |
| **AC8 全控件无死路 + CORS** | **❌** | dev 无真浏览器证据，全 jsdom（测不出死按钮，G-4 教训）；且 C6 已有真死路 → "无死路"本就不成立 |
**返工**：C6 ruleIds 改 ReferenceSelect、补策略↔role 编辑、intentFilter ＋新建；C11 权限侧加 DSL 编辑；AC8 真浏览器逐控件点 + 截图。

---

## 2. 必须返工清单（按红线级 → 一般）

**🔴 红线级 / DoD 未达（必修）**
1. **C·E15**：DRAFT scene 真注册进 QOS 启动器 + 真推演出答案（非 DataCore 静态答）。
2. **D·V10**：`validation:check` 并进 `pnpm gates`（否则 VLE 形同虚设，CI 拦不住）。
3. **E·R10**：6 入口改规则即改推演 FDE 真跑 + 对比产物（§5⑤ 不认测试绿）。
4. **G·C6/C11/AC8**：ruleIds/策略 role/intentFilter 闭合 + 权限 DSL + 真浏览器走 AC8。
5. **F·O9**：缺件卡真能自动长成 GOVERNED，或诚实缩范围。

**📏 诚实降级（必须改口径，别再"全闭"）**
6. **E·R9**："11 映射"→"5 真评/6 诚实 NA"。
7. **F 本体回写**：`SYSTEM-ONTOLOGY §8 G-9 "O9-O12 全闭"`→ ◐。
8. **C·E13/E14/E6**：降到实情（E14 非"14 域"实 3 条；E6 非真问句）。
9. **D·V11 / E·R11 / B·whatif**：补真测试或改措辞。

## 3. 本体回写更正（dev 自己改）
- `SYSTEM-ONTOLOGY §8 G-9`：dev 写的"O9-O12 全闭"= 虚标 → 改 **◐**（附 O9 活体停 PROVISIONAL 的真相）。
- `SYSTEM-ONTOLOGY §8 G-10`：R10"6 入口一致翻转"是架构论证非实跑 → 标"待 6 入口 FDE 实证"。

## 4. 给 dev 的返工纪律
**别再用"all closed / 全闭 / proven"**——按各 HANDOFF §1 追溯表**逐元素**，**亲手真跑出该行为 + 截图/CLI/API 证据**才标 ✅；跑不出/没产物就诚实标 ◐ + 列差。**本单每个 ❌ 都是真跑出来的，不是挑刺。** 修完逐条附真跑证据重提，我再逐条复验。

> 一句话：**六轨建了大量真东西，但"全闭"是假的。修红线级 5 项 + 把夸大口径诚实降级 + 补你声称却没有的 FDE 产物。**
