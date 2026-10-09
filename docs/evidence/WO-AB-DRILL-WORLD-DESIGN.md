# 演习世界 · 完整设计（含会话生命周期）· 2026-10-09

> 接手方直接照此做。**动手前必读 §6 的「未读部分」** —— 那里有三处我**没读过实现**就写下的假设。

---

## §1 问题（实测，非推断）

`app.ts` drill 路由（:4099 起）今天的行为：

```
① fork 尝试：enterpriseState.fork(c, latest.id, s.id)      target = 【当前会话本尊】
   实测 forkedFromStateId = null（无 latest 快照 ⇒ 没 fork）
② 带扰动推进：simAdvanceTicks(..., { persist: false, ephemeralPerturbations })
③ 零扰动对照：simAdvanceTicks(..., { persist: false, ephemeralPerturbations: [] })
④ 报告：worldId = s.id（原会话）· forkedFromStateId = null
```

**实测后果**：
- `worldCellsMoved = 254`（内存里真动了）
- 而 `GET /sim/sessions/<s.id>/world` ⇒ `cell_case.priceShock` **仍 = 2**（原值）
- ⇒ 读报告的人把「254 格动了 / 原会话没变」读成矛盾

---

## §2 根因（不是"限制错了"，是**缺容器**）

`R4-sim ①「演习不改世界线」`保护的是**真实世界线**（种子世界 / 本体）。**那条对。**

矛盾在 `fork` 的实现（`twin/enterprise-state.ts:164`）：

```ts
async fork(ctx, sourceStateId, targetWorldId) {
  if (worldId === "" || worldId === ENTERPRISE_STATE_REAL_WORLD_ID) throw ... // 挡住真实世界 ✓
  const session = await repos.sim.getSession(ctx.tenantId, worldId);
  if (!session) throw notFound(...);        // targetWorldId 必须是【已存在的会话】
}
```

而 drill 传的 target 是 **`s.id`（当前会话本尊）**：

| 诉求 | 今天靠什么 | 结果 |
|---|---|---|
| 别改真实世界线 | `fork` 里的 `REAL_WORLD_ID` 例外 | ✅ 挡住了 |
| **别改当前会话，但要留一份可核验的演习世界** | **没有容器** | ❌ 要么写当前会话，要么什么都不留 |

**⇒ 缺的是一个【属于演习自己的会话】。** 它现在借的是"当前会话"的 id。

---

## §3 设计（v2 · 读完 §6 三处后重写）

### 3.0 v1 被推翻的两条（留档，免得下一个人再走）

| v1 写的 | 读码后 |
|---|---|
| 有快照 ⇒ `fork` 把快照灌进 E | ❌ `fork` 只产 `EnterpriseState` **行**，**不写世界态**（`twin/enterprise-state.ts:172-181`） |
| 在 E 上 `persist:true` 推进 | ❌ **撞守卫**：`app.ts:2490` 「`ephemeralPerturbations` 只允许在 `persist:false` 的推进里使用」 |

**⇒ 而那条守卫的理由**正指着正解**：「落盘会造成**查不出来源**的世界线污染」——
演习今天用的 `ephemeralPerturbations`，定义就是「不落盘的临时冲击」，**来源查不到**。

### 3.1 正解：演习 = **普通会话上的普通操作**

```
E ← POST /a/v1/sim/sessions            （一个【普通会话】，不是特殊实体）
   ← POST …/E/perturbations            （扰动【正常入库】⇒ 来源查得到）
   ← POST …/E/tick { n: ticks }        （【正常推演】⇒ persist:true 落盘）
   ← GET  …/E/world                    （世界态【可见】⇒ 结论可核验）
```

**⇒ 与用户手动在页面上操作**完全一样** —— 不新增任何机制。**

**⇒原会话 `s.id` 与种子世界全程不被写**（因为操作对象是 E）。`R4-sim ①` 仍然成立。

### 3.2 E 的初态从哪来（⚠ 本版的关键未决）

演习的语义是「**在**当前世界**的基础上试：如果发生这件事会怎样」⇒ E 该以 `s` 的当前态为起点。

| 路 | 说明 | 状态 |
|---|---|---|
| **a** | E 用**全新会话**（初态 = 种子默认） | 简单，但**与 `s` 的当前态不同** ⇒ 若 `s` 已被推过 N 拍，演习起点就错了 |
| **b** | E 复制 `s` 的**当前态**当起点 | ✅ 语义对 —— **但需要"复制态"的原语，我没查过有没有** |

**⇒ b 是正解方向；a 只在「`s` 就是种子态」时才等价。**
**⇒ 若仓里没有现成原语，两条出路：**
- 用 `simAdvanceTicks` 的 `fromState` 把 `s` 当前态喂进 E 的第一推 —— ⚠ **但 `fromState` 被 :2499 守卫限在 `persist:false`**，又是一道墙
- 或给 `POST /sessions` 加一个「按 baseSnapshot 建」的入口

### 3.3 生命周期

- **创建**：drill 路由内先建 E（在加扰动之前）
- **归属**：`scope` 标 `{ kind: "drill", ofSessionId: s.id, at }` ⇒ 可从会话本身读到"这是谁的演习"
- **可见**：普通会话，`GET /sim/sessions` 列得到 ⇒ **用户能打开它、看到演习推出来的世界态**
- **清理**：⛔ **不做自动清理**（自动清理 = 跑完就查不着 = 退回今天的问题）
- **失败**：建 E 失败 ⇒ **整个 drill 失败并如实报**，⛔ 不退化回 `persist:false`

### 3.4 契约

**不改 `worldId` 语义**（今天 = 原会话，读它的地方可能有别的假设）。**新增**：

```
drillWorldId: string      // 这次演习实际推演的那个会话
```

报告里**显式一句话**：「本报告基于演习世界 `<drillWorldId>`；原会话 `<worldId>` 与其世界线**未被改动**（R4-sim ①）」
—— 让「254 格动了 / 原会话没变」从**看似矛盾**变成**一眼可读**。

## §4 判据（可机检，交付级）

1. **演习世界可读**：跑一次 drill ⇒ `GET /sim/sessions/<drillWorldId>/world` ⇒
   `cell_case.priceShock` **已变**（≠ 原值 2），且变化量 = `appliedStateEffects[0].rawMagnitude`
2. **原会话逐字节不动**：drill 前后读 `GET /sim/sessions/<s.id>/world` ⇒ **完全一致**
3. **种子世界逐字节不动**：`GET /sim/sessions/<REAL_WORLD_ID>/world` ⇒ 不变
4. **幅度生效**：同事件 `pctChange` 3 / 30 / 300 ⇒
   **三份演习世界的差异格上，值之比 ≈ 1 : 10 : 100**
   （⛔ 这是本轮我漏掉的那条：只看 `worldCellsMoved` 数量不变就以为"没生效"——
     数量由拓扑定，**值**才是判据。写测试时别再犯）
5. **结论随幅度变**：三份报告的 `findings`（含 `severity`）**三者互不相同**

---

## §5 与既有改动的关系

- **本会话已改的**：`svRange` 实测为 0 时回落域全距（`app.ts` 那处）—— **保留**，
  它解决的是"归位后全距 0 ⇒ 打不上"；本设计解决的是"打上了但看不见"。**两件不冲突。**
- **本轮修好的 ②**：`MATERIAL_REPRICE` 的键名是 `pctChange`（我传错成 `priceDeltaPct`）—— 已确认。

---

## §6 未读 / 未决（动手前必须先处理）

| # | 状态 | 内容 |
|---|---|---|
| ① | ✅ **已读** | `fork` 只产 `EnterpriseState` 行、不写世界态 ⇒ v1 那条已废弃 |
| ② | ✅ **已读** | `persist:true` 禁带 `ephemeralPerturbations`（`app.ts:2490/2495/2499` 三条守卫）⇒ v1 那条已废弃 |
| ③ | ⛔ **仍未查** | **「把 `s` 的当前态复制进 E」有没有现成原语** —— 这是 §3.2 路 b 的前提，**必须先查** |
| ④ | ⛔ **新增未决** | 若③无原语，且 `fromState` 又被 :2499 挡住 ⇒ **第三条出路是给 `POST /sessions` 加"按 baseSnapshot 建"入口** —— 那是**契约变更**，走之前要定 |

**⇒ ③④ 任何一条没定清 ⇒ 不要动手。**
