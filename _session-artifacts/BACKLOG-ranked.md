# 待开发 / 开发中但中断 · 排序 Backlog

> 生成 2026-07-16 · 审核方综合 · 数据源:`docs/DEBT-ledger.md`(用户明确提过的欠条 A/B 区) + 本体 `SYSTEM-ONTOLOGY.md §8` 未修断点(G-N) + PRD 库(85 篇) + 本会话新暴露的地基问题。
> 状态图例:⬜ 未做 · ◐ 半通(开发中/中断) · 🔒 阻塞在用户(我做不了) · 🆕 本会话新暴露。
> 说明:正线 = `claude/vigilant-knuth-b1nmxn`(`735231e`)。带「待正线复核」= 状态取自会话线/欠条,需在当前正线代码上确认。

---

## P0 · 地基(不修则交付门形同虚设 / 有丢代码风险)

| # | 事项 | 状态 | 实情 / 为什么 P0 |
|---|---|---|---|
| P0-1 | **四包全绿底座塌了** | ◐🆕 | 正线 **37 测试红**(datacore 30 + frontend 7)。切分已定:**31 是历史欠账**(Workshop/Equipment 本体代码超前于金值测试),**6 是 735231e 引入**(700亿需求-scale 断言未同步)。5 个分类 agent 正跑,出逐项清单后重新基线。**在立起"已知全绿"前,"四包全绿是交付底线"这条铁律是空门。** |
| P0-2 | **多副本代码合流未闭环** | ◐🆕 | 5 处本机副本已抢救:`complete-app-recovery`(30 文件)+ `complete-repo-recovery`(SA-3 Workshop/SA-6 Equipment/agentcore-fix 3 提交 + battery.ts)已推 GitHub。**但未 diff/判定哪些独有需合并进正线**;`/Users/apple/complete` 的 700B 续作待过 handoff。 |
| P0-3 | **handoff 审核管道未跑通一轮** | ◐🆕 | 管道刚立(`claude/handoff` 已建),协议已发本机 agent。需真跑一轮 push→四包绿复验→合 `b1nmxn` 闭环验证有效。 |

---

## P1 · 用户明确提过、整块未做(DEBT-ledger A 区 ⬜ / 亲点)

| # | 事项 | 状态 | 实情 | PRD/来源 |
|---|---|---|---|---|
| P1-1 | **A3 · 14 域参考运营本体 + 域内/跨域两库 + 多跳切片规划器 + 切片索引复用** | ⬜ | 用户"最新需求"**整块未动**。当前切片=单根/全字段覆盖根,**无图路径搜索的多跳切片规划器**、无两库读模型、无切片索引复用。**最大单块**,是 FDE"富多跳切片"的载体。 | DEBT A3 · PRD-live-traceable-data / PRD-data-closure-spec |
| P1-2 | **A5 · FDE 编排工作流(可观测节点图·有保证终态)** | ⬜ | 无一条显式、节点状态可视、有保证终态的 FDE 工作流(意图→倒推→查能力→比差→各模块生成→回填节点→进启动器)。 | DEBT A5 · PRD-fde-fullstack-build-workflow / PRD-build-workflow-runtime |
| P1-3 | **角色化多智能体团队(CEO agent / base-planner agent / …)** | ⬜ | 用户亲点(之前 PRD 要求建 CEO agent、base planner agent 等)。现有 **17 场景助理 ≠ 角色化团队**。需按角色建有身份/权限/职责的 agent 团队。 | 用户亲点 · PRD-addendum-agent-runtime |
| P1-4 | **A4 · 对象/类型浏览器管理页(admin)** | ⬜ | 用户实测"找不到"。无 admin 对象浏览页(列已发布类型 + 物化计数 + 下钻实例);对象图仅 `/v/graph` 业务视图。 | DEBT A4 · PRD-ontology-browser-field-coverage |
| P1-5 | **A1 · 封装引擎暴露为 MCP 工具** | ⬜ | OR-Tools sidecar 已封装为平台 API + datacore 求解器,但**未注册成 MCP server**、MCP 页看不到、agent 经 mcp-router 调不到。("封装成 API 就要在 MCP 工具里看到,包括 API") | DEBT A1 · PRD-addendum(B3 MCP) |
| P1-6 | **CAPSIM 前端 parity 补漏** | ◐ | 正线 CAPSIM"产能推演"看板已真数据彩色渲染(本会话截图证)。但早前 gap 分析的漏项:**QA 面板接真 agent(非本地正则)· 富逐日 hover showDayTip(事件脉冲+订单明细)· 四增强(多方案比较矩阵/缺失面板/全元素溯源/过程图真provenance)· 导出最终规划 button**。待正线复核。 | 用户核实 diff · PRD-cockpit-capacity-1to1-parity |

---

## P1 · 半通 / 开发中断(DEBT-ledger A 区 ◐ + 本体 §8 未修断点)

| # | 事项 | 状态 | 实情 | 来源 |
|---|---|---|---|---|
| P1-7 | **§8 G-6 · Excel parser / 数据模版 FK 驱动 / rawin** | ◐ | Excel parser TODO;合成在独立页;rawin 用独立 genCsv;数据模版/FK 驱动待补。 | 本体 §8 G-6 |
| P1-8 | **§8 G-9 · 场景卡走 R16 发育闭环** | ◐ | 闭包靠一次性手装播种(意图/计划写死 seed),非真"倒序发育长全闭包"。 | 本体 §8 G-9 |
| P1-9 | **§8 G-10 · 规则一等可编辑引用** | ◐ | 规则被引用/被写死,但非一等可编辑引用 → 关联规则半空、规则闸半空(部分求解器仍诚实 NOT_APPLICABLE)。 | 本体 §8 G-10 |
| P1-10 | **§8 G-8 · 数据构建闭包不验全链** | ◐ | 闭包仅 DataCore 栈、不验全链(大部已闭:chain:check 跨服务)。 | 本体 §8 G-8 |
| P1-11 | **§8 G-5 · 应用层电池锁死(视图结构写死)** | ◐ | 大部修(R14 debattery:check 守),仍有视图结构/DAG 写死残面。 | 本体 §8 G-5 |
| P1-12 | **§8 G-3 · 场景启动器 / presetContext 注入 QOS** | ◐ | 大部修(P1 SessionContext);presetContext 注入 QOS 收尾。 | 本体 §8 G-3 |
| P1-13 | **§8 G-12 · 优化融合确定性 what-if** | ◐ | 有确定性派生 what-if(optimize_whatif),融合域收尾。 | 本体 §8 G-12 |
| P1-14 | **A10 · 终态闭环末步"重跑验证真能推演"** | ◐ | "建域→R4 审批→publish→**自动重跑问句验证**"未全自动化、未亲手全程跑通。 | DEBT A10 |
| P1-15 | **A15 · 工业级压测(规模/并发/负载)** | ⬜ | 工作流运行时/ModuleProvisioner/gap_analysis/异步执行只有功能单测+集成(20 条),**无规模/并发/负载压测**。 | DEBT A15 |
| P1-16 | **A17 · 成文测试标准 TESTING-STANDARD.md + 修正过期数字** | ⬜/◐ | CLAUDE.md "4 包全绿"数字**已过期**(69/66/25+ vs 实际 458/265/181);无单一成文标准。**与 P0-1 强相关**。 | DEBT A17 |

---

## P2 · 次要 / 依赖前置

| # | 事项 | 状态 | 实情 | 来源 |
|---|---|---|---|---|
| P2-1 | **A16 · 真浏览器 UI E2E 进 CI** | ◐🔒 | 脚本 9/9 过;🔒 待用户拍板 E2E 进 CI vs 夜间(需起三进程 + Chromium 缓存)。 | DEBT A16 |
| P2-2 | **A6 · 拟真值域合成数据** | ◐ | 通用合成仍 hash 值域(demandDelta=390 类),非"落业务区间 + 恰当越线样本"。 | DEBT A6 |
| P2-3 | **A7 · B 栈 scaffold 单机可见** | ◐ | 需配 `AGENTCORE_BASE_URL+SERVICE_TOKEN` 才跨系统生成,否则本地看不到生成的 agent。 | DEBT A7 |
| P2-4 | **A8 · 更多最优化模型(assignment/sequencing/packing)** | ◐ | CP-SAT sidecar + 5 核心已落(46 求解器);订单分配/换型排序/装箱待扩。 | DEBT A8 |
| P2-5 | **A11 · 连接打 Connection.category 标签(per-connection)** | ⬜ | 分类层(组织+模版+模式)已成,单个连接尚未带 category。 | DEBT A11 |
| P2-6 | **A12 / A19 · hand-run 验收登记 + §3 测试登记随 PR 常态化** | ◐ | 数据构建/求解器已记;连接器/对象浏览/Agent 页逐一 hand-run 未补;§3 登记未接进 PR 模板。 | DEBT A12/A19 |
| P2-7 | **6-phase EDS 三条道总 epic** | ◐ | 仅评审稿 + 源文件落档,无总 epic;部件散在 LaneB。 | 会话补登 |

---

## P3 · 已定调暂缓 / 可选

| # | 事项 | 状态 | 实情 | 来源 |
|---|---|---|---|---|
| P3-1 | **A9 · 8b 传导 Datalog / 8a 图库 Neo4j / 8e 因果 DoWhy** | ◐ | Q1/Q2/Q3/Q5 已由净室求解器覆盖;Soufflé/Neo4j/DoWhy **已定调"默认不全上"**(规模/精度顶不住再上)。 | DEBT A9 · §8 |
| P3-2 | **A2 · comprehend 地板认新求解器(残)** | ◐ | 大部 ✅;concentration_risk/supplier_disruption_radius 地板语义仍依赖 Kimi。 | DEBT A2 |
| P3-3 | **图查询低代码 / 平台查询语言 / Query→Skill 绑定** | ⬜ | 诚实 RESERVED,后端整块未建(前端未画假壳)。 | 会话补登 U12 |

---

## 🔒 阻塞在用户(B 区 · 我做不了)

| # | 事项 | 为什么 |
|---|---|---|
| B2 | **泄露的 Gemini / Kimi key 轮换/吊销** | 外部凭据安全,必须你在 Google / Moonshot 侧吊销/换。**(会话中 key 已泄露,请尽快轮换。)** |
| B3 | **浏览器像素级 hand-run** | 沙箱无浏览器;本会话已用真 Chromium 截图部分缓解,但像素级仍需你侧。 |

---

## 排序逻辑(为什么这么排)
1. **P0 先于一切**:测试红底座 + 合流 + handoff 是"地基"——地基不稳,下面任何特性交付都无法用"四包全绿"验收,且有丢代码风险。
2. **P1 = 用户亲点 × 整块未做**:A3/A5/A4/A1 + 角色化 agent 团队,都是你反复提过、且是"能用系统"的骨干缺口。
3. **§8 断点**穿插进 P1:它们是架构接缝上的真断点,断在接缝而非模块内(本体铁律 0)。
4. **P2/P3** = 次要、有前置依赖、或已定调暂缓。
5. **🔒 B 区**单列:纯外部/环境限制,我做不了,需你动手。

> 建议下一步:P0-1(重新基线立绿底座)与 P0-2/3(合流+handoff)并行推进;P1 里先拍 **A3 vs 角色化 agent 团队** 谁先(两者都大),我据此派工。
