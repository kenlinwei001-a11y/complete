# 全局 UI 信息架构调整与合并方案（推演沙盘并入现有系统，不另起孤页）

> 问题：推演沙盘 + 就绪认证 + 数据管道建模屏，与现有 ~40 页大量重叠。若各做各的 → 出现"两个地方做同一件事"、IA 混乱、维护双份。
> 原则（贯穿）：**① 一能力一处（single source per capability）② surface 不重建（把既有能力在新流程里露出，而非另写一份）③ 合并不复制（散落的同类页收敛成一个）④ entitlement 暗发 + additive 共存 → 再废弃旧页**。
> 配套：`PRD-simulation-sandbox`(做什么) · `ARCH-sandbox-landing-discipline`(怎么安全落) · `RUNBOOK`(怎么一步步做) · 本文(**全局 IA 怎么合并/重排**)。

---

## 1. 当前 IA 全景（基线，`adminRegistry.ts`）

**业务视图**（`/v/:viewKey`）：dashboard 驾驶舱 · risk 风险看板 · project 项目推演 · audit 体检 · generate 方案 · sop 平衡 · quarter 季度 · graph 图谱 · ledger 台账 · **scenarios 场景启动器** · 对话坞 QueryDock（贯穿）。
**管理台 7 组**：
1. **数据接入**：connections(连接器与上传) · rule-docs · synthetic · external-signals · quarantine
2. **建模与图谱**：modeling(本体建模) · object-types · domains · slices(切片) · merge · meta · boundary · prototype-intake(原型导入)
3. **规则与校准**：rules · calibration
4. **构建与成长**：data-builder(数据构建发动机) · growth(自成长驾驶舱) · evals · solver-review
5. **编排与场景**：catalog · agents · workflows · skills · mcp · scenes · ops/fallback · views
6. **运营与审批**：actions · ops-schedule · notifications · validation
7. **平台治理**：tenants · users · permissions · features · llm-providers

---

## 2. 重叠地图 + 逐项合并裁决（核心）

| 新设计能力 | 与哪些现有页重叠 | 裁决 | 理由 |
|---|---|---|---|
| **推演沙盘**（交互时序仿真） | `project 项目推演`(ProjectSimView) · `risk 风险看板`(RiskBoardView) · `views/sim/*` 组件 · `scenarios 场景启动器` | **合并升格**：把 project/risk 的"单发求解器推演"升格为统一**沙盘业务视图**；project/risk 视图**降为沙盘的预设场景入口**（点卡→进沙盘对应 scope），不再各自维护一套推演 UI | 三处都是"推演/风险"，现状是单发曲线；沙盘是其交互超集。**不新增孤页，是把散落推演收敛成一个** |
| **AI 推演指挥台** | `对话坞 QueryDock`（贯穿业务视图） | **复用 QueryDock**，加 `sim.*` 工具感知 + 沙盘结果卡片渲染 | 已有自然语言→QOS 管线，**绝不另写第二个对话框** |
| **仿真就绪认证**（L0-L4/雷达/三维） | `growth 自成长驾驶舱`(GapReport/closure) · `data-builder 数据构建发动机`(FDE 节点图/closure) · `solver-review`(A18 相位) | **不新增页**：认证是**横切面板**，folded 进 ①`modeling`(建模就绪) ②`growth`(运行就绪) 两处既有页；底层复用同一 closure/三环（`meta:sync` 防漂） | 就绪/缺陷已在 growth+data-builder 算过；**再开第三个就绪页 = 三处显示同一就绪 = 违 single-source** |
| **数据管道建模屏**（数据源→处理→实体） | `connections 连接器与上传` · `modeling 本体建模` · `prototype-intake 原型导入` · `object-types` · `data-builder 数据构建发动机` | **modeling additive 增强 + 明确边界**：modeling 左栏**引用**(非复制)connections 的数据源（深链回 connections 管理）；管道画布把 dataset→实体显性化。**modeling=手动从数据源建模；data-builder=AI 故事驱动建域**——两者边界写清，不重叠 | connections 管数据源、modeling 管建模、data-builder 管 AI 建域——**各自单一来源，互相深链不复制** |
| **沙盘初始化/范围裁剪** | `slices 切片`(slice-planner 子图) | **复用 slice-planner**：沙盘范围向导调既有切片规划器选子图，不另写子图选择 | 子图/范围已有确定性规划器，**复用不重造** |
| **传导规则编辑** | `rules 规则库`(规则即引用 PRD) | **并入 rules**：传导系数/延迟是 `rule.params`，在既有规则编辑器编辑 | 规则即引用 PRD 已定，**沙盘传导规则就是规则的一类，不另开编辑器** |
| **沙盘态 Action** | `actions 审批` | **复用 actions**：沙盘"采纳"→生成 R4 ActionDraft 进既有审批页 | R4 审批单一来源，**沙盘不绕审批、不另开审批** |

> 一句话裁决总纲：**沙盘是"用"的统一入口（合并 project/risk/scenarios 的推演）；就绪认证是横切面板（folded 进 modeling+growth）；其余全 surface/复用现有页（connections/slices/rules/actions/QueryDock），零重复。**

---

## 3. 目标 IA（重排后导航）

**业务视图（决策面）重排**——推演收敛为一个支柱：
```
驾驶舱 dashboard ─ 决策总览（KPI/问题卡）
推演沙盘 sim ──── ★新支柱：统一交互推演（吸收 project项目推演 + risk风险看板为预设入口）
  ├ 场景启动器 scenarios ─ 点卡 = 进沙盘对应 scope（不再独立"启动器→单发求解器"）
  └ 对话坞 QueryDock ─ AI 指挥台（沙盘感知，贯穿）
规划与平衡 ──── audit/generate/sop/quarter（保留，决策驾驶舱类）
图谱/台账 ───── graph/ledger（保留）
```
**管理台 7 组**——基本不动，仅 2 处微调（不新增组）：
- **建模与图谱**组：`modeling` 升级为"数据源管道 + 建模 + 就绪面板"（additive）；其余不动。
- **构建与成长**组：`growth` 自成长驾驶舱**吸收"仿真就绪认证"面板**（运行就绪 = closure surfaced），`data-builder` 同享；不新增页。
- 其余 5 组（数据接入/规则与校准/编排与场景/运营与审批/平台治理）**零改动**。

> **净增页面 = 1**（推演沙盘业务视图）。**就绪认证 = 0 新页**（folded）。**数据管道 = 0 新页**（modeling additive）。**其余全复用。** —— 这才是"合并"而非"堆页"。

---

## 4. 逐页调整清单（哪些现有页改、怎么改）

| 现有页 | 调整 | 类型 |
|---|---|---|
| `project 项目推演`(ProjectSimView) | 降为沙盘预设入口；现有单发求解器视图**保留只读**（迁移期共存）→ 后期废弃 | 渐进降级 |
| `risk 风险看板`(RiskBoardView) | 同上：风险卡→沙盘断供/传导预设入口 | 渐进降级 |
| `scenarios 场景启动器` | 点卡语义从"launch→单发求解器"改为"launch→进沙盘 scope"（与发育闭环 G-9 的卡→grow 对齐） | 语义并入 |
| `modeling 本体建模` | **additive**：左栏加数据源面板（引用 connections）+ 管道画布 + 就绪面板（surface closure）；**旧 dataset 列表保留** | additive 增强 |
| `growth 自成长驾驶舱` | **additive**：加"仿真就绪认证"面板（L0-L4/雷达/三维，复用 GapReport+closure） | additive 增强 |
| `connections 连接器与上传` | **零改**；被 modeling 深链引用（单一来源） | 不动 |
| `slices 切片` | **零改**；被沙盘范围向导调用 | 不动 |
| `rules 规则库` | 复用既有编辑器编传导规则（规则即引用 PRD 已规划） | 复用 |
| `actions 审批` | **零改**；接沙盘"采纳"草稿 | 不动 |
| 对话坞 QueryDock | **additive**：sim 工具感知 + 沙盘结果卡片 | additive 增强 |
| `data-builder 数据构建发动机` | **零改**；与 modeling 边界写清（AI建域 vs 手动建模） | 不动（划界） |

> 原则兑现：**改动集中在 3 个 additive 增强（modeling/growth/QueryDock）+ 1 个新视图（sim）+ 2 个渐进降级（project/risk）**；其余 ~35 页零改动。

---

## 5. 合并迁移纪律（不破稳定 + 不出双份）

1. **共存→废弃（strangler-fig）**：沙盘上线后，project/risk 旧视图**保留只读共存**（entitlement 暗发期）；用户验证沙盘可用 → 旧视图标"将下线"→ 下一相位移除。**绝不一刀切删旧页。**
2. **single-source 门（防双份）**：新增门 `ia-single-source:check`——同一能力（数据源管理/就绪算法/审批/对话）只能有一个实现源，其余页**深链引用**，不得复制逻辑。静态校验"数据源 CRUD 只在 connections、就绪算法只在 closure、审批只在 actions"。
3. **CLI 对等不变（R15）**：合并后的能力仍各有 CLI（沙盘 `platform sim`、规则 `platform rule`），`cli-parity:check` 守。
4. **就绪算法单一来源（meta:sync）**：modeling/growth/sandbox 三处显示的就绪，**底层同一 closure 函数**，`meta:sync` 防三套漂。
5. **导航灰度**：新 IA 经 `views`/workspace 配置下发（服务端驱动导航，已有），按租户灰度切换，旧导航可回退。
6. **回退**：entitlement `sim.sandbox` 关 → 沙盘视图消失、导航回旧态、project/risk 旧视图仍在 → **瞬时回到改动前 IA**。

---

## 6. 《本体引用与影响》

- **对象类型**（§2）：`ViewConfig`/`SandboxViewConfig`（导航/视图配置驱动，R14）；`Scenario`（卡→沙盘 scope 语义并入，复用 G-9 `ScenarioOntogenesisRun`）。
- **链路**（§3）：`场景卡 --launch--> 沙盘 scope`（替代"卡→单发求解器"）；`modeling --深链引用--> connections 数据源`；`沙盘"采纳" --> actions R4`；就绪面板 `--surface--> closure/GapReport`（modeling/growth/sandbox 三投影同源）。
- **不变量**：R3（entitlement 驱动导航灰度/暗发）、R15（合并能力仍 CLI 对等）、R14（视图配置驱动、零业务常数）、R-一致（就绪/审批/数据源单一来源）。
- **门禁**（§7）：新增 `ia-single-source:check`（防"两个地方做同一件事"）；`meta:sync` 扩就绪算法单源；`cli-parity:check` 守合并能力。
- **断点**（§8）：与 G-11 同条目下记"IA 合并：推演收敛为沙盘、就绪 folded、数据源单源深链"。
- **回写**：实施后回写 §3（卡→沙盘 scope 链路改向）/§7（ia-single-source 门）。

---

## 7. 给决策者的一句话

**这不是"加几个沙盘页"，是把系统的"推演"能力从散落（project/risk/scenarios 各一套单发）收敛成一个交互沙盘，把"就绪"从可能三处显示收敛成一个横切面板（folded 进 modeling+growth），其余全复用现有页深链。净增 1 个业务视图、3 个 additive 增强、2 个渐进降级，~35 页零改动。** 配合 entitlement 暗发 + single-source 门，全局 IA 调整可控、可回退、不出双份。

> 落地顺序仍遵 RUNBOOK：增量 4（UI）才动 IA，且 modeling/growth 是 additive、project/risk 共存降级——前 3 增量（本体/CLI/引擎）完全不碰现有页。

---

## 8. 实施记账 · 收编表当前态（2026-08-17 · WO-SANDBOX-NAV-CONSOLIDATE 回写）

> 本节是**实施后的现状**，不是计划。单一出处在代码里
> （`apps/frontend-shell/src/pages/ShellLayout.tsx` 的 `CONSOLIDATED_INTO_SANDBOX`
> ＋ `apps/frontend-shell/src/views/sim/sandboxModes.ts` 的档表），本节只做人读索引；
> 两侧漂移由 `scripts/check-nav-group-coverage.mjs` 判据⑧/⑨ 与
> `apps/frontend-shell/test/sandbox-nav-consolidate.seam.test.tsx` 机械对账。

### 8.1 已收编进沙盘的 12 个入口

| 键 | via（后端哪条机制仍可达） | 沙盘里点哪里能到 | 导航回退条目 |
|---|---|---|---|
| `chain-line-map` | workspace.views | 「现状」→ 中栏画布**默认**档「线路图」 | 无（随 `sim.sandbox` 一起消失） |
| `physical-topology` | workspace.views | 「现状」→ 画布档「物理拓扑」 | 无（同上） |
| `node-inspector` | workspace.views | 「现状」→ 右栏常驻检视 → 页签「变量输入」 | 无（同上） |
| `transit-flow` | workspace.views | 「现状」→ 线路图上的「在途批次图层」勾选框 | 无（同上） |
| `chain-impediments` | workspace.views | 「现状」→ 主屏阻滞点统计条 + 逐条清单 | 无（同上） |
| `cleanroom-attr` | static-route | 「归因」→ 档「净室归因」 | `kind:"route"` + `consolidatedWhen` |
| `what-if` | static-route | 模式「试一手」 | `kind:"route"` + `consolidatedWhen` |
| `optimize-whatif` | static-route | 模式「求最优」 | `kind:"route"` + `consolidatedWhen` |
| `disruption-radius` | static-route | 模式「影响半径」 | `kind:"route"` + `consolidatedWhen` |
| **`process-wait`** | workspace.views | **「归因」→ 档「流程等待态」** | **`kind:"view"` + `consolidatedWhen`** |
| **`procurement-legs`** | workspace.views | **「归因」→ 档「采购四段腿」** | **`kind:"view"` + `consolidatedWhen`** |
| **`process-stuck`** | **view-defs** | **「归因」→ 档「流程卡点」**（暗发键关着时该档整个不出现） | **`kind:"view"` + `consolidatedWhen`** |

**两种回退语义不许混**（判据⑧a/⑧e 各守一半）：

- **无回退条目** —— 该页的 entitlement 本就 `requires: ["sim.sandbox"]`，沙盘关 ⇒ 它连
  `workspace.views` 都不下发、`/v/<key>` 本来就 404。**没有可回退的东西**，这是事实不是豁免。
- **有条目 + `consolidatedWhen`** —— 该页**不受** `sim.sandbox` 门控（沙盘关着照样能打开）。
  条目必须留着：删了 = 沙盘关的租户「沙盘没有 + 导航也没有」，这一页从 IA 里蒸发。

唯一非法的第三态是**有条目却不带 `consolidatedWhen`** —— 那是永不消失的重复入口，
也正是 §8.2 那个事故的形态。

### 8.2 事故记账：「归因与风险」组的收编承诺被逐条豁免掏空

仓主原话：**「为何导航栏还有这2个，我之前不是要求你调整吗？」**

该组原设计是「沙盘一开整组消失」（两项都带 `consolidatedWhen` ⇒ 空组自动隐藏）。
之后三张单各往组里加了一项、**每一项都不带**，注释里的理由都是
「沙盘五模式里没有它，带了就是把它唯一的入口在沙盘开时删掉，页面直接不可达」——
**这三条理由当时全是真的**。于是这个本该消失的组在沙盘开着时永远剩三项。

**形态**（铁律 0.6 句式）：
> **「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据，而前者并不度量后者。」**

**最刺眼的一点**：`ShellLayout` 里那两条历史订正每次**只更新了数字**
（「剩一项…这是正确行为，不是漏配」→「再订正一次同一句：剩两项」），
从没有人问过「这个数为什么不是零」。

**修法的红线**：不许用「删导航项」了事 —— 删了项而没有替代入口 = 页面彻底不可达。
交付判据是**两条同时成立**：① 沙盘开时组不出现在侧栏；② 那三页每一页都仍有用户点得到的入口
（不是手敲 URL、不是只有测试知道的深链）。故本轮的做法是**真收编**：给它们在沙盘里造落点。

**机制（下次由机器先说话）**：`nav-group-coverage:check` 判据⑨ ——
凡有成员带 `consolidatedWhen: X` 的组，其余成员要么也带、要么在
`ShellLayout.GROUP_CONSOLIDATION_EXEMPT` 里逐条登记理由；违规 RC=1 并点名
「本组的收编承诺正在被掏空：X 开时本组还剩 N 项」。

### 8.3 「归因」模式的四档（同一问、不同对象）

`SANDBOX_MODES` 的**五问顺序一个字没动**（决策链 = 顺序即产品表达）。三页进的是
**模式内的档**，不是新的一环 —— 它们与 `cleanroom-attr` 回答的是**同一问**（为什么会这样），
只是看的对象不同：

| 档 | 看哪一类对象 | 原独立页 |
|---|---|---|
| 净室归因 | 链路损失落在哪一段 | `cleanroom-attr` |
| 流程等待态 | 这**类**流程通常在等哪一类东西（模板层） | `process-wait` |
| 流程卡点 | **这一张单**此刻卡在第几步、等谁、等了多久（实例层） | `process-stuck` |
| 采购四段腿 | 这批料晚在哪一段、今天该打哪通电话（责任方） | `procurement-legs` |

顺序 = 从粗到细。**模板层与实例层不合并**（上一轮裁决，本轮未推翻）：它们是同一模式下的
**两个档**，各自渲染各自那一页，`waitStateOrigin` 的 `DEFINITION_TEMPLATE` vs `TASK_GATE`
那条诚实位在 IA 层完好。

**档内容的取法（这一条是 R3 不被绕过的结构保证）**：档不写死 `lazy(() => import(...))`，
而是走**与 `pages/ViewPage.tsx` 逐字同构**的分发 ——
`features.includes("view.<key>")` → `workspace.views.find(key)` → `getRenderer(view.renderer)`。
于是「档在不在」与「导航项在不在」吃的是同一个判据，`process-stuck` 的暗发键
`process.runtime`（`defaultOn:false`）关着时那一档**整个不渲染按钮**（不是禁用 —— 禁用同样泄露存在性）。

### 8.4 《本体引用与影响》（本节增量）

- **对象类型**：`ViewConfig`（档内容仍由它下发，`view.options` 与深链走同一份配置）。
- **链路**：`NAV_GROUPS(组 → 成员 → consolidatedWhen) --条件过滤--> UnifiedNav --空组--> 自动隐藏`；
  反向 `CONSOLIDATED_INTO_SANDBOX --档--> workspace.views + getRenderer --> 页面内容`。
- **不变量**：R3（暗发键关 = 功能不存在，收编后仍成立）；R14（档表配置驱动、零业务常数）。
- **门禁**（§7）：`nav-group-coverage:check` 判据⑧f（两张表不许各写一半）与判据⑨（组承诺不许被掏空）；
  退出码补齐三分（门自己瞎了 ⇒ RC=2）。
- **断点**（§8）：新增 `G-GROUP-CONSOLIDATION-HOLLOWED`（✅ 已闭）；
  `G-NAV-FALLBACK-BUCKET` 补记第三个亚型（前两个亚型是逐键的，这个出在**组**这一层）。
