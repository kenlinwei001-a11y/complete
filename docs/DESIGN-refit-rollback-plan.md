# DESIGN · 基于现系统的改造施工方案（铁律驱动 · 可回退 · 防升级失败）

> 承接 `docs/ANALYSIS-decision-os-spec-vs-system.md`（规格↔现系统对比）与 `docs/PRD-gap-analysis-engine.md`（第 0 层载体·v4 已核对代码）。
> 本文回答一件事：**怎么改才不把现系统改坏**——每一期都是"暗发 + additive + 旁路 + 影子跑 + 回退演练入齿"，任何一期失败都能一键退回上一期的稳定态。
> 状态：设计稿待派单。不改运行时。

## §0 本体引用与影响（铁律 0）

- **对象类型（§2）**：复用 `GapAnalysis`/`GapReport`/`ClassificationResult`/`WorklistItem`/`GrowthTicket`/`SOLVER_DATADEP`；拟立 `PreAnalysisReport`/`CapabilitySnapshot`（母体已 🚧 登记）；L1 拟立 `RequirementGraph`（落地时回写 §2.H）。
- **链路（§3）**：编排链 Query→classify→Intent→ExecutionPlan→{Solver|Slice|Rule}→SSE（**权威判决链·本方案不换手**）；新增旁路：预分析（母体已 🚧）；L1 新增影子链 synthesizePlan（落地时回写）。
- **事件（§4）**：`growth.pre_analysis_started/done/failed`（母体已 🚧·D-29 ≤60s）。
- **不变量（§5）**：R1 contracts-only · R2 tenant everywhere · R3 Entitlement 先于 authz（关=404）· R6 确定性 · R7 错误信封 · R9 仓储双实现四处同改 · R13 溯源 · R14 零业务常数 · R16 发育闭环；**发布律=十红线**（母体 §5:632）：RL2 暗发 `defaultOn:false` · RL9 additive 可回退（迁移带 down·旧路径在）· RL10 不与在建分叉。
- **断点（§8）**：G-1（query 预诊断补强）· G-3（presetContext）· G-4（入口收口 worklist/ticket）· G-8（checkReadiness）。
- **门禁（§7）**：`pnpm gates`（~45 项）+ `no-fake-done` + `ontology-slices` + `retention-coverage`；拟立 `hidden-req-keys:check`（L0-C 落地时登记母体 §7）。
- **回写义务**：L0 落地→把母体 3 处 🚧 拟立改"已落地"并校准锚点；L1 落地→§2.H 登记 `RequirementGraph`、§3 登记影子链、§7 登记 parity 门；每次改母体后 `pnpm ontology:slices`。

---

## §1 改造七原则（铁律 → 发布纪律）

| # | 原则 | 来源铁律 | 具体做法 |
|---|---|---|---|
| P1 | **暗发** | RL2/R3 | 每个新能力挂 entitlement key `defaultOn:false`；关=404 `FEATURE_NOT_FOUND`=「不存在」；demo 租户先开（金丝雀），观察绿再逐租户放 |
| P2 | **只加不改** | RL9/R1 | 契约字段全 optional（zod 非 strict·旧消费方零感知）；DB 只建新表不动旧表；migration 必带 down；旧代码路径**永不删除** |
| P3 | **旁路优先·权威不换手** | §10/R13 | 预分析是旁路（`void` 异步·不阻塞 SSE）；`classifyGap`(probe.ts:126) 与 `resolvePlanForIntent`(orchestrator.ts:953) 的**权威判决地位不变**——新能力只提供咨询信号，永不制造假 BLOCKER |
| P4 | **影子先行** | R6·先例 a14-parity.test | 凡触热路径（L1 planner）：先影子跑（真跑但不接管），落 divergence 记录，parity 门绿才按 intent 白名单逐个翻，任何异常即回落模板路径 |
| P5 | **回退演练入齿** | 铁律 0.4 | 每张 WO 的 acceptance **必含一条真跑回退演练**：关闸→curl 404 + 前端不渲染 + 旧行为回归测绿；migration down→up 幂等重跑。**回退是被证明的，不是被声称的** |
| P6 | **单期单单·复验绿再下期** | 协作纪律 | 一期一张 WO，审核方真跑复验 DONE 才派下一期（QUERY30 教训：无验收基线的大单=返工温床） |
| P7 | **失败判据前置** | no-fake-done | 每张 WO 派单时写死：中止条件 + 回退动作 + 数据影响。不存在"半上线"态 |

**数据安全总底**：本方案新增的所有数据（`pre_analyses`/影子记录）均为**咨询性派生数据**——可随时 drop、可由重跑再生，回退**零业务数据损失**。业务真值表一张不动。灾备底座已有（`scripts/backup-pg.sh`/`restore-pg.sh`·G-DR-1 已闭）。

---

## §2 分期施工单

### L0-A · diff 纯核 + 契约冻结 + 有界 snapshot（= PRD Phase0+1 · 零热路径）
- **范围**：`diffGap` 纯函数落 `@platform/contracts`（R1/R6·`generatedAt` 注入）；`analyzeGap`（provisioners.ts:106）改为收集 existing→调 `diffGap`，**对外签名/行为不变**（唯一调用点 service.ts:406 零改）；新端点 `GET /a/v1/databuilder/registry-snapshot`（仅 6 类 A 栈·SERVICE_TOKEN/OBO）；契约扩展 `GapTarget/GapSeverity/GapRemediation/GapExplanation/ExecutionStep`（全 optional）。
- **触点**：contracts/databuilder.ts · datacore/databuilder/{provisioners,service}.ts · datacore app.ts（+1 路由）。**不触 agentcore、不触前端、不触 QOS**。
- **回退杠杆**：git revert 单提交；snapshot 端点挂 feature key `databuilder.registry_snapshot`（defaultOn:false·关=404）。
- **爆炸半径**：DataBuilder 域内。热路径零。
- **失败判据（中止即回退）**：`analyzeGap` 改造前后 **byte 等价测试**红 / `provisioners.test` 红 / 四包 test 红。
- **验收齿**：① 等价测试（同输入改造前后 GapAnalysis JSON 字节一致）② snapshot 真跑：起 datacore·SERVICE_TOKEN curl 返 6 类·用户 JWT 403 ③ **回退演练**：关 feature→curl 404；revert 后 `provisioners.test` 绿 ④ gates 全绿。
- **排序**：**可与 Q30-P1 并行**（触点文件不相交：Q30-P1 在 catalog/solvers/workflow，本单在 databuilder/contracts）。

### L0-B · 预分析旁路闭环 + GapCard 全景条（= PRD Phase2 · 目标②近期）
- **范围**：`agentcore/growth/pre-analyze.ts`（新）：复用 `ClassificationResult` 推需求→组两侧快照（A 栈经 snapshot·B 栈查自 repos·TTL 60s 事件失效）→`diffGap`→enrich；`pre_analyses` R9 四处 + migration 013（带 down）+ 登记 `RETENTION_DEFAULTS`；3 事件登记 event-subscriptions；`GET /b/v1/growth/pre-analysis/:taskId`（R2）；MANUAL/DEVELOP 缺口收口 `growthWorklist.upsert`（deeplink `/admin/tickets?taskId=`·不造新工单系统）；前端 GapCard 顶部全景条 + CoverageRing（R-QUANT 逐值·零新色·四状态诚实：RUNNING/DONE/FAILED/无 taskId 不渲染）。
- **热路径唯一触点**：growth wiring 内一行 `if (featureEnabled) void preAnalyzeQuery(...)`——fire-and-forget，try/catch 包死，**关闸时这行不执行=零开销**。
- **回退杠杆**：feature key `growth.pre_analysis`（defaultOn:false）关闸→端点 404、事件不发、前端条不渲染（RL2/RL9）；migration 013 down 只 drop `pre_analyses`（咨询数据·零业务损失）。
- **失败判据**：QOS 回归测红 / SSE 首包延迟回归 / V7 红（无 taskId 时 GapCard 行为 ≠ 改造前）/ 预分析误产 BLOCKER（§10 违例）。任一命中→关闸=完整回退。
- **验收齿（真跑·铁律 0.4）**：① PRD §15 V1–V7 全条（真起双服务+真浏览器逐值对照：环 stroke===token 色、徽章数===端点 severity 计数、score<0.5 不阻断 reactive、FAILED 显重试且 QOS 照常）② R6：同 query 双跑 PreAnalysisReport 字节一致（LLM mock）③ **回退演练**：关 `growth.pre_analysis`→curl 404 + 浏览器 GapCard 与改造前逐像素一致 + migration down→up 幂等 ④ R2：tenantB 取 tenantA taskId→404 ⑤ gates 全绿。
- **排序**：**排在 Q30-P1 BUILT 之后**（两单都动 agentcore·避免合并冲突；L0-A 复验绿为前置）。

### L0-C · 隐藏需求闭包 + 统一验证 + 工单中心融合（= PRD Phase3 · 目标①收敛）
- **范围**：`expandHiddenRequirements`（三白名单 by-construction：本体图真类型/真链路/`SOLVER_DATADEP` 真求解器·zero 幽灵 key）B-Phase1 依赖闭包→B-Phase2 图一跳（深度=1 可配）；补齐后统一走 `verifyBuild`/`ClosureReport`；新门 `scripts/check-hidden-req-keys.mjs` 入 gates + 登记母体 §7；TicketCenterPage 融合（`?taskId=` 全景卡 + severity 徽章 + explanation 展开·**零新页**·入口收敛落点）。
- **回退杠杆**：feature key `growth.hidden_req`（defaultOn:false）关=只诊断显式需求（与不做一致）；TicketCenter 增强块条件渲染（无 `?taskId=` 时页面 100% 原样）。
- **失败判据**：hidden-req-keys 门红（幽灵 key 回潮）/ 扩展过度（反查阈值 0.6 失守·建议数爆炸）/ V8 红。
- **验收齿**：① V8：喂含 order 显式需求+真实电池本体图→断言每个扩展 key ∈ 真实注册表 ② 测谎对照：故意注入幽灵 key 的构造→门红（green→red 自证）③ **回退演练**：关闸→诊断结果与 L0-B 态字节一致 ④ 真浏览器：`/admin/tickets?taskId=` 全景卡逐值对照端点；无参时页面与改造前一致 ⑤ gates 全绿。

### L1-A · RequirementGraph 一等产物（目标②深化第一齿）
- **范围**：把预分析已产的散件（intents/solvers/objectTypes/links/`trace`）**形式化**为 `RequirementGraph{nodes,edges}` 契约（optional 字段挂进 `PreAnalysisReport`——不建新引擎，先把现有推导物结构化）；design-time（`comprehend` BuildPlan）与 runtime（QOS classify）**共用同一 graph 契约**（合两套的第一步）。
- **回退**：optional 字段 + 同 `growth.pre_analysis` 闸；不产 graph=回 L0-C 态。
- **齿**：graph 节点/边全部 ∈ 三白名单（复用 hidden-req 门）；R6 双跑一致；comprehend 与 pre-analyze 对同一目标产同构 graph（等价测试）。

### L1-B · Execution Planner 影子（目标②深化核心 · 绞杀者模式）
- **范围**：纯函数 `synthesizePlan(reqGraph, registries) → ExecutionPlan`（R6·无 IO）；在 orchestrator.ts:953 `resolvePlanForIntent` 旁**影子跑**：`shadow{templatePlan, synthesizedPlan, diff}` 落 `PreAnalysisReport.planner`（optional·复用 pre_analyses 表·零新迁移）；parity 基准 = demo 30 问 + 既有场景集（先例 a14-parity.test.ts）。
- **翻闸策略（严格单调·零回归风险）**：
  - STAGE-1：仅对 `resolvePlanForIntent` 返回 **null 的 intent**（现状=无模板可用·falls through）允许 planner 提案——**纯增覆盖**，模板路径有解时 planner 永不上位；
  - STAGE-2：parity 门连续绿的 intent 进白名单（配置态·摘除=秒级回退）；
  - **任何 planner 异常/超时 → try/catch 回落模板路径**；模板路径**永不删除**。
- **回退杠杆**：feature key `qos.exec_planner`（defaultOn:false·shadow 与 flip 分两档：`shadow`/`serve`）；白名单清空=全量回模板；关闸=连影子都不跑。
- **失败判据**：parity 分歧率超阈 / planner 产出含白名单外 key / 首包延迟回归 / R6 双跑不一致。
- **齿**：① 影子期零用户可见变化（V7 级回归）② STAGE-1 真跑：一条现状 fall-through 的问句经 planner 出可执行计划且真跑出答案 ③ **回退演练**：摘白名单→该 intent 行为与模板态一致；关闸→影子记录停增 ④ R6 + gates。
- **前置**：L1-A DONE + L0 全绿运行 ≥1 周观察窗。

### L1-C · 因果归因 path + NL 路由覆盖（目标②求解器覆盖）
- **范围**：**复用** `plan_rootcause`/`margin_attribution`/`counterfactual_timeline`（皆已注册）——补通用「因果归因」意图目录项 + 组合 workflow（归因→反事实→建议），经 ONTO-SCEN 发育管道长成（非 seed 手装·闭 G-9）；NL 代表问入 intent 目录。
- **回退**：目录行可删 + feature key；求解器本身零改。
- **齿**：代表问「为什么 X 恶化/延期」经 QueryDock NL 真跑答出归因链+反事实对照（非 fallback）；R6；gates。
- **排序**：可与 L1-A 并行（触点不相交：catalog vs contracts/growth）。

### L2（登记路线图·本轮不排）统一 Decision 内核
决策台账(decisions.ts 2 态)/QueryTask/场景卡/Action 合一 + 生命周期状态机——**入口过多的结构根治**，但爆炸半径横跨两系统。**前置条件**：L1-B planner 稳定运行 + RequirementGraph 成为通用产物。到期单独出整页 PRD（R-PRD）再议。

### L3（正交 track·独立节奏）K8s/helm · AI 原生安全（注入防护/输出安全/Agent 一等身份/数据分级）· Canonical Data Model+字段级 DQ · Agent 五维评估卡。与两目标解耦，不占本改造窗口。

---

## §3 回退矩阵总表

| 期 | 回退杠杆（秒级→分钟级） | 数据影响 | 回退后系统态 |
|---|---|---|---|
| L0-A | feature 关 / git revert | 无 | 与改造前 byte 等价（有等价测试证明） |
| L0-B | `growth.pre_analysis` 关；migration 013 down | drop `pre_analyses`（咨询数据·可重生） | GapCard/QOS 与改造前逐像素/逐值一致（V7+回退演练证明） |
| L0-C | `growth.hidden_req` 关 | 无（纯计算） | 诊断=仅显式需求（与 L0-B 态一致） |
| L1-A | 同 L0-B 闸 | optional 字段停产 | L0-C 态 |
| L1-B | 白名单摘除（秒）→ `qos.exec_planner` 关（影子也停） | 影子记录停增（可清） | 全量模板路径（从未删除） |
| L1-C | 目录行删除 / feature 关 | 无 | 求解器仍在（本就零改） |

**总不变式**：任何时刻，关掉全部新 feature key 后的系统 = 改造前系统 + 若干休眠代码与空表。这是每期回退演练要真跑证明的命题。

## §4 升级失败手册（失败模式 → 检测门 → 动作）

| 失败模式 | 检测 | 动作 |
|---|---|---|
| F1 预分析误红/吓用户 | §10 咨询信号约束 + V3/V7 | 关 `growth.pre_analysis`；修后金丝雀重放 |
| F2 QOS 延迟/稳定性回归 | QOS 回归测 + OTel span 对照（G-15 已闭·有真尺） | 关闸（void 不再 spawn）；查 pre-analyze 内阻塞点 |
| F3 契约破坏旧消费方 | 四包 build/test 门 | revert；重申 optional-only |
| F4 迁移失败/脏表 | 启动幂等迁移日志 + retention 门 | down + 关闸；`backup-pg.sh` 底座兜底 |
| F5 幽灵 key 回潮 | `hidden-req-keys:check`（green→red 自证） | 门红即拒合；回 B-Phase1 深度 |
| F6 planner 分歧/劣化 | parity 门 + divergence 率阈值 | 摘白名单（秒级）；影子继续积数据 |
| F7 任何门禁红（no-fake-done 等） | `pnpm gates` | **不绿不进下一期**（P6）；当期修或回退 |
| F8 与在建 WO 合并冲突 | 排序规则（§2 各单排序栏） | L0-B 等 Q30-P1；同栈单不并行 |

## §5 排程与协同

```
现在        Q30-P1(dev在建·Q01样板)  ∥  L0-A(可并行·文件不相交)
之后        L0-B（等 Q30-P1 BUILT + L0-A DONE）
之后        L0-C  →（观察窗≥1周）→  L1-A ∥ L1-C  →  L1-B(影子→STAGE-1→STAGE-2)
路线图      L2（单独 PRD 再议）· L3（正交独立）
```
节奏铁则：一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 才派下一期。每单 acceptance 在**派单时写死**（no-fake-done 教训：齿先行，杜绝 UNVERIFIABLE）。

## §6 落地时回写清单
L0 落地：母体 3 处 🚧 拟立→已落地 + 锚点校准 + `hidden-req-keys:check` 登 §7 + `pnpm ontology:slices`。
L1 落地：§2.H 登 `RequirementGraph`、§3 登影子链与因果归因链、§7 登 parity 门。
