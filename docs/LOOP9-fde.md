# LOOP9 · 实施者 / FDE 视角 — 「本体系统能不能被人建起来、维护下去」

> 状态：**取证中**（本文件随实测滚动更新，每段实测完即 commit + push）
> 环境：真后端内存模式 `SEED_DEMO=1`（datacore :4401 / agentcore :4402）+ 真前端 Vite dev（:5273）+ 真 Chromium。
> ⛔ 全程无 `VITE_MOCK`，无冒烟数据。登录 `demo / admin / demo1234`。
>
> 端口不是标准的 4001/4002/5173：本机同时有别的 agent 在跑 datacore，
> 标准端口上的进程被别人的 `pkill` 扫掉过 **2 次**（本会话实测），故改用私有端口 + supervisor 自拉起。

## 一、我扮演的角色

假装明天要把这套系统部署给**第二个客户**：一家做**工程机械**的制造企业（挖掘机 / 装载机 / 起重机），
产品结构、基地、客户群（经销商体系）、供应链全部与电池厂不一样。
我要在屏上走一遍「给新客户建一套本体」的头三天。

---

## 二、金丝雀（报否定结论前的自证）

按硬纪律 1，任何「屏上做不到」的结论之前，先用**同样的方法**做成一件我确定能做到的事。

| # | 金丝雀 | 结果 | 证据 |
|---|---|---|---|
| C1 | 在 `/admin/ontology-relations` 屏上**建一条因果边** | ✅ 成功 | 顶部计数 **生效因果边 42 → 43**；新行 `fde_canary_line_to_wo  Line.utilPressure --line_runs_work_order--> WorkOrder.releasePressure  0.42  0  启用` |
| C2 | 在同一屏**建一条结构边** | ✅ 成功 | 抓到真实请求 `POST /a/v1/ontology/link-types` → **201**，返回 `ltype_pavjnw83t42k95jx` |
| C3 | 用 curl 打一个**已知存在**的 REST 写口 | ✅ 成功 | `POST /a/v1/ontology/object-types`（合法单位）→ **201** `otype_t887yyqxs5r349ap` |

⇒ 屏能点、写口能通、我的探针方法是对的。下面所有「做不到」都不是环境问题。

---

## 三、五件事的实测（滚动更新）

### 3.1 从零建一个对象类型（`Excavator`）

**想做什么**：给工程机械客户建 `Excavator`（整机）类型，带属性、带量纲。

**屏上给了什么**：

| 路由 | 屏上叫什么 | 有没有「新建对象类型」 |
|---|---|---|
| `/admin/object-types` | 对象/类型浏览 | **没有**。全屏只有 3 个控件：`ot-domain-filter`（域筛选）、`ot-keyword`（搜索框）、`ot-only-mat`（只看已物化）+ 每行一个「看实例 →」。**纯只读。** |
| `/admin/modeling` | 本体建模工作台 | **没有**。整页**只有 1 个按钮**：`modeling-new-draft`「AI 建议草案」，外加一个 `<select aria-label="选择草案">` —— **该 select 的 options 数为 0**。 |
| `/admin/domains` | 域管理 | 只能建**域**（`domain-create`「新建域」），不能建类型 |
| `/admin/interfaces` | 对象接口 | 能建**接口**（`oif-save`「创建接口」+「+ 加一条属性」），不是对象类型 |
| `/admin/prototype-intake` | 原型 intake | 粘 HTML → 「解析 + 对账」→「导入到库」（见 §3.6） |

**卡在哪**：

1. **「AI 建议草案」是个死按钮。** 它 `disabled=false`、能点、点了**没有任何反应**：
   我挂了网络监听，点击后 `/a/v1|/b/v1|/api/v1` 上的请求数是 **0**（不是 4xx，是根本没发）。
   再追一层（铁律 0.5）：`GET /a/v1/modeling/drafts` → `200 []`；
   `POST /a/v1/modeling/drafts` → **404 route not found**。
   ⇒ 三分法判定：**前后端都没接线**（不是「接了线没数据」）。
   这是新客户建本体的**主入口**，它在空租户上原地不动。

2. **屏上没有任何入口能建对象类型**，但**后端有**：
   `POST /a/v1/ontology/object-types` 存在且可用（金丝雀 C3 证）。
   ⇒ 形态是**「后端有能力、屏上没入口」**，不是「系统做不到」。
   落地含义：FDE 建 98 个类型只能写脚本打 REST，或改 `seed.ts`。

**只能怎么绕**：用 curl 直接打 REST。实测建成：
```
POST /a/v1/ontology/object-types  →  201
{"key":"Excavator","displayName":"挖掘机","domain":"product",
 "properties":[{excavatorId/string/PK}, {operatingWeight/number/unit=吨}, ...]}
→ {"id":"otype_t887yyqxs5r349ap","tenantId":"demo","version":1,"status":"ACTIVE"}
```

### 3.2 量纲声明 —— 这是本轮最硬的一条

**对照实验（修前 / 修后两个数）**

| 我发的 | 结果 |
|---|---|
| `"unit": "t"`（吨的国际符号） | **HTTP 400** `未知单位 't'（单位字典：万套/GWh/%/吨/天/元/万元/件/秒）` |
| `"unit": "吨"` | **HTTP 201**，创建成功 |
| `"dimension": "mass"`（我一并发了） | **被静默丢弃** —— 201 的响应体里只有 `unit`，没有 `dimension` |

**结论一：单位字典是一个写死的 9 项 TS 常量。**
`apps/datacore/src/ontology-governance.ts:55`
```ts
/** 治理增量 §1 单位字典（场景包级；电池模板内置）。 */
export const UNIT_DICTIONARY = ["万套", "GWh", "%", "吨", "天", "元", "万元", "件", "秒"];
```
注释自称「场景包级」，实际是**模块级常量、不带 tenant 参数、无任何 API 可增删**。
工程机械客户要的 `kW / kg / t / 台 / m³ / MPa / L/h / 小时 / km` **一个都进不来**，
且报错发生在**建类型**这一步 —— 不是警告，是 400，建不出来。

**结论二：没有「量纲」这个概念，只有一个字符串 `unit`。**
`dimension` 被丢弃 ⇒ 系统无处知道「元/吨」和「元/kg」是同一量纲不同标度。
（这正是铁律 1.5 那条「碳酸锂与铝箔各涨 15% 得到同一个 9.75」的**上游成因**：
传导公式里没有用量项，而**schema 里压根没有能承载量纲的字段**，所以任何下游都无法归一。）

**结论三（更难看）：出厂的本体自己就违反这道门。**
实测 `GET /a/v1/ontology/object-types`（99 个类型、**863 条属性**）：

- 带 `unit` 的属性 **只有 27 条 = 3.1%**（96.9% 的属性没有任何单位声明）
- 这 27 条里，**9 条用的单位不在字典内**：
  `Process.requiredThroughput=电芯/天`、`Equipment.mtbf=h`、`Equipment.mttr=h`、
  `Cadence.intervalCount=个`、`DemandSegment.demandWanPerYearP50/P90=万套/年`、
  `AdoptedMitigation.eff=点`、`SopVersionRow.demand/supply=万套/年`

**对照实验**：把种子里**已经在册**的 `Equipment.mtbf` 的 `unit:"h"` 原样从 REST 发回去 ——
```
POST /a/v1/ontology/object-types {"propKey":"mtbf","unit":"h"} → 400 未知单位 'h'
```
⇒ **种子走仓储直写绕过了 REST 校验，新客户走支持路径反而被拦。**
**你没法用官方 API 复刻出厂的那套本体。** 这一条不需要读一行源码就能设计出判据，
但读了源码才知道病因：`app.ts:3824` 的门只挂在 REST 上，`seed.ts` 不经过它。

---

（下文待续：链路类型 / 改属性名与量纲 / 删不适用的东西 / 配置带走 / 3 条清单外障碍 / 人天拆解）
