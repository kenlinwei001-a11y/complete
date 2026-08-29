# WO-R9-METRO-UX · 沙盘第五档「业务流程」= 地铁线路图 —— 取证与复验

仓主两次原话：①「右侧图片是**业务端到端路线图**」（附参考图 = 地铁线路样式）；
② 看到第五档真屏后 ——「**没有看到类似『地铁线路』的 UX**」。
上一版是**分组卡片墙**：信息全，但形不对。本单换成线路图。

## 0 · 这里为什么有两个 `.mjs`

它们是本单**唯一能把两类事实说清楚的机制**，不是一次性脚本，故随截图一起留档：

| 脚本 | 它证明什么 | 为什么 jsdom 证明不了 |
|---|---|---|
| `probe-order.mjs` | 「取数端点到底下发了哪些字段」—— 含**金丝雀**（拿确定存在的字段同法查） | jsdom 里是 mock fixture，不是真后端下发的那份 |
| `shot-metro.mjs` | 「真浏览器里点得中站、面板真出内容」＋ 站数恒等式 ＋ 结构红线 ＋ 零原生 tooltip | **jsdom 不做命中测试、也不模拟指针捕获重定向**（见下 §3） |

> 建议复验方把 `shot-metro.mjs` 提升到 `scripts/`（本单范围边界只到 `docs/`，故先落在这里）。

## 1 · 「线怎么连」的依据 —— 实测取证

```bash
PORT=4802 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))') \
  node apps/datacore/dist/server.js &
node docs/shots/WO-R9-METRO-UX/probe-order.mjs http://127.0.0.1:4802
```

实测输出（2026-08-14，真后端 SEED_DEMO=1）：

- **金丝雀 3/3 命中**（`carrierTypeKey` / `waitKind` / `domainKey`）⇒ 探针是好的，
  下面的否定结论可信（铁律 0.6：报否定结论必须附金丝雀命中证据）。
- `GET /a/v1/process-definitions` 的 `ProcessDefinition` **字段全集**（对 65 条取并集）：
  `carrierTypeKey · domainKey · id · key · name · ownerFunctionKey · stdDurationDays · tenantId · waitKind`
  ⇒ **先后关系字段一个都没有**（predecessor / successor / stationIndex / flowKey / dependsOn / seq … 逐个查，全无）。
  这不只是「查了没有」：`ProcessDefinitionSchema` 是 `z.strictObject`，多一个字段就抛
  ⇒ 后端**不可能**多发一个而前端没接到。
- `ProcessDomain` 有 `order`，但契约对该字段的原文是「**展示序**」——是稳定排版序，**不是业务先后**。
- **实测站序确实存在，而且今天就在跑**，只是不经本档端点：
  `GET /a/v1/process-definitions/P34/instances` → `flowKey=procure_to_release::po_12`，
  站序 `[0:P33 → 1:P34 → 2:P35]`；`P43` → `wo_to_quality::…`，站序 `[0:P43 → 1:P47]`。

⇒ **处置**：退回**按域分线**（派单指定的退路），**连线画虚线**、屏上写明依据档位
（`spc-order-basis[data-basis=display-order]`），并把「实测站序在哪、怎么复验」写进浮层。

### 为什么不干脆按 `P##` 编号画箭头
**编号相邻 ≠ 先后**，两个反例都是真跑数据逼出来的（`apps/datacore/src/process/flow-rules.ts` 文件头）：
- 真实链是 `P43 → P47`，**跳过** P44/P45/P46；
- 第一版写成 `P42 → P43 → P47` 时，`P42.avgGapDaysToNext = −9.82 天`（负数），机器当场抖出建模错误。

把 P## 升序画成箭头 = 复现一个**已被实测证伪**的顺序。派单原话：编一个看起来像流程的顺序，比卡片墙更坏。

## 2 · 截图与机器读数

```bash
# mock（11 条）
VITE_MOCK=1 pnpm --filter frontend-shell dev --port 5203 --host 127.0.0.1
node docs/shots/WO-R9-METRO-UX/shot-metro.mjs http://127.0.0.1:5203 planner docs/shots/WO-R9-METRO-UX
# 真后端（65 条）
VITE_MOCK=0 VITE_DATACORE_URL=http://127.0.0.1:4802 pnpm --filter frontend-shell dev --port 5204 --host 127.0.0.1
node docs/shots/WO-R9-METRO-UX/shot-metro.mjs http://127.0.0.1:5204 admin docs/shots/WO-R9-METRO-UX
```

| 截图 | 何时 | 端点下发 | 上站 | DOM 站数 | 线 | 轨段 | 换乘弧 | `data-overlap` | `data-basis` | 原生 tooltip |
|---|---|---|---|---|---|---|---|---|---|---|
| `01-metro-planner.png` | mock · 切档后 | 11 | 11 | 11 | 5 | 6 | 1 | 0 | display-order | 0 |
| `02-metro-inspect-planner.png` | mock · 点站后（P01 → 面板 P01） | — | — | — | — | — | — | — | — | — |
| `01-metro-admin.png` | 真后端 · 切档后 | **65** | **65** | **65** | **13** | 52 | 1 | 0 | display-order | 0 |
| `02-metro-inspect-admin.png` | 真后端 · 点站后（P01 → 面板 P01） | — | — | — | — | — | — | — | — | — |

**站数恒等式**两侧都是现算的：左边是端点这一次真发出去的条数，右边是现数 DOM。全档不出现 `65`/`11` 任何字面量。

## 3 · 真浏览器抓到、jsdom 结构上抓不到的两个 bug（本单实测订正）

两个都是「**绿测试 ≠ 能用**」的教科书形态：jsdom 17/17 全绿，真浏览器里功能是坏的。

1. **指针捕获把 click 抢走了。** 平移照第一档抄了 `onPointerDown → setPointerCapture`。
   按 Pointer Events 规范，捕获一旦设上，`pointerup` 与**由它合成的 `click`** 都派发到**捕获元素**
   （画布 div），站上的 `onClick` 永远不触发 ⇒ **点站没反应**。
   第一档没露过，因为它的站是 `role="img"` 不可点 —— **「另一个档这么写」不是「这么写对」的证据**。
   jsdom 的 `setPointerCapture` 是不做重定向的空实现，**这件事它根本不模拟**。
   订正：位移超过 3px 才认定拖拽、才捕获；点击（位移 0）全程不进捕获态。
2. **「适应画布」把内容顶出视口。** `fitTransform` 一律居中；缩放被 `ZOOM_LIMITS.min`(0.4) 夹住、
   内容仍比视口高时 `y` 是负数 ⇒ 头几条线跑到视口上方，而屏上没有任何迹象。
   真后端 13 条线实测 `y ≈ −222`，1 号线整条不可见（mock 5 条线装得下，所以从没露过 ——
   又一个「小数据集恒绿、真数据集才炸」）。
   订正：装不下就**顶左对齐**并当面说一句（`spc-fit-clamped`）。
   ⚠ **没有改** `physicalTopology.fitTransform`（四档共用，改它等于替另外三档做决定），只在本档调用点后夹一次。

## 4 · 变异反证（每组先 `git diff` 自证变异体 ≠ 原文，逐条显式捕获 RC）

| # | 变异体 | 结果 |
|---|---|---|
| ① | 摘掉第五档取数（`fetchProcessDefinitions()` → 永不 resolve 的 Promise） | **RC=1**，12/17 红（B1–B3 · C1–C2 · D1–D3 · F1–F4） |
| ② | 把一个冻结 `nodeId` 混进流程层（首站 key ← `chainLayerOverlapCanaryKey()`） | **RC=1**，C1 红，实际交集 `demand.consensus` |
| ③ | 臆造一条跨域「端到端」连线（第 1 条线末站 → 第 2 条线首站） | **RC=1**，F2 红：`轨 P06→P08 跨了业务域` |

①证明不了②（摘取数时是「没站」才红，不是交集判据红）；①②都证明不了③——
③咬的是本单的真风险：**顺序是不是编的**。
