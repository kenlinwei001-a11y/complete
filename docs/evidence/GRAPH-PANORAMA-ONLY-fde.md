# GRAPH-PANORAMA-ONLY · FDE 证据（用户亲定 2026-07-05：七视角全删仅存全景·无豁免）

裁定：保留一个「图谱全景」；删除 graph-backbone / graph-flow / graph-source / graph-solver /
graph-mvp / graph-agent / graph-loop 七视角（「图谱·流」经用户确认一并删除）。

## 删除清单（全仓 sweep·零残留，仅存声明式退役表/tombstone/teeth）

| 层 | 删了什么 | 退役声明（防幽灵） |
|---|---|---|
| datacore features | `FEATURE_REGISTRY` 八个 `view.graph.persp.*` BLOCK 键；`VIEW_FEATURE_MAP` 八行 | `RETIRED_FEATURE_KEYS` + `RETIRED_VIEW_KEYS`（features.ts）；残留 override 解析忽略；新 override → 400 `feature key retired`；退役视图键禁动态注册 |
| datacore workspace | `withRouteFeatureAliases` 的 `view.graph-{p}` 别名环；workspace/preview 的 viewAllowed 过滤 `RETIRED_VIEW_KEYS`（旧 pg 库残留 ViewConfig 不下发） | 同上 |
| datacore synthetic | `PLANVIEW_EXTRA_KEYS` 八键、`VIEW_DEFS` 八份 graphView、`LOOP_NODE_IDS`、`graphView` helper | — |
| agentcore | `FEATURE_REGISTRY` 八键、`VIEW_ALIAS` 八行（补 `graph→view.ontology-graph` 正门别名） | `RETIRED_FEATURE_KEYS` 镜像（registry.ts） |
| frontend nav | ShellLayout「建模与图谱」组八个视角直达项（NAV-GRAPH-MERGE 后仅删项） | — |
| frontend mock | fixtures `GRAPH_VIEWPOINTS` 全块、八个 `view.graph-*` feature 定义 | teeth 断言 registry 零残留 |
| frontend 路由 | 八个 `/v/graph-*` 深链 → `<Navigate to="/v/graph" replace>`（tombstone·302→全景） | `App.tsx RETIRED_GRAPH_VIEW_KEYS` |

**③ graph vs graph-all 同质判定：同质 → 合一。** 二者同 renderer=`ontology-graph`、同全景
domain 着色（graph 无 options 时前端缺省即 `{colorBy:"domain"}`），仅差描述卡与 layoutSeed →
按 WO ③ 合一为唯一入口 `graph`，label「图谱全景」，desc/graphOptions 承接自 graph-all
（desc 改走 `options.desc`，真后端描述卡从此真渲染——原后端把 description 放 layout 前端从不读）。
保留 `graph` 键（消费方众多：geo-map「图谱中查看」深链、驾驶舱模块直达卡、scn-graph 场景入口、
SX-explore targetView），`view.ontology-graph` requires 链不动；`view.graph.persp.all` 随合一退役。

**视角专属组件 grep 断言：无可删组件。** 七视角为纯 ViewConfig 配置（renderer 复用共享
`ontology-graph`）；`OntologyGraphView`/`OntologyGraphEngine` 的 nodeFilter/colorBy=source/
mvpOverlay 能力为共享引擎能力（GraphOptionsSchema 契约 + admin/views 编辑器仍消费），保留。

## 真实测试（铁律 0.4·不作假）

### 真后端（内存模式 SEED_DEMO=1 真起 :4991·curl 逐值）
- `GET /a/v1/me/workspace`（admin）：graph 视图唯一 `{key:"graph", name:"图谱全景",
  renderer:"ontology-graph", options.graphOptions:{colorBy:"domain",layoutSeed:42}, desc:"全域对象与关系全景…"}`；
  `views`/`navigation` 中 `graph-*` 键 **0 条**；features 含 `view.graph`/`view.ontology-graph`，
  `persp`/`view.graph-*` **0 条**。
- `PUT /a/v1/tenants/demo/features {"view.graph.persp.loop":true}` → **400
  `VALIDATION_ERROR: feature key retired: view.graph.persp.loop`**（防幽灵显式拒绝）。
- `GET /a/v1/features/registry`：persp 键 0 条（总 59 键）。

### 真浏览器（VITE_MOCK build + preview :5199 + Playwright chromium·mock 登录 planner）
脚本断言 20/20 全过；截图：
- `GRAPH-PANORAMA-ONLY-nav.png`：左导航「建模与图谱」组仅「图谱全景」一项图谱入口；
  「图谱·主干分级/产能推演网络/数据来源/求解器布局/MVP/智能体网络/学习闭环/图谱·全景/本体图谱/图谱体系」全不在。
- `GRAPH-PANORAMA-ONLY-graph.png`：点「图谱全景」→ `/v/graph` 真渲染（ontology-svg 24 节点、
  图例 `data-colorby=domain`、描述卡「计划+执行一体化运营本体全景…」＝mock 后端 options.desc 逐值）。
- `GRAPH-PANORAMA-ONLY-redirect.png`：`/v/graph-backbone`、`/v/graph-flow`、`/v/graph-loop`、
  `/v/graph-all` 深链（in-app 导航·mock refresh 恒 401 整页 reload 会先落登录页故走 popstate）
  全部 302 落回 `/v/graph` 且全景真渲染。

## 牙齿（重新加回任一视角即红）
- datacore `test/planviews.test.ts`：workspace `graph-*` 零下发＋解析集 `view.graph.persp.*`/
  `view.graph-*` 零残留＋退役 override 400＋全景唯一（label/options 逐值）。
- agentcore `test/qos-f-entitlement.test.ts`：`RETIRED_FEATURE_KEYS`×8 均不在注册表；
  `viewAllowed("graph")` 受 `view.ontology-graph` 门控。
- frontend `test/f25.graph-panorama.test.tsx`：mock registry 八键零残留＋tombstone 表与退役集
  一致＋八深链 302→全景＋导航仅「图谱全景」；`test/f40.nav-groups.test.tsx`：七视角标签任一重现即红。

## 套件/门禁
- `pnpm -r build` 绿；datacore 168 文件 940 测绿、agentcore 92 文件 510 测绿、frontend 全绿
  （f25 视角测试按裁定诚实替换为全景/退役 teeth；f1/f40/workspace-contract 因视图真删同步改断言）、
  contracts/llm-adapters 绿；`pnpm gates` exit 0（含 ontology-slices:check·母体已回写 §2.B/§7）。
