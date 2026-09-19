# 数据构建发动机 · 自完善 LOOP 日志

> 自驱循环：目标→需求→真跑创建→数据验收→差异分析→**改引擎代码**→四包 gate→继续。
> 每轮记录：query · gapCode 前进 · advanced 变化 · 改了哪处引擎代码 · gate 绿否。
> 红线：R6 确定性 · R14 零业务常数 · KILL-MOCK（真实业务实体走 HARD 真人正门·绝不静默伪造）。

## 查询集（起点·补不齐的题）
| # | query | 当前卡在 | 状态 |
|---|---|---|---|
| Q1 | 常州基地设备OEE与物流时长未来30天逐日时序推演 | NO_INTENT→自补 DRAFT 意图(advanced:true) | 迭代1 机制已落·真收敛离开 NO_INTENT 留部署态(R4 墙) |
| Q2 | 储能基地未来60天产能缺口时序 | 待测 | — |
| Q3 | 乘用车订单交付风险时序 | 待测 | — |

---

## 迭代 0 · 基线真跑（2026-07-25·铁证）
**Q1 真跑结果**（起 datacore+agentcore 内存态·POST /api/v1/growth/{probe,run}）：
```
probe: gapCode = NO_INTENT（非 EMPTY_DATA）
  evidence: "分类 outOfCatalog，无意图覆盖；路径B agent 兜底作答（本体外，未验证）"
run:   fillApplied.advanced = false（只开骨架工单·不自建）
  terminalState = BOUNDARY · openTickets = [NO_INTENT]
```
**差异分析（定位到引擎代码）**：
- `growth/scenario-grow.ts:32` `SCAFFOLDABLE = {NO_PLAN, SOLVER_NOT_FOUND}` —— **NO_INTENT 不在内**。
- `growth/scenario-grow.ts:93-95` else 分支：非 EMPTY_DATA 且非 SCAFFOLDABLE → `advanced:false` 只开工单。
- 即：引擎对 NO_INTENT **不自动 scaffold 意图**，卡在意图路由层，根本走不到数据层（EMPTY_DATA）。

**结论**：数据构建发动机的第一层弱点 = **诊断得出 NO_INTENT 却不自补**。病灶在**路由/意图层**（上游），不在数据合成层。修好它，query 才能前进到下一层（NO_PLAN/EMPTY_DATA），届时才轮到"补时序"。

**下一步（迭代 1·下次唤醒实现）**：
- 新增 `growth/scaffold.ts scaffoldDraftIntent(deps, tenantId, query)`：scaffold DRAFT 意图（绑 scaffoldDraftPlan 产的计划·query 作触发例·status DRAFT 待审批 R4）。
- `scenario-grow.ts fill`：NO_INTENT → scaffoldDraftIntent → `advanced:true`（同 NO_PLAN 口径：DRAFT 产物已就绪即算前进）。
- SEAM 测：probe NO_INTENT query → run → 断言 advanced:true + 意图草稿产出。
- 四包 gate 绿 → commit。再真跑 Q1 验 gapCode 是否前进离开 NO_INTENT。
- 待解：`CreateIntentBodySchema` 必填字段（planRef 必填·已知；其余需读契约定义处）。

---

## 迭代 1 · NO_INTENT 自补 + EMPTY_DATA 时序接地（2026-07-25·WO-DATABUILDER-HARNESS 实现）

**改了哪处引擎代码**：
1. `growth/scaffold.ts` +`scaffoldDraftIntent(deps,tenantId,query)`——镜像 `scaffoldDraftPlan`：
   - 幂等（R6）：`intent_growth_<questionSlug>` 已存在则返回 `[]`（跨轮不重建）。
   - 先 `scaffoldDraftPlan` 幂等确保 `plan_growth_<slug>` 兜底计划（generic_inference）在。
   - `catalog.createIntent` 建意图（该 API 恒落 `status:"DRAFT"` → **R4 不自动发布**）·query 作 examples·planRef=latest 绑兜底计划。
2. `growth/scenario-grow.ts` fill 加 **NO_INTENT 专属分支**（不再落 else 骨架工单）：首遇 `!scaffoldedByGap.has()` → scaffoldDraftIntent → **advanced:true + scaffolded + ticket**（DRAFT 未发布 R4 墙 → 同轮开票有界收敛，施工=审批发布）；二遇（幂等）→ advanced:false + ticket。与 NO_PLAN 口径一致（`SCAFFOLDABLE` 分支同结构）。
3. `growth/data-boundary.ts` EMPTY_DATA 时序维度接地：+`detectTimeseries`（纯函数·R6·仅语言标记零业务常数 R14）+`DataGapDecision.timeseries`。
   - HARD（真实体命中 groundingVocab）：DataRequest columns 声明时间戳+度量列、reason 标"逐日时序·绝不伪造真实体时序"→ 真人正门（**KILL-MOCK：零静默合成**）。
   - SOFT（无具体实体）：`scenario-grow.ts` SOFT 分支据 timeseries 用 `fillData` 合成 ts 列 PROVISIONAL 序列·action 标"未接实测"。

**真跑证据（SEAM `apps/agentcore/test/growth-autofill-seam.test.ts`·4 测全绿·LLM mock 确定性）**：
- ① Q1「常州基地设备OEE与物流时长未来30天逐日时序推演」经 `POST /api/v1/growth/run` → round0 `gapReport.findings[0].gapCode=NO_INTENT` 且 `fillApplied.advanced=true` + scaffolded 含 `kind:intent`（`intent_growth_<slug>`）；意图真落库 `status:DRAFT`·绑 `plan_growth_<slug>`(DRAFT)。gapCode 从"NO_INTENT 恒 advanced:false 骨架工单"前进为"NO_INTENT 自补 advanced:true DRAFT 草稿"（**离开恒 BOUNDARY-无进展**）。
- ② 无实体时序 query → `fillMode:SOFT·advanced:true`·action 含"未接实测/PROVISIONAL"·fillData 调用 1 次且 fields 含 `ts`·无 DataRequest。
- ③「常州基地…逐日时序」EMPTY_DATA → `fillMode:HARD·advanced:false`·**fillData 调用 0 次（KILL-MOCK 命门）**·DataRequest.entities 含「常州」·reason 含"不静默合成"+"逐日时序"。

**gapCode 前进（Q1·诚实边界）**：机制层面 NO_INTENT 不再恒 `advanced:false`（迭代0 铁证的病灶已消）；真正"离开 NO_INTENT 前进到 NO_PLAN/EMPTY_DATA"须真人经正门发布 scaffold 出的 DRAFT 意图（R4 墙，与 O9 同一道墙）——沙箱 LLM mock 证机制、真 provider 收敛留部署态，**不编造**。

**layer3（comprehend 多步 harness）· 诚实未做·留后续单**：`databuilder/comprehend.ts` 属 datacore，DRIL 检索在 agentcore；datacore 消费 agentcore DRIL 属跨栈反向（松耦合仅 AgentCore→DataCore），半做风险高。既有 `SOLVER_HINTS`/`comprehendSystemWithSolvers`（提示接地到已注册 solver）+`SOLVER_ALIASES`/`normalizeSolverKey`（确定性收敛自造名）已部分治 comprehend.ts:143 "自造语义名"；reflect 自检 + 对口 slice/solver 检索留独立 WO。

**四包 gate**：contracts / datacore / agentcore（+新增 SEAM）/ frontend 全绿（详见交付回报）。既有 2 处 growth 测试断言按 NO_INTENT 新行为更新（intended·非隐藏回归）：`growth-autofill.test.ts`（NO_INTENT 工单 acceptance 现="已 scaffold DRAFT·审批发布"）· `growth-autofill-scaffold.test.ts`（"讲个笑话"现自补 DRAFT 意图/计划·但断言恒 DRAFT 不发布·R4 守活体目录不污染）。
