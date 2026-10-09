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

## §3 设计

### 3.1 演习世界的来源（两条路，按序）

```
① 有企业状态快照（enterpriseState.latest 取得到）：
     新建演习会话 E → enterpriseState.fork(c, latest.id, E)   ← 快照灌进 E
② 无快照（实测是常态）：
     新建演习会话 E → 把 s 的【当前态】复制进 E 的 baseSnapshot
     ⛔ 不复制 s 的 perturbations（演习的扰动是本事件解释出来的，不进 E 的扰动账）
```

**⇒ 两条路都产出同一个东西：一个**独立、可读、只被这次演习写**的会话 E。**

### 3.2 写入归属

| 对象 | 这次演习写不写 |
|---|---|
| 种子世界 / 本体（`ENTERPRISE_STATE_REAL_WORLD_ID`） | ❌ **不写**（R4-sim ① 不变） |
| **原会话 `s.id`** | ❌ **不写**（今天也没写；本次改法**保持**这一点） |
| **演习会话 E** | ✅ **写** —— `persist: true` 推进，扰动也落 E |

### 3.3 会话 E 的生命周期

- **创建**：drill 路由内，在解释冲击**之前**建（因为它要当 baseSnapshot 的落点）
- **归属**：`scope` 里标 `{ kind: "drill", ofSessionId: s.id, at: <时间戳> }`
  —— 让"这是谁的演习"可从会话本身读到，而不是只存在于那次 HTTP 回包里
- **可见性**：与普通会话同（`GET /sim/sessions` 列得到）
  ⇒ 用户**能打开它、能看到演习推出来的世界态** —— 这正是本次改法的目的
- **清理**：⛔ **不做自动清理**。理由：自动清理会让"跑完就查不着"，退回到今天的问题。
  若将来要限数量，另立一单（本设计不预设 TTL）
- **失败**：若建 E 失败 ⇒ **整个 drill 失败并如实报**，⛔ 不退化回 `persist:false`
  （退化 = 静默回到今天这个"结论无法核验"的状态）

### 3.4 契约

**⛔ 不改 `worldId` 的语义**（它今天 = 原会话，读它的地方可能有别的假设）。
**新增字段**：

```
drillWorldId: string        // 这次演习实际写入的那个会话
```

- `worldId` 保持 = 原会话（**兼容**）
- **报告里显式一句话**：「本报告基于演习世界 `<drillWorldId>`；原会话 `<worldId>` 与其世界线**未被改动**（R4-sim ①）」
  —— 让「254 格动了 / 原会话没变」从**看似矛盾**变成**一眼可读**

---

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

## §6 ⛔ 未读部分（动手前必须先读，不许照抄本设计的假设）

1. **`enterpriseState.latest` / `fork` 的完整语义** —— 我只读了 `fork` 的**开头 8 行**。
   ⚠ 尤其：`fork` 写 E 时，**E 需要预先存在**（`getSession` 会 404）⇒
   "先建 E 再 fork" 的顺序必须确认可行。
2. **`simAdvanceTicks` 的 `persist` 参数语义** —— 我只看到调用处传 `persist: false`，
   **没读它的实现**。`persist: true` 时它写哪些表、写不写 `sim_tick_state`、会不会碰 `s`，**未验**。
3. **"把 s 的当前态复制进 E 的 baseSnapshot" 有没有现成原语** ——
   我在本设计里写的是一条**我假设可行**的路，**没查过有没有现成的复制/克隆函数**。
   ⇒ 若没有，这条要么自己写，要么退回给 `fork` 加一个"从会话快照 fork"的入口。

**⇒ 这三条任何一条与我写的设计不符 ⇒ 先改设计，再动手。**
