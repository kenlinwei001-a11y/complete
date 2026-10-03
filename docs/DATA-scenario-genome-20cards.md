# 卡数据细化 · 20 场景卡完整 genome（render 投影映射 + 规则/切片接线 + growScenario 伪代码）

> 这是什么：`PRD-scenario-ontogenesis.md` 的 **P1/P2 配套数据**——把 20 张卡的"基因组"填全：每卡的 `planSteps`（含**render 投影**，修 BP-1 的 16 占位）、`renderBindings`（求解器**真实输出字段**→block）、`ruleIds`（接进 `evaluate_rules`）、`sliceTargets`。实施 agent 照此**填空**生成执行计划，不必再设计口径。
> **接地**：render 字段取自 `SOLVER_OUTPUT_SHAPES`（`service.ts:99-143`，求解器实现的权威输出契约）。🟢=字段在输出契约中确认；🟡=顶层字段确认、子字段（如 `.day`）落地前核对一次。
> S01/S02 已有手写 render（实测可用），列为 ✅ 模板范本；其余 18 卡照此范式补 render 投影。

---

## 一、20 卡 genome 总表

| 卡 | 意图 | 视图 | 求解器 | 计划步骤（修正后） | render 投影（求解器字段→block） | ruleIds（接 evaluate_rules） | sliceTargets |
|---|---|---|---|---|---|---|---|
| S01 ✅ | capacity_feasibility | project | capacity_forecast | resolve_slice→invoke_solver→evaluate_rules→render | KPI: p50/p90/gapPct · text: mainBottleneck · table: perBaseRows | C01,C02,C03,C09 | model_capacity_network |
| S02 ✅ | affected_orders | risk | affected_orders | invoke_solver→evaluate_rules→render | table: rows(columns) · text: "受影响 {count} 张" | C05 | — |
| S03 | risk_root_cause | risk | risk_timeline | resolve_slice→invoke_solver→evaluate_rules→render | chart: series(逐日) · kpi: breakpoint.day · table: 越线事件 | C06,C11 | base_risk_profile |
| S04 | plan_audit_q | audit | plan_audit | invoke_solver→evaluate_rules→render | table: 审计项(kind/verdict) · kpi: 越线项数 | C15,C16,C18,C21,C23 | — |
| S05 | plan_recommend | generate | plan_generate | invoke_solver→evaluate_rules→render | table: 三方案比选 · kpi: 推荐方案指标 · text: 推荐理由 | C08,C15,C18 | — |
| S06 | adopt_mitigation | risk | mitigation_select | evaluate_rules→invoke_solver→create_action_draft→render | table: options/plans · action_draft: recommended · text: draftPayload | C08,C10 | — |
| S07 | cert_scheduling | project | cert_schedule | invoke_solver→evaluate_rules→render | table: schedule · kpi: engineerGroups 数 | C04,C26 | — |
| S08 | kit_analysis | risk | kit_readiness | invoke_solver→evaluate_rules→render | table: rows(缺料单) · kpi: shortageCount | C06,C16 | — |
| S09 | lta_gap_q | dash | lta_gap | invoke_solver→evaluate_rules→render | kpi: netDemand/coverage/gap · table: po(补单) | C16,C27 | — |
| S10 | inventory_opt | dash | inventory_optimize | invoke_solver→evaluate_rules→render | kpi: releasableCash · table: over/under/idle | C16,C28 | — |
| S11 | changeover_opt | project | changeover_sequence | invoke_solver→evaluate_rules→render | table: sequence · kpi: totalChangeoverMin/savedVsDueMin | C22,C29 | — |
| S12 | yield_diag | risk | yield_diagnosis | invoke_solver→evaluate_rules→render | kpi: breakpoint.day/drop · table: candidates(根因) | C30 | — |
| S13 | maint_stagger | risk | maintenance_stagger | invoke_solver→evaluate_rules→render | table: adjustments · kpi: unresolved 数 | C11 | — |
| S14 | outsourcing_q | generate | outsourcing_split | invoke_solver→evaluate_rules→render | table: allocation · kpi: totalCost/savedVsAllDelay · text: outsourceQualityGate | C08,C31 | — |
| S15 | quote_margin_q | dash | quote_margin | invoke_solver→evaluate_rules→render | kpi: margin/floor/diff · text: verdict · table: breakdown | C15,C24 | — |
| S16 | credit_check | dash | credit_exposure | invoke_solver→evaluate_rules→render | kpi: limit/exposure/available · text: newOrderVerdict · table: exposureBreakdown | C13,C32 | — |
| S17 | capex_review | generate | capex_scenario | invoke_solver→evaluate_rules→render | chart: demand/S/G(缺口窗口) · table: projects · kpi: c23 | C18,C23 | — |
| S18 △ | sop_status | sop | (工作流 /a/v1/sop/*) | resolve_sop→render | kpi: 平衡进度/缺口 · table: 五步状态 · text: 当前步 | C18,C21,C22 | — |
| S19 | quarterly_gap_q | quarter | quarterly_gap | invoke_solver→evaluate_rules→render | kpi: residualGap · table: combo(对策组合) | C08,C29 | — |
| S20 | carbon_q | dash | carbon_footprint | invoke_solver→evaluate_rules→render | kpi: total/threshold · text: verdict · table: breakdown · kpi: maxLever | C33 | — |

> △ S18：`sop_balance` 是工作流非求解器（`SOLVER_404` 实测）。其 genome 特殊——`resolve_sop` 步读 `/a/v1/sop/versions` 当前版本 → render 投影平衡进度/五步状态/缺口（**不 invoke_solver**），或改用 `mrp_netting`/`finance_pnl`/`cockpit_kpi` 出富 KPI。

---

## 二、render 投影范式（照 S01/S02 手写计划补其余 18 卡）

**S01 范本**（`seed.ts:176-186`，实测出真 KPI）：
```ts
{ id: "render", type: "render_answer", params: { blocks: [
  { type: "kpi", label: "P50 产能", value: "{{steps.s2.output.data.p50}}", unit: "GWh", fromStep: "s2" },
  { type: "kpi", label: "P90 产能", value: "{{steps.s2.output.data.p90}}", unit: "GWh", fromStep: "s2" },
  { type: "kpi", label: "缺口比例", value: "{{steps.s2.output.data.gapPct}}", unit: "%", fromStep: "s2" },
  { type: "text", markdown: "主要瓶颈为{{steps.s2.output.data.mainBottleneck}}…" },
]}}
```

**通用范式**（其余 18 卡照填，字段取上表"render 投影"列 + `SOLVER_OUTPUT_SHAPES`）：
```ts
{ id: "render", type: "render_answer", params: { blocks: [
  // KPI：每个标量输出字段一个
  { type: "kpi", label: "<名>", value: "{{steps.s1.output.data.<field>}}", unit: "<单位>", fromStep: "s1" },
  // table：数组输出字段（rows/sequence/allocation/breakdown/combo/schedule…）
  { type: "table", rows: "{{steps.s1.output.data.<arrayField>}}", fromStep: "s1" },
  // text：verdict/summary/结论字段
  { type: "text", markdown: "{{steps.s1.output.data.<verdictField>}}", fromStep: "s1" },
  // action_draft（仅 S06）：
  { type: "action_draft", draftId: "{{steps.s2.output.draftId}}", actionType: "adopt_mitigation", summary: "…" },
]}}
```
**门 `ontogenesis:check` 校验**：每个 `{{steps.*.output.data.<field>}}` 的 `<field>` ∈ `SOLVER_OUTPUT_SHAPES[solverKey]` → 杜绝 S03 那种"引用不存在字段"的 `TEMPLATE_RESOLUTION_ERROR`。

---

## 三、`evaluate_rules` 接线（修"规则只挂卡面不执行"）

每卡 render 前插一步（ruleIds 取上表 + `DATA-rules-13-undefined-definitions.md` 的 SOLVER_RULE_REFS）：
```ts
{ id: "sR", type: "evaluate_rules", params: { ruleIds: <上表 ruleIds>, payload: { /* 求解器输出的相关字段 */ } } }
```
- 配合 `DATA-rules-13-undefined-definitions.md`：ruleIds 引用的规则必须已发布（`rule-closure:check` 守）。
- 求解器闸门改调规则引擎评估（PRD-rules-as-references §2.2），评估结果经 render 的 `rule_violation` block 显示——"关联规则"显**真结果**（PASS/WARN/BLOCK），不再"未找到定义"。

---

## 四、`growScenario` 逐步伪代码（倒序发育 · PRD-ontogenesis §2.2/2.3）

```
async function growScenario(card):                         # 投一颗胚胎
  run = newOntogenesisRun(card.scenarioKey)
  # ① 倒序发育：长全闭包（复用既有 provisioner，不重写）
  intent  = upsertIntent(card.intentKey); publish(intent)          # 候选可被 classify 命中
  slices  = for t in card.sliceTargets: slicePlanner.planSlice(root, t)   # A3.3 确定性，索引复用 A3.4
  rules   = for r in card.ruleIds: ensurePublishedRule(r)          # 缺→开 GrowthTicket（DATA-rules 提供定义）
  solver  = ensureSolver(card.solverKey)                           # 缺→A18 生成 PROVISIONAL 或开单
  plan    = scaffoldPlan(card, steps=[resolveSlice?, invokeSolver, evaluateRules(rules), renderAnswer(card.renderBindings)])
            assert renderBindings.field ⊆ SOLVER_OUTPUT_SHAPES[solver]   # 建图期挡 TEMPLATE_RESOLUTION_ERROR
  publish(plan)
  # ② A10 验证即上架门：正序真跑一遍主问句
  result = QOS.run(card.triggerQuestion, presetContext=card.presetContext)   # 复用 verifyBuild
  if result.answer is REAL (非空/非占位/非探索兜底):
     card.maturity = GOVERNED; run.rings = {data:✓, ontology:✓, capability:✓}
     emit('scenario.matured'); return run                          # ✅ 才上架
  else:
     card.maturity = PROVISIONAL
     gap = classifyGap(result)                                     # 7 码
     if gap.disposition == AUTO_DERIVE: runGrowthLoop(gap); retry  # 倒序补齐再验
     else: openGrowthTicket(gap); notify(); deeplink()             # 诚实开单，前端显"发育中:缺X·工单#N"
     return run                                                    # 绝不静默"未能产出回答"
```

---

## 五、给实施 agent 的注

1. **render 投影优先级**：先把 KPI（标量字段）+ table（数组字段）接上，text/verdict 次之——这是 16 占位卡变真视图的最小增量。字段名严格按 `SOLVER_OUTPUT_SHAPES` 转抄。
2. **🟡 子字段核对**：`breakpoint.day`/`breakpoint.drop`（S03/S12）、`po`（S09）等嵌套/子字段，落地前读求解器实现确认结构（顶层字段已确认在输出契约）。
3. **S18 单列处理**：不要 invoke `sop_balance`（404）；走 `resolve_sop` 读 `/a/v1/sop/*` 或换 `mrp_netting`/`cockpit_kpi`。
4. **S06 action 链**：配合守卫/字段修复——`create_action_draft` 的 payload 用 `base`（非 `baseId`，见 LOOP 账本 BP-3）。
5. **slice 仅 2 卡用**：S01(model_capacity_network)/S03(base_risk_profile)；其余 sliceTargets 为空（求解器直读对象图）。新增卡若需多跳子图，用 `slice-planner` 自动生成。
6. **与规则数据文档配套**：本文 ruleIds ⟷ `DATA-rules-13-undefined-definitions.md` 的定义 + SOLVER_RULE_REFS，两文档合用才闭"规则环"。

> 状态：P1/P2 卡数据草案。render 投影字段🟢接地于输出契约；嵌套子字段🟡落地核对。属 `PRD-scenario-ontogenesis.md` 的数据补全。
