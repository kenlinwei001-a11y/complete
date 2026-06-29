# 评审复验 — WO-4-FIX / WO-6(活体) / WO-7 / WO-8（dev 014169d·33cffd0·3d2ff91）

> **角色**（铁律0.5）：审核方独立真跑（同步+**重建 dist**+SEED_DEMO 真启动+真 JWT 跨服务+真 Kimi），非信单测/「✅」。
> **核发**：**WO-4-FIX ✅ · WO-8 ✅ · WO-6 活体 ✅（审核方补验）· WO-7 ◐**（归因真但①commit 破 tsc 构建 ②8/9 待 LIMS 拍板）。

## WO-4-FIX（014169d）= 闭合 ✅
- **真启动复验**：新构建 `SEED_DEMO=1` → datacore **healthz 200·进程存活·不再 Exit1**（之前 P0 崩已消）。
- **域迁净**：34 类型·469 物化·域集 14 合法（`commercial/supply` **✓已迁 sales/material·0 残留**）。
- **冒烟门**：`ontology-governance.test` 直呼 `synthetic.runJob({viaModelingChain:true})` 断言 SUCCEEDED+≥34 类型+无非法域——真走发布门、能抓原回归（旧测试走 A 路绕开发布门故漏）。dev 与审核方诊断一字不差，根因解（完成半截迁移）非掩盖。

## WO-8（33cffd0）= 闭合 ✅
- view.scenarios 已注册 DataCore FEATURE_REGISTRY（defaultOn:true·66 特性）。
- **真 JWT 跨服务**：`GET /b/v1/scenarios` → **launcherEnabled:true·20 卡**（修前结构性恒 false、SL2 永不可触发）。结构缺陷已解。
- 诚实边界（dev 自承·非本 WO 缺陷·记备查）：X-Debug-User 跨服务 fail-open 到 ALL；`/invalidate` 不清 gate 60s 缓存——既有缺口，另案。

## WO-6 活体（d6ccb28·WO-4 修复后审核方补验）= 闭合 ✅
- WO-4 修好 → demo 起得来 → 配 Kimi（SEED_DEMO+KIMI_API_KEY 种 kimi-k2.6）。
- **真 Kimi 探针**：`POST /api/v1/growth/probe`「常州基地影响哪些订单？」→ **verdict=BOUNDARY（诚实"仍在推演"·blocking 非真）·非 BLOCKED** ✓。原 5s 预算会误判 BLOCKED；现 180×500ms≈90s 预算 + 超预算诚实返 BOUNDARY，判据过。
- 代码+单测（growth-probe 9/9·agentcore 349）此前已核。

## WO-7（3d2ff91）= ◐（归因真 8/9·但有构建破坏 + 待 LIMS 拍板）

**✅ 逐源归因真实（审核方独立 curl·数值与 dev 报告逐位吻合·非伪造）**：
`GET /a/v1/data-health` → ERP 111·MES 96·IoT/SCADA 72·PLM 54·SRM 42·WMS 35·EMS 26·QMS 9·**LIMS 0**（8/9 业务源有真 members·真 typeKey→count）。

**🔴 缺陷①（审核方真跑发现·必修）**：**commit 破坏 `pnpm --filter datacore build`（tsc）→ `pnpm gates` 会红**。
- `datahealth.ts:12 type Source = DataHealthResponse["sources"][number]` + `:76 push({members,objectCount})`，但 **`DataHealthResponse.sources` 契约从未真加 members/objectCount**（契约里 members 命中全是无关的 base-registry）→ `TS2353 excess property`（全量 1 错）。
- dev 称「契约 additive」但**未落契约**；「778 passed」是 vitest（宽松运行时转译），`tsc`/`datacore build` 未跑 → 漏（与 WO-4「不跑真 SEED_DEMO」同类）。runtime 因 noEmitOnError=false 仍 emit、JS 不报，故 demo 能跑、tests 绿——典型「绿测试≠能用（构建红）」。
- **修**：把 `members?:{typeKey,displayName,count}[]` + `objectCount?:number` 真加进 `DataHealthResponse.sources` 契约（packages/contracts），datacore tsc 即绿。**必做**（gates 红不可交付）。

**📏 缺陷②/拍板（8/9 → 9/9·审核方据铁律0 拍板）**：LIMS demo 无任何物化对象类型 → 逐源恒 0。
- **拍板 = A（加 LabTest·走确定性合成正门·上 9/9）**。理由：① LIMS 是已声明的源系统，留它永久空 = 数据模型半截不一致；② 经**确定性合成正门**新增真正属于 LIMS 的对象类型（如电芯实验室检测 `LabTest`，R6/provenance 可溯）**不是伪造**（区别于 dev 正确拒绝的"硬塞既有对象到 LIMS"）；③ 归因基础设施已建好，加类型 + 一行归因即 9/9；④ 铁律0：解根本（补全数据模型）不接受将就。
- dev 此前 8/9 诚实交付（未伪造）正确；现据拍板**补 LabTest 至真 9/9**。
- （用户可否决：若 LIMS 在 demo 边界外、应从源清单移除，则改"8/8"——但既已声明 LIMS，倾向补全。）

## 顺带（dev 报告·审核方备查，未独立复跑）
前端 3 测试（f43.admin-cluster VLE/隔离区 + vle-segment-matrix·15s waitFor 超时）dev 称 clean baseline 同样 3 failed=本分支既存、不碰 data-health/source-overview。**建议另开单核查**（审核方未独立复跑确认其"既存"性）。

## 待 dev（更新）
- **WO-7-FIX（P1·必做）**：补 DataHealthResponse 契约 members/objectCount → 修 tsc 构建红（gates 绿）。
- **WO-7-LIMS（拍板 A）**：合成正门补 LabTest 类型 → 真 9/9。
- WO-Q1(P1) · 1C(P2) · A6-T2(P3) 不变。**已闭**：WO-1/2/3/4(+FIX)/5/6/8 + lastmile + A6尾巴① + 四链路 + 结构化接入臂。
