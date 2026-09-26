# PRD · 经营目标-指标-责任闭环骨架（Goal–Metric–Owner Spine）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 全栈（本体+生成器+求解器+前端绑定） |
| 性质 | **横切骨架**——不是又一个业务视图，而是把"目标→KSF→子目标→指标(目标vs实际)→数据源&责任人"串成一等对象**绑定脊柱**，被所有现有视图复用；强制遵 R-一致（一个事实一个出处）与 R13（溯源），**派生投影而非新真值源**。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2 对象类型 / §3 链路 / §5 R-一致·R13·R14·R4 / §8 G-5）· `docs/reference-prototype-decision-platform.html`（决策域一等对象 L1185-1196：经营KPI/待解决问题/KSF要素/经营方案/问题传播时序；KSF 五要素 L4405-4430；行动行 owner L3427-3450）· `apps/datacore/src/synthetic/battery.ts`（`PlanTarget` :494/:1163 · `FinanceMetric` :706）· `apps/datacore/src/synthetic/data-categories.ts:21`（PlanTarget 已配 FILE_UPLOAD+rest_api）· `apps/datacore/src/ontology-governance.ts:707`（域 owner 会签） |

> 一句话：每个前端展示（驾驶舱八卡 / S&OP 三线 / 规划体检行动行 owner / 规划建议 KSF 图 / AOP 目标分解）都在**隐式依赖**一条"目标-指标-责任"脊柱，但脊柱本身从未建成一等对象——导致同一指标在各视图靠各自代码拼（违 R-一致）。本 PRD 把脊柱显式化：**复用**已有的 `PlanTarget`（目标/子目标树）和 `Connector`（数据源对接+上传），**新增/提升** 3 个一等对象 `KSF`/`Metric`/`Principal`，用链路 `Goal→KSF→SubGoal→Metric→{DataSource,Owner}` 收编所有散落 KPI。指标实际值**必走数据源→物化→派生**（R13/R14），指标是**派生投影非新真值**（R13）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：
  - **复用**：`PlanTarget`（=目标/子目标树，已落库）·`Connector`（=数据源，对接 rest_api/jdbc/erp/crm + 上传 csv/json/xlsx，**禁止重造上传门**）·`RawDataset`/`ObjectInstance`/`DerivedProperty`（实际值血缘）·`FinanceMetric`（财务域既有，作为 Metric 的财务子集来源，不并吞）。
  - **新增/提升一等对象**：
    - `KSF`（决策域，关键成功要素，HTML 五要素：需求结构/产销爬坡/物料齐套/信用现金/成本外协）——把 audit/generate 的临时 `KsfGraph` 装配**提升为持久对象**。
    - `Metric`（指标库一等对象）：`{key, name, unit, level, target, actual, delta, miss, dataSourceRef, ksfRef, ownerRef, asOf, ruleRefs}`——**目标 vs 实际达成的单一出处**。
    - `Principal`（责任人/责任主体）：`{principalId, name, kind(org/role/person), parentRef}`——收编 audit 行动 owner、风险卡 owner、域签 ownerUserId。
- **触及链路**（§3，新增一条骨架链）：
  `战略目标 Goal —decompose→ SubGoal(PlanTarget) —drivenBy→ KSF —affects→ Metric{target←目标树, actual←数据源派生, delta/miss←派生} —sourcedFrom→ DataSource(Connector) & —ownedBy→ Principal`；越线 `Metric.miss → plan_rootcause/risk_timeline 推演 → 行动派 Principal → 执行回采更新 actual → 收敛`。
- **触及事件/数据流**（§4）：复用 `connection.sync_completed`/`raw_dataset.uploaded`（实际值入口）；新增 `metric.snapshot_recorded`（指标快照，actual 更新）与 `metric.breached`（越线触发推演）。
- **触及不变量**（§5）：
  - **R-一致（核心动因）**：同一指标在驾驶舱/S&OP/体检口径一致——本骨架即其落地载体（单一 `Metric` 对象 + 聚合下推）。
  - **R13**：`Metric.actual` 血缘可查到 `DataSource→RawDataset→RawRow`；指标是派生投影**非新真值源**。
  - **R14**：指标口径/目标值/KSF 文案/owner **配置化**，前端零写死（HTML 精确值仅作生成器种子）。
  - **R4**：目标定稿 / 责任绑定 / 越线行动 走 Action 审批才写真相。
  - **R2**：Metric/Principal 全部带 tenantId，跨租户 403/404。
- **关闭/影响断点**（§8）：**G-5（应用层电池锁死）**——把散落在 DashboardView/SopBalanceView/PlanAuditView 等的 KPI 硬编码收归 `Metric` 派生，消多处写死；与各 1:1 复刻 PRD（cockpit `PlanKpi`、audit/generate `KsfGraph`）**归一**：`PlanKpi` 即 `Metric` 在 plan 域的投影，`KsfGraph` 即 `KSF` 对象的图渲染。
- **门禁**（§7）：`prd:check`·`ontology:check`（KSF/Metric/Principal 登记 + 链路登记）·`chain:check`（metric_rollup/plan_rootcause 注册）·`debattery:check`（各视图改读 Metric 后前端零业务常量）·前端回归（各视图 KPI testid 不破）·FDE 亲手跑闭环（定目标→喂数据→越线→推演→派责任→回采）。
- **回写承诺**：KSF/Metric/Principal 三对象 + 骨架链路 + 两事件落地 → 回写本体 §2/§3/§4；R-一致 由"约定"升级为"有载体强约束"，回写 §5 备注。

## 1. 目标 / 非目标
### 目标
1. **指标库一等对象 `Metric`**：统一承载"业绩目标(target) vs 实际达成(actual) + 差异 + 越线 + 责任人 + 数据源 + KSF 归属"，成为**所有视图 KPI 的唯一出处**（R-一致）。
2. **KSF 提升为持久对象**：取代 audit/generate 的临时图装配；"问题→KSF→财务指标"成为可溯一等图。
3. **责任人结构化 `Principal`**：收编各处 owner 字符串与域签，目标/指标/行动可挂责任主体并问责。
4. **目标树复用 `PlanTarget` 扩展**：补 KSF 归挂 + 子目标语义，不另造目标对象。
5. **数据源复用 `Connector`**：指标实际值经"对接 or 上传"入管线（已支持），新增"指标←数据源"血缘连线；**不重造上传/对接模块**。
6. **闭环可跑**：定目标 → 数据源喂实际 → 指标算差异/越线 → 越线触发推演（plan_rootcause/risk_timeline）→ 行动派责任人 → 执行回采更新实际 → 指标收敛。
7. **视图绑定矩阵**：现有 7+ 视图逐一改为读 `Metric`/`KSF`/`Principal`，去硬编码（附录 B）。

### 非目标
- 不再造数据源/上传门（Connector 已有，仅连线）。
- 不另造目标对象（扩 PlanTarget）。
- 不把 `Metric` 做成新真值源——它是对"目标树+数据源派生"的**投影**（R13），落库的是快照与口径，不是凭空业务数。
- 本 PRD 不改各视图的业务算法，只换"数据从哪来"（前端硬编码→Metric）。

## 2. 现状盘点与缺口
| 链节 | 系统现状（file:line） | 缺口判定 |
|---|---|---|
| 目标 / 子目标 | ✅ `PlanTarget`（battery.ts:494/1163；service.ts:733；年→季→月） | 扩 KSF 归挂 + 子目标语义 |
| 数据源（对接+上传） | ✅ `Connector`（registry.ts）；PlanTarget 已配 FILE_UPLOAD+rest_api（data-categories.ts:21） | 仅补"指标←数据源"血缘连线 |
| KSF 要素 | ◐ 仅 HTML 决策域（L1190）+ audit/generate PRD 临时 `KsfGraph` | **提升为持久对象** |
| 指标库（目标 vs 实际） | ❌ 散落：`PlanTarget`=只目标值；`FinanceMetric`=仅财务（battery.ts:706）；实际值散在派生/聚合 | **新建 `Metric` 一等对象（最大缺口）** |
| 责任人 | ◐ 字符串 owner（HTML 行动行 L3427）+ 域签 `ownerUserId`（ontology-governance.ts:707） | **结构化 `Principal` + 问责连线** |
| 数据 Pipeline | ✅ 合成→物化→派生→求解器 | 复用 |
| 推演逻辑 | ✅ risk_timeline/plan_rootcause(提案)/KSF 装配 | 越线项接入推演 |

## 3. 设计
### 3.0 方法论：绑定脊柱 = 派生投影，不是第二套口径（铁律）
- `Metric.target` **取自**目标树（PlanTarget），不复制；`Metric.actual` **算自**数据源派生（DerivedProperty/聚合），不前端写死；`delta/miss` 纯函数派生。三者皆可溯（R13），任一视图引用同一 `Metric` 即同值（R-一致）。
- 落库的是**指标定义 + 口径 + 快照 + 血缘引用**，业务数仍在对象库——避免造新真值源（R13）。

### 3.1 对象模型（新增/提升）
- `KSF{ksfId, key, name, sub, finRefs[], tenantId}`（五要素：k_dem 需求结构 / k_bal 产销爬坡 / k_kit 物料齐套 / k_cash 信用现金 / k_cost 成本外协，口径同 HTML `KSF_DEF`）。
- `Metric{metricId, key, name, unit, level(month/quarter/year/op), target, actual, delta, miss, dataSourceRef(Connection), ksfRef(KSF), ownerRef(Principal), asOf, ruleRefs[], tenantId}`。
- `Principal{principalId, name, kind(org/role/person), parentRef, tenantId}`。
- **链路（Link）**：`subgoal_drivenby_ksf`(PlanTarget→KSF)·`metric_affects_ksf`(Metric→KSF)·`metric_sourcedfrom`(Metric→Connection)·`metric_ownedby`(Metric→Principal)·`plantarget_ownedby`(PlanTarget→Principal)。

### 3.2 每模块 IPO（全流程）
| 模块 | Input | Process | Output |
|---|---|---|---|
| ① 目标树（扩 PlanTarget） | 战略目标 + 行业模板 | 确定性分解 年→季→月 + 按 KSF 归挂子目标 | Goal/SubGoal 树 + KSF 关系 |
| ② KSF 要素（新） | 目标 + 待解决问题(4类) | 固化"问题→要素→财务指标"持久图 | `KSF[]` + 双向连线 |
| ③ 指标库（新·核心） | 指标定义 + 数据源绑定 + 责任人 + 目标值(←目标树) | 数据源采集 actual→物化/派生→算 delta/miss→C 系列越线判定 | `Metric{...}` 快照（驱动所有视图） |
| ④ 数据源（复用 Connector） | 对接 / 上传 | 同步/解析→RawDataset→物化 | actual 血缘根（R13） |
| ⑤ 责任人（新） | 组织/角色/人员 | 绑定目标/指标/行动 owner + 会签 | `Principal` + 问责连线 |
| ⑥ Pipeline（已有） | GenSpec/Connector | 合成→物化→派生→求解器 | ObjectInstance/DerivedProperty |
| ⑦ 推演（已有） | Metric.miss + KSF + 问题 | plan_rootcause/risk_timeline/KSF 装配 | 根因 DAG + 时序 + 三方案，回写越线项 |

### 3.3 指标快照与越线（求解器）
- 新求解器 `metric_rollup`：从对象库聚合 actual + 对齐 PlanTarget 的 target → 算 delta/miss，输出 `Metric[]`（确定性 R6）。注册进 `SOLVER_KEYS` + chain。
- 越线 `metric.breached` → 触发 `plan_rootcause`（提案于 cockpit PRD）/`risk_timeline`，根因 DAG 沿 `Metric→KSF→问题→对象/规则`。

### 3.4 责任闭环（Action）
- 目标定稿 / 指标 owner 绑定 / 越线行动派发 走 `POST /a/v1/action-drafts`（R4），执行回采更新 `Metric.actual`（`metric.snapshot_recorded`）。

### 3.5 视图绑定（去硬编码，附录 B 矩阵）
- DashboardView 八卡 / SopBalanceView 六卡 / PlanAuditView 行动行 owner / PlanGenerateView+PlanAuditView 的 KsfGraph / AnnualScenarioView 目标分解 → **逐一改读 `Metric`/`KSF`/`Principal`**，`debattery:check` 守零写死。

## 4. 契约 / 端点
- `packages/contracts/`：新增 `KsfSchema`/`MetricSchema`/`PrincipalSchema` + `MetricRollupOutput`；`PlanKpi`（cockpit PRD）声明为 `Metric` 的 plan 域投影别名。
- 端点：`GET /a/v1/metrics`（列表/按 level/ksf 过滤）·`GET /a/v1/metrics/:key`（含血缘）·`POST /a/v1/solvers/metric_rollup/invoke`·`GET /a/v1/ksf`·`GET /a/v1/principals`·复用 `POST /a/v1/action-drafts`（定稿/派责任）。
- 迁移：新表 `metrics`/`ksf`/`principals`（migrations + repo/pg + repo/memory + repo 接口，四处同改）。

## 5. 关键流程（闭环）
定目标(PlanTarget) → 挂 KSF → 定义 Metric(绑数据源+责任人) → 数据源对接/上传→物化→metric_rollup 算 actual/delta/miss → 越线 metric.breached → plan_rootcause/risk_timeline 推演根因 → 行动派 Principal(Action) → 执行回采→metric.snapshot_recorded 更新 actual → 指标收敛。

## 6. 非功能（§5）
R-一致（单一 Metric 出处）· R13（actual 血缘 + 投影非真值）· R14（口径/目标/文案配置化）· R4（定稿/派责任走 Action）· R2（租户隔离）· R6（metric_rollup 同输入字节一致）。

## 7. 验收（DoD）
- `KSF`/`Metric`/`Principal` 三对象落库（memory+pg 双实现，migration 四处）；血缘 `Metric.actual→DataSource` 可查（R13）。
- `metric_rollup` 确定性产出，越线判定接 C 系列规则；越线触发推演链通。
- **视图绑定矩阵全绿**（附录 B）：≥7 视图改读 Metric/KSF/Principal，`debattery:check` 过（前端零业务常量）。
- 闭环可由 FDE 亲手跑通（定目标→喂数据→越线→推演→派责任→回采→收敛）。
- `pnpm -r build && pnpm -r test` 全绿（新对象/求解器 + 各视图回归不破）；`ontology:check`/`chain:check`/`prd:check` 过。
- 回写本体 §2/§3/§4/§5。

## 8. 分期
- **SPINE.1** 对象与契约：`KSF`/`Metric`/`Principal` + 链路 + migration 四处 + `metric_rollup`（确定性 actual/target/delta/miss）。
- **SPINE.2** 数据源连线 + 责任闭环：Metric↔Connection 血缘、Principal↔目标/指标/行动、Action 定稿/派责任、两事件。
- **SPINE.3** KSF 持久化 + 越线推演接入：KSF 对象化、plan_rootcause/risk_timeline 接越线项。
- **SPINE.4** 视图绑定迁移（附录 B 矩阵逐项去硬编码）+ 全链回归 + 本体回写。

> 依赖与归一：与 `PRD-cockpit-capacity-1to1-parity.md`（`PlanKpi`/`RootCauseChain`）、`PRD-plan-audit-1to1.md` + `PRD-plan-generate-1to1.md`（`KsfGraph`）**共享对象**——本骨架是它们的下层载体，三者 `PlanKpi=Metric(plan)`、`KsfGraph=KSF 图渲染` 归一，避免重复建模。基线分支：本体+生成器+求解器+前端多视图，**改动面最大**，建议在各 1:1 视图 PRD 落地前先立骨架或同期推进（防各视图各拼 KPI 再返工）。

---

## 附录 A · 与既有对象的归一表（防重复建模）
| 本骨架对象 | 既有/提案对象 | 关系 |
|---|---|---|
| `Metric`(plan 域) | `PlanKpi`（cockpit PRD §3 第5） | **同一物**，PlanKpi=Metric 在 plan 域投影别名 |
| `Metric`(finance 域) | `FinanceMetric`（battery.ts:706） | FinanceMetric 作为 actual 来源之一，被 Metric 引用，不并吞 |
| `KSF` | `KsfGraph`（audit/generate PRD） | KsfGraph=KSF 对象的图渲染，提升为持久对象 |
| `Principal` | owner 字符串 + `ownerUserId`(域签) | 收编为结构化责任主体 |
| `SubGoal` | `PlanTarget`（已落库） | 扩展，不新建 |
| `DataSource` | `Connector`（已落库） | 复用，仅连血缘 |

## 附录 B · 视图绑定矩阵（去硬编码落点）
| 视图 | 现状 KPI 来源 | 改为读 | 守护 |
|---|---|---|---|
| DashboardView 八卡 | DASH_LAYOUT + 部分前端常量 | `Metric`(op/month) | debattery:check |
| SopBalanceView 六卡 | SOP_KPI_P 兜底 + 步骤派生 | `Metric`(month) + KSF | debattery:check |
| PlanAuditView 行动行 owner | 字符串 owner | `Principal` | debattery:check |
| PlanAuditView / PlanGenerateView KSF 图 | 临时 KsfGraph 装配 | `KSF` 对象 | ontology:check |
| AnnualScenarioView 目标分解 | PlanTarget（已对象化） | + Principal 责任 | — |
| QuarterlyRollingView | quarterly 派生 | Metric(quarter) 对齐 | R-一致 |
| RiskBoard/产能推演 | 求解器活算 | 越线项接 Metric.breached | chain:check |
