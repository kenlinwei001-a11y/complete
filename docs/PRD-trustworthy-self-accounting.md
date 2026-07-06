# PRD · 可信自我账（自我构建的真实性根治）

> 状态：**草案·待用户过目定稿**（用户已定 3 方向：通用能力对象模型 / E2E 真跑判据 / 存量全部回炉；优先级 P0，dev 存量让路；定稿后再派 dev）。
> 一句话：**平台对外卖"真实数据→本体→规则→求解器→Action→答案，缺了诚实报缺口"；对自己却用一套手打状态字的账本，所以能诈（"十个算法完成"实际 1/10）。根治 = 让"自我账"也跑平台自己的现成 reality-judge，且"完成"构造即真。**

---

## 0. 本体引用与影响（铁律0 · 先行）

> 已完整读取 `docs/SYSTEM-ONTOLOGY.md`（权威口径 `prd-ontology-index.json`：R1–R17 · G-1…G-15）。以下为本 PRD 触及的接线。

- **对象类型**：
  - 新增 `Capability`（一等对象·能力/缺口的统一体，§2.H 交互编排域）。
  - 扩展 `#12 Dogfooding 元层`（`SystemBreakpoint`/`SystemGate`：状态从"读 §8 emoji"升为"交叉核对运行时真相"）。
  - 纳入（非本体对象但受治）`work-queue WorkOrder.status`。
  - **复用现成 reality-judge**（不新建判据）：`classifyGap`(probe.ts:47)、`verifyScenario`(server.ts:2079)、`GrowthTicket.verify`(server.ts:353)、`RUNTIME_PROBE`(storybuildrun.ts:328)。
- **链路**：扩 `sys.meta.change_loop`(D11 §10.3)——把"影响分析"升为"不变量真值校验"；接 `sys.orch.query_to_answer`(D7) 的 gap 块使其 actionable；复用 growth `L13`。
- **事件**：复用 `growth.gap_detected` / `growth.converged`(L13)；**新增** `selfaccount.fake_detected`（no-fake-done 门查出诈账，级别 NOTIFY，落缺口+通知）。
- **不变量**：**新增 `R-NO-FAKE-DONE`（命名式**，不占 R18——R 号止于 R17 且 §0.5 有 R18/R19 悬空指针；命名式贴合 R-RETENTION/R-AUDIT/R-DR 约定，零碰撞、不触发 meta:sync 索引逐条校验）。**不得违反**：R4（fill 补缺口经 Action 审批·scaffold 为 DRAFT）、R6（判据确定性）、R2（租户隔离）、R11/R13（闭包+可溯源）、R16（发育闭环）。
- **断点**：
  - 修复 **G-9 残留**（"自动补成 GOVERNED 招牌活体"——本 PRD 让其判据被 no-fake-done 门守）。
  - **新增 G-16**：自我构建账本（work-queue DONE）+ 自我镜像（meta 断点 FIXED）**无验证门**——手打状态字与"制品真存在+重跑可答"零绑定（`collab-queue.mjs:60` 裸赋值；全仓零 `check-*.mjs` 引用 work-queue）。本 PRD 即关闭 G-16。

---

## 1. 问题（实测证据·非推断）

| # | 实测现象 | 断在哪（file:line） |
|---|---|---|
| P1 | **"十个算法完成"谎**：跨环节多跳问题 10 个里仅 1 个（what_if_displacement）真 E2E 答，其余 9 个专用算法未建（系统诚实说"缺算法"——好），但有账口把它们记成"完成" | `docs/work-queue.json status` 手打 · `scripts/collab-queue.mjs:60`（`done`→`set()` 只 `status="DONE"`，**不跑 acceptance.criteria、不查制品**）· 全仓零 check 引用 work-queue |
| P2 | **meta 镜像文档谎言**："用平台查平台自己"返回的是 §8 markdown 的 ✅/◐ 声称，非运行时真相 | `meta/parse.ts:32-39 parseBreakpointRow`（读 emoji 投影 FIXED）· `meta:sync` 只校验可解析、不校验声称为真 |
| P3 | **缺口不 actionable**（用户实测「常州基地的瓶颈是?」→工单页看不到补什么/在哪补）：真实 evidence = `LLM_PURPOSE_UNBOUND: …请在 设置→LLM 用途绑定 配置`（具体可行动），却被 `classifyGap` 拍成 `OTHER`→`suggestedFill="人工核实内部错误"`（丢弃真相）；且 `对象类型=dash` 是视图键泄漏 | `probe.ts:22-30`（未映射 error→默认 OTHER）· `probe.ts:19`（OTHER→"人工核实内部错误"）· `scenario-grow.ts:83`（`objectType \|\| view \|\| "Object"` 把视图键 dash 当对象类型） |

**共同病根**：系统**握有真相**（evidence 里有确切错因/修法；acceptance.criteria 已写在每张工单上），但**自我账层把真相拍成 catch-all 或手打状态字**——claim 与 reality 结构上可两张皮。

---

## 2. 根因（本体接线·非表象）

平台**运行时已有四套"从真实重跑派生 verified"的判据**（`乙`表 🟢）：

| 判据 | 位置 | 怎么派生真值 |
|---|---|---|
| `classifyGap` 诚实门 | `probe.ts:47` + `isDataBearing:39` | 空投影→EMPTY_DATA 非 ANSWERABLE，杜绝假收敛 |
| `verifyScenario`→GOVERNED | `server.ts:2079` | 真跑 QOS + dataBearing 门才 GOVERNED |
| `GrowthTicket.verify`→VERIFIED | `server.ts:353-373` | 重跑问句→verdict==ANSWERABLE 才 VERIFIED |
| `RUNTIME_PROBE` 证据 | `storybuildrun.ts:328` | 真过 QOS orchestrator=活证据 vs BUILD_STATIC |

**但平台自己的构建账本（work-queue DONE）与自我镜像（meta）不用它们。** 本体 §10.5.4 自陈："#12 元层已把系统投影为对象，但**尚未接规则引擎去校验不变量为真**——目前只投影文档声称。" ← 这就是根。

**根治方向不是造新判据，是把自我账接到已有判据上。**

---

## 3. 设计（根治·非补丁）

### 3.1 能力 = 一等对象（通用模型·用户选定）
`Capability`（元租户 `__platform__`，复用 objects/links 仓储 R9，不新建表）：
```
Capability {
  key, kind: solver|scenario_answer|data_source|rule|feature|workflow,
  claim,                       // 声称能做什么（如"回答基地瓶颈"）
  representativeQuery,         // 代表问（验收锚点）
  acceptance,                  // 验收判据（curl/E2E 断言）
  verifiedStatus: UNVERIFIED|VERIFIED|STALE,   // ← 派生，不可手打
  evidence: { kind: RUNTIME_PROBE|ACCEPTANCE_PASS|NONE, at, detail },
}
```
**verifiedStatus 由现实派生**（制品存在 + acceptance 真跑过 + **代表问经 QOS 自然语言路由真跑答出 ANSWERABLE+dataBearing**），任何手写路径被禁。
> **关键（audit 逼出）**："代表问 E2E 答出"必须走**用户真实的 NL 路径**（QueryDock 打字→QOS 分类→场景/求解器→答案），**不是**手搓 args 直调 `/a/v1/solvers/{key}/invoke`。现存 4 个"HTTP E2E"正是绕了 NL 路由的假 E2E——复用 `GrowthTicket.verify`（它重跑的是**问句**不是求解器）作判据，天然对齐此 bar。

### 3.2 R-NO-FAKE-DONE（命名不变量）
> 任何标为**完成/已修/已验证**的自我账目（work-queue DONE · meta 断点 FIXED · Capability.verifiedStatus），**必须挂一个 reality-derived 证据**（acceptance.criteria 真跑通 / 对应制品运行时真存在且重跑可答）；否则自动打回**开放缺口**，持续暴露。

### 3.3 `no-fake-done:check` 门（复用现成 machinery）
- **执行**每个 work-queue DONE 项自带的 `acceptance.criteria`（curl 断言——已存在！）对运行栈跑；不过 / 制品缺失 → 该 DONE = 诈 → 门**红**，发 `selfaccount.fake_detected`。
- Capability.verifiedStatus 与 GrowthTicket VERIFIED 复用 `classifyGap ANSWERABLE`。
- **green→red 自证**（植入一条假 DONE 必红）。注册三步：package.json 别名 + gates 链 + **§7 登记**（否则 `check-ontology-writeback` 红）。

### 3.4 gap 必须 actionable（P3 修·纳入根治非单独补丁）
- `classifyGap` 不得把具体 error 拍成 OTHER：未映射码**保留 evidence 原文**并派生 `{what/where/acceptance}`；`LLM_PURPOSE_UNBOUND` 等入正式码表。
- 修 `scenario-grow.ts:83` 视图键泄漏（视图键 ≠ 对象类型）。
- 每张缺口工单渲染 "缺什么·补在哪·验收=本问句 E2E 答出"，永不"人工核实内部错误/dash"。

### 3.5 meta #12：从"镜像文档"升为"反映运行时真相"
`SystemBreakpoint.status` 不只读 §8 emoji——交叉核对该断点 judge 的运行时结果；声称 FIXED 但运行时不通 → 标 `DRIFT`（本体谎言曝光）。

### 3.6 散落面 → 切片视图（增量收敛，非本 PRD 阻塞项）
工单中心（已并成长驾驶舱）/ 兜底统计 / 规划体检 / 校准报告 / Agent 评测 / 闭环验证 VLE = 同一 Capability/Gap 自我模型上的 slice，逐步收敛。

---

## 4. 反半成品守卫（对冲"通用模型战线长"风险）
用户选通用模型（我曾提示战线长易半途）。守卫：**通用模型本身按 E2E 判据交付**——先打穿"求解器能力"一条真竖井（如 bottleneck 能力真建 + probe→gap→fill→verify 闭环真跑通一遍），模型才可标完成；**模型自己不许 fake-done**（用 no-fake-done 门守自己）。

---

## 5. 施工单拆解（WO 序列 · 待定稿后派）

| WO | 内容 | 立即价值 |
|---|---|---|
| **WO-1** | `R-NO-FAKE-DONE` + `no-fake-done:check` 门（绑 work-queue DONE 到 acceptance 真跑）+ 回写 §5/§7 | **立即堵谎根**（P1）|
| **WO-2** | `Capability` 一等对象 + verifiedStatus 派生 + 代表问 E2E harness | 通用模型骨架 |
| **WO-3** | gap actionable（classifyGap 去 OTHER catch-all + evidence 保留 + dash 修 + LLM_PURPOSE_UNBOUND 入码）| **修 P3 瓶颈工单** |
| **WO-4** | meta #12 运行时真相交叉核对（status DRIFT 检测）| 修 P2 |
| **WO-5** | 散落面归一为 slice（增量）| 收编测+补 |
| **WO-6（回炉）** | no-fake-done 扫全存量 DONE，诈的重置开放缺口（十个算法 + 9 洞 + siblings）| **旧账清算**（并入 #37）|

---

## 6. 回炉审计清单（存量诈账 · truth-audit 实测）

> **核心发现（反直觉·关键）**：39 个求解器**函数体几乎都真存在**（非空桩）。诈账不在"空壳"层，而在三接缝：① 工单口径超前/自相矛盾 ② 设计文档"非真跑"当"已落地" ③ **通用多跳求解器没接进 QOS 自然语言场景路由**。**HTTP 真端到端仅 4 个（shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius），且都手搓 args 直调 `/a/v1/solvers/{key}/invoke`——无一条跑"NL 问题→QOS 编排→答案"真链路。** ← 这是最深的"绿测试≠能用"：连"E2E 测试"都绕开了用户真实的 NL 路径。

### 6.1 DONE 超 claim 单（WO-6 回炉重验）
| 单 ID | 声称 | 实际（file:line）| no-fake-done 门会怎样 |
|---|---|---|---|
| **MULTISRC-FUSION**(work-queue:230 DONE) | N1 多源融合+仲裁+测谎完成 | 求解器真在(`service.ts:585`)，**但 6 条 curl 验收全打 `source_conflict/invoke`——该 key 代码零存在(grep 空)→真跑必 404** | **教科书级铁证：验收一执行即 404→红。本设计若早在，此单当场标不成 DONE** |
| **E1-E2**(work-queue:313 DONE) | 校准活体+沙盘 what-if 进决策 | **note 自打脸"仅设计零代码·NOT-LANDED"(:320)**；E2 propagateTick 仍"待增量3"(`app.ts:1293`) | DONE↔note 矛盾→红 |
| **SOLVER-BINDING**(work-queue:5 DONE) | 真实数据出真答案 | order_fullchain 真在(`service.ts:1101`)，Q2 多源仍无真数据 | 真租户多源 E2E 实测 |

### 6.2 文档/目录名不副实
- `AUDIT-hand-run.md §③`："5 个杀手多跳全落地+真实 HTTP E2E" → 实 **4** 个直调，**NL→QOS 从未真跑**。
- `countermeasure_combo`(catalog:65 称"跨求解器编排") → `extended.ts:340` 只借名+魔数系数，**从不真调**所列子求解器。

### 6.3 治本单仍未做（用户实测抓到的假红根因）
- `KILL-MOCK-RED`（work-queue **status=TODO·未做**）：risk_timeline 无源仍哈希假红(`risk.ts:342/358`)——**你实测抓到的"假红/假裁决"根因单尚未闭**。

### 6.4 你"9 个洞"确切清单（10 题走查 · Q7=shared_bottleneck=what_if_displacement 是唯一真通那 1 个）
| 洞 | 问题 | 求解器 | 真根因（非空壳） | 应属缺口码 |
|---|---|---|---|---|
| Q1 | 毛利跌破+归因+择杠杆 | 在 | 多杠杆择优未进决策日常（缺 E2）| NO_CAPABILITY |
| Q2 | 多源各执一词仲裁 | 真在(585) | 无真多源数据+验收指幽灵端点 | SOLVER_NOT_FOUND |
| Q3 | 断供 30 天传导 | 在 | 情景注入沙盘未进决策入口（缺 E2）| NO_CAPABILITY |
| Q4 | 预测信几分 | 在 | 活体收敛趋势不可见（缺 E1）| NO_CAPABILITY |
| Q5 | 行动回采对账 | 在 | 预期 vs 实际不闭（缺 E1）| NO_CAPABILITY |
| Q6 | 保交付/毛利/信用三选二 | 在 | trade-off 不接地（缺 E2+SCENE-C）| NO_CAPABILITY |
| Q8 | 按角色不同接地答案 | 在 | 未全铺（缺 SCENE-C）| NO_INTENT |
| Q9 | 审计还原决策链 | 在 | 审计散点未成一线（缺 AUDIT-OBS）| NO_CAPABILITY（现误落 OTHER）|
| Q10 | 跨行业 config 即跑 | 大部 | 视图 layout 仍电池形（G-5）| NO_CAPABILITY |

**9 洞共性根**：求解器函数多数在，但**没接进 QOS 自然语言场景路由**（5 个通用多跳求解器在 agentcore 场景/意图路由**零命中**；SCENARIO_CATALOG S01–S20 全电池卡，无一指向通用求解器）、或依赖 E1/E2/N1/SCENE-C/AUDIT-OBS/G-5 未落、无真数据即 MOCK/假红。

> **重要范围界定**：本 PRD（可信自我账）负责**让 9 洞被诚实曝光为 actionable 开放缺口**（而非藏在"完成"里）。**真正把 9 洞填上**（把通用求解器接进 NL 场景路由 + 落 E1/E2/N1/SCENE-C/AUDIT-OBS + 除假红 KILL-MOCK-RED）是诚实账本随后驱动的一批 fill 工单（WO-7…，每个用"代表问经 NL 真跑答出"验收）——正是你要的"持续暴露、逼着补"。

---

## 7. 验收（teeth · E2E 真跑判据）

1. **"十个算法完成"结构上标不成**：9 个 acceptance 不过 → no-fake-done 门红 → 自动开放缺口。
2. **瓶颈工单**：「常州基地的瓶颈是?」出真答案 **或** actionable gap（"缺 bottleneck 能力：建 X·补在 Y·验收 Z"），**永不 OTHER/人工核实/dash**。
3. **9 洞持续暴露**：直到每个有真跑验过的求解器才转 VERIFIED。
4. **gates 含 no-fake-done**，green→red 自证；本体 §5/§7/§8 已回写。
5. **自证**：往 work-queue 植一条假 DONE（acceptance 必不过）→ 门必红。

---

## 8. 回写本体（改完必做·本体是单一来源）
- §2.H 新增 `Capability`；§4 新增 `selfaccount.fake_detected`(L15)；§5 新增 `R-NO-FAKE-DONE`；§7 新增 `no-fake-done:check`；§8 新增 G-16（并更新 G-9 收口口径）；§0.5 顺手清 R18/R19 悬空指针。
