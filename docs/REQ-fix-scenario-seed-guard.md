# 需求 · 修复「场景卡可见但意图/计划永不再种」守卫 bug（P0 · 解 PG 真部署点卡 OUT_OF_CATALOG）

> 范围：**单点根因修复**（守卫挂错键）。这是即时解堵；结构性根治见 `docs/PRD-scenario-ontogenesis.md`（场景卡发育闭环）。
> 受众：实现 agent 可直接遵循开发，无需再决策。

---

## 1. 现象（用户实测）

docker/PG 真部署，用 planner 点场景卡 S01「4680-NCM 加 20% 六周能不能接」→ 前端显示 **「（探索模式未能产出回答）」**。

逐层定位（前后端一起跑，证据确凿）：

| 层 | 实测 |
|---|---|
| 任务详情页「分类结果」 | `classification = OUT_OF_CATALOG`（候选意图为空） |
| 路由 | 无候选 → 转 Path B 探索（`AGENT`） |
| 探索 | agent 跑 discover/get_object/invoke_solver/query_objects 后撞 90s 预算 `BUDGET_EXCEEDED` → 无最终答案 → 兜底串 |
| 启动器 | **20 张卡照常显示**（卡可见） |

**矛盾点**：卡看得见，点了却说目录里没有对应意图。

---

## 2. 根因（代码锚点）

`apps/agentcore/src/main.ts:22-29`：

```ts
const seedPkg = seedScenarioPackage();
if (!(await repos.packages.get(seedPkg.id))) {     // ← 守卫挂在「包是否存在」
  await repos.packages.insert(seedPkg);
  const { intents, plans } = seedIntentsAndPlans(); // 20 意图 + 计划
  for (const p of plans) await repos.plans.insert(p);
  for (const i of intents) await repos.intents.insert(i);
}
```

**意图/计划的播种被包在 `if (包不存在)` 里。** 一旦 `pkg_battery_manufacturing` 已存在（早期部署、迁移、或上一次启动建过），该分支永不再进 → **意图/计划永不再种**。

与此同时，**场景卡走的是另一条独立的懒种路**——`apps/agentcore/src/server.ts:1775 ensureScenarios`，挂在 `scenarios.byKey` 各自存在性，每次 `GET /b/v1/scenarios` 调用：

```ts
const ensureScenarios = async (tenantId) => {
  for (const sc of seedScenarios(tenantId)) {
    if (!(await repos.scenarios.byKey(tenantId, sc.scenarioKey))) await repos.scenarios.upsert(sc);
  }
  ...
};
```

→ **卡（`scenarios`）与意图/计划（`intents`/`plans`）的播种解耦**：卡能独立种出来（启动器可见），意图/计划却被上面那个包守卫挡住（空）。

**链路后果**：classify 取 `publishedIntentsForView(packageId, view)` 得空集 → 标 `OUT_OF_CATALOG` → 转 Path B 探索 → agent 预算耗尽 → 「（探索模式未能产出回答）」。

### 旁证：同文件其它所有 seed 都是「按各自 id 幂等」，唯独意图/计划piggyback 包守卫

`main.ts:31-41`（正确范式）：

```ts
for (const wf of workflows) if (!(await repos.workflows.get(wf.id))) await repos.workflows.insert(wf);
for (const sk of skills)    if (!(await repos.skills.get(sk.id)))    await repos.skills.insert(sk);
for (const ag of agents)    if (!(await repos.agents.get(ag.id)))    await repos.agents.insert(ag);
for (const sc of seedScenarios()) if (!(await repos.scenarios.byKey(sc.tenantId, sc.scenarioKey))) await repos.scenarios.upsert(sc);
```

→ workflows/skills/agents/scenarios 都查**自己的** id；只有 intents/plans 挂在**包的** id 上。**这就是 bug。**

---

## 3. 修复规格（精确 · 对齐既有幂等范式）

把意图/计划的播种**移出包守卫**，改为与其它 seed 一致的「按各自 id 幂等」。

**`apps/agentcore/src/main.ts`：**

```ts
// 修复前
const seedPkg = seedScenarioPackage();
if (!(await repos.packages.get(seedPkg.id))) {
  await repos.packages.insert(seedPkg);
  const { intents, plans } = seedIntentsAndPlans();
  for (const p of plans) await repos.plans.insert(p);
  for (const i of intents) await repos.intents.insert(i);
}

// 修复后
const seedPkg = seedScenarioPackage();
if (!(await repos.packages.get(seedPkg.id))) {
  await repos.packages.insert(seedPkg);
}
// 意图/计划：与 workflows/skills/agents/scenarios 一致，按各自 id 幂等，
// 不再挂包存在性 —— 修复「包已存在则意图永不再种」（PG 真部署 OUT_OF_CATALOG 根因）。
const { intents, plans } = seedIntentsAndPlans();
for (const p of plans)   if (!(await repos.plans.get(p.id)))   await repos.plans.insert(p);
for (const i of intents) if (!(await repos.intents.get(i.id))) await repos.intents.insert(i);
```

**依据（仓储方法已核实，`apps/agentcore/src/persistence/repos.ts`）**：
- `repos.plans.get(id): Promise<ExecutionPlan | undefined>`、`repos.plans.insert(p)`
- `repos.intents.get(id): Promise<IntentDefinition | undefined>`、`repos.intents.insert(i)`
- 种子 id 稳定（`int_<key>_v1` / `plan_<key>_v1`，`seed.ts`）→ `get(id)` 幂等可靠。

**自愈**：部署修复后，agentcore **下次重启**即对"包在、意图空"的库补种缺失意图/计划（per-id 守卫命中空缺）。无需手工迁移脚本。

---

## 4. 边界与注意（实现 agent 须核对）

1. **状态须 PUBLISHED**：`seedIntentsAndPlans()` 产出的意图/计划须为 `PUBLISHED`（classify 的 `publishedIntentsForView` 只取 PUBLISHED）。核对种子状态；若为 DRAFT 则 classify 仍空 → 仍 OUT_OF_CATALOG。
2. **多租户**：当前 `seedIntentsAndPlans()` 针对 demo 包/租户。若生产是非 demo 租户，须确认意图/计划在**该租户的包**里也有（与 `ensureScenarios(tenantId)` 的 per-tenant 卡播种对齐）。**本修复不改多租户语义**，仅修「已存在包不再补种」。
3. **版本漂移**：`get(id)` 幂等按 id；若种子内容升级但 id 不变，旧记录不会被覆盖（与既有 `if(!get)` 范式一致，符合"幂等不覆盖"约定）。如需升版，另走 upsert/版本号路径，**不在本需求范围**。
4. **不破坏内存模式**：内存模式每次启动包不存在 → 原逻辑本就种；修复后行为不变（包种、意图按 id 种），R6 不受影响。
5. **不引入新依赖/新事件**：纯顺序与守卫调整。

---

## 5. 验收（FDE 亲手 · 不接受测试绿冒充）

1. **复现修复（核心）**：在「包已存在、意图为空」的 PG 库（或手工删 `intents`/`plans` 行后保留 `packages` 行）启动修复后的 agentcore → `GET /api/v1/catalog/packages/pkg_battery_manufacturing/intents` 返回 **20 条且含 `capacity_feasibility(PUBLISHED)`**。
2. **点卡走 Path A**：planner 点 S01 → 任务详情页「分类结果」显示 `WORKFLOW` + 命中 `capacity_feasibility`（**非** OUT_OF_CATALOG）→ 回答区出真 KPI（P50/P90/缺口），**不再**「（探索模式未能产出回答）」。
3. **幂等**：连续重启两次，`intents`/`plans` 行数不翻倍（per-id 守卫生效）。
4. **回归**：内存模式（`SEED_DEMO`）启动 → 20 意图/计划/卡齐全，既有 66 测试绿。
5. **门绿**：`pnpm -r build && pnpm -r test`、`pnpm gates`。

---

## 6. 本体引用与影响

- **链路**（§3）：`Query --classify--> Intent`（候选取 `publishedIntentsForView`）。本 bug 使候选恒空 → 链路在 classify 接缝断（"断点常在接缝"）。
- **不变量**：触及 **R16 发育闭环**——意图（器官）未随卡（器官）一同长成/补齐，违"绝不静默残缺"。本修复是**对该违反的对症补丁**（让意图至少被可靠播种），**非根治**。
- **断点**（§8）：缓解新登记的 **G-9「场景卡未走发育闭环」** 的一个具体面；根治见 `docs/PRD-scenario-ontogenesis.md`（卡=发育器官：倒序发育长全闭包 + A10 验证即上架门 + 正序确定性绑定 + 缺则生长/开单不静默）。
- **回写**：本修复仅改播种顺序/守卫，不新增链路/事件/对象类型/门禁 → **无需回写本体**；但实施时应在 §8 G-9 备注"已落对症补丁（seed 守卫修复），结构根治待 ontogenesis PRD"。

---

## 7. 与根治 PRD 的关系

| | 本需求（P0 补丁） | `PRD-scenario-ontogenesis.md`（根治） |
|---|---|---|
| 解决 | 意图/计划在 PG 可靠播种 → 不再 OUT_OF_CATALOG | 卡=发育器官：长全闭包 + 亲手验证才上架 + 正序确定绑定 + 缺则生长/开单 |
| 工作量 | 改 ~4 行 | P1–P3 分期 |
| 关系 | 立即解堵；**仍依赖"种子写得全且正确"** | 让"卡可见 vs 闭包长成 vs 能用"由发育闭环强绑，**不再依赖手装种子** |

> 建议：本需求**先合**（立即恢复 PG 部署可用），根治 PRD 的 P1 随后落地后，本补丁的守卫逻辑被发育闭环吸收。
