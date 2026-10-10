# WO-ONTO-DESIGN-VERIFY · 本体建模台设计稿 14 条批注真后端实测

> **base commit**：`bb43e65f`（= canonical `f6ed5b07` + 本单搬进来的设计稿一份，**产品源码零改动**）
> **canonical**：取证开始时 `f6ed5b07`，收尾时已漂到 `64647803`
> ⚠ **漂移已核，不影响本报告**：`git diff --stat f6ed5b07..64647803` = **2 个文件，全在 `docs/` 下**
> （兄弟单 WO-SIMTAI-DESIGN-VERIFY 的页面二产出），`apps/` 与 `packages/` **0 行改动**
> ⇒ 我量的那棵树与今天 canonical 的**产品源码逐字节相同**。
> **取证时刻**：2026-09-10 04:30–04:52 UTC
> **树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **7043**
> （对照 CLAUDE.md 记载：06-15 旧树 1249 · LOOP10 树 5357 ⇒ 本树比两者都新）

## 取证环境（真后端 + 真浏览器，全程禁 `VITE_MOCK`）

| 件 | 端口 | 自证 |
|---|---|---|
| datacore | 4531 | socket 属主 pid **9019**；`/proc/9019/cwd` = 本 worktree；`BLOB_DIR=/tmp/blobs-woonto`（本会话独有标识） |
| agentcore | 4532 | `DATACORE_BASE_URL=http://127.0.0.1:4531` |
| vite | 5531 | pid 2051，`VITE_DATACORE_URL` + `VITE_DEV_DATACORE` 双设 |
| 浏览器 | Chromium 1194（playwright） | **从 `/login` 走起**填 `demo/admin/demo1234`，登录请求实打到 `http://127.0.0.1:4531/a/v1/auth/login` |

⚠ **端口不是靠 `ss`/`netstat` 判的**（本机两者都没有）：真去 bind + `lsof` 取属主 pid。
实测 **4002 与 5173 被别的 agent 占着**（4002→pid 864、5173→pid 1158）——
正是 CLAUDE.md 警告的「读了别人的旧服务再对自己代码下结论」那个坑，故全部改用 45xx/55xx 高位口。

## 全局金丝雀（否定结论的前提）

| 金丝雀 | 结果 | 它证明了什么 |
|---|---|---|
| `GET /a/v1/ontology/domains` | **200** | 认证与路由基线正常 |
| `GET /a/v1/__no_such_route_zzz__` | **404** `route not found` | 不存在的路径长这样 |
| `DELETE /a/v1/ontology/domains`（路径在、方法不在） | **404** `route not found` | ⚠ **404 无法区分「路由不存在」与「方法不支持」**——本报告凡涉 404 均按此口径读 |
| `git ls-files -- 'apps/*/test/*.test.ts'` | **579** | pathspec 写法正确（`**` 写法恒 0，已避开） |
| `grep -c '<button' OntologyRelationsPage.tsx` | **22** | 按钮计数器有鉴别力（故 BoundaryPage 的 0 是真 0） |

## ⚠ 自污染披露

本次探针向租户 `demo`（内存模式，随进程消亡）写入：新增对象类型 4 个（`WoOntoProbe`/`WoUnitProbe_x`/`WoCrefProbe`/`WoCrefProbe2` 未建成）、
新增结构边 1 条（`wo_probe_link`）、新增域 1 个（`wo_probe_domain`）、
改 1 条因果边（`demo_base_load_to_inbound_shipment` 的 `coefficient` 与 `coefficientRef`）、
给 `Line` 挂了 1 条 `constraintRefs`。**凡涉计数处均取污染前基线**（因果边 47 = 建探针边前的读数，探针边已 DELETE 复原）。

---

## 14 条批注逐条实测

| # | 断言原文（截取） | 实测结果 | 判定 | 证据 |
|---|---|---|---|---|
| **1** | 「七个面收敛成一条动线。实测 **0/7** 达可用标准，运营在上面完成不了本职工作」 | 真浏览器登录后侧栏共 **60 项**，本体建模相关 **11 个面**。逐页量 `<main>` 内控件：本体建模 btn=1/103行 · 域管理 btn=1（含「新建域」）· 本体关系 **btn=568 / input=412 / 20 表 / 184 行** · 本体切片 btn=22 · 边界册治理 **btn=0**。**5 个面里 4 个有真写控件** | **量法坏了 → 改判：部分不可测** | 「可用标准（运营能否完成本职）」是动线判断，非控件数可裁；但**「0/7」这个笼统说法被控件面实测反证**。walk2.mjs 逐页数字互不相同 ⇒ 计数器有鉴别力 |
| **2** | 「写端已存在（`POST object-types` = upsert，改得了 `unit`/`displayName`）⇒ **接线不是造门**」 | 第 1 次 POST `WoOntoProbe` → **201** `version:1`；第 2 次同 key 改 `unit` kg→吨、`displayName` 甲→乙 → **201 同一个 `id=otype_7mmffc4bakm1h16y`，`version:2`**，两项都改成了 | **仍成立** | `POST /a/v1/ontology/object-types` ×2；回包 `id` 相同、`version` 递增 ⇒ 确是 upsert 非新建 |
| **3** | 「单位可选可扩。今天 **9 项写死 TS 常量**，`t`/`kW`/`h` 全 400」 | 词表实为 **62 项**（`apps/datacore/src/domain.ts:245-337` `PROPERTY_UNITS`，闭合联合 + `units.ts` 量纲登记表 `satisfies` 绑死）。REST 实测：`t`→**400** · `kW`→**400** · `h`→**201** · `吨`/`kWh`/`秒`→201 | **部分已闭** | 「9 项」→ **62 项**；`h` 已受理（1/3 闭）；`t`/`kW` 仍 400。⚠ **但仍是编译期写死的 TS 常量**，无任何运行时/REST 扩词路径 ⇒ 设计意图「可扩」未达成。负向金丝雀 `ZZZ_NOT_A_UNIT`→400 证明校验器真在拒 |
| **4** | 「`Line.utilization` 百分点 vs `Process.utilization` 比率，已付 100× 与 10⁴ 两次费」 | `Line.utilization` **unit=`%`** scale=ratio；`Process.utilization` **unit=`dimensionless`** scale=ratio。两者**不同族**——`units.ts:192` 原注就写着「`%` 与 `dimensionless` **不并族** —— 那正是 100× 那个 bug 的藏身处」 | **仍成立** | 扫 100 个类型 878 条属性，`utilization` 命中 2 条，单位不一致。冲突**仍在数据里**，且量纲机器已认得这一族差异 |
| **5** | 「建域 = 一步、**不可逆**、无提示地锁死发布；**下线类型返回 200 但无事发生**」 | ① 类型下线：`POST types/:key/deprecate`→**200**，写 `deprecation:{status:DEPRECATED, graceUntil:+90d}`，**但顶层 `status` 仍是 `ACTIVE`**，类型仍在列表里（102 个类型顶层 status 全 ACTIVE）；`reactivate`→**200 可逆**。② 域：`DELETE`/`PATCH /a/v1/ontology/domains/:key` **均 404**（无路由）；`POST` 同 key 可改 displayName | **部分已闭 + 断言需改写** | 「无事发生」不准：**事发生了，只是写在你不会去读的那一格**——`status` 与 `deprecation.status` **两个字段互相打架**（ACTIVE vs DEPRECATED），谁读哪一格谁得到相反答案。类型下线**已可逆**（闭）；**域仍不可删不可改**（仍成立） |
| **6** | 「波及面已实装（四桶＋逐跳＋未解析位），埋在「边界册治理」名下，而那页 **0 个按钮**」 | `GET /a/v1/boundary/impact?node=Order` → **200**，回 `registry/members/consumers[{surface,file,binding,derivesVia}]/downstream` 富数据。真浏览器进 `/admin/boundary`：`<main>` 内 **button=0 · input=0 · table=0 · tbody=0**，屏上原文「册为 `@platform/contracts` 单一来源，**改值=改代码**」 | **仍成立** | 能力在、页面零控件。金丝雀：同次遍历其余 4 页 btn=1/1/568/22 ⇒ 计数器有鉴别力，0 是真 0。⚠ **附带发现**：设计意图「波及面前置」其实**已在别处落地**——`OntologyRelationsPage` 停用因果边时先 `askImpact(r0,"disable")` 弹波及面再落 |
| **7** | 「动线主脊换成 对象→关系→…→发布，**不再按 API 表面排**」 | 今天 11 个建模面：本体图谱 / 本体建模 / 对象-类型浏览 / 域管理 / 对象接口 / 本体关系 / 本体切片 / 切片库 / 实体合并 / 边界册治理 / 原型 intake ——**基本一页一个 API 资源**，无「01 域 → 02 对象 → … → 11 发布」这类步骤脊 | **仍成立** | `adminRegistry.ts:114` 的 `modeling` 组 10 条 path + 真浏览器侧栏 60 项实测。属**导航信息架构**，改法是重排非新建 |
| **8** | 「就绪度表 = 验收表…**`constraintRefs` 被 zod 静默 strip 且返 201** · 求解器亦不读规则库 · **两半都缺**」 | ① 写端：带 `constraintRefs` POST → **400**，报文精确指出缺 `propKey`/`kind`（枚举 `must_not_exceed`\|`must_not_fall_below`\|`requires_capacity`\|`must_be_before`）；按正确形状再 POST → **201 且回读到 `constraintRefs:[{ruleKey:"C04",propKey:"cap",kind:"must_not_exceed"}]`**；引用不存在的规则 → **400**「未知规则 'ZZZ_NO_SUCH_RULE'（只能引用已发布规则；当前已发布 30 条）」。② 引擎端：**对照实验**给 `Line` 挂 `constraintRefs→C04`，同一求解器同一实参前后对比 | **已闭合（两半都闭）** | **对照实验（铁律 1.5）**：`capacity_forecast(4680-NCM)` 干预前 `evaluatedRules` = C01,C02,C03,C09；干预后 = C01,C02,C03,C09,**+C04** ⇒ 规则集**随本体配置而变**，引擎真读。金丝雀：提取器在干预前就返回 4 条（>0）⇒ 有鉴别力。⚠ **诚实保留**：C04 结论是 `NOT_APPLICABLE` ——**接线已通（规则进了评估集），但「这条约束真能卡住结果」未由本实验证明**（第四态：接对了跑通了，算得对不对另说） |
| **9** | 「`capacity_forecast(EX-220)` → **400 has no certified lines** · 42 条因果边成 **3 个互不相通分量**，无一条决策同时碰交付与钱 · `tickDays` 粒度 **1 天**，表达不了 2 小时停机」 | **9a** `POST /a/v1/solvers/capacity_forecast/invoke {modelId:"EX-220"}` → **400 `model EX-220 has no certified lines`**（逐字命中）。**9b** 47 条因果边跑无向连通分量 = **1 个分量 / 45 节点**，且该分量**同时含钱与交付**（`Material.priceShock`,`Model.costPressure`,`Order.costPressure` ∥ `Shipment.inboundExpeditePressure`,`Material.shortageRisk`,`CustomerLocation.deliveryHoldRisk`）。**9c** `tickDays: z.number().int().min(1).optional()` | **9a 仍成立 · 9b 已闭合 · 9c 仍成立** | 9a 金丝雀：同求解器换本租户真实型号 `4680-NCM` → **200** ⇒ 求解器没坏，400 是该型号特有（⚠ `EX-220` 是工程机械型号，本租户种的是电池行业，6 个型号全是 `xxxx-NCM/LFP`）。9b 分量算法**双向金丝雀**：故意造 2 段不相连→报 2、3 段→报 3、接起来→报 1 ⇒ 有鉴别力，「1 个分量」是真结果。9c `packages/contracts/src/sim.ts:814` ——**亚日粒度是契约层 `.int().min(1)` 结构性禁止**，不是数据没填 |
| **10** | 「结构边与因果边是**两套机制**（`LinkType` upsert/有 version/**115 条** ｜ `PropagationRule` 追加/**无 version**/**42 条**/**改删 404**）」 | `LinkType`：POST 同 key → 201 同 id `version:1→2`（upsert ✅ 有 version ✅），**127 条**（`sim/view-config.linkTypes`）。`PropagationRule`：POST 同 key → **200 `version:2`（upsert，非追加）**、**有 `version` 字段**、**47 条**、`PATCH`→200 / `DELETE`→204（**非 404**） | **已闭合（差异基本消失）** | 设计稿列的 4 项对比里，`PropagationRule` 侧 **3 项全反转**：追加→upsert · 无 version→有 version · 改删 404→改 200 删 204。条数 115→**127** / 42→**47**。两者今天都有生命周期，只是词汇不同（LinkType 走 deprecate/retire/reactivate；PropagationRule 走 status DRAFT/PUBLISHED/RETIRED） |
| **11** | 「因果边表**行内 0 控件**，`PUT/PATCH/DELETE` **全 404**，同 key 连写两次得系数 0.5 与 9.9 **两条并存**且 `combine:"sum"` **双算**。停用必须**可逆**——结构边今天的停用/下线**点了回不来**」 | ① 后端：`PATCH /:id {coefficient:0.77}`→**200 version 2**；`PUT /:id`→**400**（缺必填字段，路由在）；`DELETE`（PUBLISHED 态）→**409** 且报文写「请先 PATCH `{"status":"DRAFT"}` 停用（**可逆**、读数变化当场可见），确认无碍后再删」；改 DRAFT→**200**，再改回 PUBLISHED→**200**（**可逆**），DRAFT 后 DELETE→**204**。② 同 key 双写：0.5 then 9.9 → **1 条**，`coefficient=9.9`,`version=2`（**不并存、不双算**）。③ 前端真浏览器：`/admin/ontology-relations` 因果边表 **`orel-rule-toggle-*` 47 个 · `orel-rule-delete-*` 47 个**（= 每条边一套行内控件），另有行内系数/描述编辑与保存/放弃按钮 | **已闭合（三项全闭）** | 三项断言逐条反转。屏上原文自陈「结构边 128 · 状态变量 41 · **生效因果边 47** ·（生效 = 已启用；停用的边在册但不进推演）」。结构边可逆性亦部分闭：`deprecate`→`reactivate` 回 **ACTIVE**（可逆）；但 `retire` 后 `reactivate` → **409**，报文说明是**有意的单向门**并给了补救路径（同 key 重建即覆盖），非静默「点了回不来」 |
| **12** | 「已有 `coefficientRef` 引用机制，注释写着禁内联，而**实测 42 条边里 0 条在用，全部内联回落** —— 机制在、没人走，**属接线不属造门**」 | 47 条种子边逐条查 `coefficientRef`：**0 条非空**（`weightRef` 同为 0）。**双向金丝雀**：用真实已发布规则 `C35.pressureDecayPerTick` PATCH 一条边 → **200**，计数器随即 **0 → 1**（命中 `demo_base_load_to_inbound_expedite`，且其内联 `coefficient` 仍在） | **仍成立（数由 42→47）** | 计数器已证有鉴别力 ⇒ 基线那个 0 是**真 0** 不是量法坏。⚠ **机制比设计稿写的还强**：写端有**引用完整性校验**——引用未发布规则报 400「系数来源规则 X 不存在或未发布 —— **解析不到会静默回落内联系数，等于改规则不生效**」；引用无数值参数的规则报 400「规则 C03 里没有数值参数 limit（现有参数：无）」。**接线不造门，成立** |
| **13** | 「切片按域分层：域 → L1 完整切片 → L2 子集，另设跨域切片…**无交集的域对必须显式标红**」（含屏上「`parent/level/subsetOf` 零字段」「`maxHops` 调小→子集 **实测不成立**」） | ① 域字段：`GET /a/v1/slices/library` 每条带 **`scope`(intra\|cross) · `domain` · `spannedDomains` · `paths`** ⇒ **已有**；实测 **intra 7 条 + cross 63 条 = 70**（设计稿写 7+54=61）。② 层级字段：107 份 spec 原文里 `"parent"`=0 · `"subsetOf"`=0 · `"parentSliceKey"`=0；`"level"` 命中 3 次但**全是 `project` 里的业务属性名**（`PlanTarget.level` / `BOMDetail.level`），**与切片层级无关** ⇒ **L2 层级字段确实零**。③ `slices/plan` 契约 = `{rootType, targets[], maxHops 1-12, question?}` —— **无任何域限定参数**（传 `domain`/`scope` 被 zod 静默丢弃，不报错）。④ **maxHops 对照实验**（Order→Equipment）：maxHops 6→4 跳路径 · 4→同 · **3→`ok:false NO_PATH unreachable:["Equipment"]`** · 2/1→同 | **混合：域维已闭 · L2 维仍成立** | 金丝雀 `"paths"` 在 107 份 spec 里命中 **107** ⇒ 搜的是同一批文本，那三个 0 是真 0。④ 的结论比设计稿更锋利：**`maxHops` 确实生效（是真闸不是摆设），但调小得到的是「没有切片」不是「更小的切片」** ⇒「调小→子集」**仍不成立**，机制已precise |
| **14** | 「⚠ 本节数字为设计目标，非实测。今天实测：**99 条切片里仅 4 条真多跳（3–31 跳）**，其余 **95 条**是 `hops=0 / paths:[]` 零跳存根」 | 逐条拉 107 份 SliceSpec **从规格量跳数**（与 args 无关）：**零跳存根 97 · 单跳 1 · 真多跳（maxHops≥2）9**，totalHops 区间 **0–31**。多跳逐条：`enterprise_360`(11路径/max5/共31) · `order_to_cash_720`(23) · `equipment_impact_360`(18) · `order_to_material_bom`(16) · `domain_d04_product`(12) · `order_fulfillment_360`(12) · `domain_d05_material`(11) · `domain_d06_capacity`(10) · `domain_d03_sales`(7)。**97 条存根 100% 是 `coverage_*` 前缀（每个对象类型一条的自动占位），非 coverage 的手写切片 0 条是存根** | **仍成立（数由 99/4/95 → 107/10/97），但性质需改写** | ⚠⚠ **这一条的量法本身是陷阱，我先踩了再爬出来**：用 `POST /slices/:key/resolve` 空 args 量，`enterprise_360` 返回 **nodes:0 edges:0**——与真存根**屏上完全一样**；带真实 `args.so=SO-3391` 再跑，同一条切片返回 **nodes:570 / edges:596 / 17 种 linkKey**。**形态**：「我用『不带 args 解析出 0 条』当作『这条切片是零跳存根』的证据，而前者度量的是我没给根对象」。故本行改用**规格侧**量。**独立复核**：真浏览器 `/admin/slices` 屏上自陈「**107 条已注册切片 · 多跳业务切片 10 条 · 单类型覆盖切片 97 条**」——与我 API 侧 97/(9+1) **逐数吻合** |

---

## 复验命令（逐条可重跑）

```bash
# 环境（端口按需换，务必真 bind + lsof 自证属主 pid）
pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build   # ⚠ 两个包都要，只 build contracts 会假红
pnpm --filter datacore build && pnpm --filter agentcore build
PORT=4531 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-woonto SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
TOK=$(curl -s -XPOST localhost:4531/a/v1/auth/login -H 'Content-Type: application/json' \
      -d '{"tenantId":"demo","username":"admin","password":"demo1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 批注2 upsert            → 两次 POST 同 key，看 id 相同 / version 递增
# 批注3 单位              → 逐个单位串 POST object-types，看 400/201
grep -c '"' <<<"$(sed -n '245,337p' apps/datacore/src/domain.ts)"          # PROPERTY_UNITS 词条
# 批注4 口径              → GET /a/v1/ontology/object-types 里搜 utilization 的 unit
# 批注8 对照实验          → 给 Line 挂 constraintRefs→C04，比 capacity_forecast 的 evaluatedRules
# 批注9b 连通分量         → GET /a/v1/sim/propagation-rules，按 typeKey.stateVar 并查集
# 批注11 写端             → PATCH/PUT/DELETE /a/v1/sim/propagation-rules/:id
# 批注12 coefficientRef   → 全表数非空数；再 PATCH 一条 C35.pressureDecayPerTick 看计数 0→1
# 批注13 maxHops 对照     → POST /a/v1/slices/plan Order→Equipment，maxHops 6/4/3/2/1
# 批注14 跳数             → 逐条 GET /a/v1/ontology/slices/:key，量 spec.paths（⛔ 不要用空 args 的 resolve）
```

---

## 结论 · 下一张实现单是「接线」还是「造门」

**14 条里：已闭合 3 条（不进下一张单）· 接线 6 条 · 造门 4 条 · 属 UX 裁决非工程 1 条。**

### ✅ 已闭合 3 条 —— ⛔ 别再派，派了就是 CLAUDE.md 铁律 0.6 第 5 条那个「台账说没做」的老病

| # | 闭在哪 |
|---|---|
| **8** | `constraintRefs` 写端从「静默 strip 返 201」→「400 校验 + 落库 + 引用完整性」；引擎端对照实验证明 C04 真进评估集 |
| **10** | `PropagationRule` 三项反转（追加→upsert · 无 version→有 version · 改删 404→200/204），与 `LinkType` 的「两套机制」差异基本消失 |
| **11** | 行内 0 控件→**47 toggle + 47 删除**；`PUT/PATCH/DELETE` 全 404→200/400/409/204；同 key 双写并存双算→upsert 恒 1 行 |

（另 **9b** 单独闭合：42 边 3 个互不相通分量 → **47 边 1 个连通分量**，且钱与交付同分量。）

### 🔌 接线 6 条 —— 机制已在，缺的是接上/填数/上屏

| # | 机制在哪（已实测存在） | 缺的那一步 |
|---|---|---|
| **2** | `POST object-types` 已是 upsert，`unit`/`displayName` 改得动 | 屏上补新建/改类型入口 |
| **4** | `units.ts` 量纲族机器已认得 `%` ≠ `dimensionless` | 把这台机器接到建模期做口径守卫 |
| **6** | `GET /a/v1/boundary/impact` 富数据 + `OntologyRelationsPage` 已有 `askImpact` 前置弹窗 | 把波及面搬到会用到它的那几个面（边界册页今天 0 控件） |
| **7** | 导航是 `adminRegistry.ts` 里的数据 | 按「对象→关系→…→发布」重排，非新建 |
| **12** | `coefficientRef` 写端 + 引用完整性校验齐备 | 47 条边**一条都没在用** ⇒ 补数据/改种子 |
| **14** | 97 条存根全是 `coverage_*` 自动占位；手写切片 0 条是存根 | 要么给 coverage 填实，要么承认它本就是占位（**建议先裁决这一条是不是缺陷**） |

### 🚪 造门 4 条 —— 今天没有承载物，必须新建

| # | 为什么是造门 |
|---|---|
| **3** | 单位是**编译期闭合联合**（`domain.ts` `PROPERTY_UNITS` 62 项 + `units.ts` `satisfies` 绑死量纲），无运行时/REST 扩词路径。要「用户可扩」= 新建运行时词典 + 存储 + 量纲登记。（⚠ 若只想补 `t`/`kW` 两个词条，那是**接线**，两行的事——**这两件事别混成一张单**） |
| **5** | 域**没有** `DELETE`/`PATCH` 路由（均 404）⇒ 建了删不掉。（本条另含一个**接线**子项：`status` 与 `deprecation.status` 两格打架，修一处读法即可） |
| **9c** | `tickDays: z.number().int().min(1)` —— 亚日粒度是**契约层结构性禁止**，要表达「2 小时停机」得改时间模型 |
| **13** | 切片 `parent`/`level`/`subsetOf` **三个字段全零**；`slices/plan` 无域限定参数。L2 层级 = 新建字段 + 新建规划器分支 |

### ⚖️ 属 UX 裁决非工程 1 条

**批注 1**「七个面 0/7 达可用标准」——「运营能否完成本职工作」是动线判断，控件数裁不了。
但实测**反证了「0/7」这个笼统说法**：5 个面里 4 个有真写控件（本体关系一页就 568 个按钮 / 184 行表格）。
建议下一张单**先把这条拆成具体动线题**（哪个角色、哪串动作、卡在第几步），否则无法验收。

---

## 给下一张实现单的三条硬提醒（都是本次踩出来的）

1. **⛔ 量切片跳数不许用 `POST /slices/:key/resolve` 空 args。**
   `enterprise_360` 空 args 返 `nodes:0/edges:0`，带 `args.so=SO-3391` 返 `nodes:570/edges:596` ——
   **真切片与真存根在空 args 下屏上一模一样**。量跳数一律走 `GET /a/v1/ontology/slices/:key` 的 `spec.paths`。
2. **⛔ 本应用 404 不区分「路由不存在」与「方法不支持」**（金丝雀：`DELETE /a/v1/ontology/domains` 也是 404 `route not found`）。
   凡要报「这个写端不存在」，必须另找证据（读路由注册表），不能只凭 404。
3. **⚠ 只 build `@platform/contracts` 不够**：本仓还有 `@platform/llm-adapters`，不 build 会让 datacore
   报 `error TS2307: Cannot find module '@platform/llm-adapters'` —— 与本单无关的**假红**，极易误判成契约包坏了。
