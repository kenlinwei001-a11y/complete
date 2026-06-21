# 00 · START HERE · 开发包导读（其他 agent 先读这一页）

> 本包 = 一套**可直接开工**的 PRD 套件 + 施工规程。读完本页即知**开工顺序**与**每份开发什么**。

## 一、必读顺序（开工前，不可跳）
1. `CLAUDE.md` —— 项目铁律 + 架构地图 + 命令。
2. `SYSTEM-ONTOLOGY.md` —— 系统接线单一来源（对象/链路/事件/不变量 R1–R15/门禁/断点/域）。**任何跨模块改动前必读（铁律 0）。**
3. `DEV-SOP-and-LOOP.md` —— **施工总规程**：每份 PRD 必走「阅读→开发→工业级检测(含前端 UI 亲手跑通)→回写→提交」闭环。
4. `PRD-A-series-roadmap.md` —— **开工顺序总纲**（依赖 DAG + 4 波次 + 全局裁决）。
5. `_PRD-TEMPLATE.md` —— 新增 PRD 必用模板（§0 含 CLI 打通 R15 必填）。

## 二、开工顺序（严格按波次；同波可并行，跨波须前波 DoD 全绿）
| 波 | PRD | 开发什么（一句话） |
|---|---|---|
| **W1 基座** | `PRD-A3-reference-ontology-slice-planner` | 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器(图路径搜索) + 切片索引 |
| | `PRD-A6-realistic-value-domain-synthesis` | 拟真值域合成 + 确定性植入越线样本（通用路富化） |
| | `PRD-A11-per-connection-category` | 连接创建打 `Connection.category`（允许自定义值） |
| **W2 引擎** | `PRD-A1-solvers-as-mcp-tools` | 28 求解器暴露为 MCP 工具（MCP 页可治理、mcp-router 可调） |
| | `PRD-A8-more-cpsat-models` | 扩 CP-SAT：assignment/sequencing/packing |
| | `PRD-A13-floor-semantics-deterministic` | concentration_risk/supplier_disruption_radius 地板语义去 Kimi（确定化） |
| | `PRD-A4-object-type-browser` | 对象/类型浏览器（列类型+物化计数+下钻实例） |
| **W3 编排** | `PRD-A5-fde-orchestration-workflow` | FDE 编排可观测节点图（意图→倒推→查能力→比差→各模块→进启动器） |
| | `PRD-A7-bstack-scaffold-standalone` | B 栈 scaffold 单机可见（不配 AGENTCORE_BASE_URL 也看得到 agent） |
| | `PRD-A10-build-to-verify-closure` | 终态闭环：建域→R4→publish→自动重跑问句验证 |
| **W4 验证** | `PRD-A14-agent-evals-handrun` | 亲手跑 agent evals 比对 PRD（真 Kimi env-gated，parity 报告） |
| | `PRD-A12-module-handrun-completion` | 其余模块逐一 hand-run 补全（连接器/对象浏览/Agent 页…） |
| | `PRD-A9-external-engines-design-deferred` | 外部引擎(Datalog/图库/因果)**仅设计延后**（不实现） |
| **W5 CLI/intake** | `PRD-A15-cli-universal-operation-shell` | CLI 通用操作外壳（一切经 CLI：意图→路由→交互→触发；含推演问答；全模块对等） |
| | `PRD-prototype-intake-databuilder` | 原型 intake 正门 + schema 对账 HITL（上传 HTML→抽数据/关系→建域，字段不符弹人确认） |
| **特性（已 APPROVED，可独立排期）** | `PRD-cockpit-capacity-1to1-parity` | 经营驾驶舱 + 产能推演 参考原型 1:1 复刻（数据全链闭环） |
| | `PRD-synthetic-wizard-ontoprompt-chain` | 合成向导「生成进度」按 nano-ontoprompt 分阶段链重设计 |

> 依赖要点：A3 是 A4/A5/A10 前置；A1 是 A8/A7 暴露口；A13 让 A14 去抖；A15/intake 复用 A3/A5/A10；cockpit 复用 A3 域框架。详见 roadmap §1 DAG。

## 三、全局裁决（已定，写死）
- **A9** 仅设计延后（不引真依赖，守 R6 自包含）。
- **A1** 全部 28 求解器注册为 MCP 工具。
- **A3** 参考原型 16 域裁成 14 业务域。
- **A11** 连接 category 允许自定义值。
- **A15** 意图路由 = 服务端轻端点 `POST /b/v1/operations/classify`；"求解器上传"**不做 CLI 子命令**，改 **CLI 输出深链跳 GUI 求解器上传页**（§3.6）。
- **R15 CLI 对等** 已固化为本体不变量 + `cli-parity:check` 门 + PRD 模板必填：**今后每个新功能都必须 CLI 打通（或登记 GUI 深链）**。

## 四、施工纪律（一句话）
**绿测试 ≠ 能用。** 每份 PRD 必须**亲手在真服务/真 UI 用一遍**（含前端点到、CLI 敲到、数字可溯、事件实时），并**回写本体**，才算 DONE。详见 `DEV-SOP-and-LOOP.md` §6。

## 五、开工前需负责人定的两件事
1. **基线分支**：`wizardly-gauss`（推荐，超集）或 `vigilant-knuth`——涉 migration 序号 / `generateBattery` 字节回归 / `SyntheticPage` 分叉，**动手前必须定准**。
2. 每份 PRD 末尾若有「需你确认」未决项，先与负责人确认再进 ③ DEV。
