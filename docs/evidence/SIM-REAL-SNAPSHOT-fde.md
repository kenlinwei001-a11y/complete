# SIM-REAL-SNAPSHOT · FDE 真实测试取证（审计簇D 治本）

WO: `SIM-REAL-SNAPSHOT`（`docs/AUDIT-fake-value-remnants.md §2 簇D`）
病根：推演沙盘 tick0 世界态（baseSnapshot）由 `row[v] = Math.round(hash01(oid|v)*100)` 造——对象 id 取哈希→0-100
冒充「初始真实世界态」，POST 为 `createSimSession.baseSnapshot`；这些伪值再驱动 节点热度红≥70 + 全下游 tick。
整个 what-if 从**伪初态**起跑。热度阈 70 亦散落前端内联。

## 治本
1. baseSnapshot 取**后端真对象当前属性态**（view-config 新增 `nodeObjectState`：obj.props 命中 stateVar 名的**数值**属性）。
   无真值的对象/变量 → 诚实缺省，前端退 **0（静止）**，绝不 hash/合成冒充（KILL-MOCK-RED 红线）。
2. 热度阈 70 → 归口权威 sim 配置 `DEFAULT_SANDBOX_HEAT_THRESHOLD`（datacore `sim/certification.ts`），随 view-config
   下发 `heatThreshold`；前端 SandboxView/SimComparePanel/HeatStrip 消费之，不再内联 70。

## 证据 1 · 真浏览器（Playwright chromium·mock 模式·逐值对照后端）
截图 `docs/evidence/sim-real-snapshot-sandbox.png`。登录 planner/demo → 内存 token → SPA 导航进沙盘。

MSW 捕获的 `POST /a/v1/sim/sessions` 真实请求体 baseSnapshot（= 前端 deriveBaseSnapshot 产物）：
```json
{"obj_a1":{"s1":62,"s2":48},"obj_a2":{"s1":30,"s2":71},"obj_b1":{"s1":15,"s2":0},"TypeC#0":{"s1":0,"s2":0}}
```
逐值对照后端 view-config.nodeObjectState `{obj_a1:{s1:62,s2:48}, obj_a2:{s1:30,s2:71}, obj_b1:{s1:15}}`：
- obj_a1 s1=**62**（**非** hash(`obj_a1|s1`)=77）· s2=48 —— 逐值命中后端真值 ✓
- obj_a2 s1=30 · s2=71 ✓
- obj_b1 s1=15 · **s2=0**（后端无 obj_b1.s2 真值 → 诚实退 0，不造）✓
- TypeC#0（空世界类型）→ 全 0（诚实空态）✓

UI 前端所见逐值对照 baseSnapshot（前端真渲染，非 mock 断言）：
- s1 KPI = **26.8** = (62+30+15+0)/4 ✓
- s2 KPI = **29.8** = (48+71+0+0)/4 ✓
- 全局态 = **28.3** = mean(obj 聚合 55/50.5/7.5/0) ✓
- 节点 Σ：TypeA=**53**(mean 55,50.5) · TypeB=**8**(7.5) · TypeC=**0** ✓

结论：沙盘初始世界态**逐值来自后端真对象属性态，非 hash(oid)**。

## 证据 2 · 真后端 curl（诚实空态·不作假）
`docs/evidence/sim-real-snapshot-backend-viewconfig.json`（datacore 内存模式 SEED_DEMO=1）：
```
GET /a/v1/sim/view-config  (demo 租户)
heatThreshold: 70                       ← 权威 DEFAULT_SANDBOX_HEAT_THRESHOLD 下发 ✓
nodeObjectIds: 493 个真对象 id（Base×12/Model×6/Order×24/…）
stateVars: ["demandLoad","demandPressure","loadIndex","utilPressure"]
nodeObjectState: {}                     ← 空
```
demo 对象**不携带**以这些 sim stateVar 命名的数值属性（stateVar 是纯传导抽象量），故 `nodeObjectState` 诚实为空。
- 旧码：会把这 **493 个真对象 id 全 hash → 0-100 伪初态**（整张伪世界）。
- 新码：后端无真属性态 → 诚实空 → 前端 baseSnapshot 全 0（诚实静止），**零造假**。

两证互补：证据1 证「有真属性态时逐值取真」，证据2 证「无真属性态时诚实空（不 hash 兜底）」。

## 牙齿测试
`apps/frontend-shell/test/sandbox-view.test.tsx`（新增 describe「SIM-REAL-SNAPSHOT」）：
- baseSnapshot 逐值 = nodeObjectState 真值（obj_a1.s1===62）；obj_b1.s2 诚实退 0；空世界退 0。
- 牙齿：断言 obj_a1.s1===62 且 ≠ hash(`obj_a1|s1`)=77 —— **回退 hash 实现即转红**。

## 门禁
`pnpm -r build` + `pnpm --filter frontend-shell test`（394 passed）+ `pnpm gates` 全绿。
