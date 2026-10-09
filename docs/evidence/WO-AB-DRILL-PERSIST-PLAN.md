# drill「演习不落盘」改法（2026-10-09）

## 现状（读码实测）

`app.ts` drill 路由（:4099 起）：

```
① fork：enterpriseState.latest(c, ENTERPRISE_STATE_REAL_WORLD_ID)
        若无 latest ⇒ forkedFromStateId = null（注释：「没有可 fork 的真实快照是常态」）
② 执行：simAdvanceTicks(..., { n: ticks, persist: false, ephemeralPerturbations })   ← 带扰动
③ 对照：simAdvanceTicks(..., { n: ticks, persist: false, ephemeralPerturbations: [] }) ← 零扰动
④ 报告：worldId = s.id（原会话）· forkedFromStateId = null
```

**⇒ 两条推进都 `persist:false` ⇒ 报告是「两条内存世界之差」⇒ 结论算得出，但两条世界都不存在。**

实测后果（本轮）：
- `worldCellsMoved = 254`（内存里真动了）· 而 `GET /sessions/:id/world` 读原会话 ⇒ `priceShock` 仍 = 2
- ⇒ 读报告的人（含我）把「254 格动了 / 原会话没变」读成矛盾

## 判据：限制本身对，执行过头

`R4-sim ①「演习不改世界线」`保护的是**真实世界线**（种子世界 / 本体）。那条**对**。

但实测**连演习自己的痕迹都不留** ⇒ 三件事同时坏：
1. 用户看不到演习推演出的世界态 ⇒ **结论不可核验**
2. `worldId` 指向一个没被改的世界 ⇒ **声明与实际不符**
3. 读会话值不变 ⇒ 看起来「什么都没发生」

## 改法（两件事分开）

| | 该不该写 |
|---|---|
| 真实世界线（种子世界 / 本体） | ❌ 不写（R4-sim ① 对） |
| **演习 fork/新建出来的那个世界** | ✅ **该写** —— 结论从它算出来，用户也得能看见它 |

**具体：**
1. **优先走既有 `enterpriseState.fork(...)`**（本就有）
2. **无 latest 快照时**（实测 `forkedFromStateId=null` 是常态）⇒ **不退化到"什么都不留"**，
   而是**基于 `s` 的当前态新建一个演习会话**，在其上 `persist: true` 推进
3. **原会话 `s.id` 与种子世界逐字节不动**（仍是只读）
4. 报告里 `worldId` 改指**演习会话**，并显式标「本报告基于演习世界 X；原会话未被改动」

## ⚠ 风险 / 未决

- 这一步涉及**会话生命周期**（建会话、复制态），比前面几处改动大
- ⛔ **契约层**：`worldId` 语义变（从"原会话"变"演习会话"）⇒ 读它的地方要一并核
- ⛔ 未验：`enterpriseState.fork` 的签名与"无 latest 时能否自建"——**没读过它的实现**
- ⇒ 故本改**先落方案**，动手前须先读 `enterpriseState.fork` 与 `simAdvanceTicks` 的 `persist` 语义
