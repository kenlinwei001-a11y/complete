# PRD · 数据闭环规范（Data-Closure Spec · 全模块强制基线）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 横切宪法级 |
| 性质 | **每个现有与未来模块都必须满足的数据闭环基线**——把"接入→模版→生成→物化→派生→切片→求解→渲染→溯源→闭包→审批→指标→责任→CLI"定义为**一等横切关切**，并给出**逐模块合规 checklist + 门禁**。统摄各 1:1/骨架 PRD。 |
| 取代/扩展 | 收编散落定义：本体 R12（仅 databuilder 闭包 ~30%）· `PRD-unified-build-engine`（仅编排闭包 ~40%）· `PRD-A10-build-to-verify`（运行时验证）· `PRD-goal-metric-owner-spine`（Metric 对象）→ **首份完整跨模块闭环规范** |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R1–R15 · §7 门禁 · §8 G-5/G-6/G-8 · §10 域/切片）· 本文 §3 系统审计 · §4 PRD 审计 |

> 一句话：双向 100% 审计（系统 18 阶段 + PRD 12 篇 × 18 维）查实——**系统数据闭环约 60–70% 落地，1:1/骨架 PRD 普遍只做了"视觉对齐"漏了"数据闭环对齐"**。最严重的系统性缺口：**① 模版↔种子解耦（battery 写死、改模版不重生成、无上传建模版入口）② 新对象类型无自动 onboarding（要手改 5+ 文件）③ 渲染非声明式（前端拥有、G-2 风险）④ CLI 缺位（R15 未落）⑤ PRD 漏 C 登记/D 回填/R 双层/B 上传闭环/N 指标/O 责任/Q CLI**。本规范把这些定为**强制基线 + 逐模块 checklist + 门禁补强**，未来任何模块进来照单走。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2/§10）：`IndustryTemplate`（升为可上传/版本化一等制品）·`ObjectType/PropertyDef/DerivationSpec/SliceSpec`·`Connector/RawDataset`·`Metric/KSF/Principal`（接 spine）·`Solver/SOLVER_OUTPUT_SHAPES`·`ViewDef`（新，声明式渲染契约）·`ClosureReport/GapReport`·`OPERATION_CATALOG`（R15）。
- **触及链路**（§10 切片）：贯穿 `sys.ingest.data_to_object`·`sys.ingest.build_closure`·`sys.ontology.type_lineage`·`sys.solving.invoke`·`sys.action.writeback`·`sys.flow.event_to_refresh`·`sys.meta.change_loop`（= 协同进化闭环，新模块进来的元链路）。
- **触及不变量**（§5）：**R12**（闭包，扩为 HARD 默认）·**R13**（溯源补派生级）·**R14**（声明式渲染、模版/种子双层）·**R4**（物化/模版变更走审批）·**R6**（同 industry,seed 字节一致 + 测试证明）·**R10**（事件失效 ≤60s）·**R-一致**（指标单一出处）·**R15**（CLI 对等）·**R2/R5**。
- **关闭/影响断点**（§8）：**G-6**（模版引擎已收口 → 本规范补"模版可上传改/建"最后一段）·**G-5**（电池锁死 → 模版/种子双层根治）·**G-8**（构建闭包 → 补 backfill + 渲染声明式 + scaffold 前置 publish 阻断）。
- **门禁**（§7）：新增/强化 `closure(HARD 默认)`·`chain:check(pre-commit)`·`shape:check(ViewDef ⊆ solver 输出)`·`cli-parity:check(R15)`·`template-lifecycle:check(模版库化)`·`auto-onboard:check(新类型五处登记)`·`prd:check(§0 必含数据闭环声明)`。
- **回写承诺**：`IndustryTemplate 一等化 / ViewDef / OPERATION_CATALOG / auto-onboarding 链路` → 回写本体 §2/§3/§7/§10；本规范 checklist → 并入 `_PRD-TEMPLATE.md §0` 与 `OPERATING-MODEL.md`。

## 1. 目标 / 非目标
### 目标
1. **定义数据闭环全链 21 维**（§2）为唯一权威清单。
2. **记录系统 AS-IS**（§3）与 **PRD 语料遗漏**（§4），双向无盲点。
3. **给出逐模块合规 checklist**（§6）——任何模块 PRD 的《本体引用与影响》必须逐项声明达成/豁免。
4. **补强门禁**（§7），让漏项**编译期/提交期红**，而非靠自觉。
5. **根治模版生命周期**（§5.1）：battery 模版反写进库、上传建新行业/客户模版入口、模版(schema)+种子配置(值)双层。
### 非目标
- 不在本 PRD 实现各模块业务逻辑（只定基线+门禁+清单）。
- 不推翻已落部分（R2/R6/chain/closure 等保留，只补缺口与强制力）。

## 2. 数据闭环全链 · 21 维（权威清单）
| 阶段 | 维 | 定义 | 不变量 |
|---|---|---|---|
| **模版** | T1 模版单一源 | ObjectType = 唯一 schema；合成/数据构建发动机/上传列模版三方同源 | R14 |
| | T2 **模版生命周期** | IndustryTemplate 可**上传创建/编辑/fork**，库化版本化（非代码常数） | R4 |
| | T3 **模版+种子双层** | schema(形)与精确值(种子配置)分离，二者皆可编辑、皆确定 | R6/R14 |
| **接入** | I1 三模式+登记 | 合成/上传/对接，新类型必登记 `data-categories.ts` | — |
| | I2 上传→重生成闭环 | 上传→建模→发布(Action)→**自动重物化/重派生/重跑求解器** | R4 |
| **物化派生** | M1 物化 | RawDataset→ObjectInstance，**默认也走 R4 门** | R4 |
| | M2 派生+时序 | DerivationSpec + TsAgg，新派生须登记 | R7 |
| **切片求解** | S1 切片 | 新类型**自动生成 coverage slice** + 场景 mustIncludeTypes | R12 |
| | S2 求解器 | 注册 SOLVER_KEYS + chain:check | R11 |
| **渲染溯源** | V1 **声明式渲染** | ViewDef 契约（query kinds/期望输出/字段绑定），前端零写死 | R14 |
| | V2 溯源 | Provenance + lineage，**补派生级**"谁算的这个值" | R13 |
| **闭包治理** | C1 闭包 | object/data/forward/CHAIN/SHAPE，**HARD 默认** | R12 |
| | C2 真值审批 | ActionType→approval→真 domainExecutor | R4 |
| | C3 缺口诚实 | GapReport 7 码 + VLE 七段，断即 BLOCKED | R10 |
| | C4 **回填** | backfill 故事脚本 + SOLVER_TARGET_VIEW，建域可验证 | R11 |
| **横切** | X1 租户 | tenantId everywhere | R2 |
| | X2 确定性 | seed 字节一致 + **测试证明** | R6 |
| | X3 事件失效 | OutboxEvent/订阅，**≤60s SLA 可证** | R10 |
| | X4 **指标+责任** | KPI 注册进 `Metric`(target/actual) + `Principal`(owner) | R-一致 |
| | X5 数据源健康 | DataSourceHealth 新鲜度→P90 降级 | R13 |
| | X6 **CLI 对等** | OPERATION_CATALOG 命令镜像 | R15 |

## 3. 系统 AS-IS 审计结论（18 阶段，~60–70% 落地）
| 维 | 状态 | 锚点 | 缺口 |
|---|---|---|---|
| T1 模版单一源 | ✅ | `data-template.ts:41 buildDataTemplates` 读 ObjectTypeDef | battery 种子与模版解耦 |
| T2 模版生命周期 | ❌ | `battery.ts:716 BATTERY_TEMPLATE` 代码常数；`service.ts:116 resolveTemplate` 从不读库 | **无上传建/改模版入口**（仅 GET，无 POST） |
| T3 模版+种子双层 | ◐ | `generateBattery(seed)` 用**写死** BASES/MODELS/CUSTOMERS(battery.ts:9-34) | 改模版≠重生成 |
| I1 三模式+登记 | ✅/◐ | `data-categories.ts:14-63` 三模式登记 | 新类型不强制登记 |
| I2 上传→重生成闭环 | ◐ | `modeling.ts:81 deriveModelingSuggestion`→publish | **发布后不自动重生成对齐** |
| M1 物化 | ✅/◐ | `origin=MATERIALIZED`；`actions.ts:117` 审批链 | 默认物化未强制 R4 门 |
| M2 派生+时序 | ✅ | TsAgg `battery.ts:791`；派生引擎 | 派生须手动登记 |
| S1 切片 | ✅/◐ | `batteryCoverageSlices() data-categories.ts:75` | 新类型不自动生成切片 |
| S2 求解器+chain | ✅ | `solvers/service.ts:17`；`check-chain-closure.mjs` | 仅 CI、无 pre-commit |
| V1 声明式渲染 | ◐ | SHAPE 门 `closure.ts:119`；renderBindings | **无 ViewDef 注册表，渲染散在前端 React** |
| V2 溯源 | ✅/◐ | `origin`(domain.ts:328)；ObjectPropHistory | lineage 端点/派生级溯源不全 |
| C1 闭包 | ✅ | `closure.ts:15 validateClosure` | **policy 可配 SOFT/DROP，HARD 非默认** |
| C2 真值审批 | ✅/◐ | `actions.ts:50` 状态机 | **executor 仍 Mock**，真 domainExecutor 待 |
| C3 缺口诚实 | ✅ | `selfcheck.ts:12`；`vle.ts:7` 七段 | — |
| C4 回填 | ◐ | `comprehend.ts:327 deriveBackfillScripts` | 新模块未接 |
| X1 租户 | ✅ | repo 层 tenantId 过滤 | 无 |
| X2 确定性 | ✅/◐ | `prng.ts mulberry32` | **无"seed→字节一致"测试证明** |
| X3 事件失效 | ✅/◐ | `outbox.ts:39` | **无 60s SLA 证明** |
| X4 指标+责任 | ◐/❌ | spine 提案 Metric/Principal | 未落库、1:1 未反向注册 |
| X5 数据源健康 | ✅ | `datahealth.ts:19` | 仅告警不阻断、无自动发现 |
| X6 CLI 对等 | ❌ | 无 OPERATION_CATALOG | **A15 未实现** |

## 4. PRD 语料审计结论（视觉对齐 ✅ / 数据闭环对齐 ✗）
12 篇 × 18 维矩阵的**系统性遗漏**（覆盖率）：
- **D 回填 8%** · **C 登记 17%** · **Q CLI 8%** · **O 责任 8%** · **N 指标 25%** · **B 上传闭环 25%** · **R 双层 42%** · **P 数据源健康 17%**。
- **反模式**（全部 6 篇 1:1 PRD）：定对象✅→定渲染✅→声明"数据走管线"✅→**漏"怎么登记/怎么回填/怎么证全链闭合"**。
- **根因**：聚焦"1:1 视觉"，未把"接入→登记→回填→重生成→验证 全环"当一等横切。
- **无现成完整清单**：R12/unified-build/A10/spine 各覆盖一角——**本规范即缺失的那份**。

## 5. 顶层系统性缺口与设计
### 5.1 模版生命周期（你点出的两条 → 根治）
**现状**：`BATTERY_TEMPLATE` 是代码常数（battery.ts:716），`resolveTemplate` 直接返回、从不读库（service.ts:116）；`GET /a/v1/industry-templates` 只列库记录、**无 POST/上传**；新行业仅靠 LLM 生成（service.ts:121），**无"上传文件建新行业/客户模版"入口**。
**设计**：
1. **battery 反写进库**：`BATTERY_TEMPLATE` 作种子 upsert 进 `industry_templates`（代码仅兜底），可读/编辑/版本化。
2. **上传建模版入口**：`POST /a/v1/industry-templates`（上传 JSON/CSV → 校验 `IndustryTemplateSchema` → 存库）+ **从 battery fork 新行业/客户模版**；前端"行业/客户模版"管理页（建/改/fork/版本）。
3. **模版变更走 R4**：审批后 `runSynthetic(industry)` 按新模版 objectTypes/字段/propGenerators **确定性重产**（R6）。
4. **三方同源库读**：合成/数据构建发动机/`buildDataTemplates` 一律读**库里的 IndustryTemplate**，不读代码常数。
### 5.2 模版↔种子双层（T3）
把 `BASES/MODELS/CUSTOMERS/BOTTLENECKS`（battery.ts:9-34 写死）抽进 `IndustryTemplate.generation[].propGenerators` 作**种子配置**；`generateBattery` 读配置不读硬编码。→ 改 schema(形) 或 种子配置(值) 都触发确定性重生成。
### 5.3 新对象类型自动 onboarding（消"手改 5+ 文件"）
发布 ObjectType → 触发自动登记流水线：①自动建 `coverage_${TypeKey}` 切片 ②自动并入最近域 DataCategory ③发 `type.registered` 事件 → 渲染/特性 scaffold。门：`auto-onboard:check`（新类型缺任一登记即红）。
### 5.4 声明式渲染契约（V1，挡 G-2）
前端视图向后端注册 `ViewDef`（query kinds/期望输出/字段绑定）；闭包 SHAPE 门校验 `ViewDef ⊆ solver 输出`；新求解器→自动 scaffold 视图骨架。
### 5.5 CLI 对等（X6/R15）
落 `OPERATION_CATALOG` + `@platform/cli`（build-data/run-synthetic/invoke-solver/validate-closure/templates…），`cli-parity:check` 守。

## 6. 逐模块合规 Checklist（**每个模块 PRD §0 必须逐项声明**）
> 达成填 ✅+锚点；豁免填 `// reason`。漏项 = `prd:check` 红。

```
[ ] T1 schema 单一源：对象类型在 ObjectType 注册（非前端/求解器内联）
[ ] T2 模版：新数据可经 IndustryTemplate 上传/编辑/fork（不写死代码常数）
[ ] T3 双层：精确值入种子配置(可编辑)，非 bespoke 代码
[ ] I1 登记：新类型登记 data-categories.ts（三模式 connectorTypeKeys）
[ ] I2 上传闭环：上传→建模→发布(Action)→自动重生成 路径声明
[ ] M1 物化走 R4；M2 派生/时序登记
[ ] S1 切片：自动 coverage slice + 场景 mustIncludeTypes 含新类型
[ ] S2 求解器注册 + chain:check 过
[ ] V1 声明式渲染 ViewDef（前端零写死 R14 / debattery:check）
[ ] V2 溯源 R13（Provenance + 派生级 lineage）
[ ] C1 闭包 HARD 过；C3 缺口诚实（断显 GapReport 码）
[ ] C2 真值经 Action 审批；C4 backfill 脚本 + SOLVER_TARGET_VIEW
[ ] X1 tenantId；X2 确定性 + 字节一致测试；X3 事件失效 ≤60s
[ ] X4 KPI 注册进 Metric(target/actual) + Principal(owner)
[ ] X5 数据源健康/新鲜度→P90；X6 CLI 命令 + cli-parity:check
```

## 7. 门禁补强（让漏项编译期红）
| 门 | 现状 | 补强 |
|---|---|---|
| `closure` | 可配 SOFT/DROP | **HARD 默认**，SOFT 须显式声明理由 |
| `chain:check` | 仅 CI | + pre-commit hook |
| `shape:check` | SHAPE 维在闭包内 | 独立 `ViewDef ⊆ solver 输出` 门 |
| `cli-parity:check` | 待落(A15) | 落 + 棘轮基线 |
| `template-lifecycle:check` | 无 | 新：模版必库化（无新代码常数模版） |
| `auto-onboard:check` | 无 | 新：发布类型→五处登记齐 |
| `prd:check` | 校验 §0 R/G | + 校验**本 §6 checklist 逐项声明** |

## 8. 分期
- **DC.1**（根因）模版生命周期（5.1）+ 模版↔种子双层（5.2）+ `template-lifecycle:check`。
- **DC.2** 自动 onboarding 流水线（5.3）+ `auto-onboard:check` + closure HARD 默认。
- **DC.3** 声明式渲染 ViewDef（5.4）+ `shape:check` + 派生级 lineage（V2）。
- **DC.4** 指标/责任收口（X4，接 spine）+ backfill 接各模块（C4）+ 数据源健康阻断（X5）。
- **DC.5** CLI 对等（5.5，接 A15）+ 确定性/事件 SLA 测试证明（X2/X3）。
- **DC.6** checklist 并入 `_PRD-TEMPLATE.md §0` + `OPERATING-MODEL.md`；回填存量 1:1/骨架 PRD 的漏维（C/D/R/B/N/O/Q）。

## 9. 回写本体承诺
`IndustryTemplate 一等化 / ViewDef / OPERATION_CATALOG / auto-onboarding 链路 / closure HARD` 落地后回写本体 §2（对象类型）·§3（链路）·§7（门禁）·§10（切片 `sys.ingest.template_to_seed` 新增）·§5（R12 升 HARD、R14 含声明式渲染、R15 落 cli-parity）。

---
> 这份规范是"接入→…→CLI"全环的**单一权威 + 逐模块强制清单 + 编译期门禁**。落地后，新模块 onboarding 从"手改 5+ 文件、漏维无人知"变为"声明式模版 + checklist 必填 + 门禁拦截"。建议并入交付 zip，作为所有模块 PRD 的上位约束。
