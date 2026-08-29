# LOOP9 · 实施者 / FDE 视角 — 「本体系统能不能被人建起来、维护下去」

> **环境**：真后端内存模式 `SEED_DEMO=1`（datacore :4401 / agentcore :4402）+ 真前端 Vite dev（:5273）+ 真 Chromium（`/opt/pw-browsers/chromium`）。
> ⛔ 全程 **无 `VITE_MOCK`、无冒烟数据、无桩**。登录 `demo / admin / demo1234`。
> 端口非标准 4001/4002/5173：本机另有 agent 在跑 datacore，标准端口上的进程被别人的 `pkill` 扫掉过 **2 次**（本会话实测），故换私有端口 + supervisor 自拉起。
> 截图 43 张在 `docs/assets/loop9-fde/`。
>
> **我扮演的角色**：假装明天要把这套系统交付给**第二个客户** —— 一家做**工程机械**的制造企业
> （挖掘机 / 经销商 / 属具），产品结构、基地、客户群、供应链与电池厂全不一样。
> 下面是我在屏上真走的「给新客户建一套本体」的头三天。

---

## 一、核心立场（2 句话）

**这套系统的本体是「能改的」，但不是「能建的」—— 屏上给了改边、改切片、改规则、甚至灌数据的入口，
唯独没有给「建对象类型」的入口，而对象类型正是换一个客户时 100% 要重写的那一层。**
**更要命的是：本体治理页上那个唯一的治理按钮「发起发布会签」，在出厂租户上点一次就会把整个页面永久打成白屏 ——
本体建设的头三天里，最先坏掉的不是我建的东西，是那扇门本身。**

---

## 二、最强证据（亲手测出来的数，不是转述）

### 证据 0 · 在**出厂租户**上点一次「发起发布会签」，本体关系页当场变白屏（双向对照实验）

这是本轮最硬的一条，而且**不需要任何自定义建模就能复现** —— 重启 datacore 拿到干净种子后，
不建类型、不改任何东西，只做一件事：在 `/admin/ontology-relations` 点一次页面自己提供的「发起发布会签」。

| X | 条件 | `/admin/ontology-relations` 实测 |
|---|---|---|
| X′ | `GET /a/v1/ontology/publish-requests` → `[]` | **正常**：`main` 文本长度 **23,973**，底部「暂无发布会签请求」在位 |
| X | 点一次「发起发布会签」后重新加载 | **整页崩**：`main` 文本长度 **65**，屏上只剩「⚠ 页面出错了 / **Cannot read properties of undefined (reading 'join')** / 刷新」 |

`pageerror` 原文：`TypeError: Cannot read properties of undefined (reading 'join')`，
React 错误边界指名 `<OntologyRelationsPage>` @ `OntologyRelationsPage.tsx:50`。

**根因追到行**（`apps/frontend-shell/src/pages/admin/OntologyRelationsPage.tsx:869`）：
```tsx
<td className="mono">{p.touchedDomains.join(" · ") || "—"}</td>
```
而后端返回的会签请求记录**根本没有 `touchedDomains` 这个字段**。实测字段清单：
```
id, tenantId, ontologyVersion, requestedBy, status, signoffs, createdAt
'touchedDomains' in record  →  false
```
⇒ 只要租户里存在 **≥1 条** 会签请求，这张表就必崩，而这张表和结构边、因果边、不变式体检、
类型停用/下线**在同一个页面组件里** ⇒ **整个本体治理面一起消失。**

**而且回不去。** `DELETE /a/v1/ontology/publish-requests` → **404 route not found**
（金丝雀：同法 `GET /a/v1/ontology/domains` → 200 有数据 ⇒ 探针没坏）。
内存模式靠重启才恢复；**pg 模式下这条记录是永久的。**

**同一段代码里还埋着第二把锁**（`:875` / `:883`）：
```tsx
disabled={signoff.isPending || p.status !== "PENDING"}
```
后端返回的 `status` 是 **`"PENDING_SIGNOFF"`**（实测两条请求都是）。
⇒ 就算那一行渲染得出来，「同意 / 驳回」两个按钮也**永远是禁用态**。
**屏上没有任何人能对任何会签投票。**

> 这正是本仓 CLAUDE.md 铁律 0.6 第 4 条那个形态的实例：契约字段值以**字符串字面量**
> 形态写在比较里（`"PENDING"` vs `"PENDING_SIGNOFF"`），**类型系统一个都看不见**，
> 四包 typecheck / build 全绿。

### 证据 A · 屏上建一个域 = 永久锁死本体发布（一步，不可逆，无提示）

在 `/admin/domains` 屏上建域 `dealer`（表单只有 **domainKey + 显示名** 两个字段，实测 `domain-create` → `POST /a/v1/ontology/domains` **201**）。
随后在 `/admin/ontology-relations` 点「发起发布会签」：

```
POST /a/v1/ontology/publish-requests -> 201
  ontologyVersion: 2, status: PENDING_SIGNOFF
  signoffs: [... {"domainKey":"dealer","ownerUserId":null,"decision":null} ...]
```

屏上白纸黑字写着发布规则：**「经各域 owner 会签后由后端自动固化（全域 APPROVE → publishVersion）」**。
`ownerUserId: null` ⇒ **没有任何人能对 `dealer` 投 APPROVE** ⇒ 全域 APPROVE 永不成立 ⇒ `publishVersion` 永不触发。

**对照实验（这是判据，不是感觉）**

| X | 做法 | Y（新发起一次会签后的阻塞域） |
|---|---|---|
| X | 域从**屏上**建（表单无 owner 字段） | 阻塞域 = **`dealer`** |
| X′ | 同一个域从 **API** 建并带 `ownerUserId` | 该域**从阻塞名单里消失** |

实测原文：先修 `material`（`POST /a/v1/ontology/domains {"domainKey":"material","ownerUserId":"usr_demo_admin"}` → 201），
再发一次会签 → `preq_demo_1787997457584_16`，**无 owner 的域：`dealer`**（只剩我从屏上建的那一个）。

**顺带挖出一个出厂缺陷（已在重启后的干净种子上复核，与我做过的任何事无关）**：

```
GET /a/v1/ontology/domains          → 15 个域，有 material 吗: false，无 owner 的只有 unassigned
GET /a/v1/ontology/publish-requests → 会签名单 15 个域，无 owner 的是: material
```
对象类型 `MaterialBalance` 的 `domain` 写的是 `"material"`，而 `material` **从来没在域注册表里**
（`/admin/domains` 屏上 15 个域没有它，注册表里叫 `supply`）。会签名单是按类型上的 `domain` 值拼的，
于是名单里凭空多出一个**屏幕上看不见、也没有 owner 的幽灵域**。
⇒ **出厂租户在任何人动手之前就已经发不出 v2 了** —— 屏上「已发布版本：**v1**」。

> 这条同时解释了另一个现象：`/admin/ontology-relations` 上的「建边 / 停用 / 下线」写的是**工作集**，
> 而工作集要靠会签才能变成已发布真值。会签既然永远过不去，**这一整页的治理动作就都落不了地**。

---

### 证据 B · 量纲：字典是 9 项写死的 TS 常量，出厂本体自己就违反它

**对照实验（修前 / 修后两个数）**

| 我发的 | 结果 |
|---|---|
| `{"propKey":"operatingWeight","unit":"t"}` | **HTTP 400** `未知单位 't'（单位字典：万套/GWh/%/吨/天/元/万元/件/秒）` |
| `{"propKey":"operatingWeight","unit":"吨"}` | **HTTP 201** 创建成功（`otype_t887yyqxs5r349ap`） |
| 我一并发的 `"dimension":"mass"` | **静默丢弃** —— 201 响应体里只有 `unit`，没有 `dimension` |

字典出处 `apps/datacore/src/ontology-governance.ts:55`：
```ts
/** 治理增量 §1 单位字典（场景包级；电池模板内置）。 */
export const UNIT_DICTIONARY = ["万套", "GWh", "%", "吨", "天", "元", "万元", "件", "秒"];
```
注释自称「场景包级」，实际是**模块级常量、不带 tenant 参数、无任何 API 可增删**。
工程机械要的 `kW / kg / t / 台 / m³ / MPa / L/h / 小时 / km` **一个都进不来**，且是 400 不是警告。

**更难看的一层 —— 出厂本体自己就过不了这道门。** 实测 `GET /a/v1/ontology/object-types`：

- **99 个类型 / 863 条属性，带 `unit` 的只有 27 条 = 3.1%**（96.9% 的属性没有任何单位声明）
- 这 27 条里 **9 条的单位不在字典内**：
  `Process.requiredThroughput=电芯/天` · `Equipment.mtbf=h` · `Equipment.mttr=h` ·
  `Cadence.intervalCount=个` · `DemandSegment.demandWanPerYearP50/P90=万套/年` ·
  `AdoptedMitigation.eff=点` · `SopVersionRow.demand/supply=万套/年`

**对照实验**：把种子里**已经在册**的 `Equipment.mtbf` 的 `unit:"h"` 原样从 REST 发回去：
```
POST /a/v1/ontology/object-types {"propKey":"mtbf","unit":"h"} → 400 未知单位 'h'
```
⇒ **种子走仓储直写绕过了 REST 校验，新客户走支持路径反而被拦。你没法用官方 API 复刻出厂的那套本体。**

**「单位」在系统里其实有三个互不相干的地方**（这才是铁律 1.5 那条「碳酸锂与铝箔各涨 15% 得同一个 9.75」的上游成因）：
1. `UNIT_DICTIONARY` —— 9 项 TS 常量，只守 REST 建类型这一条路
2. `property.unit` —— schema 级，863 条属性里只有 27 条有
3. `props.unit` —— **数据行上的一个自由字符串**。实测 `obj_material_al_foil.props.unit = "kg"`，
   `obj_material_cell_case.props.unit = "个"` —— 两个值**都不在字典里**

`Material.unitPrice` 自己**没有 unit**。铝箔按 kg 计价、碳酸锂按吨计价，这件事在 schema 里**无处可写**。
`dimension` 又被丢弃 ⇒ 系统永远无法知道「元/吨」和「元/kg」是同一量纲不同标度。
**不是传导公式漏了用量项那么简单 —— 是 schema 里压根没有能承载量纲的字段，任何下游都无从归一。**

---

### 证据 C · 「下线一个类型」是空动作，而屏上承诺了两件它没做的事

屏上原文（`/admin/ontology-relations` 弃用流程区）：
> 「停用/下线一个类型会**连带作废它两端的全部关系**」
> 「下线前后端会先查引用；**有引用则 409 并逐条列出**，界面原样显示。」

我在屏上对 `WIPLot`（在制批次，**260 个实例**、2 条因果边、2 条结构边）点「下线类型」：

```
POST /a/v1/ontology/types/WIPLot/retire -> 200 {"key":"WIPLot","status":"RETIRED"}
```

**没有 409。没有引用清单。** 然后：

| 指标 | 下线前 | 下线后 |
|---|---|---|
| 结构边 | 116 | **116**（`work_order_yields_wip_lot` / `wip_lot_found_defect` 一条没作废）|
| 生效因果边 | 44 | **44**（2 条 WIPLot 边仍 `PUBLISHED`、仍进推演）|
| 不变式体检 | 成立 6 / 不成立 2 | **成立 6 / 不成立 2**（一条守卫都没响）|
| `GET object-types` 里 WIPLot 的 `status` | ACTIVE | **ACTIVE** |
| 对象/类型浏览器 | 在制批次 WIPLot · 260 | **在制批次 WIPLot · 260** |

**刷新页面后，屏上那张「已下线」的表整块消失**（它是「本次会话写回包」，纯客户端）。
记录里留下的是两个互相矛盾的状态字段：
```json
{"key":"WIPLot","status":"ACTIVE","deprecation":{"status":"RETIRED","retiredAt":"2026-08-29T09:42:40.810Z"}}
```
凡是按 `status === "ACTIVE"` 过滤的消费方（如 `ontology-governance.ts:1067`）**照旧把它当活的**。

**根因追到了（不是猜的）**：`retire()` 确实调了 `references()` 并在 `total > 0` 时抛 409 —— 
问题是 `references()` **只数派生（derivation）**。实测逐个探：

| key | `GET /a/v1/ontology/references` |
|---|---|
| `type Order` | **total 1** — `{"refKind":"derivation","key":"order_value","where":"targetType"}` ← **金丝雀：端点是活的** |
| `type Base`（13 条结构边 / 4 条因果边 / 13 实例） | total **0** |
| `type Material` / `Line` / `WIPLot` | total **0** |
| `link line_has_process` / `work_order_yields_wip_lot` / `equip_used_in` | 全部 total **0** |

⇒ 我于是对 `Base`（整个工厂本体的根）点下线：
```
POST /a/v1/ontology/types/Base/retire -> 200 {"key":"Base","status":"RETIRED"}
```
**零告警。** 「有引用就不许下线」这道闸，在 link / 因果边 / 对象实例三类引用上**是全瞎的**。

---

### 证据 D · 「配置迁移」导出的 bundle 里**没有本体**

`/admin/config-migration` 屏上原话：「导出本租户配置 bundle → 另一环境导入」。点「导出本租户配置」：

```
GET /a/v1/config-bundles/export -> 200 (516 字节)
{"platformSchemaVersion":"1.0","sourceTenantId":"demo","exportedAt":"...",
 "featureOverrides":{"qos.dril-routing":true, ... 共 14 个布尔开关}}
```
屏上摘要：`schema 1.0 · 源租户 demo · **14 项功能开通**`。

**整个 bundle 只有 14 个 feature flag。** 101 个对象类型、116 条结构边、45 条因果边、
100 条切片、29 条规则、17 个域 —— **一条都不在里面。**
名字叫「配置迁移」的那扇门，迁的是功能开关，不是配置。

---

### 证据 E · 第二个客户的第一天：唯一能跑的行业是写死在 TS 里的那个

`/admin/synthetic` 合成数据向导有两个行业入口：一个 `<select>`（**只有一个选项** `battery-manufacturing`），
一个「行业（自由输入，**优先生效**）」文本框。

**对照实验**

| 行业（自由输入） | 结果 |
|---|---|
| 留空（回落内置 `battery-manufacturing`） | **HTTP 202** → 6 段全 DONE，屏上出行数表（Base 13 / Order 500 / Process 650 / Equipment 780 …）|
| `construction-machinery` | **HTTP 500** `Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set...`（AWS SDK 原文直接冒到接口层）· **屏上一个字都没变**，还停在第 1 步 |

出处 `apps/datacore/src/synthetic/builtin-templates.ts`：
```ts
export const BUILTIN_INDUSTRY_TEMPLATES: IndustryTemplate[] = [BATTERY_TEMPLATE];
```
一个元素的数组。`battery.ts` **5,357 行** + `battery-extended.ts` **1,141 行**。
非内置行业要走 LLM，而没配 provider 时的表现是：**按钮点了没反应，日志里是一句泄漏的 SDK 报错。**

---

### 证据 F · 「改值 = 改代码」—— 这句话是系统自己说的

`/admin/boundary` 边界册治理，**整页零个按钮**，页面顶部原文：

> 「册为 `@platform/contracts` 单一来源，**改值=改代码经 boundary-singlesource 门**」

册里正是换客户必改的三样：
`BASE_REGISTRY · 13 条`（13 个电池基地）· `SEG_REGISTRY · 3 条`（应用细分）· `PLAN_GOAL_TARGETS · 6 条`。
页面自己列出派生消费端：`synthetic/battery.ts` · `frontend-shell/src/mocks/fixtures.ts` ·
`mocks/simSolvers.ts` · `solvers/risk.ts` · `views/plan/OrderChainView.tsx` · `views/sim/PlanGenerateView.tsx`。

实测引用面：`base-registry.ts` 545 行，**66 个非测试源文件**引用这三个册（含测试 91 个）。
（金丝雀：同一命令查 `UNIT_DICTIONARY` 命中 4 个文件 ⇒ 工具没坏。）

---

## 三、五件事逐条：想做什么 → 屏上给了什么 → 卡在哪 → 只能怎么绕

### 3.0 金丝雀（报任何否定结论之前的自证）

| # | 金丝雀 | 结果 |
|---|---|---|
| C1 | 屏上建一条**因果边** | ✅ 顶部计数 生效因果边 **42 → 43**，新行 `fde_canary_line_to_wo … 0.42 · 启用` |
| C2 | 屏上建一条**结构边** | ✅ 抓到真请求 `POST /a/v1/ontology/link-types` → **201** `ltype_pavjnw83t42k95jx` |
| C3 | curl 打一个已知存在的写口 | ✅ `POST /a/v1/ontology/object-types`（合法单位）→ **201** |
| C4 | `references` 端点能不能返回非 0 | ✅ `type Order` → **total 1** |
| C5 | 合成数据按钮能不能成功一次 | ✅ 内置行业 → **202**，6 段 DONE |
| C6 | grep 工具自证 | ✅ `UNIT_DICTIONARY` 命中 4 文件（非 0）|

⇒ 屏能点、写口能通、探针方法对。下面所有「做不到」都不是环境问题。

### 3.1 从零建一个对象类型（`Excavator` / `Dealer`）——【屏上唯一真正缺的一环】

| 路由 | 屏上叫什么 | 有没有「新建对象类型」 |
|---|---|---|
| `/admin/object-types` | 对象/类型浏览 | **没有**。全屏 3 个控件：域筛选 / 搜索框 / 「仅有物化」勾选 + 每行「看实例 →」。**纯只读** |
| `/admin/modeling` | 本体建模工作台 | **没有**。整页**只有 1 个按钮**「AI 建议草案」，旁边一个 `<select aria-label="选择草案">` 且 **options 数 = 0** |
| `/admin/domains` | 域管理 | 只能建**域** |
| `/admin/interfaces` | 对象接口 | 只能建**接口** |
| `/admin/prototype-intake` | 原型 intake | 只能把表**映射进既有类型**（页面自己写「**不新建类型**」）|
| `/admin/slices` `/admin/slice-library` `/admin/boundary` `/admin/merge` `/admin/connections` `/admin/data-builder` | — | 均无 |

**「AI 建议草案」是个死按钮。** `disabled=false`、能点、**点了不发任何请求**：
挂网络监听后点击，`/a/v1|/b/v1|/api/v1` 上的请求数为 **0**（不是 4xx，是根本没发）。
再追一层（铁律 0.5 三分法）：`GET /a/v1/modeling/drafts` → `200 []`；`POST /a/v1/modeling/drafts` → **404 route not found**。
⇒ 判定 **「前后端都没接线」**，不是「接了线没数据」。这是新客户建本体的**主入口**，在空租户上原地不动。

**只能怎么绕**：curl 打 `POST /a/v1/ontology/object-types`（后端有，屏上没有入口）。实测建成
`Excavator` / `Dealer` / `Attachment` 三个类型。建完在 **对象/类型浏览器**、**本体图谱 `/v/graph`**（显示为「挖掘机」）、
**本体关系的类型下拉**里都看得见；`/admin/slices` 的 root 下拉里也有。

### 3.2 建一条链路接到已有对象 ——【屏上能做，且下游认】

屏上 `建结构边`：`Excavator --excavator_built_at_base(N:1)--> Base` → `POST /ontology/link-types` **201**，结构边 **115 → 116**。
屏上 `建因果边`：`Excavator.orderPressure --excavator_built_at_base--> Base.loadIndex` 系数 0.55 →
`POST /sim/propagation-rules` **201**，生效因果边 **43 → 44**，状态变量 **40 → 41**。

**下游确实认它**：
- 推演沙盘顶部读数从「传导边 43 条」变成「**传导边 44 条（其中启用 44 条）**」
- **切片库自动派生出 `biz.x.excavator_to_base`（跨域 factory / product · 2 跳）** —— 我没做任何事它自己出现了
- `/admin/slices` 的「规划路径（求最短路）」用我这条边找出了
  `Excavator -[excavator_built_at_base:out]-> Base`

**但是 —— 因果边只能新建。** 屏上自己写着「**⚠ 因果边今天只能新建**」：行里没有编辑框、没有删除、没有启停按钮
（DOM 实测该 `<tr>` 只有 5 个 `<td>`，零个 `<button>`）。系数打错了就**永久留在推演里**。

**顺带撞出一条**：我建的那条金丝雀边和既有 `demo_line_util_to_wo_release` 完全重复
（同源量、同关系、同目标量），守卫**事后**点名了：
> 「同一对量之间不得有重复的因果边 … 实测 **1条** … **不成立** … 违反的是：`fde_canary_line_to_wo`」

但屏上同时写着「**不成立只标注、不拦任何动作**」—— 它**没拦住创建**，而我又**删不掉**。

### 3.3 改一个已有对象类型的属性名 / 量纲 ——【能改，零告警，屏上当场退化】

拉现网 `Material` 定义（19 条属性），把 `unitPrice` 改名 `unitPriceCny`，原路 upsert 回去 → **200，零告警、零影响面分析**。

**对照实验（屏上肉眼可见的修前 / 修后）** —— `/admin/object-types` → Material → 看实例：

| | 屏上第一行 |
|---|---|
| 改前 | `al_foil  物料名称=铝箔 · **单价**=32.48 · 到货周期=14` |
| 改后 | `al_foil  物料名称=铝箔 · **unitPrice**=32.48 · 到货周期=14` |

中文显示名 `单价` 退化成了**英文原始键**，而且是**旧的那个键** `unitPrice`。机制查实：
```
GET /a/v1/objects?type=Material  →  props: {"matId":"al_foil","name":"铝箔","unitPrice":32.48, ...}
```
**对象数据没有迁移**，仍是 `unitPrice`；类型定义已经是 `unitPriceCny`。
渲染时按对象存的键去定义里查 displayName，**查不到就退回打原始键**。
值还在、页面不报错、四包不会红 —— **只是那一列的业务含义在屏上无声消失了**。
没有任何告警端点报这件事（`/a/v1/ontology/health` → 404，不存在）。
后来跑了一次全量合成重建，**这个错位依然在**（`unitPriceCny` 存活、数据仍是 `unitPrice`）。

### 3.4 删掉一批不适用的东西 ——【见证据 C：能点，200，但什么都没发生】

补一条：`Attachment`（我自己建的、真的零引用）也是 200。所以 200 **不区分**「真的没引用」和「查引用查瞎了」。

### 3.5 把配置带走 ——【见证据 D：bundle 里没有本体】

除 `config-migration` 外，本轮扫过的其余出口都不是本体出口：推演沙盘的「⬇ 导出」是推演结果；
`/a/v1/ontology/publish-requests` 是会签流水。**出厂本体的真正来源是 TS 源码**：
`synthetic/battery.ts` **5,357 行**（98 个类型的属性/派生/源绑定都在这里，如 `:2672` 那行的 `Base`）
+ `battery-extended.ts` 1,141 行 + `seed.ts` 1,562 行 + `sim/seed-world.ts` 783 行。

---

## 四、清单外的 6 条落地障碍（题目要求 ≥3；这些都不在给我的五件事清单上）

### 障碍 1 · 状态变量是自由文本，打错字 = 静默造一个死变量，且删不掉

`建因果边` 表单里「来源状态变量 / 去向状态变量」是**纯文本输入框**，无下拉、无校验。
我故意把 `utilPressure` 打成 `utilPresure`、`queuePressure` 打成 `queuePresure`：

```
POST /sim/propagation-rules -> 201
  sourceStateVar: "utilPresure", targetStateVar: "queuePresure", coefficient: 0.9
```

| | 修前 | 修后 |
|---|---|---|
| 状态变量 | 41 | **43**（一次手滑凭空造出 2 个没有任何对象承载的变量）|
| 生效因果边 | 44 | **45**，且该边 **启用**（进推演）|
| 不变式体检 | 成立 6 / 不成立 2 | **成立 6 / 不成立 2**（7 道守卫**没有一道**检查状态变量是否真实存在）|

而「因果边今天只能新建」⇒ **这条永不触发的边永久留在 45 条里**。
新客户建 45 条边，按人工录入的错字率，最后没人知道哪几条是活的。

### 障碍 2 · 「无候选」和「类型名打错了」在屏上一模一样

`/admin/merge` 实体合并的类型是**自由文本框**（默认值 `Base`），点「扫描候选」：

| typeKey | 响应 | 屏上 |
|---|---|---|
| `Customer`（真类型） | `200 {"candidates":[]}` | 无待合并候选 |
| `ZZZNotARealType`（不存在） | `200 {"candidates":[]}` | 无待合并候选 |

**两者字节级相同。** 这正是 CLAUDE.md 铁律 0.6 那个形态，只是这次出现在**用户屏上**：
> 「我用『屏上说无候选』当作『这个类型没有重复实体』的证据，而前者并不度量后者 —— 类型名打错时它也这么说。」

### 障碍 3 · 每加一个对象类型，就默认地把「就绪认证」拉得更远一格

推演沙盘顶部黄条：`NO_SLICE · GLOBAL — 图查询覆盖 N/M 对象`。

| 时刻 | 横幅 |
|---|---|
| 出厂（**我在重启后的干净种子上亲手复核**，且与 `docs/LOOP2-ux-mainline.md:192` 独立记录的一致） | `图查询覆盖 95/**98** 对象，切片 99 < minQueries 1` |
| 我加了 `Excavator` 之后 | `95/**99**` |
| 我又加了 `Dealer` + `Attachment` 之后 | `95/**101**` |
| 我给 `Excavator` 注册了一条切片之后（见「改口一」） | `**96**/101` |

**分母跟着类型数走，分子默认不动。** 分子 95 的出处我找到了 ——
`/admin/slices` 上那行「99 条已注册切片 · 多跳业务切片 4 条 · **单类型覆盖切片 95 条**」。
出厂给 98 个类型里的 95 个各配了一条覆盖切片；**新建的类型不会自动获得一条**。
⇒ 建模越认真，就绪认证越红。而红的时候屏上说的是「**现在推演出的结论仅供参考**」。

> ⚠️ **这里我自己的第一个推论被实测推翻了，照实记**：我原本要写「分子在屏上抬不上去」。
> **错的。** 见下面「我改口的两条」。

### 障碍 4 · 新建的域没有颜色，而图谱是按域着色的

`/admin/domains` 的 15 个出厂域每个都有颜色；我建的 `dealer` 那一行颜色列是「**—**」。
建域表单只有 domainKey + 显示名两个字段。而域的定位是屏上自己写的：
「域是一等治理单元 —— 对象类型归域、**按域分组图谱**、域 owner 会签发布」。
新客户的域在 `/v/graph` 图例里没有自己的颜色。

### 障碍 5 · 数据接入控制台的 17 个分类是写死的，新类型在那扇门后不存在

`/admin/connections` 是「数据分类（17）」组织的，每类描述都是电池口径
（如「客户下达的**电池**销售订单（型号/数量/交期/状态）」）。
用同样的方法在该页搜 `Excavator|挖掘机|Dealer|经销商` → **一处都没有**
（金丝雀：同法搜「数据分类」→ 立刻命中，工具没坏）。

出处 `apps/datacore/src/synthetic/data-categories.ts`（117 行），每类硬编码 `typeKeys` 数组，
注释自己写着：「设计原则 ① **覆盖全部出厂对象类型** … ③ 行业可扩展（**其它行业另给 manifest**）」。
「另给 manifest」= **再写一个 TS 文件**，没有运行时注册。
⇒ 新类型 ⇒ 不在任何分类的 `typeKeys` 里 ⇒ 数据接入控制台里不存在 ⇒ **没有上传模版、没有系统对接口**。

### 障碍 6（附赠）· 对账候选队列会重复累积

`/admin/prototype-intake` 解析后「对账候选队列（待人确认 **3** / 共 3 条）」，
点「导入到库」之后同一份候选变成「待人确认 **6** / 共 6 条」—— 同样 3 列进了两遍。

---

## 五、我改口的两条（实测把我自己的前提顶翻了）

铁律：**实测与推断冲突以实测为准**。本轮我有两条推断被自己的实验推翻，照实写在最显眼处。

### 改口一：就绪认证的分子，屏上**抬得上去**
我本来要报「95 这个分子在屏上无法抬升」。实测不成立。路径存在，只是**入口标签是错的**：
`/admin/slices` 上那个按钮叫「**＋新建切片**」，但点开的面板**没有任何创建按钮** ——
只有 root 下拉 + maxNodes + 一排目标类型开关 + 一个「**规划路径（求最短路）**」。
必须先点规划路径，`POST /slices/plan → 200` 之后才会**长出**「**入库（注册切片）**」这个按钮。点它：

```
PUT /a/v1/ontology/slices/custom_excavator_base -> 201 {"sliceKey":"custom_excavator_base","version":1}
```

| | 修前 | 修后 |
|---|---|---|
| 已注册切片 | 99 | **100**（多跳业务切片 4 → **5**）|
| 就绪横幅 | `图查询覆盖 95/101` | `图查询覆盖 **96**/101` |

⇒ 分子确实动了。**代价是每个对象类型都要走这套三步流程一遍**，而第一步的按钮名在说谎。

### 改口二：新建类型**灌得进数据**
我本来要报「新类型没有任何数据入口」——`POST /a/v1/objects` 确实 **404**（金丝雀：同法 `POST /a/v1/ontology/domains` → 201，探针没坏），
数据接入控制台里也确实没有新类型（障碍 5）。**但 `原型 intake` 那条路是通的。**

粘一段含 `<script>const EXCAVATORS=[...]</script>` 的 HTML → 「解析 + 对账」→
`POST /databuilder/intake → 200`，自动映射出 `EXCAVATORS.excavatorId → Excavator.excavatorId` 等 3 条 →
「导入到库」→ 「**物化为对象**」：
```
POST /databuilder/intake/objectify -> 200 {"materialized":[{"dataset":"EXCAVATORS","type":"Excavator","count":2}]}
```
屏上验证：对象/类型浏览器 `挖掘机 Excavator  4/0  excavatorId  **2**`。

**但这条路有三个真实的钉子**：
1. **入口格式是「HTML 原型」**，不是 CSV / Excel / 数据库。客户给的是 ERP 导出，不是带内嵌 JS 的网页。
2. **对账的置信分档是反的**。`DEALERS.region → Supplier.region`（经销商的区域被映到**供应商**上）
   落在**自动映射（不需人确认）**那一档；而显然正确的 `EXCAVATORS.listPrice → Excavator.listPrice`
   反而被丢进**待确认**。9 列里至少 2 列判反。
3. 页面自己写明「**不新建类型**」，「建模为新类型（A3）」那条链接指向 `/admin/modeling` —— **就是那个死按钮页**。

---

## 六、那个数：给新客户建一套可用本体要多少人天

判据按题目给的：**凡是只能靠改 TS 常量 / 改 `battery.ts` / 重新 build 才能做到的，记「必须改源码」。**
规模按出厂实测折算（出厂 98 类 / 863 属性 / 116 结构边 / 45 因果边 / 100 切片 / 29 规则 / 17 数据分类 / 13 基地 / 3 细分），
工程机械客户按 **~70 类 / ~600 属性** 估。

### A. 屏上点得完（无需改源码、无需重 build）

| 工作 | 量 | 屏上入口（已实测通） | 人天 |
|---|---|---|---|
| 建域 | ~15 | `domain-create` → 201 | 0.2 |
| 建结构边 | ~110 | `orel-link-create` → 201 | 1.5 |
| 建因果边 | ~45 | `orel-rule-create` → 201 | 1.0 |
| 注册切片（规划路径 → 入库） | ~70 | `slice-plan` → `PUT /ontology/slices` 201 | 2.5 |
| 建对象接口 | ~5 | `oif-save` | 0.5 |
| 建规则 | ~29 | 规则库「新建规则」 | 3.0 |
| 原型 intake 灌数据 | 逐表 | `intake → import → objectify` 200 | 2.0 |
| **小计** | | | **≈ 10.7 人天** |

### B. 屏上没有入口，但走 REST 脚本可做（**不必重 build**）

| 工作 | 量 | 实测依据 | 人天 |
|---|---|---|---|
| 建对象类型 + 属性 | 70 类 / ~600 属性 | 屏上零入口；`POST /a/v1/ontology/object-types` → 201 | 12–18 |
| 给域设 owner | 每个域 | 屏上表单无该字段；API 接受 `ownerUserId` → 201 | 0.3 |
| **小计** | | | **≈ 12.3–18.3 人天** |

### C. 必须改源码 + 重 build

| # | 工作 | 实测依据 | 人天 | 必须？ |
|---|---|---|---|---|
| C1 | 扩单位字典 | `ontology-governance.ts:55` 9 项 TS 常量；`t`/`kW`/`h` 全部 400 | 0.5 | **必须**（否则工程机械几乎所有物理量建不出来）|
| C2 | 改边界册 BASE/SEG/PLAN_GOAL | 屏上明写「改值=改代码」；`base-registry.ts` 545 行 · **66 个非测试文件**引用 | 5–8 | **必须**（否则 13 个电池基地/3 个电池细分会一直出现在驾驶舱、地图、推演里）|
| C3 | 写数据接入分类 manifest | `data-categories.ts` 117 行 / 17 类 / `typeKeys` 写死 | 3–5 | **必须**（否则新类型没有上传模版、没有系统对接口）|
| C4 | 域管理屏补 owner 字段 | 屏上建域即锁死发布（证据 A）；顺带修 `material` 幽灵域 | 0.5–1 | **必须**（否则本体永远发布不了）|
| C5 | 因果边的改 / 删 / 停 | 屏上「⚠ 因果边今天只能新建」；行内零按钮 | 2–3 | **必须**（否则一次手滑要重建整个租户）|
| C6 | `references()` 补 link / 因果边 / 实例三类引用 | `Base` 报 0 引用、下线返 200（证据 C）| 2–3 | **必须**（否则「下线」是空动作、承诺的 409 永不发生）|
| C7 | 状态变量改成受控选择（或建一道守卫） | 打错字 → 状态变量 41→43，7 道守卫全绿（障碍 1）| 1–2 | 强烈建议 |
| **C0** | **修 `OntologyRelationsPage.tsx:869` 的 `touchedDomains` 崩页 + `:875/:883` 的 `PENDING` / `PENDING_SIGNOFF` 状态串不一致** | 证据 0：干净种子上点一次即白屏；同意/驳回恒禁用 | **0.5** | **必须，且是第 0 天的第 0 件事** —— 不修则本体治理面在第一次点治理按钮时就没了 |
| **必须项小计** | | | **≈ 14.5–23.5 人天** | |
| C8 | 写行业模板 `construction-machinery.ts` | `battery.ts` **5,357 行** + `battery-extended.ts` 1,141 行；`BUILTIN_INDUSTRY_TEMPLATES=[BATTERY_TEMPLATE]` 一元数组；自由输入行业 → **500** | **25–40** | 仅当要让**合成数据 / 推演沙盘**跑起来 |

### 合计

| 交付口径 | 总人天 | 其中**必须改源码** | 占比 |
|---|---|---|---|
| **最小可用**（接客户真实数据，不要合成沙盘） | **≈ 37–53 人天** | **14.5–23.5** | **39–44%** |
| **完整**（含推演沙盘 / demo 可跑） | **≈ 62–93 人天** | **39.5–63.5** | **64–68%** |

⚠ **注意 C0 的性质与其余不同**：它只有 0.5 人天，但**不修的话上面 A 栏那 10.7 人天全部做不了** ——
因为 A 栏里有 5 项（结构边 / 因果边 / 类型停用下线 / 不变式体检 / 发布会签）都在**同一个会崩的页面**上。
换句话说：**这份估算里最小的一项，是其余所有项的前置。**

**这个数还没算两笔我量不出来的**：
① 出厂租户在我动手前就发不出 v2（`material` 幽灵域），这笔债的清理成本取决于还有多少同类不一致；
② 就绪认证从 96/101 走到 101/101 之后**是否真能变绿**，我没测出来 —— 横幅里那句
`切片 100 < minQueries 1` 本身读不通（100 < 1 恒假），我不确定它度量的是不是它说的那件事。

---

## 七、只有我会说的那一条

**别的角色会说「这个功能缺了、那个按钮该降层」。我要说的是：这套系统里，「点得动」和「留得下」是两件事，
而屏幕从不告诉你自己在哪一边。**

本轮我在屏上做了 9 类写操作，全部返回 2xx、全部在屏上"成功"了。但它们其实分三档，而**屏上完全看不出区别**：

| 档 | 屏上表现 | 实际 | 例子 |
|---|---|---|---|
| **真落地** | 计数变、刷新还在 | 落库 | 建结构边（115→116）· 建因果边 · 注册切片（99→100）· 物化对象（0→2）|
| **落进一个发不出去的工作集** | 计数变、刷新还在 | 落库但**永远进不了已发布真值**（会签被无 owner 的域锁死） | 上面那些**全部**——它们写的是工作集 |
| **纯客户端幻觉** | 屏上出现「已下线」表 | **刷新即消失**，读模型 `status` 仍是 ACTIVE | 停用/下线类型 |

一个 FDE 在客户现场干完一天，屏上是绿的、计数是涨的、图谱里有他新建的节点 ——
**他没有任何办法在屏上判断这一天的成果属于哪一档。**
「已发布版本：v1」那行小字是唯一的线索，而它长在页面最底部、发布会签区里 ——
**而当他伸手去按旁边那个「发起发布会签」时，整页就没了**（证据 0）。
换句话说：**唯一能告诉他「你今天做的东西还没落地」的那个东西，被他试图落地的那个动作删掉了。**

这正是本仓 CLAUDE.md 铁律 1.5 那句话的用户侧同构：
> 「跑得起来」不度量「算得对」。

FDE 侧的版本是：
> **「屏上点成功了」不度量「这条配置会活到明天」。**

而这件事**只有真的把一套本体从零建一遍的人会撞上** —— 因为出厂租户里没人需要发布 v2，
所以那把锁**从来没有人去拧过**，直到第二个客户来。

---

## 八、复现方式（任何人可原样重跑）

```bash
pnpm install --prefer-offline && pnpm -r build
PORT=4401 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-fde SEED_DEMO=1 CREDENTIAL_KEY=$(openssl rand -hex 32) node apps/datacore/dist/server.js &
PORT=4402 DATACORE_BASE_URL=http://127.0.0.1:4401 node apps/agentcore/dist/main.js &
VITE_DATACORE_URL=http://127.0.0.1:4401 VITE_AGENTCORE_URL=http://127.0.0.1:4402 pnpm --filter frontend-shell dev --port 5273
# 浏览器 http://127.0.0.1:5273 → demo / admin / demo1234
```

**四条最快的复现**（各 1 分钟，全部只用屏幕 + curl，不改一行代码）：
0. **【先做这条，因为它会毁掉后面几条的环境】** 干净种子上打开 `/admin/ontology-relations`，
   拉到底点一次「发起发布会签」→ 刷新本页 → **白屏**「Cannot read properties of undefined (reading 'join')」。
   恢复只能重启 datacore（内存模式）；`DELETE /a/v1/ontology/publish-requests` → 404（证据 0）
1. `/admin/domains` 建一个域 → `POST /a/v1/ontology/publish-requests` →
   看 `signoffs` 里那个 `ownerUserId: null`（证据 A）
2. `POST /a/v1/ontology/object-types` 带 `unit:"t"` → 400；换 `unit:"吨"` → 201（证据 B）
3. `/admin/ontology-relations` 弃用流程选 `Base` → 点「下线类型」→ 200 → 刷新页面 → 什么都没变（证据 C）
