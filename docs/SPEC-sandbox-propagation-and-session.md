# 推演沙盘 · 传导核 + 会话层 落地规格（增量 1/3 · 行业无关 · 配置驱动 · 按租户模块化）

> 这是什么：把"把 ❌/◐ 变 ✅"落成**实现 agent 可照抄的工程规格**——通用传导核（纯函数）+ SimSession 会话/检查点/分支（三张普通表，进现有 pg+memory）+ 系数配置化 + **按租户暗发不同模块**。对应 RUNBOOK 增量 1（会话+CLI）与增量 3（传导引擎）。
> 三条硬约束（用户三次强调）：**① 零业务常数（R14）——代码里不得出现 Supplier/Factory/Order/锂电/基地任何行业实体名，全部是抽象 (typeKey, stateVar, linkKey) + 数值系数；② 多租户通用——物流/医疗/金融租户用同一套核，各自定义自己的类型/链路/状态变量；③ 按需配置——每个客户经 entitlement 开不同子模块（lite 客户只给基础传导，旗舰客户给延迟+分支+认证）。**
> 不需要时序图数据库：图小（千级节点）、tick 是会话内模拟时间、传导是确定性内存计算。详见对话与接地地图 §C。

---

## 0. 一张图：数据从哪来 → 核怎么算 → 状态存哪（全程走正门、零行业常数）

```
任意行业本体(租户自建/合成/连接器导入)         ← 世界态来源,走正门(R16/R4),不硬编码
        │ 物化对象 + 链路 + 状态变量(派生属性)
        ▼
SimSession.base_snapshot (tick 0 世界态) + scope(切片范围,复用 slice-planner)
        │
        ▼  每推进 1 tick:
propagateTick(graph, state_t, rules[], pending) ──纯函数,确定性(R6)──> state_{t+1} + trace
   · 沿 viaLink 导航(复用 recompute 的 navIn/navOut, ontology-core.ts:~400)
   · 贡献 = 系数 × source状态 × 可选衰减(复用 risk.ts:177 衰减公式)
   · 延迟 = 贡献排进 pending 队列,在 tick t+delay 到达(确定性,无时钟)
        │
        ▼  落 sim_tick_state(每 tick 快照+pending+trace) ；命名存档=sim_checkpoint
   rollback = 删 tick>检查点 的态；branch = 以检查点态为 base 开新 session
```

**关键：传导核只认 `(typeKey, stateVar, linkKey, 系数, 延迟)`——给它喂供应链本体就跑供应链，喂医疗本体就跑医疗。行业是"喂进去的内容"，不是代码。**

---

## 1. 传导核（增量 3 · 新写 · 纯函数 · 零业务常数）

新文件 `apps/datacore/src/sim/propagation.ts`。**契约进 `@platform/contracts`（跨包共享，R1）。**

### 1.1 PropagationRule —— 一等类型对象（不塞进 RuleEntry）

> 诚实接地（2026-06-24 更新）：**G-10「规则即引用」P1 已落**（commit 261f29e）——`RuleEntrySchema`（datacore.ts:110）**现已有 `params: Record<string,number>`（命名阈值）**。因此设计取**结构 + 引用分离**：`PropagationRule` 仍是**自己的一等类型**（承载 source/target/link 结构——这是 `rule.params` 那个纯数字表装不下的），但其 `coefficient`/`delayTicks` **应优先引用一条可编辑规则的 `rule.params`**（真正兑现「改规则即改推演」=竞品价值主张+G-10 目标）；冷启动可先内联数值，再接规则引用。**两条路都不阻塞**，且 P1 已把"引用"那条路打通。

```ts
// packages/contracts/src/sim.ts  (NEW)
export const PropagationRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string(),                 // R2 tenant_id everywhere
  key: z.string(),                      // 稳定键,可被 OPERATION_CATALOG/审计引用
  sourceTypeKey: z.string(),            // 抽象——任意对象类型
  sourceStateVar: z.string(),           // 抽象——任意状态变量(派生属性)
  viaLinkKey: z.string(),               // 抽象——任意链路类型
  targetTypeKey: z.string(),
  targetStateVar: z.string(),
  coefficient: z.number(),              // 配置,可编辑(竞品的 0.85 / 0.7 在这)
  delayTicks: z.number().int().min(0),  // 配置,可编辑(竞品"延迟1个时序"=1)
  combine: z.enum(["sum", "max"]).default("sum"),   // 多入边如何累加
  decay: z.object({ window: z.number().int(), den: z.number() }).nullable().default(null), // 复用 risk.ts 衰减,可空
  clamp: z.object({ min: z.number(), max: z.number() }).nullable().default(null),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).default("DRAFT"),
});
export type PropagationRule = z.infer<typeof PropagationRuleSchema>;
```

### 1.2 核函数签名（纯·确定性 R6·无 Date.now/随机）

```ts
// apps/datacore/src/sim/propagation.ts
export interface TickState { [objectId: string]: { [stateVar: string]: number } }
export interface DelayedContribution { arriveTick: number; targetObjectId: string; targetStateVar: string; amount: number; ruleKey: string }
export interface PropagationTrace { ruleKey: string; fromObjectId: string; toObjectId: string; amount: number; viaLinkKey: string }

/**
 * 一个 tick 的传导,纯函数:同 (graph, state, rules, pending, tick) → 同输出(R6 字节一致)。
 * - graph: 已物化对象 + 链路(从本体库读,任意行业)
 * - 沿 viaLink 用 recompute 的链路导航(navIn/navOut)解析边,行业无关
 * - delay>0 的贡献排进 pending,在 arriveTick 到达;delay=0 当 tick 生效
 */
export function propagateTick(
  graph: { objects: { id: string; typeKey: string }[]; links: { fromId: string; toId: string; linkKey: string }[] },
  state: TickState,
  rules: PropagationRule[],
  pending: DelayedContribution[],
  tick: number,
): { next: TickState; pending: DelayedContribution[]; trace: PropagationTrace[] }
```

### 1.3 算法（确定性、稳定排序，避免浮点/遍历序不确定）

1. `next = deepClone(state)`；先结算 `pending` 中 `arriveTick === tick` 的贡献（按 `(targetObjectId, targetStateVar, ruleKey)` **稳定排序**后 `sum/max` 累加）。
2. 对每条 PUBLISHED 规则：沿 `viaLinkKey` 取所有 `source(typeKey)──link──>target(typeKey)` 边（复用 recompute 链路导航）；贡献 `amount = coefficient × state[source][sourceStateVar] ×(可选 decay)`。
3. `delayTicks===0` → 当 tick 累加进 `next`；`>0` → push 进 `pending`（`arriveTick = tick + delayTicks`）。
4. 应用 `clamp`；返回 `{ next, pending(去掉已结算), trace }`。`trace` 喂前端"三级风险轨迹"可视化。
5. **确定性纪律**：所有遍历对 id 排序；不调 `Date.now()/Math.random()`；浮点按固定精度。单测：同输入跑两次 `expect(a).toEqual(b)`。
6. **时间信任（Temporal Trust，防未来窥视）**：tick t 的计算**只读 ≤t 的状态 + pending 队列**，**绝不读未来 tick 态**；延迟贡献只能落在 `arriveTick > 当前 tick`。（对应竞品"Temporal Trust"信任维；与 R6 确定性正交——确定性管"可复现"，时间信任管"不作弊读未来"。）

> 复用而非重写：链路导航=recompute（`ontology-core.ts` resolveAffectedTargets / navIn·navOut）；衰减公式=risk.ts:177（`amp×(1-dist/den)`）；tick 循环=simclock。**核只是把这三者在"任意本体 × 逐 tick × 系数 × 延迟"上合体——这是接地地图 §C 说的唯一全新算法。**

---

## 2. SimSession 会话层（增量 1 · 三张普通表 · R9 四处同改 · 无新库）

> R9 铁律：新表必须同改 **migrations + repo/pg.ts + repo/memory.ts + repo/repo.ts 接口** 四处。

### 2.1 迁移 `apps/datacore/migrations/026_sim_sessions.sql`

```sql
-- 推演沙盘会话/逐tick态/检查点(行业无关;state 为 jsonb,不含任何业务列)
CREATE TABLE sim_session (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,                 -- R2
  base_snapshot   jsonb NOT NULL,                -- tick0 世界态(合成/连接器/切片物化而来)
  scope           jsonb NOT NULL,                -- 范围裁剪(复用 slice-planner 子图)
  status          text NOT NULL DEFAULT 'DRAFT', -- DRAFT|READY|RUNNING|PAUSED|ENDED
  cur_tick        int  NOT NULL DEFAULT 0,
  parent_checkpoint_id text,                     -- 非空 = 本会话是某检查点的分支
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sim_session_tenant ON sim_session(tenant_id);

CREATE TABLE sim_tick_state (
  session_id  text NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  tenant_id   text NOT NULL,                     -- R2
  tick        int  NOT NULL,
  state       jsonb NOT NULL,                    -- TickState(对象→状态变量值)
  pending     jsonb NOT NULL DEFAULT '[]',       -- 延迟贡献队列快照(resume 确定性)
  trace       jsonb,                             -- 传导轨迹(可视化)
  PRIMARY KEY (session_id, tick)
);
CREATE INDEX sim_tick_tenant ON sim_tick_state(tenant_id, session_id);

CREATE TABLE sim_checkpoint (
  id          text PRIMARY KEY,
  session_id  text NOT NULL REFERENCES sim_session(id) ON DELETE CASCADE,
  tenant_id   text NOT NULL,                     -- R2
  tick        int  NOT NULL,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sim_checkpoint_tenant ON sim_checkpoint(tenant_id, session_id);
-- down: DROP TABLE sim_checkpoint, sim_tick_state, sim_session;  (R9 可回退)
```

> 起步用**每 tick 全量快照**（图小，简单、R6 确定）；规模大再换 base+delta。**全是 jsonb，零业务列——换行业不改表。**

### 2.2 语义

| 操作 | 实现 | 不变量 |
|---|---|---|
| **init** | 建 session，`base_snapshot` ← 合成/连接器/切片物化的世界态（走正门）；`scope` ← slice-planner 选子图 | R16 倒序发育起步、禁硬编码 seed |
| **tick(n)** | 循环 `propagateTick`，每步落 `sim_tick_state`，`cur_tick += n` | R6 确定性 |
| **act(干预)** | 改 session 内状态（模拟态，**不写真值**）；采纳才生成 R4 ActionDraft | R4 / replay 红线 |
| **checkpoint(label)** | 记 `(session, cur_tick, label)` | — |
| **rollback(cpId)** | 删 `tick > cp.tick` 的 `sim_tick_state`，`cur_tick = cp.tick` | 确定性恢复 |
| **branch(cpId)** | 新建 session，`base_snapshot` ← cp 处 tick 态，`parent_checkpoint_id = cpId` | 世界态级分支 |
| **compare(a,b)** | 取两 session/分支的 KPI 序列对比（输出形状复用 `counterfactual_timeline`） | 复用不另造 |

### 2.3 repo 接口（`repo/repo.ts` 加一支，pg+memory 各实现）

```ts
export interface SimRepo {
  createSession(s: SimSession): Promise<void>;
  getSession(tenantId: string, id: string): Promise<SimSession | null>;   // 跨租户 → null(R2)
  putTickState(ts: SimTickState): Promise<void>;
  listTickStates(tenantId: string, sessionId: string): Promise<SimTickState[]>;
  deleteTicksAfter(tenantId: string, sessionId: string, tick: number): Promise<void>; // rollback
  createCheckpoint(cp: SimCheckpoint): Promise<void>;
  getCheckpoint(tenantId: string, id: string): Promise<SimCheckpoint | null>;
  propagationRules(tenantId: string): Promise<PropagationRule[]>;          // PUBLISHED only
}
```

---

## 3. 系数配置化 + 倒序发育（不写死、可编辑、能长出）

1. **配置驱动**：coefficient/delayTicks 是 PropagationRule 的类型化字段，经 `/a/v1/sim/propagation-rules` CRUD 编辑（沙盘"传导规则"编辑器，并入既有规则库 IA，不另开页）。**改系数即改结果**——单测断言改 coefficient 后 tick 输出变化。
2. **倒序发育**（R16，复用 buildplan §3.3）：PropagationRule 是**新 BuildPlan need + 注册 provisioner**（新增 need 不注册即测试红）。一句场景 → comprehend 倒推出传导规则草案（DRAFT），缺系数 → GapReport `NO_RULE` → `runGrowthLoop` 补草案或开真人工单（**不静默**）。
3. **零业务常数门**：`debattery:check` 扫 `sim/` 目录——出现行业实体名即红。

---

## 4. 按租户配置不同模块（entitlement 暗发 · R3 · "按需给不同客户不同模块"）

> 这就是"配置化、按需提供模块"的落点：每个沙盘子能力是一条 `FeatureDef`，`defaultOn:false`（暗发），用 `requires` 表达依赖。**给某客户开哪几个 = 开哪几个 entitlement；关掉的模块对该租户 404 不存在（R3）。**

`apps/datacore/src/features.ts` FEATURE_REGISTRY 追加（**全 defaultOn:false**）：

```ts
{ key: "sim.sandbox",        name: "推演沙盘",        level: "VIEW",  defaultOn: false },                                   // 总开关
{ key: "sim.propagation",    name: "系数传导",        level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },        // 基础:系数(无延迟)
{ key: "sim.propagation.delay", name: "延迟传导",     level: "BLOCK", defaultOn: false, requires: ["sim.propagation"] },    // 进阶:系数+延迟
{ key: "sim.checkpoint",     name: "检查点/回滚",     level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
{ key: "sim.branch",         name: "分支对比",        level: "BLOCK", defaultOn: false, requires: ["sim.checkpoint"] },
{ key: "sim.certification",  name: "就绪认证 L0-L4",  level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
{ key: "sim.commander",      name: "AI 推演指挥台",   level: "BLOCK", defaultOn: false, requires: ["sim.sandbox", "qos.agent-fallback"] },
```

**配置样例（同一套代码、按需组装）**：

| 客户档位 | 开的模块 | 体验 |
|---|---|---|
| Lite | `sim.sandbox` + `sim.propagation` | 建模+单步/无延迟传导 |
| Pro | + `sim.propagation.delay` + `sim.checkpoint` | 逐 tick 延迟传导 + 存档回滚 |
| 旗舰 | + `sim.branch` + `sim.certification` + `sim.commander` | 分支对比 + L0-L4 认证 + NL 指挥台 |

> 每个 `/a/v1/sim/*` 路由先过 entitlement 门（R3）：关 → 404 `FEATURE_NOT_FOUND`。**lite 租户调 `/sim/sessions/:id/branch` 直接 404,模块"不存在"——零代码分叉地实现"按需供给"。**

---

## 5. 端点 + CLI 对等（R15 · CLI 先于 UI）

每个 op 注册 `OPERATION_CATALOG`（`cliCommand`），`cli-parity:check` 守；先 CLI 跑通再做 UI（增量 4）。

| REST（`/a/v1/sim/*`，过 R2/R3） | CLI | entitlement |
|---|---|---|
| `POST /sessions`（init: base+scope） | `platform sim init` | sim.sandbox |
| `POST /sessions/:id/tick` | `platform sim tick --n 2` | sim.propagation |
| `POST /sessions/:id/act` | `platform sim act` | sim.sandbox |
| `POST /sessions/:id/checkpoint` | `platform sim checkpoint --label` | sim.checkpoint |
| `POST /sessions/:id/rollback` | `platform sim rollback --cp` | sim.checkpoint |
| `POST /sessions/:id/branch` | `platform sim branch --cp` | sim.branch |
| `GET  /sessions/:id/compare` | `platform sim compare --a --b` | sim.branch |
| `GET/POST /propagation-rules` | `platform sim rule ...` | sim.propagation |

---

## 6. 验收（DoD · FDE 亲手 · 两行业证 R14）

1. **CLI 无头跑通一遍**：`init → act → tick×2 → checkpoint → tick → rollback → branch → compare`，贴输出。
2. **确定性**：同 base+规则+操作序列跑两次，`sim_tick_state` 字节一致（R6 单测）。
3. **改系数即改结果**：改一条 PropagationRule.coefficient，重跑，tick 输出随之变。
4. **两行业各跑通**（**证零行业锁死**）：同一套核，喂"供应链(供应商→工厂→订单)"与"另一行业(如医疗:科室→设备→排程 / 物流:仓→线路→运单)"两套**租户自定义本体**，都能 init→tick→传导。代码零改、仅本体内容不同。
5. **按租户模块**：lite 租户 `branch` 返 404，旗舰租户 200——证 entitlement 暗发可配。
6. **门**：`pnpm -r build && pnpm -r test && pnpm gates`（真实 10 门）+ 新建 `sim:check`/`propagation:check`（须并入 gates 聚合）+ `debattery:check`（sim/ 零业务常数）+ `cli-parity:check`。

---

## 7. 《本体引用与影响》（回写 SYSTEM-ONTOLOGY.md · 增量 0 先行）

- **对象类型**（§2）：新增 `SimSession` / `SimTickState` / `SimCheckpoint` / `PropagationRule`（4 个新对象；PropagationRule 同时是新 BuildPlan need + provisioner）。
- **链路**（§3）：`本体世界态 --init--> SimSession --propagateTick(系数×延迟)--> SimTickState --checkpoint--> SimCheckpoint --branch--> SimSession'`；`沙盘act(模拟态) --采纳--> ActionDraft(R4)`。
- **事件**（§4）：`sim.session_created` / `sim.tick_completed` / `sim.checkpoint_saved` / `sim.branched`（产出发事件，下游订阅 R10）。
- **不变量**：R2（tenant_id everywhere）· R3（entitlement 暗发分模块）· R4（act 模拟态、采纳才写真值）· R6（传导核纯函数确定性）· R9（三表四处同改）· R14（传导核+表零业务常数，两行业验收）· R15（每 op CLI 对等）· R16（PropagationRule 倒序发育长出）。
- **门禁**（§7）：新增 `sim:check`（会话状态机/迁移 down/确定性）+ `propagation:check`（系数×延迟正确性、改系数即改果），并入 `pnpm gates`。
- **断点**（§8）：闭 G-11 的"传导核+会话层"——沙盘从"有积木无沙盘"到"有状态可分支"。
- **回写**：增量 0 先把上述对象/链路/事件/R17/G-11/门写进本体，`ontology:check` 绿，再写代码（RL1 本体先行）。

---

## 8. 一句话给实现 agent

**传导核是一支不认识任何行业的纯函数（只吃 typeKey/stateVar/linkKey + 数值系数+延迟），会话是三张全 jsonb 的普通表（进现有 pg+memory），系数是可编辑的一等字段、能倒序发育长出，模块按 entitlement 暗发——lite/Pro/旗舰客户开不同 sim.* 开关就得到不同沙盘。** 复用 recompute 链路导航 + risk.ts 衰减 + simclock tick + slice-planner 范围 + actions 走正门 + QOS 指挥台,真正新写的只有"propagateTick 合体算法 + SimSession 状态机"。零新数据库,零行业常数,两行业验收证通用。
