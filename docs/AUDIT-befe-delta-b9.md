# AUDIT · `merge-batch-9` 相对 canonical 的后端↔前端接缝差集（WO-BEFE-DELTA-3）

**只定性、只建议，一行产品源码未改、一条基线未动。**

- 量法：`scripts/check-backend-frontend-seam.mjs --verbose`（门 `befe-seam:check`）
- A = canonical `962dd3be` · B = `origin/claude/merge-batch-9` `30942636`
- 取证日期：2026-09-09

---

## 1 · 真 A/B（不是两棵树两个人两次跑拼出来的）

派单给的「147 vs 150」是**两棵树、两个人、两次跑**拼出来的。本节把它重做成一次对照实验。

### 1.1 先控制住量具本身

**若量具在两棵树上不同，差集度量的就是「门改了」而不是「代码改了」。** 先证明它没变：

| 对象 | `962dd3be` blob | `30942636` blob | 判定 |
|---|---|---|---|
| `scripts/check-backend-frontend-seam.mjs` | `8ee8ab07…` | `8ee8ab07…` | **逐字节相同** |
| `scripts/backend-frontend-seam-baseline.json` | `9d789ab9…` | `9d789ab9…` | **逐字节相同** |

`git diff 962dd3be 30942636 -- <两文件>` 输出为空。落盘后 `md5sum` 复核同样一致
（`e4564816…` / `556b4567…`）。⇒ **量具受控，差集是真实代码差异。**

### 1.2 同机、同 node、同一份脚本、背靠背两跑

两棵树用 `git archive` 各导出门真正读的四样（`apps/datacore/src` · `apps/agentcore/src` ·
`apps/frontend-shell/src` · 基线 JSON），在同一台机上背靠背各跑一次。

| | A `962dd3be` | B `30942636` | 差 |
|---|---|---|---|
| 金丝雀 | **31/31 全中** | **31/31 全中** | — |
| 后端注册端点 | 554 | **557** | **+3** |
| 结构性豁免 | 12 | 12 | 0 |
| **前端 URL 字面量** | **354** | **354** | **0** |
| **前端零调用** | **147** | **150** | **+3** |
| 门 RC | 1 | 1 | — |

**⇒ 差集正好 3 条，与派单给的数一致。** 反向差集（A 有 B 无 = 已修复）**为空** ⇒ 纯新增。

**「前端 354 条 URL 字面量两边完全相同」是本次最强的那个对照**：
前端一个字都没动，后端多注册 3 条 ⇒ 这 3 条**出生即零调用**，不是量法漂移。

**抽取自检**：我从 verbose 明细里切名单的 `awk` 先自证能复现门自己报的总数
（A=147 应为 147 · B=150 应为 150），再做差集。切法错了这一步就对不上。

### 1.3 顺带纠正的一个前提

派单写「环境前置：`pnpm install --prefer-offline` && `pnpm -r build`（**这道门读 dist**，
不 build 会给你『未判定』而不是红）」——**这条前提不成立，照它做会白等一轮 build**：

- 门的 import 只有 `node:fs` / `node:path` 两行（`:70-71`）⇒ **不需要 node_modules**；
- 门读的是 `src/`（`:86-89`），且 `walk()` 在 `:815` 显式**跳过 `dist` 与 `node_modules`**。

本次全程未 `pnpm install`、未 `pnpm -r build`，门照常出数且金丝雀 31/31 全中。

---

## 2 · 差集逐条定性

三条全部属于同一张交付单 **`WO-AGENT-IN-LOOP`**（agent 参与方案生成）。

| # | 端点 | 注册处 | 定性 |
|---|---|---|---|
| 1 | `POST /a/v1/sim/optimize-pareto/propose` | `apps/datacore/src/app.ts:3342` | **真没接线** |
| 2 | `POST /a/v1/sim/optimize-pareto/by-proposal` | `apps/datacore/src/app.ts:3410` | **真没接线** |
| 3 | `POST /b/v1/sim/propose-candidates` | `apps/agentcore/src/server.ts:2631` | **有意无前端消费方**（登记缺失） |

**三条里没有一条是「接了线门看不见」。** 这个假设我是**证伪**的，不是没找到——见 §3。

### #1 / #2 —— 真没接线

- 两条都走**用户鉴权 + entitlement**（`requireSim(c, "sim.sandbox")` +
  `requireSim(c, "sim.agent-proposals")`）⇒ 按构造就是**给前端用的口**，不是服务间口。
- 门禁 `sim.agent-proposals`：`features.ts:110` `level: "BLOCK", defaultOn: false`。
- 前端侧追到底仍为零（追层见 §3）。

### #3 —— 有意无前端消费方，但**门里没登记**

端点自己的注释白纸黑字（`server.ts:2632-2634`）：

> 「**仅限服务间调用**（同 `/b/v1/internal/scaffold` 口径）：调用方是 A 侧的
> `POST /a/v1/sim/optimize-pareto/propose`……用户 JWT 直打本口一律 401 ——
> **它不是给前端用的口**。」

第一行代码就是 `requireServiceToken(req)`（`:2635`）。

**⚠ 注释说的不度量真实（铁律 1.5 判据四），所以我追了调用方那一层**：
`apps/datacore/src/sim/agent-proposal.ts:108`
`fetch(\`${baseUrl…}/b/v1/sim/propose-candidates\`, …)`，由 `app.ts:3341`
在 `AGENTCORE_BASE_URL && SERVICE_TOKEN` 都配了时构造。
⇒ **它有真实消费方（A 侧），只是那个消费方不是前端。** 不是死代码。

---

## 3 · 「门看不见」这一档是**证伪**的，不是没找到

派单要求区分「真没接线」与「量法看不见」。本仓最像的那种看不见形态是**常量拼接**
（`${PARETO_ENDPOINT}/propose` —— 门只认整条字面量，拼出来的它抓不到）。
沙盘里确实有一族这样的常量，所以这个假设必须正面排除，不能靠「grep 没命中」。

前端 pareto 一族常量**全部 4 个**及其用法：

| 常量 | 值 | 用法 |
|---|---|---|
| `PARETO_ENDPOINT` (`useParetoFrontier.ts:849`) | `/a/v1/sim/optimize-pareto` | `api.a(PARETO_ENDPOINT, { body: req })` `:863` |
| `PARETO_ASSEMBLE_ENDPOINT` (`SandboxOptRoute.tsx:147`) | `…/optimize-pareto/assemble` | `api.a(PARETO_ASSEMBLE_ENDPOINT, { body })` `:169` |
| `MULTIOBJ_ASSEMBLE_ENDPOINT` (`MultiObjWhatifPanel.tsx:58`) | `…/optimize-pareto/assemble` | `api.a(…, { body: {} })` `:111` |
| `MULTIOBJ_PARETO_ENDPOINT` (`MultiObjWhatifPanel.tsx:61`) | `/a/v1/sim/optimize-pareto` | `api.a(…, { body: {…req!, weights} })` `:141` |

**四个全部作为整体实参直接传进 `api.a(...)`，没有任何一处做后缀拼接。**
⇒ 「门把拼接出来的调用漏掉了」这条路**被证伪**，不是没查到。

再追的其它间接层，全部为零：
`by-proposal` · `propose-candidates` · `/propose` · `proposeCandidates` · `byProposal`
在 `apps/frontend-shell/src` 全库 **0 命中**（含 `api/endpoints.ts` 封装层与 `mocks/`）。

前端出现的「提案」字样**全部属于另一个特性**（M11 校准提案 `calibration_proposal`，
`CalibrationPage.tsx` / `ReviewView.tsx`），与本单三条口无关——这是个同名干扰项，
先排除掉才能说「前端不认识这个特性」。前端亦**零处**提及门禁键 `sim.agent-proposals`。

---

## 4 · 金丝雀（否定结论的入场券）

报「前端零调用」之前，先拿**同一把量法**跑一条我确定前端在调的端点，双向都要有鉴别力：

```
grep -rn "optimize-pareto/assemble"        apps/frontend-shell/src  →  5 命中   ✅ 量法有效
grep -rn "optimize-pareto/propose|…by-proposal|propose-candidates"   →  0 命中   ← 结论
```

**正向命中 5 条**证明量法不是恒假；这 0 才有资格被读作「零调用」而不是「我没查出来」。
门自身的金丝雀在两棵树上均 **31/31 全中**（词法 2 · SSE 抽取 4 · 路由 8 · 消费判据 5 ·
baseline 1 · exempt 1 · method 7 · 通配 3）。

`git grep` 两个已知骗法本次均已避开：未用含通配的 pathspec 当目录前缀，未用 `**` 形态。

---

## 5 · 「它该不该有」——逐条过三问

只对判为**真没接线**的 #1 / #2 过（#3 有消费方，不适用）。

### 承接的是一处**今天屏上确实坏着**的东西

`app.ts:3304-3306` 自陈上一条 `/assemble` 的行为：

> 「它**不读本次事件**，故施加任何扰动，那张网格逐字节不变：
> **那是一张固定的产线产能扫描表，不是本次事件的对策。**」

即：今天沙盘方案寻优页上，**施加扰动后看到的方案与扰动无关**。#1/#2 正是补这一格的
（`:3316` 明写两者是「**同一步的两种做法**」：确定性挑杠杆 vs agent 挑杠杆）。

| 三问 | #1 `/propose` | #2 `/by-proposal` |
|---|---|---|
| **谁会看见它** | 沙盘方案寻优页（`SandboxOpt.tsx` / `SandboxOptRoute.tsx`）的使用者——**宿主屏今天已存在**，只是屏上只有确定性那一条路 | 同上，同一块屏；它负责把 #1 定版的提案交给求解器算出营收/成本/毛利/获排率 |
| **不做会缺什么** | 缺「**方案随本次事件而变**」。缺了这条，扰动改了而方案纹丝不动——这正是仓主反复追的「后端算了、屏上没有」 | 缺**数值**。#1 按设计**一个业务数字都不回**（`server.ts:2624` 契约里没有数值格），没有 #2 就只有一张没有数的方案清单 |
| **删掉会不会有人发现** | **不会**——前端零调用、`defaultOn:false`、前端连这个门禁键都不认识。但「没人发现」在这里恰恰是病症本身：功能建好了从未上过屏 | **不会**，同上。且 #2 单独留着无意义（它只吃 #1 落盘的 `proposalId`），**两条是一个原子，要接一起接、要删一起删** |

### 处置建议（只建议，不执行）

| # | 建议 | 理由（落在**该不该有**） |
|---|---|---|
| 1 + 2 | **接前端**（作为一对，不可拆） | 它补的不是锦上添花，是一处**已知的失真**：今天该屏承诺「方案寻优」而方案不随事件变。宿主屏与确定性那半都已就位，缺的只是屏上那条 agent 路径的入口 |
| 3 | **登记为服务间口** | 它有真实消费方（A 侧 SERVICE_TOKEN 调用），前端调它一律 401。它进「零调用」名单是**门的登记缺口**，不是交付缺口 |

⚠ **#1/#2 的接线建议受禁令 2 约束**：范围落在 `apps/frontend-shell/src/views/sim/`
（沙盘接真实数据的 UX），**开工必须先拿到仓主逐案批准**。本文只提案。

⚠ **三条都不建议删端点。** #1/#2 承接的缺口是真的；#3 有消费方。

---

## 6 · ④ 门的登记缺口（只报不修）

**门没有量错，是豁免表漏了一类。** `ROUTE_EXEMPTIONS`（`:859-892`）里管服务间口的只有一条：

```js
{ re: /\/internal\//, why: "服务间内部钩子（B←A 事件失效等）·SERVICE_TOKEN 凭证，前端一律 403" }
```

判据是**路径里含 `/internal/`**。而 `/b/v1/sim/propose-candidates` 是
**SERVICE_TOKEN 专用但不在 `/internal/` 底下**，于是这条豁免够不着它。
端点注释自称「同 `/b/v1/internal/scaffold` 口径」——**口径同，路径形状不同**，
而豁免表量的是路径形状。

> **形态（铁律 0.6 句式）**：
> 「我用『路径里有没有 `/internal/`』当作『它是不是服务间口』的证据，而前者并不度量后者。」

这与豁免表自己记着的 `metrics` 那笔错账**同构**（「我用『它长得像探活路径』当作
『它是探活端点』的证据」），只是方向相反：那次是**该查的被豁免掉**（真缺口隐身），
这次是**不该查的没被豁免**（合法服务间口混进缺口数，把 150 这个数掺了水）。

**判据建议落在鉴权上而不是路径形状上**：一条路由的 handler 首行是不是 `requireServiceToken`
——那才是「服务间口」的定义。⚠ 但这是**改门脚本**，受禁令 3（新增门/棘轮/基线冻结）与
本单「不许改基线」双重约束，**故只报不修，交仓主裁**。

---

## 7 · 越界发现

- **两棵树上门都是红的（RC=1），不是 B 才红。** A 已经 `新增 7`（基线 143），
  B 是 `新增 10`。派单点名的那 4 条存量（`sim/live-scenarios/*/end` · `*/pause` ·
  `dsh/tool-execute` · `governance/adjudicate`）确认在 A 的 7 条里，与本次差集无交集。
- **B 的 3 条里有 1 条不该计入**（#3 服务间口）⇒ 若按鉴权判据登记，
  `merge-batch-9` 真正的**交付缺口只有 2 条**，且是同一张单的一对。
- **散文位诚实数**：门报前端散文串里写着路由、却无任何真 URL 佐证的有 4 条
  （`/a/v1/sim/sessions/{id}/perturbations` · `…/tick` · `/a/v1/sop-versions` ·
  `/a/v1/history/bundle`）。两棵树同为 4 条，**与本次差集无关**，但它是一族
  「文档里写了、代码没调」的候选，留一笔坐标。
