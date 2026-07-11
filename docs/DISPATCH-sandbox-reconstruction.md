# DISPATCH · 推演沙盘重建 · 派单索引（给 dev 按序执行的完整工单集）

> 状态：**待派单总表**。本文件是"推演沙盘重建"整套 WO 的**单一调度入口**——读这份即知：为什么改、改什么、按什么序、每单交付什么、谁依赖谁、怎么验收回退。
> 阅读顺序（dev 先读）：**① 本文 → ② `REVIEW-sandbox-intent-vs-reality.md`（为什么·逐功能价值裁定）→ ③ 对应 WO 详单**。
> 铁律（钉死）：**一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 才派下一期**（`DESIGN-refit-rollback-plan.md` 七原则）。绿测试≠达成（铁律 0.4）。

---

## §0 一句话背景

沙盘"从底往上建到了一半"：**引擎底座真且诚实**（SimSession + 通用逐-tick 传导核·`sim/propagation.ts` 纯函数零业务常数确定性），但**面向人的顶层**（问题输入/一句场景倒推/主动指挥台/答案与业务语义/数据血缘徽标/配套可见性）要么明标"增量4后放"、要么标"头号诚实缺口"未闭合。**且沙盘是孤立独立页,不在"问题→意图→渲染"主链上。** 本套 WO **不推倒重来**——保留真价值底座,按"每功能须服务真实决策、拒绝照搬竞品形式"逐层补顶层。

三条主线收敛为一件事：**入口过多① + 倒推精度② + 配套诚信**——都指向"把沙盘变成时序推演意图的答案画布"。

---

## §1 WO 全集与调度序

```
前置   主 PRD gap 引擎（PRD-gap-analysis-engine·L0-A diffGap）  ← 沙盘配套借它的诊断能力
  │
  ▼
S0  WO-SANDBOX-CONFIG-COVERAGE   ← 配套可见（传导规则/状态变量纳入 gap 覆盖）·全套前置
  │
  ▼
S1  WO-SANDBOX-AS-RENDER-TARGET  ← 页面→意图落地渲染器（五触发归一）·MVP=shock短程+状态级结论
  │        （协同：兄弟单A classify 精度·提升时序意图命中）
  ├────────────┬────────────┬────────────┬────────────┐
  ▼            ▼            ▼            ▼            ▼
S2 TRUST-BADGE  S3 BRANCH-INJECT  S4 RADAR-COLLAPSE  S5 TICK-CALENDAR  S6 TEMPORAL-GROUNDING
（敢信·最小） （方案对比真有意义）（砍竞品形式膨胀）  （tick↔业务时间+归因） （时序接地·外生驱动/overlay/守恒/约束/回放）
  │                                                                        │
  ▼                                                                        ▼
后续  Layer2（sim.* MCP 技能·主动指挥台）              **S6 解锁：hold/60天/求解器维利好利空**（S6 前不得上线·否则假推演）
```

**并行/串行规则**：S0→S1 严格串行（S1 的配套预检门依赖 S0）；S2/S4 可与 S1 并行（触点不相交：S2 后端 dataMode、S4 纯前端）；S3/S5 依赖 S1（分支注入/tick 语义挂在渲染器落地之后）。

---

## §2 逐 WO 派单卡（每张：价值/依赖/触点/风险/回退/详单）

| WO | 服务哪个决策（价值·过 §2 三问） | 依赖 | 触点面 | 风险 | 回退杠杆 | 详单 |
|---|---|---|---|---|---|---|
| **S0** WO-SANDBOX-CONFIG-COVERAGE | 让"这推演缺哪些传导规则/状态变量"可诊断可施工→GrowthTicket（配套不再隐形） | 主 PRD diffGap | 后端·契约（无迁移·复用现有表） | 低（additive 两 kind） | 摘两 provisioner+枚举 | `WO-SANDBOX-CONFIG-COVERAGE.md`（已出） |
| **S1** WO-SANDBOX-AS-RENDER-TARGET | 人机对话/场景卡/what-if/告警五触发→同一时序推演·渲染进沙盘·答案先行（入口①收敛+倒推②入口） | S0 + 主PRD preAnalyze；协同兄弟单A | 契约·前端(渲染器)·后端(意图/plan) | 中（触主链·绞杀式暗发） | feature `sim.sandbox_render` 关=回旧路径（未删） | `WO-SANDBOX-AS-RENDER-TARGET.md`（已出） |
| **S2** WO-SANDBOX-TRUST-BADGE | 每数字标 LIVE/合成/未校准→用户"敢信"（补沙盘唯一缺的诚信位·最符 genuine-sim 纪律·最小） | — | 后端(SimTickState.dataMode)+前端徽标 | 低 | additive·关=不显徽标 | 见 §3 卡 |
| **S3** WO-SANDBOX-BRANCH-INJECT | A/B 分支各注入不同应对(外协vs加班)+对比换决策维(交付/成本/齐套)→方案对比真有意义 | S1 | 契约·前端·后端(scope 增量) | 中 | 白名单·关=回容器分支 | 见 §3 卡 |
| **S4** WO-SANDBOX-RADAR-COLLAPSE | 三雷达合一(维度换人话)+L0-L4 折一句人话→**砍竞品形式膨胀**·降信息过载 | — | 纯前端 | 低 | 视觉回退 | 见 §3 卡 |
| **S5** WO-SANDBOX-TICK-CALENDAR | tick↔业务时间(推进到第N周)+时间轴事件标注+节点归因(为什么红)→看得懂 | S1 | 契约·前端·后端(trace 消费) | 低-中 | additive | 见 §3 卡 |
| **S6** WO-SANDBOX-TEMPORAL-GROUNDING | 时序推演接地五件套：外生驱动(需求/在途/检修真源逐tick喂引擎)+求解器模拟态overlay+hold守恒(隐含净补/日)+约束层+回放校验(UNCALIBRATED转正)——**hold/60天/利好利空的上线门禁** | S1 MVP·真源(DemandSegment/A8) | 契约·引擎(additive)·后端 | 中 | feature `sim.temporal_grounding` 关=回 v1.1·契约 default | `WO-SANDBOX-TEMPORAL-GROUNDING.md`（已出） |

---

## §3 S2–S5 施工卡（compact 但可执行；详单可按此展开）

### S2 · WO-SANDBOX-TRUST-BADGE
- **范围**：`SimTickState`/沙盘 KPI 输出补 `dataMode`(LIVE/SYNTHETIC/STALE/UNCALIBRATED) + 对象 `origin` + 派生属性新鲜度；前端每数（全局态/stateVar KPI/基地卡/节点）绑徽标（复用既有 dataMode 徽标范式·`ProjectSimView` 已有先例）。
- **触点**：`contracts/sim.ts`(TickState +dataMode·additive) · `sim/propagation.ts`(透传源诚实位·不造) · `SandboxView.tsx`(徽标渲染·仅用既有 token) · genuine-sim:check 扩断言。
- **验收**：真起→每 KPI 徽标逐值对后端 dataMode；合成租户显"合成"、未校准显"未校准"；green→red（临时改真态→徽标应变 LIVE）。
- **回退**：additive·关 feature=不显徽标（页面原样）。**价值**：这是沙盘从"不敢信"到"敢信"最小一步，独立于 S1 可先落。

### S3 · WO-SANDBOX-BRANCH-INJECT
- **范围**：分支后每条线可注入不同"应对"（=改哪条传导规则系数/加哪个 Action 模板）；`SimComparePanel` 对比维从"全局态曲线"换为决策维（交付缺口/成本/齐套·来自求解器输出）。
- **触点**：`contracts/sim.ts`(branch scope 增量) · `app.ts sim/branch`(注入) · `SimComparePanel.tsx`(决策维) · 需**方案库**（应对模板·可小起）。
- **验收**：A 外协/B 加班注入后 A≠B；对比表出交付/成本;真跑。**回退**：白名单·关=回容器分支。

### S4 · WO-SANDBOX-RADAR-COLLAPSE（砍竞品形式）
- **范围**：三套雷达(3维+健康6维+信任4维)合并为 **1 张主雷达（维度名换人话·如"数据齐不齐/规则覆盖/可信度"）** + 其余收"详情"折叠；L0-L4 stepper 折成一句人话"当前 L2·可参考不可直接落 Action·因缺 X"，黑话收详情。
- **触点**：纯前端 `SandboxView.tsx`/`SimReadinessPanel.tsx`/`RadarChart.tsx`；维度 label 走 config/i18n（R14）。
- **验收**：一屏一雷达、维度人话可读；认证一句话结论正确映射 cert level。**回退**：纯视觉可回退。**价值**：直接执行 REVIEW"拒绝 copy 竞品形式"。

### S5 · WO-SANDBOX-TICK-CALENDAR
- **范围**：tick↔业务时间映射配置（tick=1模拟日·"推进到第N周/某里程碑"）；时间轴 heat 加刻度+越线/事件标注（消费引擎已产 `PropagationTrace`）；节点点开加归因（哪条边×系数传入·trace 已有）。
- **触点**：`contracts/sim.ts`(tick 时间映射) · `SandboxView.tsx`/`PropagationTimeline.tsx`(刻度/归因) · 引擎 trace 前端消费。
- **验收**：命令显真实时间;点节点看到归因链;逐值对 trace。**回退**：additive。

---

## §4 全局纪律（每张 WO 派单时必带）

1. **暗发**：每能力 feature key `defaultOn:false`（关=404/原样）；demo 先开金丝雀。
2. **只加不改**：契约字段 optional（zod 非 strict）；migration 带 down；**旧路径永不删**（沙盘独立路由/URL what-if 全保留）。
3. **旁路·权威不换手**：`classifyGap`/`resolvePlanForIntent`/`propagateTick` 判决地位不变；预分析/配套门只提供咨询与诚实缺口，**永不假跑假红**。
4. **回退演练入齿**：每单 acceptance **必含一条真跑回退**（关闸→404/原样+旧行为回归测绿；migration down→up 幂等）。
5. **单期单单·复验绿再下期**。
6. **失败判据前置**：每单写死中止条件+回退动作+数据影响（沙盘新增数据均咨询性派生·可 drop 重生·业务真值零动）。
7. **诚信红线**：配套缺→诚实报缺+工单，**绝不合成/哈希/写死冒充**（KILL-MOCK-RED / genuine-sim:check）。

---

## §5 交付物清单（本套 handoff 全文件）
| 文件 | 作用 | 状态 |
|---|---|---|
| `docs/DISPATCH-sandbox-reconstruction.md` | 本文·派单总索引 | ✅ |
| `docs/REVIEW-sandbox-intent-vs-reality.md` | 为什么·逐功能价值裁定·配套依赖(§7)·页面定位(§8) | ✅ |
| `docs/WO-SANDBOX-CONFIG-COVERAGE.md` | S0 详单·配套纳入 gap 覆盖 | ✅ |
| `docs/WO-SANDBOX-AS-RENDER-TARGET.md` | S1 详单·五触发归一·渲染器落地 | ✅ |
| S2–S5 施工卡 | 见本文 §3（compact 可执行·可按需展开为详单） | ✅ |

**背景配套（已在仓库·沙盘依赖它们）**：`PRD-gap-analysis-engine.md`（gap 引擎）· `PRD-upstream-classify-precision.md`（时序意图命中）· `PRD-simulation-sandbox.md`/`SPEC-sandbox-propagation-and-session.md`（沙盘初衷与传导核）。

---

## §5.5 对账（2026-07-11 · origin `8f8f161` 已合入 cap-sim 8 单 + 主 PRD L0 部分实现 · **dev 开工前必读**）

> origin 分支在本套 WO 起草后有大量合入。**逐条对过账**，下表标"已被实现/部分/未动"——dev 只做差量，勿重复实现；所有 WO 内 file:line 锚点以 origin 最新为准（`SandboxView.tsx` 已 +195 行，行号普遍漂移）。

### A. 主 PRD（gap 引擎）落地状态 → S0/S1 前置已就绪
| 我方设计 | origin 实况 | 对 S 系列的影响 |
|---|---|---|
| `GET /a/v1/databuilder/registry-snapshot`（主 PRD §6.5） | ✅ **已实现**（feature 门 + service-only·`app.ts:3765`） | S1 的 A 栈快照直接可用 |
| `diffGap` 契约扩展（主 PRD §4/§5） | ✅ `contracts/databuilder.ts` +373 已合 | S0 扩 kind 的底座已在 |
| `preAnalyzeQuery` + `pre_analyses`（主 PRD §6/§9） | ✅ `growth/pre-analyze.ts`(331行) + `migrations/013` + 192 行测试 | S1 配套预检门的引擎已在 |
| → **结论** | **S0/S1 的"前置：主 PRD 落地"已满足，可直接开工** | 排程提前 |

### B. cap-sim 8 单 vs S0–S5（防撞车·只做差量）
| cap-sim（已合入） | 与 S 系列关系 | dev 动作 |
|---|---|---|
| CAP-01 REALDEMAND（真供需替代合成恒红·闭 G-SIM-FAKE） | S 系列未覆盖的**后端数据真实性**层·互补 | 无需动 |
| CAP-02 SEED-VARY（种子分化+衰减） | 互补 | 无需动 |
| CAP-03 KPI-FIX（口径正名·真均值·量纲归一） | ≈ S2 的"真值"半 | **S2 只补徽标层**（dataMode 披露），口径勿重做 |
| CAP-04 TICK-DAYS（批量推进 N 天） | ≈ S5 的一半 | **S5 只补差量**：N天→"到第N周/里程碑"+时间轴事件标注+节点归因 |
| CAP-05 BRANCH-VISIBLE（对比卡首屏可达） | ≈ S3 的"可达"半 | **S3 只补差量**：注入不同应对+决策维注册表 |
| CAP-06 WHATIF-SCOPE（跳转真带基地裁剪世界·闭 G-3·`whatif.ts resolveBaseId`） | S1 的 scope 机制部分现成 | S1 复用其裁剪函数，scope 语义对齐 |
| CAP-07 MODEL-DIM（型号维度切片） | 新增能力·S 系列未含 | 无需动;S1 渲染器落地时保留该面板 |
| CAP-08 OPS-FLOW（运营一条龙·依赖05/06/07） | **与 S1 相邻**：CAP-08=沙盘内操作流，S1=NL 意图→渲染器落地 | 按 S1 §3.3 分工执行·接缝=SimulationRequest 复用 |

### C. v1.1 泛化修正（用户钉·已改入 WO）
- **情景四原型**：`disruption`（只装冲击）→ `ScenarioAction{shock|hold|trend|policy}`——覆盖"库存水位保持 X 未来 60 天"类保持型问句（AS-RENDER-TARGET §2.1）。
- **利好/利空双向评估**：新增 `ImpactAssessment`（基线 vs 情景双跑·决策维 delta×direction 机械判 FAVORABLE/UNFAVORABLE·无数据 NO_DATA 诚实）（§2.5）。
- **决策维注册表**：S3 对比维与 §2.5 共用一份配置（R14——"交付/成本/齐套"是电池租户配置内容，非代码）。
- **意图类按原型组织**（shock/hold/trend/policy），业务问法进 examples;验收含**域泛化自检**（同一意图类须产能+库存两域问法都命中）。

## §6 给 dev 的执行说明
1. **先复现基线**：`pnpm -r build && pnpm -r test` 四包全绿 + `pnpm gates` 全绿（改造前基线）。
2. **按 §1 序派单**：S0 起，一期一单，每单读对应详单 + REVIEW 对应功能行。
3. **每单交付即 `prd:check` + 该单 acceptance 全条真跑 + 回退演练**，绿才 DONE。
4. **改母体即 `pnpm ontology:slices`**（沙盘 WO 落地要回写 §2.I/§3·见各单 §0 回写清单）。
5. **任一门红不进下一期**；任一失败判据命中即按该单回退杠杆回退。
