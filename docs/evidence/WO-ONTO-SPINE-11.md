# WO-ONTO-SPINE-11 · 本体建模动线主脊（设计稿批注 #7）

> **base commit**：`241aea0c`（空提交开工）→ 本单 tip 见分支 `claude/handoff-wo-onto-spine`
> **canonical**：`cb89c0e7`（`origin/claude/inspiring-gates-aqczjg`）
> ⚠ **开工时 worktree 落后 canonical 4570 个提交**（`git merge-base --is-ancestor HEAD $CANON` → **RC=0** ⇒ HEAD 是 canonical 的祖先 ⇒ 落后）。
> 已照铁律从 canonical 重开分支，**并 merge 了 `origin/claude/handoff-wo-onto-wire4`**（1 文件 +46/-2，`ontology-governance.ts`）。
> **取证时刻**：2026-09-10 05:14–06:05 UTC
> **树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **7043**（与底本 WO-ONTO-DESIGN-VERIFY 同树）
> **设计稿**：`docs/design/UI-onto-modeling-20260831.html` · md5 `76c99bc9f969a2138e95a5592e9b2fd4` · **50498 字节**
> 金丝雀：`<h2 class="screen">` = **2** · `td.i` = **24**（= 14+10）⇒ 取的是对的那份文件。

## 取证环境（真后端 + 真浏览器，全程禁 `VITE_MOCK`）

| 件 | 端口 | 自证 |
|---|---|---|
| datacore | **4741** | socket 属主 pid **27477**；`/proc/27477/cwd` = 本 worktree；`BLOB_DIR=/tmp/blobs-wospine11`（本会话独有） |
| vite dev | **5741** | 属主 pid **22090**；`VITE_DEV_DATACORE` + `VITE_DATACORE_URL` 双设指向 4741 |
| 浏览器 | Chromium **1194**（`/opt/pw-browsers/chromium-1194/…/chrome`） | **从 `/login` 走起**填 `demo/admin/demo1234` |

⚠ 端口不靠 `ss`/`netstat` 判（本机都没有）：**真去 bind + `lsof` 取属主 pid**。
⚠ 杀进程只杀**自己 log 里记下的 pid**（22692/22690），⛔ 未用 `pkill -f`。

## 全局金丝雀（否定结论的前提）

| 金丝雀 | 结果 | 证明了什么 |
|---|---|---|
| 路由正则 `app.(get\|post)("/a/v1/…ontology` | **53** | 路由计数器有鉴别力 |
| 同一正则换 `event` | **0** | ⇒ **datacore 零个 `/a/v1/*event*` 路由**（真 0，不是量法坏） |
| `grep -rl 对象约束 / 结构边` in `pages/` | 1 / 2 文件 | 中文词计数器有鉴别力 |
| 同法搜 `事件类型` | **0** | ⇒ **零个事件建模面**（`ActionsPage.events` 是审批审计流水，非本体事件，⛔ 不拿它凑数） |
| `GET /a/v1/ontology/domains` | 200 | 认证/路由基线正常 |
| `GET /a/v1/__no_such_route_zzz__` | 404 | 不存在的路径长这样 |
| vitest 并发探针（父进程非 vitest 的 vitest 进程） | **7**（同刻 `ps\|grep -c` 报 **19**） | 说明**为何不能用行数**；load 18–71，故⛔未跑 gate/全量 vitest |

---

## ★ 11 步映射表（本单最关键产出）

**判定图例**：✅ 可直接指过去 · ⚠ 与他步同页需锚点 · 🔶 派生非独立面 · ❌ 今天没有落点

| 步 | 设计稿要什么（原文） | 今天在哪个面 / 哪个 API | 完成度怎么算（数据来源） | 实测值 | 判定 |
|---|---|---|---|---|---|
| **01 域** | `域` · `15` | `/admin/domains` 域管理 ← `GET /a/v1/ontology/domains` | 数组长度 | **15** | ✅ 可直接指过去（**与设计稿 15 逐数吻合**） |
| **02 对象** | `类型 · 属性` · `12 / 70` | `/admin/object-types` 对象/类型浏览器 ← `GET /a/v1/ontology/object-types` | 类型数 / Σ`properties.length` | **100 / 878** | ✅ 可直接指过去（设计稿 12/70 是**设计目标**，非实测） |
| **03 关系** | `结构 · 归属 · 业务` · `0 / 110` | `/admin/ontology-relations` **§结构边·关系类型** ← `GET /a/v1/ontology/mapping/registries`.`linkTypes` | 数组长度 | **127** | ⚠ 与 04/07/08/11 同页 ⇒ **本单加锚点 `#onto-structural`** |
| **04 状态** | `State` · `—` | 同页 **§因果边** ← `GET /a/v1/sim/view-config`.`stateVars` | 传导规则 source/target 状态变量**去重** | **41** | 🔶 **无独立建模面**：它是第 08 步的派生投影（`view-config` 里一句 `[...new Set(rules.flatMap(…))]`）⇒ 脊上标「派生自 08」 |
| **05 事件** | `Event` · `11 型` | ❌ **无任何面**；唯一数据是映射表静态种子 `EVENT_TYPE_REG` | 只能数静态种子 | **3**（检修窗口/交付高峰/到货间隙） | ❌ **缺口**。零 REST 资源（金丝雀见上）、零管理面消费。设计稿「11 型」**今天无出处** |
| **06 规则** | `Rule` · `0 / 29` | `/admin/rules` 规则库 ← `GET /a/v1/rules` | `status==="PUBLISHED"` 计数 | **30**（全 PUBLISHED） | ✅ 可直接指过去 |
| **07 约束** | `Constraint` · `—` | 同页 **§对象约束·引用规则库** ← 对象类型上的 `constraintRefs` | Σ`constraintRefs.length` / 类型总数 | **0 / 100** | ⚠ 同页需锚点 `#onto-constraint`。**机制齐备而数据为 0**（写端已闭合，见底本 #8/#12）⇒ 脊算出的**作业面就是这一格** |
| **08 因果** | `Causal` · `0 / 45` | 同页 **§因果边·传导规则** ← `view-config`.`propagationCount` | 生效（PUBLISHED）边数 | **47** | ⚠ 同页需锚点 `#onto-causal` |
| **09 数据** | `灌入 · 对账` · `—` | `/admin/synthetic` 合成数据 ← `GET /a/v1/ontology/object-types/stats` | 有实例的类型数 / 类型总数（Σ`count` = 实例总数） | **89 / 100**（实例 **12,849**） | ✅ 可直接指过去 |
| **10 场景·求解** | `Scenario · 求解` · `—` | `/admin/solvers` 求解器目录 ← `GET /a/v1/solvers/registry` | `solvers` 数组长度 | **63** | ✅ 可直接指过去（`GET /a/v1/sim/scenarios` 另返 **0**，未用作该格） |
| **11 发布·会签** | `评审 · 会签` · `—` | 同页 **§发布会签（R4）** ← `GET /a/v1/ontology/versions` + `…/publish-requests` | `max(version)`，待签数另标 | **v1 · 0 待签** | ⚠ 同页需锚点 `#onto-publish`。该页刻意不给「直接发布」按钮，会签是唯一出口 |

### 这张表推翻的两件事

1. **设计稿步骤条的 11 个计数没有一个能照抄**。`15` 恰好对上（域），其余全是设计目标：
   `12/70` vs 实测 `100/878` · `0/110` vs `127` · `0/29` vs `30` · `0/45` vs `47` · `11 型` vs `3`。
   ⇒ 代码里**一个都没写死**，全部现算。
2. **11 个建模面 ≠ 11 步**。今天 `adminRegistry.ts:114` 的 `modeling` 组是 **10 条 path**，
   而 11 步里 **4 步（03/04/07/08）+ 第 11 步全部挤在 `OntologyRelationsPage` 一页**（1892 行），
   另有 **1 步（05 事件）没有任何面**。所以「一页一个 API 资源」这句实测成立，但更准确的说法是
   **「一页塞五步，另一步没有页」** —— 这正是需要脊的理由。

---

## 对照实验（铁律 1.5 判据一）· 四个数

> X = 底层数据：真去新建一条因果边　Y = 脊上第 08 格计数
> 读法与 `OntoSpine.tsx` **逐字同源**（不是另数一遍 —— 另数只证明后端有这个数，证明不了脊会动）

| | 01 域 | 02 对象 | 03 关系 | 04 状态 | **08 因果（目标格）** |
|---|---|---|---|---|---|
| ① **改前** | 15 | 100 / 878 | 127 | 41 | **47** |
| ② **改后**（POST 新边 → 201 PUBLISHED） | 15 | 100 / 878 | 127 | 41 | **48** |
| ③ **撤销后**（PATCH→DRAFT，再 DELETE→204） | 15 | 100 / 878 | 127 | 41 | **47** |
| ④ **对照格判定** | 不动 ✅ | 不动 ✅ | 不动 ✅ | 不动 ✅ | Δ=+1，复位差=0 ✅ |

**结论**：目标格随底层数据变化且可复位；**四个对照格同刻不动** ⇒ 不是「所有格子跟着乱动」。

⚠ **一次差点误判的自查**：脚本内 DELETE 先报 **400**，报文 `FST_ERR_CTP_EMPTY_JSON_BODY`
——**是我的探针给无 body 的 DELETE 带了 `Content-Type: application/json`**，不是应用缺陷；
换 curl（不带该头）→ **204**。⛔ 差一点把「探针写法错」报成「删除路坏了」。

**自污染披露与复原**：本次向租户 `demo`（内存模式）建过 2 条探针因果边 + 1 条探针结构边（UI 走查那条）。
因果边**已全部 DELETE**，复原后实测 `total incl drafts = 47 · probe rows = 0 · propagationCount 47 / linkTypes 127 / stateVars 41`。
⚠ **UI 走查建的那条结构边 `wo_spine11_ui_probe` 未删**（配额中止），下一个人请清理，或直接重启内存态服务。

---

## 真浏览器动线四数（从 `/login` 走起，⛔ 未手敲 admin URL）

| 数 | 值 |
|---|---|
| **总步数** | **8** |
| **总点击数** | **7** |
| **页面跳转数** | **6** |
| **卡在第几步** | **第 7 步** —— 「新建一个对象类型」 |

**卡点原文**：`/admin/object-types`（对象/类型浏览器）页 **疑似新建按钮 = `[]`（0 个）**。
追一层确认不是量法坏：全仓 `createObjectType`/`upsertObjectType` **零个 UI 调用方**
（金丝雀：同法搜 `createLinkType` 命中 **3 处** UI 调用点 ⇒ 计数器有鉴别力）。
唯一造类型的路是 `建模草案 → publishDraft`（`modeling.ts:350+` 真在建类型），**需要先有 raw dataset**，
不是「点一下新建」。⇒ **与底本批注 #2「屏上补新建/改类型入口」完全一致，该缺口仍开着。**

**脊本身走通的部分**（同一次走查）：
- 第 3 步：脊在 `/admin/ontology-relations` 正常渲染 11 格。
- 第 4–5 步：**用页面表单真建一条结构边** → 脊上 **03 关系 127 → 128**，同刻其余格不动 ⇒ **UI 侧计数也现算**。
- 第 6 步：点脊上 07 格 → URL 变 `/admin/ontology-relations#onto-constraint`，**锚点小节可见 = true** ⇒ 锚点生效。

---

## 真浏览器抓出的一个**我自己的 bug**（已修）

走查第 3 步截到一屏：规则 / 数据 / 场景 / 发布四格明明各有 `30`、`89/100`、`63`、`v1`，
**在读端回来之前全被涂成「待建 todo」**。病因在我写的 `computeSpine`：
`ready === undefined` 落进 `ready ? "done" : "todo"` 的 else 支。

> **形态**：「我用『我没读到』当作『它不存在』的证据。」——**正是本组件文件头注在防的那一条，我自己先犯了。**

**已修**：新增第五态 `unknown`（虚点边框 + 半透计数），`unknown` **不参与 `now`、不落 `todo`**；
`now` 自报也不许覆盖 `unknown`（否则数字还没到就先断言「你在这一步」）。

---

## 诚实位 · 分母不干净（收编方需知）

`listTypes()` 按 `status === "ACTIVE"` 过滤，而**全仓没有任何路径把 `status` 写成 `RETIRED`**；
类型下线只写进 `deprecation` 那一格 ⇒ 结构上「已下线的类型仍会进列表」。
**今日实测**：100 个类型**顶层 status 全 ACTIVE、带 `deprecation` 标记的 0 个**
⇒ **今天这个分母在事实上是干净的**，但结构上脆。已在脊的图例里挂诚实位说明。
（另一张单 `claude/handoff-wo-onto-wire4` 正在修这条，本分支已 merge 其当前 tip。）

⚠ 另据收编方实测：`GET /a/v1/boundary/impact?node=X` 的 `node` 参数是假的（带不带参回包逐字节相同）
—— **本单未使用该端点**，脊上没有任何一格依赖它。

---

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `apps/frontend-shell/src/views/admin/onto-spine/spineModel.ts` | **新建**。11 步定义 + 完成度现算（纯函数，无 React 无网络） |
| `apps/frontend-shell/src/views/admin/onto-spine/OntoSpine.tsx` | **新建**。绑 9 个**既有** fetcher，queryKey 与既有页面对齐 |
| `apps/frontend-shell/src/views/admin/onto-spine/OntoSpine.module.css` | **新建**。五态样式，颜色全走 `tokens.css :root` 已定义令牌 |
| `pages/admin/OntologyRelationsPage.tsx` | 挂脊 + **四个锚点** `#onto-structural/-causal/-constraint/-publish` |
| `pages/admin/{DomainsPage,ObjectTypesBrowserPage,RulesPage,SyntheticPage,SolversPage,ModelingPage}.tsx` | 各加一行挂载（只加入口，零重写） |

**零新增 API**（9 个 fetcher 全是既有的）· **零新增门/棘轮/基线 JSON**（守冻结令）· **未碰** `views/sim/**`、边界册治理页、`apps/datacore/src/{ontology*,domain.ts,units.ts}` 与种子。

**未跑全量 gate，原因：全机 CPU 争抢（实测 7 个并发 vitest、load 18–71），由收编方统一验。**
本单已跑：`pnpm --filter frontend-shell typecheck` **绿**（3 次，最后一次在 `unknown` 态修复后启动，因 load 过高被移入后台，结果未及回收）。
