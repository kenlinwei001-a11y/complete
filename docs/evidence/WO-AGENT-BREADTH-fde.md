# WO-AGENT-ASSET-BREADTH（R16·agent 资产广度 + 全 LLM 入口场景预配）FDE 证据

> 施工范围全在 `apps/agentcore/src/mocks/seed.ts`（出厂种子单一来源）。委派机制（runPathB→runSceneAgent）、
> 幂等播种（main.ts）、配置门（scene-agent-config:check）此前已就位，本单只补配置数据。

## 1. 资产计数（前 → 后）

| 资产 | 前 | 后 | 说明 |
|---|---|---|---|
| 出厂 agent | 7 | **14** | 12 场景 agent + 2 兜底 analyst（agt_seed_analyst/agt_seed_explore）。WO §2.4 文案"13 agent"未计 2 兜底 analyst，实际 14。 |
| 出厂 skill | 1 | **5** | 补 skl_risk_diagnosis / skl_sop_balance / skl_order_margin / skl_plan_scheme；各场景 agent 挂对口方法论。 |
| 出厂 workflow | 1 | **3** | 补 wf_seed_risk_scan / wf_seed_sop_balance；挂到 agt_risk/agt_sop_balance（WORKFLOW 工具不再仅 analyst 独有）。 |
| 场景入口 | 9 | **13** | 新增 scn_annual / scn_quarterly / scn_order_chain / scn_geo_map（4 无入口 LLM 业务视图）。 |
| 入口带 defaultAgentId | 6/9 | **13/13** | 补 scn_plan_generate / scn_project_sim / scn_review + 4 新入口全带；全覆盖。 |

live API 核对（内存态双服务）：

```
$ curl -s /b/v1/agents  → count 14
  agt_seed_analyst, agt_seed_explore, agt_plan_audit, agt_dash, agt_risk, agt_order,
  agt_sop_balance, agt_plan_generate, agt_project_sim, agt_review, agt_annual,
  agt_quarterly, agt_order_chain, agt_geo_map
$ curl -s /b/v1/skills → count 5
  skl_seed_capacity, skl_risk_diagnosis, skl_sop_balance, skl_order_margin, skl_plan_scheme
$ curl -s /b/v1/workflows → count 3
  wf_seed_capacity, wf_seed_risk_scan, wf_seed_sop_balance
$ curl -s /b/v1/scene-entries → count 13（全部 defaultAgentId 非空）
  dash→agt_dash · risk→agt_risk · order→agt_order · graph→agt_seed_analyst(AGENT_FIRST)
  plan-audit→agt_plan_audit · plan-generate→agt_plan_generate · project-sim→agt_project_sim
  sop-balance→agt_sop_balance · review→agt_review · annual-scenario→agt_annual
  quarterly-rolling→agt_quarterly · order-chain→agt_order_chain · geo-map→agt_geo_map
```

## 2. 门绿 + green→red 自证

```
$ pnpm --filter agentcore build   → 绿（全 4 包 pnpm -r build 亦绿）
$ node scripts/check-scene-agent-config.mjs
  ✓ scene-agent-config:check 通过（13 个对话入口配置一致：无 WORKFLOW_ONLY ·
    defaultAgentId 均指向已发布 agent · 工具/规则绑定合法）。
```

**故意配半截 → 门红 → 还原**（防"绿测试≠能用"）：

```
# 把 scn_geo_map.defaultAgentId 改成不存在的 agt_MISSING（dist）
$ node scripts/check-scene-agent-config.mjs
  ✗ geo-map(scn_geo_map): defaultAgentId=agt_MISSING 在出厂注册表中不存在（半截配置·指向缺失 agent）
  exit=1
# 还原
$ node scripts/check-scene-agent-config.mjs
  ✓ scene-agent-config:check 通过（13 个对话入口配置一致…）
```

测试：`pnpm --filter agentcore test` → **Test Files 75 passed | 1 skipped；Tests 355 passed | 1 skipped**（66 底线不回退）。

## 3. 路由证据（抽样 ≥3 新配入口·真起双服务 mock）

内存态起 datacore(4001)+agentcore(4002)，对新配入口发预设意图外的开放式问句，抓 SSE `routing.completed`：

| 入口 view | 开放问句 | routing.completed note |
|---|---|---|
| plan-generate | 保毛利和保规模到底怎么选，给我管理动作 | `{"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}` |
| geo-map | 哪个基地产能利用率最高、瓶颈在哪，帮我梳理一下 | `{"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}` |
| review | 到货危机当时是怎么闭环的，有哪些可迁移经验 | `{"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}` |
| order-chain | 常州基地影响哪些订单，四类问题怎么分布 | `场景入口模式 WORKFLOW_FIRST` |
| quarterly-rolling | 本季度缺口在哪、怎么补 | `场景入口模式 WORKFLOW_FIRST` |
| annual-scenario | 三情景哪个更稳，触发条件是什么 | `场景入口模式 WORKFLOW_FIRST` |
| project-sim | 4680-NCM 加 20% 六周能不能接，缺口怎么补 | `场景入口模式 WORKFLOW_FIRST` |

`场景入口模式`（orchestrator.ts:837 runSceneAgent 路径）而非通用 `进入探索模式`（orchestrator.ts:703），
证明 WORKFLOW_FIRST 命不中预设意图时回落到该页专属场景 agent（非通用探索 agent）。

## 4. 诚实边界（真 Kimi 富答案留审核方 FDE）

- **本单坐实**：出厂配置正确（13/13 入口全带 PUBLISHED defaultAgentId·工具∈注册表·ruleBindings 合法·
  skills 挂对口方法论·model 引用现有 agent 的 model 字段非字面量）+ 委派路由正确（runSceneAgent 命中）+
  资产广度落库（5 skill / 3 workflow / 14 agent 经 live API 核对）+ 门绿（含 green→red 自证）。
- **留审核方 FDE**：场景 agent 的"接地富答案"真实质量（引求解器真值 + 规则裁决 + ⟦ref:N⟧ 溯源、非通用泛答）
  需真 Kimi/Anthropic（env-gated）。mock 环境 LLM 一律 mock（R6），本单不宣称富答案质量已验。
- **rules ⊆ 已发布** 是跨系统运行期校验（规则在 DataCore）；agentcore 侧门只静态校 ruleBindings 形态。
  ruleKeys 选码依据 `scenarios-catalog.ts` 目录卡口径（C01–C33），不新造规则。

## 本体引用与影响

- **链路**：L4 场景入口链——只增出厂 SceneEntryConfig + AgentDefinition/SkillDefinition/WorkflowDefinition 数据，
  走既有 main.ts 幂等播种，不改事件拓扑。QOS 路径 B 委派链机制不变。
- **对象类型（B 侧配置对象）**：SceneEntryConfig / AgentDefinition / SkillDefinition / WorkflowDefinition
  （@platform/contracts）——只增实例，不改 schema。
- **不变量**：R16（发育闭环资产广度补齐·6/13→13/13·1→5 skill/1→3 workflow）· R2（tenant everywhere·全 SEED_TENANT）·
  R6（静态常量·无 Date.now/随机·LLM 全 mock）· R3（新入口经 viewAllowed 在功能关时标 inactive）。
- **断点**：闭 G-3/G-9（半截场景配置·资产洼地）。
- **回写**：不改 SYSTEM-ONTOLOGY.md 结构；仅 §8 G-3/G-9 行更新全入口覆盖进展 + 资产广度实数。
