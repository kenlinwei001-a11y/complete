# MODE-DISPATCH-HONOR · 意图 mode 派发失守（审计簇⑦）治本 FDE 实证

> 2026-07-05 · 真起双服务（datacore :4801 SEED_DEMO=1 + agentcore :4802·内存模式）·**真 Kimi**（openai_compatible
> kimi-k2.6·KIMI_API_KEY 运行期 env·不入 git 不回显 R5）。全部数值来自 live curl，逐值粘贴、非转述。

## 根因（审计簇⑦）与治

- `intents/materialize` 钉死 7 意图 AGENT_FIRST（审核方 13/7 表），但 `scenarios-catalog.ts scenarioFromCard`
  一揽子 `mode:"WORKFLOW_FIRST"` 且 `orchestrator` 分发只看 `scene.mode` → 审计实测 10/10 走 Path A，
  yield_diag/maint_stagger/outsourcing_q/capex_review/quarterly_gap_q 的「为什么/哪个好/怎么选」拿工作流表格。
- 治（不重定 modes·只让派发尊重既有表）：
  1. 钉死表移 `apps/agentcore/src/intents/intent-mode.ts`（**唯一真相源**·materialize re-export 兼容），
     `scenarioFromCard` 的 mode 改 `intentModeFor(intentKey)` 派生 → 一等 Scenario 投影不再撒谎；
  2. `orchestrator.proceedWithIntent`（意图已解析的唯一分发点）先查一等权威
     `repos.materializedIntents.byKey(tenantId, intentKey)`（R14 数据驱动·读可编辑一等对象非硬编码表）：
     PUBLISHED + AGENT_FIRST + 绑定 agent 已发布 → `runConfiguredAgent`（与 runSceneAgent 共用单一机制·
     agentRun.agentId 持久化·AGENT-UNIVERSAL C2 同坐标系）；缺一等 Intent/agent 不可用 → 回落既有链。

## ① 投影与物化层：mode 不再互相矛盾（live 逐值）

`GET /b/v1/scenarios`（demo·20 卡）：

```
AGENT_FIRST cards: S03:risk_root_cause, S05:plan_recommend, S12:yield_diag, S13:maint_stagger,
                   S14:outsourcing_q, S17:capex_review, S19:quarterly_gap_q
WORKFLOW_FIRST count: 13
```

`GET /b/v1/intents`（demo·20 一等 Intent）：

```
intents total: 20  agent-first: 7  workflow-first: 13
agent-first bindings: capex_review→agt_plan_generate, maint_stagger→agt_risk, outsourcing_q→agt_plan_generate,
  plan_recommend→agt_plan_generate, quarterly_gap_q→agt_quarterly, risk_root_cause→agt_risk, yield_diag→agt_risk
```

（治前：同一 20 卡 mode 全 WORKFLOW_FIRST，与物化 Intent 13/7 矛盾。）

## ② 被审计的 5 个 agent-first 意图：live 真跑全部走 agent-first（真 Kimi·COMPLETED）

自由问句 `POST /b/v1/queries`（view 按卡）→ 逐条终态与 routing.completed（SSE 持久事件原文）：

| intentKey | taskId | classify | 终态 | routing.completed（原文） | resolvedRefs agent（C2 坐标系） |
|---|---|---|---|---|---|
| yield_diag | task_01KWRCVHW9VYX0NN1GP31EENGM | `dcp:llmp_…:kimi-k2.6` conf 0.98 | COMPLETED·path=AGENT | `{"path":"AGENT","intentKey":"yield_diag","note":"意图权威模式 AGENT_FIRST（一等 Intent yield_diag）"}` | `{"kind":"agent","key":"risk_agent","version":1}` |
| maint_stagger | task_01KWRCZ76PAKMQ43PN5F24TGM0 | 真 Kimi | COMPLETED·path=AGENT | `{"path":"AGENT","intentKey":"maint_stagger","note":"意图权威模式 AGENT_FIRST（一等 Intent maint_stagger）"}` | `{"kind":"agent","key":"risk_agent","version":1}` |
| outsourcing_q | task_01KWRD2G7EZY715JS86FJNMRRK | 真 Kimi | COMPLETED·path=AGENT | `{"path":"AGENT","intentKey":"outsourcing_q","note":"意图权威模式 AGENT_FIRST（一等 Intent outsourcing_q）"}` | `{"kind":"agent","key":"plan_generate_agent","version":1}` |
| capex_review | task_01KWRD2GADSTM748TAF2AG9KTP | 真 Kimi | COMPLETED·path=AGENT | `{"path":"AGENT","intentKey":"capex_review","note":"意图权威模式 AGENT_FIRST（一等 Intent capex_review）"}` | `{"kind":"agent","key":"plan_generate_agent","version":1}` |
| quarterly_gap_q | task_01KWRCZ790K82422S49QYNVR42 | 真 Kimi | COMPLETED·path=AGENT | `{"path":"AGENT","intentKey":"quarterly_gap_q","note":"意图权威模式 AGENT_FIRST（一等 Intent quarterly_gap_q）"}` | `{"kind":"agent","key":"quarterly_agent","version":1}` |

- resolvedRefs 的 agent key 与一等 Intent 绑定逐一对上：agt_risk=risk_agent、agt_plan_generate=plan_generate_agent、
  agt_quarterly=quarterly_agent（agentRun.agentId 持久化由进程内 HTTP 级齿检逐值断言，见下「牙齿」）。
- yield_diag decision-trace：`path=AGENT · toolCalls: invoke_solver:OK, search_knowledge:OK, load_skill:OK`——
  agent **真调工具推理**，非工作流表格。答案首段（真 Kimi·真值溯源）：
  「涂布良率在第31天出现断点，环比下降5.71个百分点…最可能的根因为第33天发生的**换批**事件。关联规则
  「C30 良率连降停线评审」当前未触发（NOT_APPLICABLE）…本次诊断数据为合成数据（MOCK），结论仅供推演参考」
  （诚实标注数据来源·KILL-MOCK-RED 边界自守）。
- outsourcing_q 答案给出**取舍推理**「缺口 8 万套优先『外协』补量，但不可全量外协；自产扩产已证伪…对比五条
  路径的求解器结果」——正是 agent-first 的「哪个好/怎么选」价值（治前拿到的是一张 Path A 求解器表）。
- **点卡路径同样尊重**：`POST /b/v1/scenarios/S12/launch` → task_01KWRDYGS521HATXVX8CH02YNZ →
  COMPLETED·path=AGENT·同 note（确定性 scenario-bind 分支也过同一分发点）。

## ③ workflow-first 零回归（live 对照组）

- 自由问句 `4680-NCM 加 20% 六周能不能接？`（capacity_feasibility·钉死 WORKFLOW_FIRST）→
  task_01KWRCYA05MRBZQSPJN3SBGYFC：COMPLETED·**path=WORKFLOW**·trust=VERIFIED_WORKFLOW·
  routing.completed=`{"path":"WORKFLOW","intentKey":"capacity_feasibility","confidence":1}`·
  答案首行仍带 LAUNCHER-SLOT-TRUTH 参数回显「本次回答所用参数：型号=4680-NCM、需求增量=0.2、周数=6」。
- 点卡 `POST /b/v1/scenarios/S02/launch`（affected_orders）→ task_01KWRDY0F6NCEN7B0W8ZG4KS0A：
  COMPLETED·path=WORKFLOW·VERIFIED_WORKFLOW·**表 6 行**（==已知常州真值 6 张·与 LAUNCHER-SLOT-TRUTH
  实证一致）。
- 13 个 workflow-first 键在物化层全部 WORKFLOW_FIRST（门 `scene-agent-config:check` ⑤ mode=钉死表继续守·
  齿 ② 逐键断言）。
- 边注（非本单回归）：自由问句 affected_orders 带 chip 时 live 走 SLOT_FILLING 澄清（entity-resolution 链·
  与本单无关，dispatch 代码路径对 WORKFLOW_FIRST 意图零改动；澄清链修复属在飞 WO CLARIFY-CHAIN-FIX）。

## 牙齿（revert→red 已双向自证）

`apps/agentcore/test/mode-dispatch-honor.test.ts`（9 例·进程内 HTTP 级·scripted LLM）：
① 5 个被审计意图分类命中 → path=AGENT + note=意图权威模式 + **agentRun.agentId==该意图绑定 agent**（逐值）；
② affected_orders 照旧 Path A + 13 workflow-first 物化 mode 逐键断言；
③ mode 单一来源：materialize re-export 与 intent-mode **同一对象** + `seedScenarios` 20 卡 mode==钉死表
  （agent-first 卡集合 == 7 键集合）；
④ 权威=一等对象：repo 中把 yield_diag 的 mode 编辑回 WORKFLOW_FIRST → 分发跟随走 Path A（数据驱动非硬编码）；
  未物化租户 → 回落既有链。
自证：临时回退 orchestrator 分发（不读一等 Intent）→ ①5 例红；临时回退 scenarios-catalog 一揽子
WORKFLOW_FIRST → ③红；恢复后 9/9 绿。

## 门与全量

- `pnpm -r build` 4 包绿；agentcore `npx vitest run` 88 文件 470 通过（+本单 9）；datacore 940 / frontend 456 绿。
- `pnpm gates` exit 0（含 `scene-agent-config:check`：13 入口 + 20 Intent 全绑定链 + 兜底终点绿——该门本就
  校验 Intent mode=钉死表、未编码簇⑦缺陷，零改动）；`pnpm ontology:slices` 已同步（hash f7c4052c61ac8828）。
