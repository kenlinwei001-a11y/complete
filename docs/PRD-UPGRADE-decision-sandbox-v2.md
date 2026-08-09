# PRD · 决策推演沙盘 · 重大升级（统一版 v2.0）

> 2026-08-09 · 审核方 · 起因：仓主「重新梳理决策推演沙盘的 PRD，把我发的所有 PRD 或者信息都整理完毕，
> 然后基于目前系统已经开发的功能、数据，以及开发了的推演沙盘，重新设计一版重大升级项目」
> ＋「包括之前我提到的曾经开发的 skill 升级项目，都合并梳理」
>
> **本文是决策推演沙盘的唯一权威 PRD。** 此前散落的 29 份沙盘文档 + 8 份 Skill 文档，
> 归并口径见 §0.3；冲突时**以本文为准**。

---

## 0. 本 PRD 的地位

### 0.1 North Star（仓主原话 · 一切设计以此为准）

> **让决策者一眼就了解全流程端到端的卡点，堵点，断点，韧性不足，消耗大的部分，
> 包括流程，时长，决策复杂度等等，输入变量，推演决策的可行性。**

这句话拆成九个可计算维度，是本次升级的验收标尺（详见 §5.1）。

### 0.2 三条已生效的裁决（仓主已定，本文不再讨论）

| # | 裁决 | 出处 |
|---|---|---|
| ① | **流程审批不体现** —— 审批链/权限矩阵整块砍掉 | 仓主 2026-08-09 |
| ② | **只补真数据，不做 mock；写死在前端的数据都不行** | 仓主 2026-08-09（已建门，§7.3） |
| ③ | **不做 8 个页面** —— 八页 UI PRD 是借鉴材料，不是施工单 | 仓主 2026-08-09 |

### 0.3 文档归并表（这份取代什么）

**输入源（仓主给的 5 份）**

| 代号 | 来源 | 本文吸收进哪节 |
|---|---|---|
| S1 | 端到端产销业务数字孪生流程（14 步 Demo 链） | §5.2 验收剧本 · §6 WO |
| S2 | Enterprise Decision Twin PRD（7 世界 / World Fork / Delta Sim / 影响传导 / 23 Skill / 5 表） | §3 · §4 |
| S3 | UI/UX Design Specification V1.0 | §5.3 |
| S4 | 八页 UI PRD（页面已裁，能力逐条保留） | §5.3 借鉴台账 |
| S5 | 锂电制造企业端到端业务孪生节点/流程/变量全量模型 V1.0（13 域 × 65 流程 × 300+ 对象） | §3.2 |
| S6 | Enterprise Decision Twin 工业级开发 PRD（字段级 Schema · PostgreSQL DDL · Neo4j） | §4 |

**我此前的裁决文档（保留为证据，不再单独维护）**

| 文档 | 状态 | 本文对应节 |
|---|---|---|
| `PRD-enterprise-decision-twin.md` | 🔻 降级为证据附录 | §2 §3 |
| `DECISION-twin-feature-triage.md`（78 项三分类） | ✅ 结论并入 | §6.4 |
| `RECONCILE-twin-8pages-ui.md`（20 条复用台账） | ✅ 结论并入 | §5.3 |
| `REQ-LEDGER-sandbox.md`（148 条勾选台账） | ✅ **继续维护** —— 它是防漏机制，不是叙述 | §7.4 |
| `AUDIT-demo-chain-atomic.md`（52 项原子需求） | ✅ 结论并入 | §5.2 |
| `DECISION-13domain-65process-layering.md` | ✅ 结论并入 | §3.2 |
| `WO-PACK-twin-data.md`（D 层六单） | ✅ **仍是可派发件** | §6.1 |
| 8 份 Skill PRD/SPEC（4209 行） | ✅ 并入第三主动脉 | §3.3 |

**归并纪律**：以上文档一律**不删**（它们承载 file:line 证据与我的记账），
但**新的改动只写本文**。发现两处打架 → 以本文为准，并回写被取代的那份加一行「已被 v2.0 取代」。

---

## 1. 《本体引用与影响》（铁律 0 强制章节）

- **触及对象类型**（本体 §2）：
  `SimSession` · `SimTickState` · `SimCheckpoint` · `PropagationRule`（已有四类）
  ＋ **`Perturbation`**（🆕 本次核心新增，§3.1）
  ＋ **`ProcessDefinition` / `ProcessChainNodeMap`**（🆕 §3.2）
  ＋ `SkillDefinition`（🔗 扩字段，§3.3）
  ＋ 复用：`OntologyType` `ObjectRecord` `LinkRecord` `RuleEntry` `Decision` `ActionDraft` `Cadence` `CausalFactor` `SliceSpec`
- **触及链路**（§3）：
  `扰动注入 → propagateTick 传导 → 阻滞点识别 → 候选枚举 → 方案比对 → Decision → ActionDraft`
  —— 本次升级要闭合的正是**第一段（扰动注入）与最后一段（决策落地）**，中间三段已建成。
- **触及不变量**（§5）：
  R2 tenant_id everywhere · R4 模拟态不写真值（扰动只改 TickState，采纳才出 ActionDraft）·
  R6 确定性（同扰动同种子同结果）· R9 仓储双实现 · R14 零业务常数 · R16 走正门读数据
- **关闭的断点**：
  **#150**（扰动入口零调用方）· **#151**（act 清空 pending）· **#130**（`SimSession.scope` 有写端无读端）·
  **#152**（Trial Tick 跑错栈，传导恒记 0）· **#153**（Skill 四条分支未并）· **#154**（solver precondition 静默丢弃）·
  **R060**（扰动无时序维）· **R143**（只有 3 条传导边）
- **需修正的既有账**：**#124**（`agent.skill-on-free-qa` demo 上是关的 —— **已过期**，见 §3.3.0）·
  **#125**（WO-SKILL-3 五处退单点 —— **计数与并入状态均已过期**，见 §3.3.0）
- **门禁**（§7）：`SEAM-GATE` 接缝驱动测 · `check-debattery` 探测器 B（无 mock 数据）·
  `check-chain-node-singlesource` · 🆕 `check-process-chain-map`
- **回写承诺**：见 §8。

---

## 2. 实测基线 —— 今天到底建成了什么

> 这一节全部是 **2026-08-09 亲手 grep 到的事实**，不是规划。每条带 `file:line`。
> 报否定结论处均先跑金丝雀证明工具有效（证据见 §2.5）。

### 2.1 已建成、且真接线的（**复用，禁止重造**）

| 能力 | 承载物 | 证据 |
|---|---|---|
| 沙盘会话状态机 | `sim_session` 表 + `SimSessionSchema` | `migrations/026_sim_sessions.sql` · `contracts/sim.ts:88` |
| 逐 tick 态快照 | `sim_tick_state`（复合主键 session+tick） | `026:16` · `contracts/sim.ts:101` |
| 命名存档 / 回滚 | `sim_checkpoint` + `/checkpoint` `/rollback` | `app.ts:1488` `app.ts:1497` |
| **世界分叉（World Fork）** | `parentCheckpointId` + `POST /branch` + **真按钮** | `app.ts:1506-1518` · `SandboxView.tsx:636`(`sandbox-branch-btn`) · CLI `platform-cli.mjs:127` · **已建成，S2 说的 World Fork 不用做** |
| 双世界比对 | `GET /a/v1/sim/compare?a=&b=` + `SimComparePanel` | `app.ts:1519` · `SandboxView.tsx:576` |
| 仓储双实现 | `SimRepo` 13 方法 · memory + pg 全实现且语义无漂移 | `repo.ts:341-355` · `memory.ts:32` · `pg.ts:38` |
| 真传导核 | `propagateTick`（纯函数·392 行） | `sim/propagation.ts:219` ← 生产调用方 `app.ts:1458` |
| 传导规则一等对象 | `sim_propagation_rule` 表 + CRUD 路由 | `026:38` · `app.ts:1525/1530` |
| 「改规则即改推演」 | `coefficientRef → rule.params` | `contracts/sim.ts:54` |
| 节拍闸门 | `cadenceNodeId` + `buildCadenceGates` | `contracts/sim.ts:57` · `propagation.ts:120` |
| **诚实缺席出口** | `unresolvedGates[]`（读不回来显式报缺，不给默认值） | `app.ts:1475` |
| 24 节拍节点单源 | `CHAIN_NODE_REGISTRY`（S0 冻结） | `contracts/chain-sim.ts:150` |
| 地铁线路图 | `chainLineMap.ts`(985) + `ChainLineMapView.tsx`(940) | 已存在 |
| 就绪认证 | `sim/certification.ts` + `/certification` `/scope-precheck` | `app.ts:1669/1677` |
| 决策台账 | `decisions` 表 + `decision-kernel.ts` | `migrations/027_decisions.sql` |
| 结构化扰动（**求解器域**） | `OptPerturbation`（4 kind） | `contracts/opt-template.ts:84` |
| 因果因子 | `CausalFactor` + `caused_by` | `contracts/gap-attribution.ts` |
| 本体切片 | `slice_specs` 表 + `SliceSpecRecord` + `executeSlice` | `migrations/008:43` |
| 阻滞点检测 + 候选枚举 | `chain-impediment.ts`(799) + `impediment-options.ts`(760) | `chain-impediment.ts:719/761` |
| 损失归因 | `chain-loss.ts`(940) | `solvers/service.ts:3053` |
| 决策三态内核 | `PROPOSED/COMMITTED/REALIZED` + commit 派 ActionDraft | `decision-kernel.ts:29` · `decision/kernel.ts:145-177` |

**结论：S2 提的「World Fork / Delta Simulation / 影响传导」三件，平台已经有了骨架。**
本次升级不是造这三件，是**把它们接上用户**。

**⚠️ 三处「建成但用完就丢」（不是缺陷，但影响 §5 的子页设计）**

1. **分叉出来的子会话没有持久读端** —— `branchId` 只活在组件 state（`SandboxView.tsx:267`），刷新即丢；
   前端没有任何 `useQuery` 读 `GET /a/v1/sim/sessions`（仓库自己记了这条账：`eventInvalidation.ts:67/75`）。
   ⇒ 「7 个世界并存对比」今天做不到 —— 能分叉，但分完找不回来。
2. **Agent 够不到分叉** —— `SIM_COMMANDER_TOOLS` 只有 4 个（`tools/registry.ts:457`）：
   `sim_init` / `sim_tick` / `sim_world` / `sim_certify`，**无 `sim_branch` / `sim_checkpoint`**。
3. **`chain_loss_attribution` 只认 `so`，不吃范围/时窗维** —— 时窗控件因此在屏上被禁用
   （`SandboxConsole.tsx:133-134/367/524`，已诚实标注）。子页④ 的筛选器要按这个约束设计。

### 2.2 🔴 建了没接线的（本次升级的主战场）

#### ① **沙盘唯一的扰动入口零调用方**（欠账 #150 · 本次最大发现）

`POST /a/v1/sim/sessions/:id/act`（`app.ts:1479`）是**世界里唯一能施加扰动的路由**。
实测它的调用方：

- 前端 `endpoints.ts` 封了 `tick` `world` `checkpoint` `certification` `scope-precheck` `branch` `compare` —— **没有 `act`**
- agentcore：0 命中
- 测试：0 命中

🐤 金丝雀：同一条 grep 在 `endpoints.ts` 命中 **16 个** sim 端点 ⇒ 工具有效，「0」是真的 0。

> **这意味着：用户今天在沙盘里能推进时间、能存档、能分叉、能比对，唯独不能施加任何扰动。**
> 「扰动 → 传导 → 影响」这条主链**没有用户入口**。
> 这解释了为什么沙盘看起来什么都有、却回答不了 North Star 的任何一问 —— 因为它从来没被扰动过。

#### ② 扰动的形状本身不足以承载业务语义

```ts
// app.ts:1482 —— 这就是今天「扰动」的全部
const b = req.body as { objectId: string; stateVar: string; value: number };
(state[b.objectId] ??= {})[b.stateVar] = Number(b.value);
```

一次扰动 = **把某个对象的某个状态变量设成某个数**。它没有：

| 缺什么 | 后果 | 对应需求 |
|---|---|---|
| `kind`（语义类型） | 「设备停机」「原料涨价」「供应商断供」塌缩成同一个「设一个数」，前端无法分类展示 | S2 五类扰动 |
| `startTick` | 只能作用于「当前 tick」，无法排「第 5 天开始」 | **R060** |
| `durationTicks` | **永不回退** —— 「停机 72h」被跑成永久停机 | **R060**（Demo 链阶段 2） |
| `id` / 持久化 | 扰动不是实体，只是一次副作用；无法列举「这个世界受过哪些扰动」 | S6 `perturbation` 表 |
| 溯源 | 无法回答「这个结果是哪次扰动造成的」 | North Star「断点」维 |

#### ③ `/act` 无条件写 `pending: []`（欠账 #151 · 今日潜伏，接线即炸）

```ts
// app.ts:1485
await repos.sim.putTickState({ ..., state, pending: [], trace: null });
//                                        ^^^^^^^^^^^ 无条件清空
```

而 tick 路由正是从这里读回在途延迟贡献（`app.ts:1433`）。
`seed.ts:250` 的 `demo_line_util_to_base_load` 带 `delayTicks: 1` ⇒ demo 租户跑一次 tick 后 `pending` 必然非空。

⇒ `tick → act → tick` **静默丢掉全部在途传导**。
今天不炸，只因为 ① 让 `act` 根本没人调；**一旦按本 PRD 接上入口，它立刻变成线上静默错答。**
**故 §6 的 WO-P1 必须把 ①③ 放在同一张单里做 —— 拆开做就是制造一个已知会炸的中间态。**

#### ④ 传导网只有 3 条边（欠账 R143）

`seed.ts` 实测三条，全部集中在需求侧：

| key | 源 → 靶 | 系数 | 延迟 |
|---|---|---:|---:|
| `demo_order_demand_pressure` | `Order` →(order_for_model)→ `Model` | 0.8 | 0 |
| `demo_model_demand_to_base_load` | `Model` →(model_producible_at)→ `Base` | 0.6 | 0 |
| `demo_line_util_to_base_load` | `Line` →(line_belongs_to_base)→ `Base` | 0.5 | 1 |

三条边全部指向 `Base.load`。**供应/物料/产能/交付/成本/现金 六个方向一条边都没有。**
⇒ 无论施加什么扰动，传导都只会走到「基地负载」为止，走不到 North Star 要的「断点/消耗/时长」。
**这是「接了线没数据」形态：引擎是对的，图是空的。**

#### ⑤ `SimSession.scope` 有写端无读端（欠账 #130）

`scope` 字段在建会话时写入（`app.ts:1391`，前端真写 `{kind,target}` 于 `SandboxView.tsx:308`），
但 `propagateTick` 的入参里**没有 scope** —— tick 路由建图**无条件全本体**
（`app.ts:1436-1441`：遍历所有类型所有对象 + `links.list`，一行都没碰 `s.scope`）。

全仓 `scope` 读端逐处追完，**没有一处读 `{kind,target}`**：`app.ts:1408` 只读 `snapshotKind` 一个键；
`app.ts:1512` 分叉整体透传；`app.ts:1705/1707/1732/1742/1751/1769/1788/1798` 全是 live-scenarios
把 `scope` 列当快照 JSON 容器用，与沙盘范围语义无关。连 `scope-precheck`（`app.ts:1677-1684`）
与 `certification`（`:1669-1675`）的 scope 都取自 query，`:id` 只用于 404 隔离。
唯一读端在前端且只用于**显示**（`SandboxView.tsx:521` 回显 · `:285-287` 漂移告警）。

⇒ 「局部推演」在引擎层**根本不存在**（形态①：写端接了线，读端从没写过），切 LOCAL 算的仍是 GLOBAL。

#### ⑥ 沙盘就绪认证的「Trial Tick」跑的是**另一套栈**（新发现 · 形态④）

`assembleCertification`（`app.ts:1582`，被 `/certification` `:1674` 与 `/scope-precheck` `:1682` 调用）
里的 Trial Tick 调的是 `ontologyCore.recompute`（`app.ts:1628`），**不是 `propagateTick`**。
`app.ts:1630` 的 `rulesFired = rc.order.length` 只统计**派生**规则。

且 `app.ts:1625` 的注释至今写着「propagateTick 待增量3 → 传导记 0」——
**而传导栈今天已经实装并有生产调用方（`app.ts:1458`）。注释停留在传导未实装的时代。**

⇒ 用户在认证屏上看到「Trial Tick 通过 · rulesFired=N」，度量的是派生栈；**传导栈恒记 0**。
这是典型的「信号是真的，只是它不指向我要断言的那个对象」。

### 2.3 真缺的（今天连骨架都没有）

| 缺口 | 实测 | 影响的 North Star 维 |
|---|---|---|
| **业务流程层** | `ProcessDefinition` / `ProcessInstance` / `ProcessTask` / `BusinessProcess` **全仓 0 命中** | 流程 · 时长 |
| **Perturbation 一等对象** | 见 §2.2① —— 无表、无契约、无实体 | 输入变量 · 推演可行性 |
| **Constraint 一等对象** | `OptConstraintFamily` 只活在求解器内部，无表无 CRUD | 推演可行性 |
| **韧性缺口 `resilienceGap`** | 零承载物 | 韧性不足 |
| **决策复杂度 `decisionComplexity`** | 零承载物（且耦合分量今天算不准 —— 只有 3 条传导边） | 决策复杂度 |
| **Skill 可执行化** | `SkillDefinition` **无 `execution` 字段**（`contracts/agentcore.ts:236-262`）——今天 Skill 是提示词片段。⚠️ 但**编排器/编译器的实现已在四条未并分支上**（§3.3.1） | §3.3 |

### 2.4 平台 vs S5 全量模型（逐项对账）

| 模型层 | S5 目标 | 平台实测 | 差距性质 |
|---|---:|---:|---|
| 一级业务域 | 13 | **0**（只有 `DataCategory` 归类） | 🆕 轻·纯分类 |
| 核心业务流程 | 65 | **0** | 🆕 **主缺口** |
| 一级本体对象 | 300+ | **86 已物化** · 33 处 `def()` | 🔗 补面 |
| 动态状态 | 500+ | 多套独立状态机，无统一状态本体 | 🔗 统一 + 补 |
| 动态事件 | 300+ | outbox **79 处 emit**，`sim.*` 5 个里仅 1 个有订阅方 | 🔗 补订阅方 |
| 业务规则 | 300+ | `RuleEntry` **252 条** | ✅ 基本够 |
| 约束 | 300+ | **52**，且无一等对象 | 🆕 建 Constraint |
| Solver | 10 类 | **59 个** | ✅ **超配**，需按 10 类归档 |
| Agent | 15 类 | **5 角色** | 🔗 补 10 |
| Skill | 150+ | **7 条种子**，且是提示词片段 | 🆕 **大缺口** |
| **传导边** | （S5 未给） | **3 条** | 🆕 **本次真正卡脖子的那项** |

**⇒ 差距最大的四项：传导边（3）· 流程层（0/65）· Skill 可执行化（0）· Perturbation（0）。**
**规则与求解器反而是超配的 —— 本次升级不碰它们。**

### 2.5 🐤 金丝雀证据（铁律 0.6 强制 · 所有否定结论的自证）

| 我报的否定结论 | 金丝雀 | 命中 | 判定 |
|---|---|---:|---|
| `/act` 零调用方 | 同条 grep 在 `endpoints.ts` 找 `sim/` | **16** | 工具有效 ⇒ 0 是真 0 |
| `sim.ts`/`global-sim.ts` 无时序扰动字段 | 同文件找 `z.object\|export const` | **25 / 31** | 工具有效 ⇒ 0 是真 0 |
| 全仓无图数据库 | `Grep` 工具找 `neo4j\|cypher\|gremlin` | **4 个文件，全是 docs** | 有效 ⇒ 零代码零依赖 |
| `ProcessDefinition` 0 命中 | （沿用 08-09 上午同一次扫描，金丝雀已过） | — | 见 `DECISION-13domain-65process-layering.md §3` |

---

## 3. 三条主动脉（本次升级的架构主张）

> 只有三条。每条都对应 §2 里一个**已坐实的**缺口，不是想象出来的功能。

### 3.1 主动脉一 · **扰动升格为一等公民**（关闭 #150 #151 R060）

**这是本次升级的心脏。** 没有它，其余全部是装饰。

#### 3.1.1 为什么是它

平台有传导核、有世界、有分叉、有比对、有决策台账 —— **唯独没有「事情发生了」这个概念**。
沙盘今天是一个**没有天气的气象模型**：一切都建好了，但从没有人往里面吹过一阵风。

#### 3.1.2 新契约 `Perturbation`

放 `packages/contracts/src/sim.ts`（**不新开文件** —— 它属于沙盘域）：

```ts
/** 扰动语义类型：决定前端怎么分类展示、以及默认落在哪个 stateVar 上 */
export const PerturbationKindSchema = z.enum([
  "demand_shift",      // 需求突变（追加订单 / 砍单）
  "supply_disruption", // 供应中断（供应商断供 / 到货延迟）
  "capacity_loss",     // 产能损失（设备停机 / 人员缺勤）
  "cost_shock",        // 成本冲击（原料涨价 / 汇率）
  "quality_event",     // 质量事件（批次不良 / 召回）
]);

export const PerturbationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),                    // R2
  sessionId: z.string(),                   // 属于哪个世界
  kind: PerturbationKindSchema,
  targetObjectId: z.string(),
  targetStateVar: z.string(),

  // ── R060 的三个时序字段（今天全缺，这是本次真正的新东西）──
  startTick: z.number().int().min(0),      // 何时开始
  durationTicks: z.number().int().min(1).nullable().default(null), // 持续多久；null = 永久
  magnitude: z.number(),                   // 幅度
  mode: z.enum(["set", "delta", "scale"]).default("set"), // 设为 / 增减 / 乘以

  label: z.string().max(200),              // 人话（「常州 A 线停机 72h」）
  createdAt: z.string(),
});
```

**四条设计判据（每条都有来历）**

1. **`durationTicks` 必须可空** —— `null` = 永久，等价于今天 `/act` 的行为
   ⇒ **additive 可回退**：不填时间维的老调用逐字节同旧行为。
2. **`mode` 三选一而非只有 `set`** —— 「涨价 15%」是 `scale`，「加 200 台」是 `delta`，
   「停机」是 `set 0`。只给 `set` 会逼前端自己算，那就是第二套真相源。
3. **`kind` 不进传导规则** —— 它只管**展示分类与默认落点**，传导仍由 `PropagationRule` 决定。
   两者混起来 = 把「发生了什么」和「它怎么扩散」焊死，换行业就要改代码。
4. **不新建 `perturbation` 表** —— 见 §4.2，走 `sim_tick_state` 同族的 doc-jsonb 新表，
   但**表名与字段照 §4.1 的裁决走**。

#### 3.1.3 引擎改动（最小面）

`propagateTick` 增加**一个**入参（第 8 位，可选）：

```ts
export function propagateTick(
  graph, state, rules, pending, tick, ruleParams = {}, gates = {},
  perturbations: Perturbation[] = [],   // 🆕 本 tick 生效的扰动（已按 startTick/duration 过滤）
): { next; pending; trace; unresolvedGates; appliedPerturbations: string[] }  // 🆕 溯源
```

生效判据在**调用方**算（保持 `propagateTick` 纯函数 R6）：

```
active(p, t)  ⇔  t >= p.startTick  且  (p.durationTicks === null  或  t < p.startTick + p.durationTicks)
```

**回退（`durationTicks` 到期）**：在 `startTick + durationTicks` 那一 tick 把该 stateVar
**还原为「若无此扰动本应有的值」** —— 实现上记 `preValue` 于扰动生效当 tick 的 trace，
到期时反向施加。⚠️ 这是本次唯一一处需要状态记忆的地方，必须有独立测试。

#### 3.1.4 补齐传导边（关闭 R143 —— **这条决定升级成不成**）

引擎再好，图只有 3 条边就走不到 North Star。本次至少补到**六个方向各有一条链**：

| 方向 | 需要的边（示例） | 用来回答 North Star 哪一维 |
|---|---|---|
| 需求 | ✅ 已有 3 条 | — |
| 供应 | `Supplier.deliveryDelay → Material.available → Order.shortage` | 断点（MATERIAL） |
| 产能 | `Line.downtime → Base.capacity → Order.lateRisk` | 卡点（BOTTLENECK） |
| 交付 | `Base.load → Shipment.leadTime → Order.otd` | 时长 |
| 成本 | `Material.price → Order.cost → Margin` | 消耗大的部分 |
| 现金 | `Order.otd → Receivable.days → Cash` | 消耗大的部分 |

**纪律**：这些边是**数据**（`sim_propagation_rule` 行），不是代码。
补边 = 补种子，不改引擎。**任何 dev 想改 `propagation.ts` 来实现某个方向 = 退单。**

---

### 3.2 主动脉二 · **流程层承载 65 流程**（24 节拍节点冻结不动）

> 完整论证见 `DECISION-13domain-65process-layering.md`，此处只留结论与派单红线。

#### 3.2.1 结论：「24 太少」判断对，但改的地方不是 `CHAIN_NODE_REGISTRY`

那 24 条**不是流程数**，是**链路节拍节点**，测的是「时间与损失落在哪一段」。
S5 的 P01–P65 是**业务流程**，测的是「企业里有哪些业务活动」。
**两层不同粒度，不能互相替代，也不能合并。**

| | 链路节拍层（现有 24） | 业务流程层（新增 65） |
|---|---|---|
| 回答什么 | 时间/损失落在哪一段 | 企业有哪些业务活动 |
| 载体 | `CHAIN_NODE_REGISTRY` **静态冻结契约** | `ProcessDefinition` **数据** |
| 能不能改 | ❌ 前 12 逐字冻结，只能末位追加 | ✅ 配置驱动 |

**不能动 24 的实测理由**：契约 `chain-sim.ts:150` 自己写着「前 12 条是 S0 冻结的原表，
**一个 id 都没动**：改任何一个已在册 id = 把『交集为 0』的事故复现一遍」；
两道单源门盯着；前端测试甚至按**下标**取样（`[4] === capacity.schedule`）。

**平台已有先例**：`capacity.op.<opId>` 动态工序命名空间 ——「数量随实例变的东西不进静态表」。
**65 流程走的就是这条路。**

#### 3.2.2 映射是 N:M，必须显式声明

- 一个 `P##` 可跨多个链路节点（`P40 APS排产` 跨 `capacity.schedule` + `capacity.op.*`）
- 一个链路节点可被多个 `P##` 共用（`capacity.schedule` 同时是 `P37 MPS` 与 `P40 APS` 的落点 —— 全仓只有一个排产承载物）

⇒ 建 `process_chain_node_map`，**不许前端与引擎各自推断**。新增单源门 `check-process-chain-map`。

#### 3.2.3 每个 `P##` 必须有三件

`ownerFunctionKey`（谁做）· `stdDuration`（多久）· `waitKind`（卡在哪种等待）
—— 这正是 `WO-PACK-twin-data.md` D4 单要补的，范围从 24 扩到 65。

**红线**：**论证不出承载物的流程节点是空壳不是建模。**
（来历：契约里 `P4 APS` 那条 —— 当年没硬拆成两个节点，正是因为「全仓只有一个排产承载物」。）

---

### 3.3 主动脉三 · **Skill 从提示词片段升格为可执行单元**（合并 Skill 升级项目）

#### 3.3.0 🔴 先纠三条我此前说错/说过期的（实测推翻）

> 照铁律 0.6，错了就当场改，并留下推翻它的证据。

| 我此前说的 | 实测 | 证据 |
|---|---|---|
| 「`agent.skill-on-free-qa` 在 demo 上实测是关的」（欠账 #124） | ❌ **已过期**。契约默认确实是关（`features/registry.ts:120` · `features.ts:120`，且列入 `QOS_DARK_LAUNCH_FEATURES` `features.ts:166`），**但 demo 生产态是开的** —— `seed.ts:94` 在 `DEMO_LIGHTUP` 里显式置 `true`，经 `seedDemoEntitlements` `:154` 落库 | #124 很可能是在**单测语境**观测的：`seed.ts:38-42` 注释写明该表只在生产 `SEED_DEMO=1` 路径播种，不进基座 `seedDemo`，而单测 `makeApp` 只调 `seedDemo`。开态实测见 `PRD-demo-lightup-2.md:14`（工具集 27→28 含 `load_skill`，5 个 `skl_*` 进池，`load_skill` 真被调） |
| 「WO-SKILL-3 的 5 处退单点至今未收」（欠账 #125） | ❌ **计数与状态都已过期**。`fef59a23`「WO-SKILL-3 复验并入：**6 处**退单点自修」**已在 canonical 上** | `git merge-base --is-ancestor fef59a23 HEAD` = YES |
| 「Skill 升级项目 = 8 份 PRD，今天基本没落地」 | ❌ **严重低估**。WO-SKILL-1/2/3 三张单**全部已并 canonical**；更关键的是**五份 PRD 的实现工作已经写出来了** | 见 §3.3.1 |

#### 3.3.1 🔴 真正的发现：Skill 升级项目**不是没做，是做完了没并线**

实测四条 handoff 分支，**一条都不在 canonical 上**：

| 分支 | 提交 | 内容 |
|---|---|---|
| `handoff-skill-orchestrator-s1` | `1cffce83` `55bf21d1` | Skill Graph 契约 + 拓扑分层/环检测编译器 + **`GraphScheduler` + `POST /b/v1/skill-graphs/run`** |
| `handoff-skill-compiler-s1` | `6390d06b` `a7209951` | Parser + 推理图派生 + Validator + **`POST /b/v1/skills/:id/compile`** |
| `handoff-skill-refclosure-a` | `b320f223` `d5429acc` | **引用可校验门接上 skill 发布路 + 关死两层 fail-open** + `ref-closure:check` 防退化门 |
| `handoff-skill-partial-a` | `0b49b75a` `29e2b6dd` | **`maxBudgetRounds` 接线** + `dependsOn` 补种子 + 接缝驱动测 |

> **这解释了今天所有的「零消费方」**：`maxBudgetRounds` 仍是形态②（只有 test 引用 ——
> `skill-contract.test.ts:77` 断的是 `toBe(12)`，只验存取不验行为）、引用可校验门仍不存在、
> 编译器仍不存在 —— **不是因为没人写，是因为写完的东西躺在分支上没进主线。**
>
> **⇒ 本次 Skill 主动脉的第一件事不是开发，是复验并入。** 这比新写任何代码性价比都高。
> （同源纪律：铁律 1 判据 #5「push 与过 gate 是两回事」—— 这四条分支是反例的另一面：
> **推了，但没人复验并线，等于也没落袋。**）

#### 3.3.2 为什么必须并进这次升级，而不是另立项目

沙盘的价值链最后一段是「**发现阻滞 → 枚举候选 → 比对方案 → 落决策**」。
这一段今天靠 `MITIGATION_LIB` 撑着（`solvers/extended.ts:39`，**7 因素 × 20 方案**，
每条只有写死的 `eff/tn/cost` 三元组；`mitigationSelect` 做的是
`score = eff*urgency/(costRank*tn)` 排序取头名 —— 无约束、无搜索、无迭代 ⇒ **不是求解器**）。

⚠️ 一处要说准：`MITIGATION_LIB` 今天是 **fallback，不是主数据源** ——
`extended.ts:86` 优先用注入的 `args.mitigations`（来自 `params.risk.mitigations`，R14 单一来源），
库只在「直接单测无 context」时兜底。**S2 说的 23 个 Skill、S5 说的 150+ Skill，本质是想让这一段可扩展。**

而 Skill 今天**不可执行**：

```ts
// contracts/agentcore.ts:236-262 —— SkillDefinition 的全部字段
id, tenantId, key, version, name, summary,
body,                              // ← 提示词片段（max 50k 字符）
resources, status,
capability?, sideEffect?, inputSchema?, outputSchema?,
references?, dependsOn?, approvalGate?, provenancePolicy?, maxBudgetRounds?
```

**没有 `execution` 字段。** 一个 Skill 被挂到 Agent 上，运行时实测只做四件事：
① 把 `name+summary` 拼进 system prompt（语义 top-6，`agent/prompts.ts:69-78`）；
② `load_skill` 工具按需取 `body` 全文（`agent/loop.ts:399-408/551-571`）；
③ 三个策略钩子（`engine.ts:268` provenance / `:269` 写模式 / `:272`+`:401` 规则预检后验）；
④ 自由问答路径同款拼装（`router/orchestrator.ts:1997-2000`）。
**没有任何独立的 Skill 执行器** —— `GraphScheduler`/`SkillGraph` 在 canonical 上 0 命中（它们在 §3.3.1 那条分支上）。
⇒ 「150 个 Skill」在今天的形状下 = 150 段提示词，不是 150 个能力。

**SPEC 12 层实测对照**：✅ **1 层**（⑧ 规则约束 —— 唯一真接线）· ⚠️ **6 层**（①③④⑨⑩⑪）· ❌ **5 层**（②⑤⑥⑦⑫）。
其中 ⑦ Tool/MCP Binding 比 SPEC 自评还差一档：`SKILL_REFERENCE_KINDS`（`agentcore.ts:216`）
八种 kind 里**根本没有 `tool` / `mcp`** ⇒ 不是「不声明」，是「**声明不了**」。

**🔴 顺带抓到一处形态④（出厂态唯一那条前置约束声明是错的）**：
`seed.ts:1332` 给 `capacity_action_draft` 声明
`references:[{kind:"solver", key:"capacity_forecast", role:"precondition", required:true}]`，
而 `engine.ts:41-51` 的 `skillRuleRefs` 第一个判据是 `r.kind === "rule"` ⇒
**`kind==="solver"` 的 precondition 被静默丢弃，不报错不告警。**
实测结果：precondition rule keys = `[]` ⇒ `engine.ts:272` 整条预检路径对 7/7 种子**永不触发**；
postcheck 只有 `["C03"]` 一条是真跑起来的。
**声明在、消费方在、两者对不上** —— 列入 §6 WO-S0。

#### 3.3.3 本次升级只做**一件**：给 Skill 一个可执行的落点

**不做**：8 份 Skill PRD 里的编译器 / Reasoning Graph 编排器 / 治理学习闭环 / 32 份 ExecutionPlan 迁移
—— 那是独立项目，本次不铺。

**做**：`SkillDefinition` 增一个 **additive 可选**字段：

```ts
execution: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt") }),                                    // 今天的行为（缺省）
  z.object({ kind: z.literal("solver"),  solverKey: z.string() }),            // 复用 59 个求解器
  z.object({ kind: z.literal("slice"),   sliceKey: z.string() }),             // 复用本体切片
  z.object({ kind: z.literal("sim"),     perturbationTemplate: PerturbationSchema.partial() }), // 🆕 接沙盘
]).optional(),
```

**四条判据**

1. **缺省 = `prompt`** ⇒ 现有 7 条种子逐字节不变（additive 可回退）。
2. **`solver` 分支复用已有 59 个求解器** —— §2.4 实测求解器是**超配**的，
   缺的不是求解能力，是「让 Skill 指得到它」的一根指针。
3. **`sim` 分支是本次的接缝**：一个 Skill 可以声明「我这个技能 = 往沙盘里打一个这样的扰动」。
   ⇒ 主动脉一与主动脉三在这里合流，**这就是本次升级的 SEAM-GATE 头号断言**（§7.1）。
4. **不碰 `body`** —— 提示词与执行体并存，不是二选一。

#### 3.3.4 与 8 份 Skill 文档的关系

| 文档 | 本次动它吗 | 说明 |
|---|---|---|
| `SPEC-industrial-skill.md`（12 层） | 只落其中 1 层 | 本次只做「⑥ 执行层」，其余 11 层留 |
| `PRD-skill-compiler-registry.md` | ✅ **收编分支** | 实现已在 `handoff-skill-compiler-s1`，本次复验并入 |
| `PRD-skill-runtime-orchestrator.md` | ✅ **收编分支** | 实现已在 `handoff-skill-orchestrator-s1` |
| `PRD-skill-contract-dsl.md` | ❌ | 契约 DSL 全量落位是独立项目 |
| `PRD-skill-governance-learning.md` | ❌ | 治理学习闭环不铺（⑫ 层留） |
| `PRD-skill-migration.md`（32 份 ExecutionPlan 升格） | ❌ | 实测迁移进度 **0/32**（32 份 Plan 在 `mocks/seed.ts:216`，全 PUBLISHED、与意图 1:1）；M0 影子声明未开工 |
| `PRD-addendum-skill-authoring.md` | ✅ 遵守 | **8 份里唯一完整落地的** —— 两道发布门都真闭合（`server.ts:1246` lint 必跑 · `:1269` 探针三重与门，用例 <3 先以 `SKILL_EVAL_INSUFFICIENT` 拦住，不会静默跳过） |
| `PRD-skill-crossreview.md` | ✅ 遵守 | 我自己的审查结论继续有效；**C3 门账仍无人认领**（见下） |

**⚠️ crossreview 的 C3 实测坐实**：今天 `pnpm gates` 是 **24 道门，skill 门 0 道**；
`scripts/` 下 48 个 `check-*.mjs`，**无一个 `check-skill*`**。
C1 裁决的 `requires` 命名至今在契约里不存在，C2 两个门名今天一个都没有。
⇒ 这不是新工作，是 §3.3.1 那条 `handoff-skill-refclosure-a` 分支要带进来的东西。

---

## 4. 字段级 Schema 裁决（回应 S6 工业级开发 PRD）

> S6 要求「把 300+ Object、65 Process、500+ State/Event 展开成真正可导入 PostgreSQL / Neo4j 的字段级 Schema」。
> 这一节逐项裁决：**哪些是真新，哪些是把已有的东西改个名重造一遍。**

### 4.1 S6 提的表 × 平台实测（**这张表是本节的核心**）

| S6 提议的表 | 平台已有 | 裁决 |
|---|---|---|
| `ontology_object_type` | ✅ **`ontology_types`**（`001_init.sql:95`，doc-jsonb + tenant + key 索引） | ⛔ **不建** —— 改名重造 |
| `ontology_object` | ✅ **`objects`**（`001:127`，含 `object_type`/`origin_type` 真列 + 双索引） | ⛔ **不建** |
| `ontology_relationship` | ✅ **`links`**（`001:138`，含 `link_type` 真列；`008:53-54` 已建 `fromId`/`toId` 索引） | ⛔ **不建** |
| `world` | ✅ **`sim_session`**（`026`，含 `parent_checkpoint_id` 分叉字段） | ⛔ **不建** —— 已是世界 |
| `world_snapshot` | ✅ **`sim_tick_state`**（`026:16`） | ⛔ **不建** |
| `simulation_run` | ⚠️ 部分 —— `sim_session` + `sim_tick_state` 合起来就是 run | ⛔ **不建**（会造第二套真相源） |
| `variable_definition` / `variable_value` | ⚠️ `LEVER_PROP_META`（后端下发 unit+kind）＋ `object.props` | 🔗 **扩既有**，不新建 |
| `causal_link` | ✅ **`CausalFactor` + `caused_by` 链路**（已全接线） | ⛔ **不建** |
| `rule` / `constraint` | ✅ `rules`(252 条) · ⚠️ 约束只在求解器内部 | 🔗 rules 复用；**Constraint 建一等对象** |
| **`perturbation`** | ❌ **零** | ✅ **建** —— §4.2 |
| **`process_definition`** | ❌ **零** | ✅ **建** —— §4.2 |
| **`process_chain_node_map`** | ❌ **零** | ✅ **建** —— §4.2 |

> **⚠️ 这张表是本节存在的理由。**
> 照 S6 原样建 `ontology_object_type` / `ontology_object` / `ontology_relationship` / `world`，
> 会造出一套与 `ontology_types` / `objects` / `links` / `sim_session` **并行的存储机制** ——
> 两套表都有数据、都有人写、谁也不是真相源。
> 这正是我在 `WO-PACK-twin-data.md` D3 单里已经犯过一次并被自己抓回来的错
> （当时我让 dev 给 BOM/Routing/Supplier/Material 建表，而它们早已存在且有数据）。
> **12 张提议表里，只有 3 张是真新的。**

### 4.2 真新的三张表（DDL · 迁移号 028–030）

**存储约定**（沿用 `WO-PACK-twin-data.md §0.65 已立的规矩）：
业务对象走 `objects` 表的 doc-jsonb，**不单独建表**；只有**平台级制品**才建表。
下面三张都是平台级制品（扰动是仿真制品、流程定义是元模型、映射是单源表）。

```sql
-- 028_perturbations.sql
-- 扰动一等公民（关闭 #150/#151/R060）。行业无关；doc 为 jsonb 通用列（换行业不改表）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。R2 tenant 隔离。
CREATE TABLE IF NOT EXISTS sim_perturbation (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  session_id  TEXT NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  doc         JSONB NOT NULL,                         -- Perturbation（contracts/sim.ts）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_perturbation_tenant ON sim_perturbation(tenant_id, session_id);
-- 按 startTick 取「本 tick 生效的扰动」——引擎每 tick 都要查，必须有索引
CREATE INDEX IF NOT EXISTS sim_perturbation_start ON sim_perturbation(tenant_id, session_id, ((doc->>'startTick')::int));
-- down: DROP TABLE IF EXISTS sim_perturbation;

-- 029_process_definitions.sql
-- 业务流程层（承载 S5 的 13 域 × 65 流程）。配置驱动，可增删改——与冻结的 CHAIN_NODE_REGISTRY 相对。
CREATE TABLE IF NOT EXISTS process_definitions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- ProcessDefinition：
                                                      --   { key:"P40", domainKey:"D07", name, ownerFunctionKey,
                                                      --     stdDurationDays, waitKind, carrierTypeKey }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS process_definitions_tenant_key ON process_definitions(tenant_id, (doc->>'key'));
CREATE INDEX IF NOT EXISTS process_definitions_tenant_domain ON process_definitions(tenant_id, (doc->>'domainKey'));
-- down: DROP TABLE IF EXISTS process_definitions;

-- 030_process_chain_node_map.sql
-- 流程层 ↔ 节拍层 的 N:M 显式映射（单源；禁止前端/引擎各自推断）。
-- chain_node_id 受 CHAIN_NODE_REGISTRY 约束（含动态 capacity.op.<opId>），由门 check-process-chain-map 校验。
CREATE TABLE IF NOT EXISTS process_chain_node_map (
  tenant_id      TEXT NOT NULL,                       -- R2
  process_key    TEXT NOT NULL,                       -- → process_definitions.doc->>'key'
  chain_node_id  TEXT NOT NULL,                       -- → CHAIN_NODE_REGISTRY 在册 id
  weight         NUMERIC NOT NULL DEFAULT 1,          -- 一个流程跨多节点时的耗时分摊权重
  PRIMARY KEY (tenant_id, process_key, chain_node_id)
);
-- down: DROP TABLE IF EXISTS process_chain_node_map;
```

**⚠️ 迁移号纪律**（欠账 #74 已记过一次三方撞车）：028/029/030 三个号**本 PRD 预留**，
派单时必须在工单顶部写明，且 dev 提交前须 `ls apps/datacore/migrations/` 复核未被占用。

### 4.3 Constraint 一等对象（S6 要求 · 本次做半张）

`OptConstraintFamily` 今天只活在求解器内部（52 条，无表无 CRUD）。
**本次不建表** —— 先做**只读投影**：把求解器内部的约束族投影成 `/a/v1/constraints` 只读列表，
让沙盘的「推演可行性」维能读到它。**建表留到有人要 CRUD 时再说。**

> 判据：本仓的教训是「先建表后接线」十有八九变成又一张零调用方的表（欠账 #92 `llm_budgets`
> 就是「状态机完整但零调用方」）。**先让它被读到，再让它可写。**

### 4.4 Neo4j 裁决：**不引**（且这不是我的新决定）

S6 提议引入 Neo4j 作为图层。实测：

- **全仓零代码、零依赖、零 compose 服务** —— `neo4j|cypher|gremlin` 只在 **4 份文档**里出现
- 且 **仓主本人已经裁过这件事**：`docs/PRD-A9-external-engines-design-deferred.md` 原文
  > 「**裁决（用户）：A9 仅出设计 PRD、标记"按需延后"** —— 三个外部引擎都设计齐"接入点"，
  > **不现在引真依赖**，守系统自包含 / R6 确定性 / 部署轻。」
- `PRD-ontology-browser-field-coverage.md:36` 也写着「不引入 Neo4j/ChromaDB 等外部存储」

**⇒ 维持原裁决。** 图查询用已有的 `links` 表：它已有 `links_tenant_from_idx` / `links_tenant_to_idx`
两个表达式索引（`008:53-54`），而 `propagateTick` 内部已经建了邻接表
（`navOut: "linkKey\0fromId" → toId[]`，`propagation.ts:238-243`）—— **图遍历能力已经在了。**

若将来规模顶不住，按 A9 定的 **CP-SAT sidecar 同款范式**接入（自托管、数据不出边界、未配则显式「未接入」不兜底）。
**本次升级不触发这个条件。**

### 4.5 500+ State/Event 怎么落

**不建「状态本体表」。** 实测平台已有多套状态机（`ActionStatus` 8 · `SimSessionStatus` 5 ·
`QueryTaskStatus` 7 · `Decision` · `GrowthTicketStatus` …），它们各自正确、各自有消费方。
**强行统一 = 把 8 个能跑的东西换成 1 个要重接 8 处的东西。**

本次只做两件：
1. **事件补订阅方** —— outbox 已有 79 处 emit，但 `sim.*` 5 个事件里**只有 1 个有订阅方**（欠账 #145）。
   补订阅方比补新事件重要得多。
2. **状态枚举进资源目录** —— 让 Agent 能查到「`SimSession` 有哪 5 个态」，走已建成的
   `WO-RESOURCE-CATALOG-ONTOLOGY`（欠账 #83 已完成）的同一条路。

---

## 5. 界面：一个页面，多个子页面

### 5.1 North Star 九维 → 承载物对照（**验收标尺**）

| # | North Star 维 | 承载物 | 今天状态 |
|---|---|---|---|
| 1 | **卡点**（能力不够·加产能有用） | `ChainImpediment.BOTTLENECK` | ✅ 有 |
| 2 | **堵点**（流不动·加产能没用） | `ChainImpediment.CONGESTION` | ✅ 有 |
| 3 | **断点**（接不上） | `ChainImpediment.BREAK`（MATERIAL/LEADTIME/DATA） | ✅ 有 |
| 4 | **韧性不足** | `resilienceGap` | ❌ **零承载物** |
| 5 | **消耗大的部分** | `chain_loss_attribution` + `isValueAddKind` | ✅ 有 |
| 6 | **流程** | `ProcessDefinition` | ❌ **零**（§3.2） |
| 7 | **时长** | `stdDuration` + 节拍闸门 | 🔗 24 有 / 65 无 |
| 8 | **决策复杂度** | `decisionComplexity` | ❌ **零承载物**（且耦合分量算不准 —— 只 3 条边） |
| 9 | **输入变量 · 推演可行性** | `Perturbation` + `Constraint` | ❌ **零**（§3.1 §4.3） |

**⇒ 九维里四维零承载物。这四维正是本次三条主动脉要造的东西 —— 不是巧合，是倒推出来的。**

#### 5.1.1 两个零承载维的可计算定义

```
resilienceGap      = f(备选度, 单点依赖, 缓冲量, 恢复 tick 数)
                     其中「恢复 tick 数」由 propagateTick 实测得出，不是估的：
                     施加扰动 → 记录 stateVar 回到基线所需 tick 数
                     权重进规则表（新 R14 族），可编辑 ⇒ 「改规则即改推演」

decisionComplexity = f(切片对象数, 跨职能数, 约束密度, 候选数, 传导图度数)
                     ⚠️ 诚实声明：「传导图度数」分量今天**算不准**（全图只有 3 条边）。
                     ⇒ 前端必须显式标注该分量为「数据不足」，不许拿 3 条边算出一个数糊上去。
                     R143 补边后此分量才转正 —— 这是 §7 验收的一条硬断言。
```

### 5.2 验收剧本：仓主的 14 步 Demo 链

完整 52 项原子需求见 `AUDIT-demo-chain-atomic.md`。本次升级要让这条链**真跑通**，
关键在阶段 2（五扰动·时序维集中在这里）—— 而那正是 §3.1 造的东西。

| 阶段 | 关键动作 | 依赖本 PRD 的哪节 |
|---|---|---|
| 0 触发 | 订单进入 | ✅ 已有 |
| 1 订单评审五项 | 五项校验 | ✅ 已有 |
| **2 五扰动** | **停机 72h / 涨价 / 断供 / 追单 / 不良** | **§3.1（今天做不了）** |
| 3 本体切片 | `executeSlice` | ✅ 已有 |
| 4 因果影响 | `CausalFactor` | ✅ 已有 |
| 5 联合仿真 | `propagateTick` | 🔗 §3.1.4 补边后才走得远 |
| 6 求解器四方案 | 59 个求解器 | ✅ 超配 |
| 7–8 比对与推荐 | **方案比对** | 🔗 §5.3 |
| 9–10 批复与执行 | `Decision → ActionDraft` | 🔗 欠账 #81 |
| 11 外部反馈 | 回写 | ✅ 已有 |
| 12–13 回放与校准 | Replay | ✅ 已有 |

### 5.3 子页面划分（一个页面 · 六个子页 · **不是 8 个页面**）

仓主已裁「不做 8 个功能和页面」「不必全部放在一个页面，可以是一个页面的多个子页面」。

| 子页 | 主视觉 | 复用什么（**禁止重造**） | 回答 North Star |
|---|---|---|---|
| **① 全景** | **地铁线路图** | `chainLineMap.ts`(985) + `ChainLineMapView.tsx`(940) | 卡点/堵点/断点 一眼看到 |
| **② 扰动台** | 扰动卡片 + 时间轴 | 🆕 `Perturbation`（§3.1） | 输入变量 |
| **③ 传导** | 传导轨迹图 | `PropagationTrace` + `unresolvedGates` 诚实缺席 | 断点 · 时长 |
| **④ 阻滞** | 阻滞点清单 | `ChainImpediment` 三型 + `chain_loss_attribution` | 卡点/堵点/消耗 |
| **⑤ 方案比对** | 并排比对 | `GET /sim/compare` + `MITIGATION_LIB` + 59 求解器 | 推演可行性 |
| **⑥ 决策** | 决策台账 | `decisions` 表 + `decision-kernel.ts` | 落地 |

**UI 纪律（仓主已明确不满意过一次：「几次输出的 html 都不专业」）**

1. **调色板必须跑校验器，不许目测** —— 5 槽堆叠 / 3 槽雷达 全对 CVD 全对通过才算数。
2. **雷达图用小倍数（small multiples），不叠加** —— 4 个多边形叠一起必然全对失败且互相遮挡。
3. **站点半径 `area ∝ share ⇒ radius ∝ √share`**，clamp `[7,26]`；`null` 返回最小值
   （语义：「基准尺寸不是 0%」）。单源 `stationRadius`，前端不许各算各的。
4. **渲染完必须截图自查** —— 校验器看不见溢出、字号被 SVG 缩放炸掉、图被挤扁。
5. **数据一律来自后端** —— 违反 ② 号裁决的写死数据会被 `check-debattery` 探测器 B 拦下（§7.3）。

---

## 6. WO 分解与派发顺序

### 6.1 派单前必读（六条 · 全部是本仓踩过坑写下的）

1. **分支判据是祖先关系，不是文件存在性**（铁律 0.6 · 一天骗到 4 个 dev）：
   ```bash
   CANON=origin/claude/inspiring-gates-aqczjg
   git fetch origin && git merge-base --is-ancestor HEAD $CANON \
     && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，必须重开"; git checkout -B <wo-branch> $CANON; } \
     || echo "HEAD 不落后，可原地开工"
   ```
2. **环境前置**：worktree 可能没有 `node_modules`（先 `pnpm install --prefer-offline`）；
   `@platform/contracts` 可能未 build（先 `pnpm --filter @platform/contracts build`）。
   不装就会报 `Failed to resolve entry for package "@platform/contracts"` 这种**与本单无关的假红**。
3. **每张 WO = 一条 handoff 分支**，dev 建 → push `claude/handoff-<wo>`，**不碰正线**。
4. **每完成一个可命名单元立刻 commit + push**（铁律 1 判据 #5 · 已丢过一次工作）。
   「gate 跑着」不是「工作已落盘」。
5. **dev 不许跑 `bash scripts/gate.sh` 或 `pnpm -r test`** —— datacore 勿并发多 vitest（4 核机）。
6. **派 dev 必须 `isolation: "worktree"`** —— 不隔离会污染我正在跑的 gate。

### 6.2 三条主动脉的 WO（**按依赖排序，不许并**）

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **P0** | 🔴 **`Perturbation` 契约 + 表 + 路由 + 前端入口 + `/act` pending 修** | **重** | 无 |
| **P1** | 补传导边至六方向（**纯种子，不改引擎**） | 轻 | P0 |
| **P2** | `propagateTick` 接扰动（含 duration 到期回退 + `appliedPerturbations` 溯源） | 重 | P0 |
| **P3** | `SimSession.scope` 接读端（关闭 #130 / #129 局部推演静默错答） | 中 | P2 |

> **P0 必须整单做**：#150（接线）与 #151（pending 清空）**拆开做就是制造一个已知会炸的中间态**。
> 这正是「跨数据/引擎两半的特性必须一个 dev 整单做」那条纪律的适用场景。

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **Q0** | `ProcessDefinition` 表 + 契约 + 13 域 65 流程种子 | 中 | 无 |
| **Q1** | `process_chain_node_map` + 单源门 `check-process-chain-map` | 中 | Q0 |
| **Q2** | 每个 `P##` 补 `ownerFunctionKey`/`stdDuration`/`waitKind`（D4 扩到 65） | 轻 | Q0 |

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **S0** | 🔴 **复验并入四条 Skill handoff 分支**（不是开发，是收编 —— 见 §3.3.1）：`handoff-skill-compiler-s1` · `handoff-skill-orchestrator-s1` · `handoff-skill-refclosure-a` · `handoff-skill-partial-a` | **重**（审核方自己做，不派 dev） | 无 |
| **S0.5** | 修 `seed.ts:1332` 的 `kind:"solver"` precondition 被静默丢弃（§3.3.3 形态④） | 轻 | 无 |
| **S1** | `SkillDefinition.execution` 四分支（`prompt`/`solver`/`slice`/`sim`） | 中 | S0 |
| **S2** | SEAM：一个 `sim` 类 Skill 端到端打进沙盘（§7.1 头号断言） | **重** | S1 + P2 |

> **S0 是本次 Skill 主动脉里性价比最高的一单，且不需要派 dev。**
> 四条分支上躺着 Skill Graph 契约 + `GraphScheduler` + `POST /b/v1/skill-graphs/run` +
> Parser/Validator + `POST /b/v1/skills/:id/compile` + 引用可校验门 + `maxBudgetRounds` 接线。
> **复验并入即可，一行新代码都不用写。**
> 复验口径照 LOOP 纪律：worktree 隔离 checkout → 组合四包 gate → cherry-pick 上 canonical → push。
> ⚠️ 四条分支很可能都落后 canonical 很多提交 —— 复验前先按 §6.1 第 1 条做**祖先关系**判定，
> 不要用「某文件在不在」当判据（那个错一天骗到 4 个 dev）。

### 6.3 数据补齐六单（`WO-PACK-twin-data.md` · **仓主要求转发，仍待派**）

| 单 | 内容 | 状态 |
|---|---|---|
| D0 | 七个「生成器已产行、却没人物化」的类型（**最高性价比**） | 待派 |
| D1 | 组织世界补齐（**扩既有 `Principal`，不许新造 `Person`**） | 待派 |
| ~~D2~~ | ~~批复策略种子~~ | **已撤单**（裁决① 审批不做） |
| D3 | 产销链**尾段**补齐（主数据已有，不要重建） | 待派 |
| D4 | 流程定义与节点耗时种子 | **并入 Q2** |
| D5 | 异常剧本种子（五类异常一等公民） | 待派 → **与 P0 的 `PerturbationKind` 五类对齐** |
| D6 | 🔴 `upsertType` 吞掉七个字段（**本包唯一真 bug**，欠账 #69 的根因） | 待派 |

> ⚠️ **D5 与 P0 必须对齐**：D5 的「五类异常」与 `PerturbationKindSchema` 的五个 kind
> **必须是同一套词表**，否则又是一次「两个 dev 各发明一套词表、交集为 0」（欠账 #99 的原型）。
> **裁决：以 `PerturbationKindSchema` 为单源，D5 引用它。**

### 6.4 明确不做（承接 `DECISION-twin-feature-triage.md` 的 16 项）

审批流 · 权限矩阵 · 8 个独立页面 · Neo4j · 统一状态本体表 ·
`simulation_run` 表 · `ontology_object*` 三表 · `world` 表 · Skill 编译器 ·
Reasoning Graph 编排器 · Skill 治理学习闭环 · 32 份 ExecutionPlan 迁移 ·
Constraint 建表（先只读投影） · 150 个 Skill 铺量 · 300+ 对象一次补齐 · 前端写死任何数据

---

## 7. 验收（SEAM-GATE 驱动接缝，不验各半）

### 7.1 头号断言（**接缝驱动 · 任一半漏即红**）

```
一个 execution.kind === "sim" 的 Skill
  → 被 Agent 调用
  → 产生一条 Perturbation（kind=capacity_loss, startTick=3, durationTicks=72）
  → 注入 SimSession
  → propagateTick 在 tick 3 施加、在 tick 75 自动回退
  → 沿补齐后的传导边走到 Order.lateRisk
  → 识别出 ChainImpediment.BOTTLENECK
  → 枚举候选 → 比对 → 落 Decision
```

**这一条测不通，本次升级就是没做完** —— 它同时驱动三条主动脉的接缝。
（判据来历：metric-aware 反复炸，就是因为数据半与引擎半各自绿、接缝没人测。）

### 7.2 时序维专项断言（R060）

| 断言 | 为什么必须单列 |
|---|---|
| `durationTicks: 72` 的扰动在 tick 75 **真的回退** | 这是本次唯一需要状态记忆的逻辑，最容易做成「永久生效」 |
| `durationTicks: null` 与今天 `/act` **逐字节同结果** | additive 可回退的证明 |
| `tick → act → tick` 后 `pending` **未丢** | 直接咬 #151；没有这条，修了也会退化 |
| 同扰动同种子重跑**字节级一致** | R6 确定性 |

### 7.3 数据真实性门（裁决② 的机制化）

`scripts/check-debattery.mjs` 探测器 B 已建成并接入 gate：
平衡括号提取 + 行数/数字计数（`MIN_ROWS=3` / `MIN_NUMS=6`），基线 35 命中 / 24 文件，
**金丝雀与主逻辑共用同一份实现**（不许各抄一份正则 —— 抄了就是装饰品）。
本次新增前端代码若写死数据，门会红。

> 例外走**审计标记** `// hardcoded-data-allow`，**不许调基线数字** ——
> 调基线是把证据抹掉，加标记是把判断留在案发现场。

### 7.4 防漏机制（`REQ-LEDGER-sandbox.md` 继续维护）

148 条需求台账逐条勾选，`☑ = 已裁决并有证据`（**明确不等于已实现**）。
本 PRD 的每个 WO 完成后必须回勾对应条目。

> **来历**：我在这个项目里连漏三次（时序推演 / 方案比对 / 地铁线路图），形态相同：
> **「我用『我列了一份清单』当作『需求都覆盖了』的证据，而前者不度量后者。」**
> 照铁律 0.6 三级处置，第三次必须建机制 —— 台账就是那个机制，
> 且需补 `scripts/check-req-coverage.mjs` 让**机器先说话**（今日仍欠，列入 §8）。

### 7.5 四包全绿

`pnpm -r build && pnpm -r --workspace-concurrency=1 test`
（datacore 1388 / agentcore 870 / frontend 884 / contracts 42 / llm-adapters 35 = 3219）
＋ 门必须显式捕获退出码：`out=$(cmd 2>&1); rc=$?`，**禁止** `cmd | tail; echo $?`。

---

## 8. 回写义务

本 PRD 落地后须回写 `docs/SYSTEM-ONTOLOGY.md`：

- **§2 对象类型**：新增 `Perturbation` · `ProcessDefinition` · `ProcessChainNodeMap`；
  `SkillDefinition` 补 `execution` 字段说明
- **§3 链路**：新增「扰动注入 → 传导 → 阻滞 → 候选 → 决策」全链；新增「流程 ↔ 节拍节点」映射链路
- **§4 数据流**：`sim.perturbation_applied` 新事件 + 订阅方（并补 #145 的 4 个无订阅方 `sim.*` 事件）
- **§5 不变量**：新增 R14 族「韧性权重可编辑」
- **§7 门禁**：登记 `check-process-chain-map`、`check-req-coverage`
- **§8 断点**：关闭 #150 #151 #130 R060 R143；新登记「Constraint 只读投影未可写」

**另需回写本文件**：若 §2 的任一实测结论在实施过程中被推翻，
**必须回本文改，并注明推翻它的证据（`file:line` + 复验命令）** —— 本体不回写即过期失效。

---

## 附 · 命名纪律

命名**禁用外部产品名**（参考产品是参考产品），一律用平台自有术语。
「决策推演沙盘」「链路节拍节点」「业务流程层」「扰动」「阻滞点」—— 这些是本平台的词。
