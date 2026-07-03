# VIS-SIGNALS FDE 证据（G-VIS-1 · P1/P2 状态·空态·导航透出批）

7 项「后端 curl 得真值·前端整块无处可见/藏别处/导航走」逐项接后端已有真端点出 UI（诚实空态·非造假·**零新后端能力**）。真实测试不作假（铁律 0.4）：先 curl 真后端证真值，再真浏览器双跑逐值对后端。

## 信号 → 后端真端点 → 前端落点

| # | 信号 | 后端真端点（真值） | 前端落点 |
|---|------|------------------|----------|
| S1 | 场景启动器未开通空态 | `GET /b/v1/scenarios` → `launcherEnabled` | `ScenarioLauncherPage`：`launcherEnabled===false` 专用引导空态（区分未开通 vs 空目录） |
| S2 | 兜底统计诚实空态 | `GET /b/v1/ops/fallback-stats` → fresh 租户 `items:[]` | `OpsFallbackPage`：空表 → 诚实空态引导 |
| S3 | 顶栏通知铃 + 未读角标 | `GET /a/v1/notifications` → `unread` | `ShellLayout` `NotificationBell`：常驻顶栏铃 + 未读角标 → 点进通知中心；unread=0 诚实静止 |
| S4 | 推演历史导航归组 | （前端归组·`adminRegistry` query-history 已存在） | `ShellLayout` NAV_GROUPS「编排与场景」补 `query-history`（此前缺登记落「其它」组） |
| S5 | 写回落地对账面板 | `GET /a/v1/writeback-echoes?actionId=`（OC5·admin） | `ActionsPage` `WritebackReconcilePanel`：显 ref/writtenValue/writtenAt 待对账回声；非 EXECUTED/非 admin 诚实空态 |
| S6 | 图谱检查器已物化 N 实例徽章 | `GET /a/v1/ontology/object-types/stats` → `count` | `OntologyGraphView` Inspector：按 `node.key` 关联物化数 + 去对象浏览器深链；0 实例标「未物化」 |
| S7 | 分类面板每类型已物化 N 徽章 | 同 `object-types/stats.count` | `DataCategoriesPanel`：卡头合计 + 逐类型徽章；未建模/无实例诚实标 |

## C1 · 真后端 curl 证真值（datacore:4001 + agentcore:4002·内存 SEED_DEMO=1）

```
[S6/S7] object-types/stats count: Base=12(mat:true) Model=6(mat:true) Order=24(mat:true) Line=12 Process=60 Equipment=72 ...
[S7]    data-categories types: sales_orders[Order] demand_forecast[...] customer_ar[Customer,ARInvoice] product_master[Model,Segment] capacity_base[Base,Line,CapexProject]
[S3]    notifications unread: 0 items: 0          (fresh 租户诚实静止)
[S5]    POST /a/v1/writeback-echoes → 200 ; GET ?actionId=act-probe → items:[{ref:"Model:M-4830.safetyStock", writtenValue:1800, writtenAt:..., actionId:"act-probe"}]
[S1]    /b/v1/scenarios launcherEnabled: true total: 20
[S2]    /b/v1/ops/fallback-stats: {items:[]}      (fresh 租户 → 诚实空态)
```

## C2 · 真浏览器 MOCK 模式（VITE_MOCK vite + Playwright chromium·登录 planner/demo·in-app nav 保内存 token）— 10/10 PASS

```
PASS S3 通知铃存在 ; S3 未读角标=1
PASS S4 query-history 在编排与场景组 ; S4 query-history 未落其它组
PASS S1 场景卡渲染 6 张(launcherEnabled 真值路径)
PASS S5 写回对账面板存在 ; S5 对账表: ... Model:M-4830.safetyStock 1800 2026-06-06T08:00 待源回流对账
PASS S7 分类物化合计徽章: 已物化 20 ; S7 类型物化徽章: dc-mat-Order=已物化 20
PASS S6 图谱检查器物化计数: 已物化 3 实例
=== 10/10 PASS ===
```

截图：`VIS-SIGNALS-s1-launcher.png` / `-s3-notif-bell.png` / `-s4-nav-group.png` / `-s5-writeback-reconcile.png` / `-s6-graph-inspector.png` / `-s7-data-categories.png`

## C3 · 真浏览器 真后端模式（VITE_DATACORE_URL/AGENTCORE_URL 指向真服务·登录 admin/demo1234·**逐值对后端**）— 4/4 PASS

```
PASS REAL 登录成功(admin/demo1234)
PASS S2 兜底诚实空态显示: 暂无兜底聚类——尚无未命中意图的查询，或已全部孵化为意图...
PASS S6 REAL 图谱物化计数: 已物化 12 实例        (== 后端 Base count=12·逐值对上)
PASS S7 REAL 分类物化合计: 已物化 24             (== 后端 Order count=24·逐值对上)
=== 4/4 PASS ===
```

截图：`VIS-SIGNALS-s2-fallback-empty.png` / `-s6-graph-real.png` / `-s7-data-categories-real.png`

## 牙齿 / 回归

- `fetchWritebackEchoes` 契约复用 `WritebackEcho`（`@platform/contracts`·不重定义·contracts-only-shared）；MSW `*/a/v1/writeback-echoes` 同形 handler（admin 门·actionId/ref 过滤）。
- MOCK fixtures 新增 `act-003`（EXECUTED·writebackTarget MOCK）+ `WRITEBACK_ECHOES`（ref/writtenValue=1800）供对账面板逐值对照。
- 四包全绿：`pnpm -r build` 通过；`pnpm --filter frontend-shell test` 402/402 通过；`pnpm gates` exit 0。

## 边界（诚实·非硬塞）

- S3 unread / S2 fallback 在 fresh demo 租户为空 → 诚实静止/诚实空态（非造数字）；MOCK 模式用代表值（unread=1·act-003 echo）证 UI 渲染路径，真后端模式证空态 + 逐值对账。
- S1 未开通空态（`launcherEnabled===false`）为条件分支：真后端 demo 场景功能开启（launcherEnabled=true·20 卡）→ 分支逻辑就位，未开通态随功能关闭触发（Entitlement §6）。
