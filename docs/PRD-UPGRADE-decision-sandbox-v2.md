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

### 0.25 ⛔ 定位纠正（仓主 2026-08-09 · **本条改写了本 PRD 的整个框架**）

> **仓主原话：「不要在已开发的『推演沙盘』上面打补丁，而是一个工业级的推演沙盘，
> 可以复用已有的功能，但不要受到限制，遗漏了我的需求。」**

**这条批评是对的，我认。** 本 PRD 的初稿是**代码库优先**写的 ——
先量出平台有什么，再问「最小要补什么才能接上」。这个顺序会系统性地产生一种裁剪：
**「平台已经有个差不多的东西」被当成「这个需求已经满足」**。

初稿 §6.4 那 16 条「明确不做」里，有 **6 条**就是这么砍掉的（逐条复审见 §6.4）。

**改正后的框架 —— 需求优先（needs-first）**

```
① 先按需求画出工业级沙盘的目标架构（§3.0 八层），不看平台有没有
② 再逐层问：平台已有的东西，是否【完全】满足这一层？
      完全满足  → 复用，写清复用什么
      部分满足  → 扩展，写清【差什么】——不许拿「有个近似物」当满足
      完全没有  → 新建，写清成本——【平台没有】不是降需求的理由
③ 只有两种理由能让一条需求真正出局：
      (a) 仓主自己裁掉的（审批流 / 8 个页面 / 前端写死数据）
      (b) 有 file:line 证据证明【照做会造出第二套真相源】（如 ontology_object* 三表）
    「工作量大」「是独立项目」「平台有个差不多的」——**这三条都不算理由**
```

**判据（写进每次评审）**：
> **「平台没有它」度量的是平台的现状，不度量这个需求该不该做。
> 拿前者当后者的证据，就是用实现去裁剪需求 —— 那正是打补丁。**

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
| `REQ-LEDGER-sandbox.md`（**172** 条勾选台账·原写 148 已订正） | ✅ **继续维护** —— 它是防漏机制，不是叙述 | §7.4 |
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
  **REQ060**（扰动无时序维）· **REQ143**（只有 3 条传导边）
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
| `startTick` | 只能作用于「当前 tick」，无法排「第 5 天开始」 | **REQ060** |
| `durationTicks` | **永不回退** —— 「停机 72h」被跑成永久停机 | **REQ060**（Demo 链阶段 2） |
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

#### ④ 传导网只有 3 条边（欠账 REQ143）

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

## 3. 工业级沙盘的目标架构

### 3.0 八层目标架构（**先按需求画，再看平台有什么**）

> 照 §0.25 的顺序：这张表**先立**，然后每层各自去问平台。
> 「差什么」一列是本 PRD 的真正工作量来源 —— 它不许被「平台有个近似物」抹掉。

| 层 | 工业级要求（来自 S1–S6 + North Star） | 平台已有 | 满足度 | **差什么**（本次要做的） |
|---|---|---|---|---|
| **L1 世界** | 多世界并存 · 分叉 · 命名 · 持久 · 两两比对 · 一次推演可复算（参数/种子/耗时/结论可查） | `sim_session`+`sim_tick_state`+`sim_checkpoint`+`/branch`+`/compare` | **部分** | ① 分叉出的子世界**无持久读端**（刷新即丢，§2.1）② 无「运行记录」语义（参数/种子/结论）③ Agent 无 `sim_branch`/`sim_checkpoint` 工具 |
| **L2 扰动** | 五类语义扰动 × 时序（起止/持续/回退）× 三种幅度模式 × 可列举 × 可溯源 | **仅 `/act` 一个裸标量写入，且零调用方** | **几乎没有** | 🔴 **整层新建**（§3.1）—— 全 268 条未并分支实测无人做过 |
| **L3 传导** | 全域传导网（需求/供应/产能/交付/成本/现金）· 增量重算 · 逐跳溯源 · 延迟与节拍 | `propagateTick`(392 行纯函数) + 节拍闸门 + `unresolvedGates` 诚实缺席 | **引擎够 · 图空** | ① 只有 **3 条边**且全指向 `Base.load`（§2.2④）② 全量扫描非增量 ③ scope 无读端（§2.2⑤）④ 认证 Trial Tick 跑错栈（§2.2⑥） |
| **L4 本体** | 300+ 对象 15 类 · **500+ 状态统一可查** · 300+ 事件有订阅方 · 切片 | `objects`/`links`/`ontology_types` 三表 + 86 已物化 + `slice_specs` 全接线 | **部分** | ① 对象 86→300+（分 15 类批）② **统一状态本体（投影层）** —— 初稿砍了，现恢复（§4.5）③ `sim.*` 5 事件仅 1 个有订阅方 |
| **L5 流程** | 13 域 × 65 流程 · 每流程有 owner/时长/等待类型 · 与节拍层 N:M 映射 | **全仓 0**（`ProcessDefinition` 等四个名字零命中） | **没有** | 🔴 **整层新建**（§3.2），24 节拍节点冻结不动 |
| **L6 规则约束** | 300+ 规则 · **300+ 约束为一等对象** · Rule/Constraint DSL · 不可行性诊断（IIS） | `rules` 252 条 ✅ · 约束 52 条但**只活在求解器内部** | **规则够 · 约束没有** | 🔴 **Constraint 升一等对象**（初稿只给「只读投影」，现恢复为建对象 —— §4.3） |
| **L7 求解决策** | 10 类求解器 · 方案比对 · Decision 台账 · 落 ActionDraft | **59 个求解器（超配）** + `decisions` 三态 + commit 派单链通 | **基本够** | ① 59 个按 10 类归档（纯分类）② 方案比对子页（§5.3⑤）③ 欠账 #81 语义映射 |
| **L8 技能** | 工业级 Skill 12 层 · 编译器 · 图编排 · 治理学习 · 可扩展到 150+ | 12 层实测 ✅1/⚠️6/❌5；**编译器+编排器+引用门实现全在未并分支**（4664 行） | **做完了没并** | 🔴 **收编 5 条分支**（§3.3.1）+ 加 `sim_perturb` 步骤 + **治理学习分期落**（初稿砍了，现恢复 §3.3.5） |

**⇒ 八层里：整层新建 2（L2 扰动 · L5 流程）· 大补 2（L3 图 · L6 约束）· 收编 1（L8）· 补面 1（L4）· 微调 2（L1 · L7）。**

**三条承重主动脉**（下面 §3.1–§3.3 展开）= **L2 扰动** · **L5 流程** · **L8 技能**，
因为这三条是「整层新建 / 整批收编」；L3/L4/L6 的补面挂在它们后面走。

> ⚠️ **这不是「三条主动脉就是全部」** —— 初稿那样写就是打补丁。
> L1/L3/L4/L6/L7 的「差什么」逐条都在 §6 的 WO 表里有单，一条都不许因为「平台有近似物」蒸发。

### 3.1 主动脉一 · **扰动升格为一等公民**（关闭 #150 #151 REQ060）

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

  // ── REQ060 的三个时序字段（今天全缺，这是本次真正的新东西）──
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

#### 3.1.4 补齐传导边（关闭 REQ143 —— **这条决定升级成不成**）

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

远端实测 **12 条 skill 分支，一条都不在 canonical 上**（`git merge-base --is-ancestor` 逐条验，
🐤 自反测 `is-ancestor HEAD HEAD` 通过 ⇒ 判据可信）。其中 **5 条带真实现**：

| 分支 | 未并提交 | 代码文件 | 插入行 | 内容 |
|---|---:|---:|---:|---|
| `handoff-skill-orchestrator-s1` | 4 | 6 | **1673** | Skill Graph 契约 + 拓扑分层/环检测 + **`GraphScheduler`** + `POST /b/v1/skill-graphs/run` + **`Skill.execution` 对名裁决**（§3.3.3） |
| `handoff-skill-compiler-s1` | 4 | 6 | **1513** | Parser + 推理图派生（纯函数 R6）+ Validator + `POST /b/v1/skills/:id/compile` |
| `handoff-skill-refclosure-a` | 2 | 6 | **710** | **引用可校验门接上 skill 发布路 + 关死两层 fail-open** + `ref-closure:check` 防退化门 |
| `handoff-skill-partial-a` | 3 | 5 | **381** | **`maxBudgetRounds` 接线** + `dependsOn` 补种子 + lint 干跑补挂载点 + 接缝驱动测 |
| `handoff-skill-partial-b` | 3 | 1 | **387** | 反思闭环/升级阶梯 × 生产 demo 集 SEAM 测 + SPEC 12 层缺口台账 |
| 合计 | **16** | **24** | **4664** | —— |

另 7 条：5 条 `handoff-prd-skill-*`（写 PRD 的分支，各 1 提交、落后 343–344）·
`handoff-skill-agent-reconcile`（689 行纯文档对账）· `handoff-skill-migration-scope`（507 行 WO 拆分）·
`verify-skill3`（5 提交，落后 381）。

> ⚠️ 五条实现分支**只落后 canonical 30–31 个提交**（不是几百）——
> 说明它们是近期产出，复验成本低。这与那 5 条落后 344 提交的 PRD 分支是两回事，别混为一谈。

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

#### 3.3.3 🔻 **撤回我上一稿的 `execution` 设计 —— 它已经存在，且比我的好**

> **我在这份 PRD 的初稿里提议给 `SkillDefinition` 加一个
> `execution: discriminatedUnion("kind", [prompt|solver|slice|sim])`。**
> **这个提议作废。** 亲手 `git show` 到 `handoff-skill-orchestrator-s1`
> （`55bf21d1` 提交标题就写着「**对名裁决 `Skill.execution`**」）：
> **`SkillExecutionSchema` 已经设计好、实现好、且带 SEAM 测试**
> （`apps/agentcore/test/skill-orchestrator.seam.test.ts:735`
> 「SEAM · `Skill.execution` 对名裁决：执行来源在响应里可见」）。

**已存在的真实契约**（`packages/contracts/src/skill-graph.ts:373-398`，该分支上）：

```ts
export const SkillExecutionStepSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),                    // ← 开放字符串，不是闭合枚举
  params: z.record(z.string(), z.unknown()).default({}),
  onError: OnErrorSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
}).passthrough();

export const SkillExecutionSchema = z.object({
  steps: z.array(SkillExecutionStepSchema).min(1).max(MAX_GRAPH_NODES).optional(), // 线性形态
  graph: SkillGraphSchema.optional(),                                              // 图形态
  mode: z.enum(["DETERMINISTIC", "AGENTIC"]).optional(),
}).strict();
```

**它为什么比我的好（三条，都是我的设计做不到的）**

1. **可组合** —— 我的是「一个 Skill 只能是一种东西」的扁平 one-of；
   它是 `steps[]` / `graph`，一个 Skill 可以「先切片 → 再求解 → 再打扰动」。
2. **`type` 是开放字符串 + `.passthrough()`**，契约里写明理由：
   「元素**不钉死** `PlanStepSchema`——闭合联合会挡掉 `ExtraToolStep` 三类；
   结构地板在此，语义校验必须走 `validatePlanSteps`」。
   ⇒ **加一个沙盘步骤类型根本不需要改契约。**我的闭合 union 每加一种能力都要动契约。
3. **`mode: DETERMINISTIC | AGENTIC`** —— 我完全没想到这一维，
   而它是 R6 确定性的抓手（`DETERMINISTIC` 图内不得出现 LLM 节点）。

**⇒ 修正后的本次工作量（大幅缩小）**

| 原计划 | 修正后 |
|---|---|
| 设计 + 实现 `Skill.execution` | ❌ 删除 —— 复验并入 `handoff-skill-orchestrator-s1` 即可 |
| 四个 `kind` 分支 | ❌ 删除 —— `steps[].type` 是开放串，无需分支 |
| —— | ✅ **唯一真增量**：加一个 `sim_perturb` 步骤类型（`validatePlanSteps` 一个 case + 执行器一个 case），让 Skill 能往沙盘打扰动 |

**⇒ 主动脉三的真实内容 = 「复验并入 5 条实现分支」+「加一个步骤类型」。**
不是造一套执行体系 —— 那套已经造好了。

#### 3.3.3.1 ⚠️ 这是同一个错的第 4 次（照铁律 0.6 记账并立机制）

把四次各写成一句，形态完全相同：

> **「我用『我没在主线上看到它』当作『它不存在』的证据，而前者不度量后者。」**

| # | 我说过 | 实际 |
|---|---|---|
| 1 | `OntologySlice` 不是一等实体 | 是 —— `slice_specs` 表 + `SliceSpecRecord` + `executeSlice` + 4 条种子 |
| 2 | D3 单：给 BOM/Routing/Supplier/Material 建表 | 全都已存在且有数据 |
| 3 | D1 单：新造一个 `Person` 类型 | `Principal` 已有 `kind:"person"` |
| 4 | **本条**：给 Skill 设计 `execution` 字段 | **已设计好、实现好、带 SEAM 测试，躺在未并分支上** |

前三次的共同点是「**没在当前主线搜到 ⇒ 判定不存在**」，
第 4 次多了一层：**东西在分支上，主线 grep 必然 0 命中**。

**机制（第 3 次就该建，现在补）**——写进派单模板与我自己的复验清单：

> **凡要新建一个对象类型 / 契约字段 / 表，落笔前必须先跑：**
> ```bash
> git ls-remote --heads origin | sed 's|.*refs/heads/||' > /tmp/br.txt
> for b in $(cat /tmp/br.txt); do
>   git grep -l "<待建符号名>" "origin/$b" -- packages apps 2>/dev/null | sed "s|^|$b: |"
> done
> ```
> **命中任何一条 ⇒ 不许新建，改为「复验并入」。**
> 判据：**主线 0 命中 ≠ 全仓 0 命中** —— 本仓当前有 12 条 skill 分支、
> 未并实现 4658 行，只搜主线必然把它们全判成「不存在」。

#### 3.3.4 与 8 份 Skill 文档的关系

| 文档 | 本次动它吗 | 说明 |
|---|---|---|
| `SPEC-industrial-skill.md`（12 层） | 落 3 层 | 本次落 **⑥ 执行层**（收编分支）＋ **⑫ 治理学习 P1/P2**（§3.3.5）＋ **⑦ Tool/MCP Binding**（见下 🔴）。其余 9 层留，**理由逐层写在 §3.3.7**，不许再出现「其余 N 层留」这种无理由裁剪 |
| `PRD-skill-compiler-registry.md` | ✅ **收编分支** | 实现已在 `handoff-skill-compiler-s1`，本次复验并入 |
| `PRD-skill-runtime-orchestrator.md` | ✅ **收编分支** | 实现已在 `handoff-skill-orchestrator-s1` |
| `PRD-skill-contract-dsl.md` | 🔴 **改为部分做** | ~~「契约 DSL 全量落位是独立项目」~~ —— **这个理由不成立**（§0.25 明写「是独立项目」不算理由），而且它**自相矛盾**：§3.0 L6 把 Rule/Constraint DSL 列为工业级要求、§4.3 又用它论证 Constraint 必须建表，同一个 DSL 需求在这里却被当成可裁的。**改为**：Constraint DSL 随 L6-a 落（已在范围内）；Skill 契约 DSL 的其余部分随 S0 收编分支带进来多少算多少，缺口记 §3.3.7 |
| `PRD-skill-governance-learning.md` | ✅ **P1+P2 做** | ~~❌ 不铺~~ —— **已被 §3.3.5 推翻**，此行原是漏改的过期行（派单人只读本表会把已恢复的事再砍一次） |
| `PRD-skill-migration.md`（32 份 ExecutionPlan 升格） | ✅ **M0 做** | ~~❌~~ —— **已被 §3.3.6 推翻**，同上属漏改的过期行。实测迁移进度 **0/32**（32 份 Plan 在 `mocks/seed.ts:216`，全 PUBLISHED、与意图 1:1），本期落 M0 影子声明 |
| `PRD-addendum-skill-authoring.md` | ✅ 遵守 | **8 份里唯一完整落地的** —— 两道发布门都真闭合（`server.ts:1246` lint 必跑 · `:1269` 探针三重与门，用例 <3 先以 `SKILL_EVAL_INSUFFICIENT` 拦住，不会静默跳过） |
| `PRD-skill-crossreview.md` | ✅ 遵守 | 我自己的审查结论继续有效；**C3 门账仍无人认领**（见下） |

**⚠️ crossreview 的 C3 实测坐实**：今天 `pnpm gates` 是 **24 道门，skill 门 0 道**；
`scripts/` 下 48 个 `check-*.mjs`，**无一个 `check-skill*`**。
C1 裁决的 `requires` 命名至今在契约里不存在，C2 两个门名今天一个都没有。
⇒ 这不是新工作，是 §3.3.1 那条 `handoff-skill-refclosure-a` 分支要带进来的东西。

#### 3.3.5 🔻 治理与学习闭环（SPEC ⑫）—— **推翻初稿的「不铺」，改为分期**

> **初稿把 SPEC ⑫ 整层砍了**，理由「治理学习闭环是独立项目」。
> 照 §0.25 复审：**「是独立项目」不是裁需求的理由。**
> 而且 ⑫ 是**工业级 Skill 的定义性特征**，不是加分项 ——
> SPEC 原文写的是「Evaluation（准确率 · **人工采纳率** · 收益）+ Human Feedback 闭环
> （AI 建议 20% → 人改 10% → 系统学习）」。一个不知道自己被采纳了多少次的技能库，
> 铺到 150 个也只是 150 段没人知道好不好用的提示词。

**分期落地（本期只做可测的最小闭环）**

| 期 | 内容 | 本次做吗 | 判据 |
|---|---|---|---|
| **P1 · 记录** | `SkillExecutionTrace`：每次 Skill 执行落一条（skillKey / 入参摘要 / 耗时 / 结果 / 是否 BLOCK） | ✅ **做** | 没有记录就没有任何后续可能；且平台已有 outbox + `evals.ts` 骨架可挂 |
| **P2 · 采纳率** | Decision `COMMITTED` 时回标「这个决策用了哪些 Skill」→ 算 per-skill 采纳率 | ✅ **做** | 接缝已存在（`decision/kernel.ts:145` commit 链），只差回标一个字段 |
| **P3 · 人工修正差量** | 记录「AI 给的方案 vs 人最终改成什么」的差量 | ⏸ 后期 | 需要前端改造，且要先有 P1/P2 的数据才知道量什么 |
| **P4 · 学习** | 用 P1–P3 的数据反馈调整 Skill 排序/权重 | ⏸ 后期 | 无数据谈算法是空转 |

**⇒ 本期 P1+P2**，两件都挂在已有接缝上，不新建机制。
**验收硬条件**：P1 的 Trace 必须**有读端**（沙盘的 Skill 面板真的显示它）——
否则就是又一个 `llm_budgets`（欠账 #92：状态机完整但零调用方）。

#### 3.3.6 ExecutionPlan 迁移 M0（🔻 推翻初稿的「后续」）

实测 **32 份 ExecutionPlan**（`mocks/seed.ts:216`，全 PUBLISHED，与意图 1:1 绑定），
**迁移进度 0/32**。`handoff-skill-migration-scope` 分支上已有 507 行把迁移拆成 5 张 WO。

**本期只做 M0「影子声明」**：给 32 份 Plan 在 Skill 侧各留一条影子记录
（`key === intent.key`，`execution.steps` 直接引用 Plan 的 steps），**不改运行时**。

**为什么 M0 值得现在做**：它是**零风险的**（影子记录没有消费方就没有行为变化），
但它一次性把「Skill 与 ExecutionPlan 是两套东西」这个结构性分裂**变成可见的**——
之后任何一张迁移单都有了对照基线。全量迁移（M1–M4）后期按那 5 张 WO 走。

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
-- 扰动一等公民（关闭 #150/#151/REQ060）。行业无关；doc 为 jsonb 通用列（换行业不改表）。
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

### 4.3 Constraint 升为一等对象（🔻 **推翻初稿的「只做只读投影」**）

> **初稿写的是「本次不建表，先做只读投影，建表留到有人要 CRUD 时再说」。**
> 照 §0.25 复审：这是**平台谨慎在裁需求**。S6 明确要 Rule/Constraint DSL；
> North Star 第 9 维「推演可行性」整个压在约束上 —— 一个读不到、改不了的约束层撑不起它。
> **恢复为建一等对象。**

**实测起点**：`OptConstraintFamily` 今天只活在求解器内部（**52 条**，无表、无 CRUD、无契约导出）。
对照：`RuleEntry` 有表（`rules`）、有 CRUD、有 `params`、有「改规则即改推演」的接线（`coefficientRef`）。
**同样是决策的两条腿，规则那条腿是一等的，约束这条腿今天连站的地方都没有。**

```sql
-- 031_constraints.sql
-- 约束一等对象（S6 Rule/Constraint DSL · North Star 第 9 维「推演可行性」的承载物）。
-- 刻意与 rules 表同构 —— 规则与约束是决策的两条腿，形状不一致会让消费方写两套代码。
CREATE TABLE IF NOT EXISTS constraints (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                          -- R2
  doc         JSONB NOT NULL,                         -- Constraint：
                                                      --   { key, family, name, kind:"hard"|"soft",
                                                      --     expression, params, scope, status, penalty? }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS constraints_tenant_key ON constraints(tenant_id, (doc->>'key'));
CREATE INDEX IF NOT EXISTS constraints_tenant_family ON constraints(tenant_id, (doc->>'family'));
-- down: DROP TABLE IF EXISTS constraints;
```

**三条落地判据**

1. **`hard` / `soft` 必须分开** —— 不可行性诊断（IIS）只对 `hard` 有意义；
   `soft` 带 `penalty` 进目标函数。混成一个字段，前端就没法回答「这个方案为什么不可行」。
2. **52 条现有约束族必须迁进来，不是并存** —— 否则就是我自己反对过的第二套真相源。
   迁移方式：求解器侧改为**从表里读**，`OptConstraintFamily` 降为该表的一个 `family` 取值。
3. **⚠️ 保留初稿那条教训，但改成验收条件而不是降级理由**：
   本仓确实有「先建表后接线 → 又一张零调用方的表」的前科（欠账 #92 `llm_budgets`
   状态机完整但零调用方）。**所以这一单的验收硬条件是：建表的同一张单里必须带上
   「沙盘可行性面板真的读它」这条接缝断言** —— 表与消费方同单交付，不许拆。
   （这正是 SEAM-GATE 的用法：不是不建，是**不许只建一半**。）

### 4.3.1 不可行性诊断（S6 的 Infeasibility Engine）

有了一等 Constraint，「推演可行性」才有得算：

```
扰动注入 → 传导 → 约束逐条求值 → 违反集合 V
  V = ∅            ⇒ 可行，给方案
  V ≠ ∅ 且全 soft  ⇒ 可行但有代价，报 Σpenalty
  V ≠ ∅ 且含 hard  ⇒ 不可行 ⇒ 求极小不可行子集（IIS）⇒ 告诉用户「松哪一条就能行」
```

平台已有 `optimize_whatif` 的 `conflictConstraints`（`opt-template.ts:100`，IIS 式）——
**复用它的算法，把输入从「模板内部约束族」换成「一等 Constraint 表」。**

### 4.4 Neo4j 裁决：**不引**（且这不是我的新决定）

S6 提议引入 Neo4j 作为图层。实测：

- **全仓零代码、零依赖、零 compose 服务** —— `neo4j|cypher|gremlin` 只在 **4 份文档**里出现
- 且 **仓主本人已经裁过这件事**：`docs/PRD-A9-external-engines-design-deferred.md` 原文
  > 「**裁决（用户）：A9 仅出设计 PRD、标记"按需延后"** —— 三个外部引擎都设计齐"接入点"，
  > **不现在引真依赖**，守系统自包含 / R6 确定性 / 部署轻。」
- `PRD-ontology-browser-field-coverage.md:36` 也写着「不引入 Neo4j/ChromaDB 等外部存储」

**🔻 但我把 A9 的条件句读成了终判 —— 这是初稿的一处错。**

A9 原文是「**按需延后**——**规模/精度顶不住再上**」。那是一个**带触发条件的延后**，
不是永久否决。初稿写「维持原裁决 · 本次升级不触发这个条件」，
却**没给任何可测的判据** —— 等于用一句断言把条件句关死了。照 §0.25 改正：

**本次裁决：暂不引，但给出可测的触发判据。**

| 判据 | 阈值 | 今天实测 | 触发？ |
|---|---:|---:|---|
| 链路总数 | > 500k 条 | `links` 表 demo 租户量级 ≪ | ❌ |
| 单次传导跳数 | > 6 跳 | 传导网**只有 3 条边**，最长链 2 跳 | ❌ |
| 单 tick 建图耗时 | > 2s | 全量重建索引，当前数据量下未观测到瓶颈 | ❌ |
| 需要变长路径查询（`*1..n`） | 有此需求 | `propagateTick` 按规则逐跳走，不需要 | ❌ |

**⇒ 四项全不触发，本次不引。** 但这四项写进本 PRD 后成为**可复验的条件**：
§3.1.4 把传导边从 3 条补到六方向后，**必须重测「单次传导跳数」与「单 tick 建图耗时」**——
若届时跳数 > 6 或建图 > 2s，**按 A9 定的 CP-SAT sidecar 同款范式接入图引擎**
（自托管、数据不出边界、未配则显式「未接入」不兜底），**不需要再开一次会**。

**今天的图能力**：`links` 表已有 `links_tenant_from_idx` / `links_tenant_to_idx`
两个表达式索引（`008:53-54`），`propagateTick` 内部已建邻接表
（`navOut: "linkKey\0fromId" → toId[]`，`propagation.ts:238-243`）—— **图遍历已经在了**，
今天缺的是**边**（3 条），不是图引擎。**先补边，再谈换引擎。**

### 4.5 500+ State/Event 怎么落（🔻 **推翻初稿的一半**）

> **初稿写的是「不建状态本体表」**，理由是「8 套状态机各自正确各自有消费方，
> 强行统一 = 把 8 个能跑的换成 1 个要重接 8 处的」。
>
> 照 §0.25 复审：**这个论证只对「替换」成立，对「投影」不成立。** 我用一个反对**替换**的理由，
> 砍掉了一个只需要**投影**的需求 —— 形态与 §0.25 说的完全一致。

**改正：建统一状态本体，但它是只读投影层，8 套状态机原样不动。**

```ts
// 状态投影：不是新真相源，是对既有状态机的可查询视图
export const StateOntologyEntrySchema = z.object({
  ownerTypeKey: z.string(),      // "SimSession" / "Action" / "Decision" / "QueryTask" …
  stateKey: z.string(),          // "RUNNING"
  displayName: z.string(),       // "推演中"（中文业务名 —— 欠账 #63 要的那个）
  terminal: z.boolean(),         // 是否终态
  transitionsTo: z.array(z.string()), // 可达后继态
  sourceRef: z.string(),         // 单源锚点，如 "contracts/sim.ts:85"
});
```

**三条判据**

1. **只读 · 从既有枚举**派生 —— 8 套状态机是**唯一真相源**，投影层不许有第 9 套。
   派生方式与 `WO-RESOURCE-CATALOG-ONTOLOGY`（欠账 #83 已完成）同一条路，不另造机制。
2. **必须带 `sourceRef` 且被门校验** —— 否则又是欠账 #80 那种「file:line 锚点已漂而门只验文件存在」。
3. **为什么工业级沙盘一定要它**：500+ 状态若不可统一查询，
   Agent 回答不了「这个对象现在处于什么态、下一步能到哪些态」，
   而这正是「推演可行性」与「决策复杂度」两维的输入。**不是锦上添花。**

**另两件（初稿已有，保留）**

4. **事件补订阅方** —— outbox 已有 79 处 emit，但 `sim.*` 5 个事件里**只有 1 个有订阅方**（欠账 #145）。
   **补订阅方比补新事件重要得多** —— 300+ 事件里若大半没订阅方，那是 300 个 `llm_budgets`（欠账 #92）。
5. **新增 `sim.perturbation_applied` 事件**，且**同单必须带订阅方** —— 照上一条的教训，
   本 PRD 立规矩：**新事件与其订阅方同单交付，不许拆。**

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
                     REQ143 补边后此分量才转正 —— 这是 §7 验收的一条硬断言。
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
| **6 求解器四方案** | **加班 / 跨基地 / 外协 / 延期** 四个具体方案 | 🔴 **§3.1.4 + 新增 WO-R137**（见下） |
| 7–8 比对与推荐 | **方案比对**（含 ★BEST 标记 + `recommendedPlan`） | 🔗 §5.3⑤ |
| 9–10 批复与执行 | `Decision → ActionDraft` | 🔗 欠账 #81 |
| **11 外部反馈** | ERP ✅`mock_erp` / **MES ❌ / WMS ❌ / TMS ❌** | 🔴 **三个零**（见下） |

#### 🔴 5.2.1 我在这张表里又犯了一次 §0.25 的错（交叉核对抓到，必须记账）

上表第 6 行**原来写的是「59 个求解器 · ✅ 超配」**。第 11 行原来写的是「回写 · ✅ 已有」。

**两行都是拿平台库存当需求满足的证据** —— 正是 §0.25 判定不成立的那种论证：

- **第 6 行**：Demo 链要的四个方案是 **加班 / 跨基地 / 外协 / 延期** 四个**具体业务动作**。
  「59 个求解器」度量的是求解器数量，**不度量这四个方案能不能出来**。
  更糟的是它与本 PRD 自己的实测**直接打架**：§3.3.2 已经查明
  `MITIGATION_LIB`「无约束、无搜索、无迭代 ⇒ **不是求解器**」，而 CP-SAT 实解在
  `portfolio` / `job_shop_schedule` 里，**两者未打通 ⇒ 库外方案永远出不来**。
  **诊断写在 §3.3.2，结论写在这里且相反** —— 这是本 PRD 唯一一处自己推翻自己的实测。
- **第 11 行**：`ERP` 有 `mock_erp`，而 **MES / WMS / TMS 实测是零**。
  一行「✅ 已有」把三个零盖过去了。

**处置：新增两张 WO，并把 R137 提到与 R143 同级（台账三条 🔴 之一）。**

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **R137** 🔴 | 打通 `MITIGATION_LIB` ↔ CP-SAT 实解：四个方案（加班/跨基地/外协/延期）**由求解器实解产生**，不是库内枚举。承载物实测已存在：`overtime`(42) · `interbase-transfer.ts` · `outsourcing_split`+C08 红线 · `defer`/`finalDueDays` | **重** | P1（补边） |
| **R140-142** | MES / WMS / TMS 反馈接入（照 `mock_erp` 同款范式，**不新造机制**） | 中 | 无 |

**判据（写进这两张单）**：验收断言必须是「**库外方案能出来**」，不是「求解器被调用了」。
前者度量的是能力，后者度量的是调用 —— 这两个又是不同的命题。
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

### 5.4 🔴 UI 能力承载表（交叉核对抓到的最大缺口·54 条里我丢了 46 条）

> **仓主裁的是「不做 8 个页面」，明确说「这些都是用于借鉴的」，
> 而 §0.2③ 我自己也写了「能力逐条保留」。然后我把能力也一起丢了。**
>
> 交叉核对实测：S3（UI/UX Spec 25 条）+ S4（八页能力 29 条）= 54 条，
> **46 条是 ❌ 或 ⚠️（85%）**。§5.3 那张六行子页表 + 5 条 UI 纪律，
> 承载不了 54 条能力 —— 这是**用一个表格的存在，冒充了对 54 条需求的回答**。

**六子页不变**（§5.3），但每个子页要挂哪些能力，必须显式列出：

| 子页 | 挂哪些能力（REQ 编号） | 复用什么（禁重造） | 真缺的 |
|---|---|---|---|
| **① 全景** | REQ078 六大一级导航 · REQ079 首页三段（Enterprise State + Critical Decisions + Active Scenarios，**不做 KPI 大屏**）· REQ106 Global Shell · REQ107 健康分 · REQ109 CriticalEventList P0-P3 · REQ163 点节点右侧**按类型分化**详情 | `chainLineMap.ts`(985) + `ChainLineMapView.tsx`(940) · `ShellLayout.tsx` 导航 | 健康分（`cockpit_kpi` 出 5 标量，**无合成分**）· 事件清单 P0-P3 分级 |
| **② 扰动台** | REQ082 多扰动输入 · REQ111 **七种 operator**（今天 3 种，见下）· REQ113 **Mode B 自然语言建扰动** · REQ114 Mode C 对象图选择 · REQ118 **≥20 扰动并存** · REQ084 扰动间耦合预览 · REQ164 每节点扰动变量词表 | QOS orchestrator + 槽位填充（**不新建 NLU**）· 本体浏览器 + `slice-planner` | 三种 Mode 的入口 · 20 条并存的 UI 承载 · `VAR_CLASSES` 变量词表 |
| **③ 传导** | REQ085 联合推演 10 步进度 · REQ087 **Impact Waterfall** · REQ122 因果图 **8 种 edge 类型**（今 2 种）· REQ123 Impact Score · REQ124 Forward/Backward · REQ125 ≥1000 节点图 · REQ127 Event Stream 实时 · REQ128 Pause/Step/Speed | `PropagationTrace` · `unresolvedGates` 诚实缺席 · **SSE**（REQ129 ⛔ WebSocket：平台是 SSE，不引第二条实时通道）· BFS 双向已有 | 瀑布图 · 8 类 edge · 10 步进度 · 暂停/单步/倍速 |
| **④ 阻滞** | REQ092「**Why?**」任意数字可点 · REQ093「What changed」· REQ094「What should I do」· REQ169 各节点对财务指标影响占比 · REQ147 五段时长口径 | `gap_attribution`（数据已齐）· `chain_loss_attribution` · `CHAIN_STEP_KINDS` · `isValueAddKind`（唯一增值段 = `work`） | 三个问句的组装 · 按节点聚合财务影响 |
| **⑤ 方案比对** | REQ088 **方案比较表 + ★BEST** · REQ086 **BASELINE vs SCENARIO 语义** · REQ089 `recommendedPlan` AI 推荐卡 · REQ116 **Objective Builder 权重拖拽** · REQ130 Solver View（变量/约束/迭代/GAP/OPTIMAL） · REQ115 Constraint Builder **HARD/SOFT/PREFERRED** | `/sim/compare` · **`methodWeights` 已完整实现**（复用，别重写）· §4.3 `constraints` 表 | `BASELINE`/`SCENARIO` 标签 · ★BEST · 求解过程可视 · **`PREFERRED` 第三档**（§4.3 今天只有 hard/soft） |
| **⑥ 决策** | REQ044 **Decision Graph**（决策之间的边：parent/supersedes/conflictsWith）· REQ170 COO 页签（问题→影响→建议）· REQ074/REQ091 **Enterprise Decision Timeline**（非 BPMN） | `decisions` 表 + `decision-kernel.ts` 三态 | 决策间的边（`decisions` 表无这三个字段）· timeline 视图 · COO 页签 |

**跨子页的基础设施（三条，缺一则六子页各自为政）**

| REQ | 内容 | 为什么必须先做 |
|---|---|---|
| **REQ104** | `EnterpriseContext` 跨页上下文（**纯前端 store，无需后端**） | 六子页共享「当前世界/当前扰动/当前决策」，没有它每页各自取参 |
| **REQ103** | 七个 ID 串联（4 有 / **2 零**：`impactGraphId`(REQ046) · `EnterpriseContext`(REQ104) / 1 指代不明：`scenarioId`） | 这是「从①点到⑥」能不能走通的判据 |
| **REQ098** | 11 种状态色规范 —— **必须与既有 `ActionStatus` 建映射表，不许另造** | §4.5 的 `StateOntologyEntrySchema` 今天没有 `color`/`severity` 字段 ⇒ 前端仍会各造一套 |

**⚠️ 两条我此前少算的**

1. **REQ111 扰动 operator：需求是 7 种，§3.1.2 只给了 3 种**（`set`/`delta`/`scale`）。
   我论证了「为什么不能只有 `set`」，**没有论证「另外 4 种为什么不要」**——
   按 §0.25，缺失的 4 种既没被承载也没被合法裁掉。**WO-P0 须补齐或逐条给出裁决理由。**
2. **REQ126 Simulation 9 态状态机**：§6.4#15 只讲了给 `SimSession` 补
   「参数/种子/耗时/结论」四个字段，**9 态一个字没提**。
   纪律：**不许替换既有 5 态**（`SimSessionStatus`），9 态放在运行记录那一层上。

**UI 层 WO（补进 §6）**

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **U0** | `EnterpriseContext` 跨页 store + 七 ID 串联（REQ103/REQ104） | 中 | 无 |
| **U1** | 子页①②：全景挂能力 + 扰动台三种 Mode（REQ078/079/106/107/109/163 · REQ082/113/114/118） | **重** | U0 + P0 |
| **U2** | 子页③④：传导可视 + 三个问句（REQ085/087/122/123/127/128 · REQ092/093/094） | **重** | U0 + P2 |
| **U3** | 子页⑤⑥：方案比对 + 决策图（REQ086/088/089/116/130/115 · REQ044/074/170） | **重** | U0 + R137 |
| **U4** | 状态色单源映射表（REQ098）+ 设计系统对齐（REQ080 色值 / REQ095 六级层级 / REQ096 响应式四档 / REQ097 组件库） | 中 | U0 |

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
2. **环境前置**（2026-08-09 扩充 —— 三条都被实测顶回来过）：
   ```bash
   pnpm install --prefer-offline
   pnpm --filter @platform/contracts build
   pnpm --filter @platform/llm-adapters build   # ← 漏它 → 210 个套件报「与本单无关」的假红
   ```
   - **两个包都要 build，不止 contracts。** 只 build contracts 会撞
     `Failed to resolve entry for package "@platform/llm-adapters"`，**210 个套件全红**，
     极易被误判成本单打坏了什么。
   - 🔴 **`pnpm --filter <pkg> test -- <关键字>` 不会过滤**（实测：它照样跑全部 240 个测试文件，
     我自己复验时因此超时）。要跑单个测试文件，进包目录用
     `npx vitest run test/<文件名>.test.ts`。
     写错这条 = 让 dev 以为自己只跑了一个文件，实际跑了全量，既慢又会撞上不相干的红。

2.5. 🔴 **`dist` 过期是本仓最会骗人的一种假红**（2026-08-09 我自己栽在这上面，
   还据此派了一张 WO 出去）：好几道门读的是**构建产物**不是源码
   （如 `check-lever-binding-drift.mjs:53` 读 `packages/contracts/dist/`）。
   **源码是对的 + dist 是旧的 ⇒ 门会报「源码缺 XX」并给出精确到 `file:line` 的修法 ——
   那份修法是对着一份并不存在的缺陷开的药。**
   判据：**门报红时，先 build 再看，不要先改代码。**
   （该门现已加 dist 新鲜度金丝雀，不一致直接 exit 2 报「门自己坏了」；
   但别的门未必有，所以这条纪律照旧。）
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

#### 6.2.1 其余五层的 WO（**§3.0 表里「差什么」一列，逐条落单 —— 不许蒸发**）

| WO | 层 | 内容 | 画像 | 前置 |
|---|---|---|---|---|
| **L1-a** | 世界 | 分叉子世界持久读端（前端 `useQuery` 读 `GET /sim/sessions` + 世界列表页）·关闭「刷新即丢」 | 中 | 无 |
| **L1-b** | 世界 | `SimSession` 补运行记录字段（参数/种子/耗时/结论）·§6.4 #15 | 轻 | 无 |
| **L1-c** | 世界 | Agent 补 `sim_branch` / `sim_checkpoint` 两个工具（今天 `SIM_COMMANDER_TOOLS` 只有 4 个） | 轻 | L1-a |
| **L3-a** | 传导 | 🔴 修认证 Trial Tick 跑错栈（欠账 #152）—— 让它真跑 `propagateTick` | 中 | P2 |
| **L3-b** | 传导 | 传导增量化（今天每 tick 全量重建索引 `propagation.ts:236/240/246`） | **重** | P1+P2 |
| **L4-a** | 本体 | 统一状态本体投影层 + `sourceRef` 门（§4.5） | 中 | 无 |
| **L4-b** | 本体 | `sim.*` 事件补订阅方（欠账 #145，5 个里 4 个没有） | 轻 | 无 |
| **L4-c…f** | 本体 | 对象补面 86→300+，按 §6.5 的 **B1/B2/B3/B4** 四批，**一批一单** | 中×4 | B1 先 |
| **L6-a** | 约束 | 🔴 `constraints` 表 + 契约 + 52 条现有约束族**迁入**（不并存）·§4.3 | **重** | 无 |
| **L6-b** | 约束 | 不可行性诊断（IIS）复用 `optimize_whatif` 的 `conflictConstraints` 算法 | 中 | L6-a |
| **L7-a** | 求解 | 59 个求解器按 S6 的 10 类归档（纯分类，不动实现） | 轻 | 无 |
| **L7-b** | 决策 | 欠账 #81：`decision_play` 域 × `mitigation` 域的语义映射 | 中 | 无 |
| **S3** | 技能 | Skill 治理 P1+P2（`SkillExecutionTrace` + 采纳率回标）·§3.3.5 | 中 | S0 |
| **S4** | 技能 | ExecutionPlan 迁移 M0 影子声明（32 份）·§3.3.6 | 轻 | S0 |

> **⇒ 全量 WO 共 30 张**（P×4 · Q×3 · S×6 · L×14 · D×3）。
> 其中 **S0 一张就吃掉 4664 行已完成实现**，是唯一「不派 dev、审核方自己收编」的单。
> 按画像分层并发（CLAUDE.md 铁律 2）：重画像 ≤1 且 gate 跑着时为 0；中 2–3；轻不设限。

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **S0** | 🔴 **复验并入五条 Skill 实现分支**（不是开发，是收编 —— §3.3.1，共 16 提交 / 24 代码文件 / 4664 行） | **重**（审核方自己做，不派 dev） | 无 |
| **S0.5** | 修 `seed.ts:1332` 的 `kind:"solver"` precondition 被静默丢弃（§3.3.2 形态④·欠账 #154） | 轻 | 无 |
| **S1** | ~~`SkillDefinition.execution` 四分支~~ → **改为：加一个 `sim_perturb` 步骤类型**（`validatePlanSteps` 一个 case + 执行器一个 case） | **轻**（原估中，撤回后缩小·§3.3.3） | S0 + P0 |
| **S2** | SEAM：一个带 `sim_perturb` 步骤的 Skill 端到端打进沙盘（§7.1 头号断言） | **重** | S1 + P2 |

> **S0 是本次全部工作里性价比最高的一单，且不需要派 dev。**
> 五条分支上躺着：Skill Graph 契约 + **`Skill.execution`（已对名裁决，见 §3.3.3）** +
> `GraphScheduler` + `POST /b/v1/skill-graphs/run` + Parser/Validator +
> `POST /b/v1/skills/:id/compile` + 引用可校验门（含关死两层 fail-open）+ `ref-closure:check` 门 +
> `maxBudgetRounds` 接线 + `dependsOn` 种子 + 三组接缝驱动测。
> **复验并入即可，一行新代码都不用写。**
>
> 复验口径照 LOOP 纪律：worktree 隔离 checkout → 组合四包 gate → cherry-pick 上 canonical → push。
> ⚠️ 五条分支各落后 canonical **30–31 提交**（实测，不是几百）—— 复验前仍须按 §6.1 第 1 条做
> **祖先关系**判定，不要用「某文件在不在」当判据（那个错一天骗到 4 个 dev）。
> ⚠️ 五条之间**很可能互相冲突**（`orchestrator-s1` 与 `compiler-s1` 都改
> `agentcore/src/server.ts` 与 `contracts/src/index.ts`）——按
> `orchestrator-s1 → compiler-s1 → refclosure-a → partial-a → partial-b` **串行**并，
> 每并一条跑一次四包 gate，**不许攒着一起并**。

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

### 6.4 🔻 16 条「不做」逐条复审（照 §0.25 需求优先重判）

> 初稿把这 16 条一股脑列成「明确不做」。按仓主「不要打补丁 / 不要遗漏我的需求」重判：
> **只有两种理由能真正出局** ——（a）仓主自己裁的；（b）有 file:line 证据证明照做会造第二套真相源。
> 「工作量大」「是独立项目」「平台有个差不多的」**都不算理由**。

| # | 初稿裁「不做」的项 | 我当时的理由 | 重判 | 处置 |
|---|---|---|---|---|
| 1 | 审批流 | 仓主裁决① | ✅ **维持** | 仓主自己裁的 |
| 2 | 权限矩阵 | 随审批一起 | ✅ **维持** | 同上 |
| 3 | 8 个独立页面 | 仓主裁决③ | ✅ **维持**（能力逐条保留，见 §5.3） | 仓主自己裁的 |
| 4 | 前端写死任何数据 | 仓主裁决② | ✅ **维持**（已建门 §7.3） | 仓主自己裁的 |
| 5 | `ontology_object_type/_object/_relationship` 三表 | 与 `ontology_types`/`objects`/`links` 并行 | ✅ **维持** | 有 `001_init.sql:95/127/138` + `008:53-54` 索引为证：照建就是第二套真相源 |
| 6 | `world` 表 | 与 `sim_session` 并行 | ✅ **维持** | `026_sim_sessions.sql:3` 含 `parent_checkpoint_id`，它就是 world |
| 7 | 150 个 Skill 铺量 | 铺量不是需求 | ✅ **维持**（但须**证明**可扩展） | `SkillExecutionStepSchema.type` 是开放串 + `passthrough`（`skill-graph.ts:376`）⇒ **铺到 150 个不需要改一行代码**。这是证明，不是承诺 |
| 8 | 300+ 对象一次补齐 | 一次补不现实 | ✅ **维持分批**（但须给**完整分批表**，不许含糊说「按域分批」） | §6.5 给 15 类 × 批次表 |
| — | —— 以下 **8 条推翻，恢复进范围** —— | | | |
| 9 | **Constraint 建表** | 「先只读投影，等有人要 CRUD 再说」 | 🔴 **推翻** | **这是平台谨慎在裁需求。** S6 明写要 Rule/Constraint DSL，North Star 的「推演可行性」维就压在约束上。改为**建一等对象**（§4.3 重写） |
| 10 | **统一状态本体** | 「8 个状态机各自能跑，统一 = 把 8 个能跑的换成要重接 8 处的」 | 🔴 **推翻一半** | 原论证只对「**替换**」成立，对「**投影**」不成立。改为：**建只读状态投影层**，8 个状态机原样不动（§4.5 重写） |
| 11 | **Skill 编译器** | 「独立项目，本次不铺」 | 🔴 **推翻** | 实现已在 `handoff-skill-compiler-s1`（1513 行）⇒ 不是「铺」，是**收编**。S0 |
| 12 | **Reasoning Graph 编排器** | 同上 | 🔴 **推翻** | 实现已在 `handoff-skill-orchestrator-s1`（1673 行）⇒ 同上。S0 |
| 13 | **Skill 治理学习闭环** | 「⑫ 层不铺」 | 🔴 **推翻分期** | SPEC ⑫「人工采纳率 → 学习」是工业级 Skill 的定义性特征，不是加分项。本期落**可测的最小闭环**（Execution Trace + 采纳率埋点），学习算法后期（§3.3.5） |
| 14 | **32 份 ExecutionPlan 迁移** | 「后续」 | 🔴 **推翻 M0** | 迁移 PRD 已拆成 5 张 WO（`handoff-skill-migration-scope`，507 行）。本期落 **M0 影子声明**（零风险：32 份 Plan 在 Skill 侧留影子记录，不改运行时），全量迁移后期 |
| 15 | **`simulation_run`** | 「`sim_session`+`sim_tick_state` 合起来就是 run」 | 🔴 **推翻一半** | 「是 run」不等于「有 run 的语义」——今天 `SimSession` **没有**参数/种子/耗时/结论字段，「这次推演是怎么跑出来的」无处可查。改为：**扩 `SimSession` 补运行记录字段**（不新建表，此判断保留） |
| 16 | **Neo4j** | 引 A9 旧裁决「不引真依赖」 | 🔴 **改为条件化** | A9 原文是「**按需延后** —— 规模/精度顶不住再上」，那是**条件性延后不是永久否决**。我把条件句读成了终判。改为**给可测触发判据**（§4.4 重写） |

**⇒ 8 条恢复进范围。其中 4 条（11/12/13/14）只需复验并入，不需新开发。**

### 6.5 对象补面分批表（承接上表 #8 · 15 类 × 4 批）

| 批 | 类（S6 的 O.Taxonomy） | 为什么这批优先 |
|---|---|---|
| **B1** | A 组织 · B 产品 · C 物料 | 传导网六方向的**源与靶**都在这三类；不补它们 §3.1.4 的边挂不上 |
| **B2** | D 设备 · E 产能 · F 工艺 | North Star 的「卡点」维直接压在这三类 |
| **B3** | G 订单 · H 计划 · I 库存 · J 物流 | 「时长/堵点」维 + Demo 链阶段 1–5 |
| **B4** | K 质量 · L 成本 · M 供应商 · N 客户 · O 决策 | 「消耗/断点」维 + 决策闭环 |

**每批一单，单内不许跨批** —— 跨批就会出现「一个 dev 同时改四类对象」的巨单，
那是 LOOP 纪律③「靠文件边界不靠身份」防的那种单。

### 6.6 🔑 WO → 需求编号映射（**没有这张表，§7.4 的「回勾」就没有钥匙**）

> 交叉核对指出的结构性问题：全 PRD 1169 行里 172 个编号只出现了 2 个（`REQ060`/`REQ143`），
> 「每个 WO 完成后必须回勾对应条目」这条纪律**无法执行**，因为没有 WO↔编号的对应关系。
> 这张表就是钥匙 —— 加上它之后，`check-req-coverage` 能自动算出「哪些编号没有 WO 覆盖」。

| WO | 关闭哪些需求编号 |
|---|---|
| **P0** 扰动一等公民 | REQ060 REQ111 REQ118 REQ164 |
| **P1** 补传导边六方向 | REQ143 REQ125 REQ035 |
| **P2** propagateTick 接扰动 | REQ033 REQ034 REQ046 |
| **P3** scope 读端 | REQ130（台账）· 欠账 #130 |
| **Q0** ProcessDefinition | REQ024 REQ070 |
| **Q1** process_chain_node_map | REQ021 |
| **Q2** 流程三件套 | REQ054 REQ057 REQ166 |
| **S0** 收编 5 条 Skill 分支 | REQ018 REQ064 REQ066 REQ155 |
| **S0.5** solver precondition | 欠账 #154 |
| **S1** `sim_perturb` 步骤 | REQ155 |
| **S2** SEAM 端到端 | REQ063 |
| **S3** Skill 治理 P1+P2 | REQ066 REQ067 |
| **S4** ExecutionPlan M0 | REQ064 |
| **L1-a/b/c** 世界层 | REQ023 REQ039 REQ069 REQ126 REQ036 REQ086 |
| **L3-a** Trial Tick 修 | 欠账 #152 |
| **L3-b** 传导增量化 | REQ032 REQ038 REQ073 |
| **L4-a** 状态本体投影 | REQ010 REQ098 |
| **L4-b** sim.* 补订阅方 | REQ009 |
| **L4-c…f** 对象补面 4 批 | REQ008 REQ068 |
| **L6-a** Constraint 一等对象 | REQ115 |
| **L6-b** 不可行性诊断 | REQ138 |
| **L7-a** 求解器归 10 类 | REQ016 REQ130 |
| **L7-b** decision_play 映射 | 欠账 #81 |
| **R137** 🔴 方案由实解产生 | REQ137 REQ133 REQ134 REQ135 REQ136 |
| **R140-142** MES/WMS/TMS | REQ140 REQ141 REQ142 REQ139 |
| **U0** 跨页上下文 | REQ103 REQ104 |
| **U1** 子页①② | REQ078 REQ079 REQ106 REQ107 REQ109 REQ163 REQ082 REQ113 REQ114 REQ084 |
| **U2** 子页③④ | REQ085 REQ087 REQ122 REQ123 REQ124 REQ127 REQ128 REQ092 REQ093 REQ094 REQ169 REQ147 |
| **U3** 子页⑤⑥ | REQ088 REQ089 REQ116 REQ130 REQ044 REQ074 REQ091 REQ170 |
| **U4** 设计系统 | REQ080 REQ095 REQ096 REQ097 REQ098 |
| **D0…D6** 数据补齐 | REQ007 REQ025 REQ058 REQ059 |

**仍未被任何 WO 覆盖、且本 PRD 明确记录为「暂不做」的（补齐 §6.4 漏记的三条）**

| 编号 | 内容 | 裁决理由（须属 §0.25 认可的两种） |
|---|---|---|
| **REQ101** | Monte Carlo | ⛔ 无承载物且仓主未要求。**记在此处**，免得将来有人问「为什么没有蒙特卡洛」在 PRD 里查不到答案 |
| **REQ110** | 新建 `Scenario` 对象 | ⛔ **本仓已有 6 个同名不同物**，建第 7 个即第二套真相源 —— 属 §0.25 的 (b) 类 |
| **REQ129** | WebSocket | ⛔ 平台实时通道是 SSE，引第二条 = 第二套机制 —— 属 (b) 类。**记在此处以防下一个 dev 引入** |
| **REQ171** | 「后端无需变只改前端」 | ⛔ **已被后续需求推翻**（本 PRD 大量改后端）。此处记录该裁决被推翻及原因，供日后对账 |
| **REQ061/REQ062** | Replanning Loop / Continuous Decision Loop | ⏸ **本期不做，但不是裁掉**：它依赖 P2（扰动接传导）+ R137（实解方案）两条链都通了才有意义。**触发条件：P2 与 R137 均验收通过后立单**，不是无限期推迟 |
| **REQ042/REQ043** | 按 Decision Intent 语义裁剪切片 | ⏸ 同上，依赖 `DecisionIntent` 概念先落地。**触发条件：L6-a 完成后立单** |

### 6.7 剩余 21 条的落点（**逐条给真落点，不靠撒编号凑数**）

> 加完 §6.6 映射表后覆盖门从「未落 82」降到「未落 21」。
> 这 21 条我**不会**为了让数字好看而随手写进某张单 —— 那正是本 PRD 反复在治的病。
> 逐条给：要么挂到一张**已存在的 WO**上，要么**新立单**，要么**带触发条件地暂缓**。

| 编号 | 需求 | 落点 |
|---|---|---|
| **REQ121** 🔴 | `upsertType` 吞七字段（`ontology.ts:197-212` 漏抄 `stateVariables/functions/actions`…） | **已有单 D6**（`WO-PACK-twin-data.md` 唯一真 bug）。它是 REQ006 的根因 |
| **REQ006** | 本体状态流主线：`stateVariables` 定义有但**写入被吞** | **随 D6 一并闭** —— 不是两件事，是同一个 bug 的两面 |
| **REQ150** 🔴 | 韧性不足 `resilienceGap`（全仓 18 处「韧性」无一是业务韧性·零承载） | **§5.1.1 已给可计算定义**（恢复 tick 数由 `propagateTick` 实测，权重进规则表）。**新立单 N1**，前置 P2+P1 |
| **REQ151** 🔴 | 决策复杂度 `decisionComplexity`（全仓 11 处全是 DRIL 求解器成本权重，不是这个） | **§5.1.1 已给定义**，且已诚实声明「传导图度数分量今天算不准（只 3 条边）」。**新立单 N2**，前置 P1（补边后该分量才转正） |
| **REQ152** | 推演决策的可行性 | **已有单 L6-a + L6-b**（Constraint 一等对象 + IIS）—— 这就是它的承载物 |
| **REQ022** | 「订单进入后企业如何被扰动」总目标 · 需 `EnterpriseState` 常驻承载 | **新立单 N3 · `EnterpriseState`**。交叉核对抓到我整条漏了：§4.1 的 12 张表裁决里连「⛔不建」都没写。⚠️ 它与 §6.4#15（扩 `SimSession` 补运行记录）**不是一回事**：那个是「一次推演的记录」，这个是「企业的常驻状态，会话结束不消失」 |
| **REQ020 / REQ029** | 时间轴引擎 / `Time` 世界 | **已有单 P0**（扰动的 `startTick`/`durationTicks` 就是时间维）+ 复用 `SimClock`（一 tick = 一日）。REQ029 与 REQ020 同源，一并闭 |
| **REQ165** | 多扰动因素**联合**推演 | **已有单 P1** —— `propagateTick` 天然联合，瓶颈是边不足（REQ143），补边即闭 |
| **REQ015** | Scenario Engine 层 · **命名须避开 6 个同名物** | **新立纪律（非单）**：写进 §7 命名纪律 —— 本仓已有 6 个 `Scenario` 同名不同物（REQ110 已 ⛔ 不建第 7 个）。**任何新命名前先跑 `crossbranch-reinvent:check --symbol <名>`** |
| **REQ056** | Availability 在岗（台账明写「保留」，「为什么卡住」要用） | **挂到 Q2**（流程三件套之 `waitKind`）—— 「人不在岗」正是一种等待类型 |
| **REQ132** | 评审三态聚合（✓/⚠/✗），无「评审单」承载体 | **挂到 U1**（子页① Critical Events）—— 三态聚合是事件清单的一种呈现，不另造承载体 |
| **REQ119 / REQ120** | 切片三栏（Tree/Graph/Detail）· 切片时间滑块 Time Travel | **新立单 U5 · 切片子页**。交叉核对说得对：§5.3 六子页里**没有切片页**，而 REQ090 的切片 UI 工作没有落点。数据齐（`executeSlice`），缺的是前端 |
| **REQ153** | 16 层切片规格（平台覆盖 12/16：Function 签名 0 · Interface 8 · 时间语义弱） | **挂到 U5** + 欠账 #69（本体七要素缺口）。⚠️ 这 4 层缺口与欠账 #69 是同一件事，不许当两件做 |
| **REQ154** | Slice ≠ Subset（语义闭环） | ⏸ **带触发条件暂缓**：依赖 REQ042（Decision Intent）。**触发条件：L6-a 完成后与 REQ042/043 同单立** |
| **REQ077** | UX 主循环 Observe→Orient→Decide→Act→Recalibrate（各环节有，**闭环未串**） | **挂到 U0**（跨页上下文）—— 「闭环未串」的本质就是六子页之间没有共享上下文，U0 就是串它的那根线 |
| **REQ099** | 六条核心 UX 原则（可解释/可回滚/独立World/有Evidence/可Replay/支持What-if） | **升为 §5 的验收条款**，不是一张单：六子页**每一页**交付时都要对照这六条自查。写进 §5.3 UI 纪律作第 6 条 |
| **REQ100** | North Star 用户路径（缺 REQ046 与 REQ060 两处断点） | REQ060 已由 P0 闭；**REQ046（`impact_graph_id` 可传递）挂到 U0**（七 ID 串联之一）。两处都闭，路径才通 |
| **REQ105** | 前端路由设计（仓主已定**一页多子页**，非 8 条独立路由） | **挂到 U0** —— 一页多子页的路由结构是 U0 的一部分 |
| **REQ162** | 每个节点是一个部门（信息/指标/决策/推演四类内容） | **挂到 Q2**（`ownerFunctionKey` = 部门归属）+ **U1**（REQ163 按类型分化的详情面板）。指标与推演已有，缺的是**部门归属**这一维 |

**新立的四张单（补进 §6.2.1）**

| WO | 内容 | 画像 | 前置 |
|---|---|---|---|
| **N1** | `resilienceGap` 韧性缺口（REQ150）—— 恢复 tick 数由 `propagateTick` **实测**得出，不是估的；权重进规则表可编辑 | 中 | P1 + P2 |
| **N2** | `decisionComplexity` 决策复杂度（REQ151）—— 五分量；**耦合分量在补边前必须显式标「数据不足」，不许拿 3 条边算个数糊上去** | 中 | P1 |
| **N3** | `EnterpriseState` 企业常驻状态（REQ022/REQ023/REQ069）—— 会话结束不消失 | **重** | P0 |
| **U5** | 切片子页（REQ119/REQ120/REQ090/REQ153）—— 三栏 + 时间滑块 | 中 | U0 |

**⇒ WO 总数从 30 张增至 40 张**（P×4 · Q×3 · S×6 · L×14 · U×6 · N×3 · R137/R140-142×2 · D×3，去重后 40）。

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

### 7.2 时序维专项断言（REQ060）

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

**172** 条需求台账逐条勾选，`☑ = 已裁决并有证据`（**明确不等于已实现**）。
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
- **§8 断点**：关闭 #150 #151 #130 REQ060 REQ143；新登记「Constraint 只读投影未可写」

**另需回写本文件**：若 §2 的任一实测结论在实施过程中被推翻，
**必须回本文改，并注明推翻它的证据（`file:line` + 复验命令）** —— 本体不回写即过期失效。

---

## 附 · 命名纪律

命名**禁用外部产品名**（参考产品是参考产品），一律用平台自有术语。
「决策推演沙盘」「链路节拍节点」「业务流程层」「扰动」「阻滞点」—— 这些是本平台的词。
