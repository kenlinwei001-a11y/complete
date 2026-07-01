# REVIEW · FIX-2CONCERN 复验闭环（GRAPH-3/4 Object360 死交互 + FRESHNESS 缓存失效）

> 审核方按 ACCEPTANCE-CONTRACT **逐条亲手跑 method + 逐条引证据**，且遵用户令**前后端闭环 + 像素级**（FIX-1 真浏览器实拍·非"应该显示"）。门红不核发；凭证据判真假。
> 复验环境：真 datacore（`apps/datacore/dist/server.js` · SEED_DEMO · 12 真 Base 对象）+ 真 agentcore(4002) + 真 vite 前端（`127.0.0.1:5177` · **非 mock**·指向真后端）。同站(127.0.0.1 跨端口)→ refresh cookie 流通 → 深链保活。

## 判决：✅ DONE（两 concern 均真闭·前后端闭环·FIX-1 像素级实拍）

---

## FIX-1 · Object360 血缘下钻死交互 —— 真浏览器像素级实拍 ✅

**GOAL（用户视角）**：用户打开某基地的对象 360 页 → 点血缘图谱里的邻接节点 → **溯源抽屉真的弹出**（修前：点了没反应=死交互）。

**测试方法（真实场景·Playwright 真 Chromium·真后端数据）**：
1. 真 vite（非 mock）指向真 datacore；登录 `demo/admin/demo1234`（真 JWT，非 mock 账号）。
2. 深链 `/o/Base/obj_base_changzhou`（常州基地·真后端 12 基地之一）。
3. 点血缘节点 → 断言 `[data-testid="dag-node-drawer"]` 出现；Escape 关闭；再点另一节点重开。

**证据（真跑输出 + 截图）**：

| 断言 | 期望 | 实测 | 证据 |
|---|---|---|---|
| 深链保活（同站 cookie·真后端 refresh 成功） | 不跳登录 | `O360 url=…/o/Base/obj_base_changzhou`（未跳 /login） | Playwright step |
| 点节点前无抽屉 | drawer=false | `DRAWER before=false` | optV-pw.mjs |
| **点血缘节点后抽屉渲染**（FIX-1 核心） | drawer=true | `DRAWER … AFTER=true` | `docs/evidence/optV-03-drawer.png` |
| 抽屉内容真实（出处+备注+导航 action） | 非空·含 action | `🔍 IoT/SCADA 实时采集（DataSourceHealth）` / 来源系统=邻接对象（A6 行级过滤后）/ 备注=对象类型 DataSourceHealth / 「打开对象 360 →」按钮 / 「信任 = 出处 + 推导可当场亮出（R13）」 | optV-03 截图 |
| Escape 关闭 | drawer=false | `after-Escape drawer=false` | optV-pw-close.mjs |
| 重开（点另一节点） | drawer=true | `re-open#2 drawer=true` · `drawer2 src=邻接对象（A6 行级过滤后）` | optV-pw-close.mjs |

**前后端闭环·数据前后端可见（后端 curl 得 X → 前端页面显示同 X）**：

| 字段 | 后端(`curl /a/v1/objects/Base/obj_base_changzhou` + `/neighbors`) | 前端(Object360 页实拍) | 一致 |
|---|---|---|---|
| 名称 | `name=常州` | header「常州」 | ✅ |
| objectKey | `id=obj_base_changzhou` | `obj_base_changzhou` | ✅ |
| 域 | Base→factory 域 | 蓝徽章「工厂」 | ✅ |
| 属性 | gwh=36.7 · util=0.83 · formationCapDaily=63265 · agingCapDaily=61698 · bottleneck=模组 · lon=119.95 · lat=31.78 | 属性表逐行同值 | ✅ |
| 邻接组 | 7 组 [base_data_health, base_energy_meter, base_finance, base_has_shipment, base_maint_plan, line_belongs_to_base, model_producible_at] | 关系区 7 组 testid 完全一致 | ✅ |
| 邻接节点数 | 9+1+1+1+1+1+3=17 邻居 + 中心 | 血缘图 `lineageNodes=18` | ✅ |

截图：`docs/evidence/optV-02-object360.png`（全页·属性表+血缘图 18 节点+图例 8 类型+关系区）、`optV-03-drawer.png`（抽屉弹出·像素级）。
代码修：`Object360Page.tsx:148 {drawer && <DagNodeDrawer detail={drawer} onClose={() => setDrawer(null)} />}`（对照 Slices/Meta/Boundary 三页同写法）；回潮测 `wo-graph-3-4-fusion.test.tsx` 补 Object360 点节点断言。

---

## FIX-2 · FRESHNESS invalidateConfidenceCache 缓存失效 —— 5 条契约逐条真跑 ✅

**GOAL**：长跑进程里决策先诚实标 SYNTHETIC；接真实数据（上传→objectify）后**同一决策自动据实翻转为真实**，无需手动清缓存/重启。

| # | 断言 | 类型 | 实测证据 | 判 |
|---|---|---|---|---|
| C1 | 运行中 datacore：合成→SYNTHETIC；经真实写路径接真实 Order（零手动 invalidate）→ 同 solver 翻 `synthetic=false`/`dataMode≠SYNTHETIC` | curl(live) | 新租户 c1freshco2 实跑：① synthetic job `job_5r4nmvphz4q1sp2d` ② **BEFORE** `{synthetic:true,dataMode:"SYNTHETIC"}` ③ 上传 real-orders.csv→objectify `[{dataset:"real-orders",type:"Order",count:2}]` ④ **AFTER** `{synthetic:false,dataMode:"LIVE"}` → **C1 PASS**（诚实位经写路径自动翻转·零手动失效） | ✅ |
| C2 | 单测 `WO-FRESHNESS①b` 通过 + 该 it 块**零手动 invalidate** | unit | `vitest -t 'WO-FRESHNESS①b'` → **1 passed**；lines 538-567 内 `invalidateConfidenceCache` 仅 line 539 **注释**（解释由来），零实调用（真调用在 ②③ 块 line 578·method 允许）；块正文靠真实写路径 upload→objectify→runDerivations 触发翻转（"不接钩子则步③仍 SYNTHETIC 必红"） | ✅ |
| C3 | `src` 下（排除 test）对 `invalidateConfidenceCache` 的**生产调用方**≥1 且在写路径 | gate | `grep -rln … apps/datacore/src \| grep -v /test/` → `ontology.ts`(调用方) + `service.ts`(定义)；`ontology.ts:688 this.solvers?.invalidateConfidenceCache(ctx.tenantId)` 在 runDerivations 成功分支（非注释） | ✅ |
| C4 | `pipeline-freshness:check` exit=0 且门查**失效接线**（非仅 presence） | gate | `pnpm pipeline-freshness:check` → `✓ 通过` **exit=0**；门脚本 `check-pipeline-freshness.mjs:91-92` `if(!/invalidateConfidenceCache\(/.test(ontologySrc)) fail(…)` → 删该调用则正则不中→fail→exit≠0（门有牙·由门自身 fail 分支逻辑证，未在共享分支改 dev 代码做破坏性 tooth-test） | ✅ |
| C5 | `pnpm --filter datacore test` 全绿（向后兼容·未破坏 STALE/MOCK 维与既有 solver） | gate | `pnpm --filter datacore test` → **Test Files 154 passed \| 2 skipped；Tests 830 passed \| 15 skipped；0 failed**（exit 0·Duration 390s）；含 WO-FRESHNESS①①b②③ + capacity/risk/affected 等既有断言全过 → 修复零回归 | ✅ |

---

## 本体引用与影响
- **不变量**：R13（诚实位不失真·FIX-2 闭）· R6（失效确定·写路径收口自动失效）。
- **断点**：闭 2 个"绿测试≠能用"接缝（皆 dev 自验绿、审核方代码评审+真跑才抓出）。
- **回写**：无新链路；FIX-2 闭 → 回写本体 §4 FRESHNESS「缓存失效接线」已由 `ontology.ts:688` 写路径收口 + `pipeline-freshness` 门守护。
- **反偷懒**：C1 用**运行中真服务**跑合成→真实翻转（非仅单测）；FIX-1 用**真浏览器像素级实拍**（非"应该显示"·非只后端 curl），前后端同值比对逐字段一致。

---
*审核方 FIX-2CONCERN 复验闭环（前后端闭环 + FIX-1 像素级实拍 + FIX-2 五条契约逐条真跑）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
