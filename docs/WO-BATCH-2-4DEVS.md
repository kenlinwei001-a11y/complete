# WO 第二批 · 四张单交接（⑦–⑬ + 新查出的一条）

> **给派单人**：每张单发给一个 dev。发之前把 **§0 通用前置**（在 `docs/WO-BACKLOG-2026-08-11.md`）
> 的路径告诉他 —— 提示词里已经写了让他自己去读，你不用复制。
>
> **置信度标记**：✅ 实测（有人亲手跑出来过，附证据） · ⚠️ 未复验（可能是错的，dev 第一步是取证不是动手）

---

## 画像与并发（4 核机的真约束）

| 单 | 画像 | 约束 |
|---|---|---|
| WO-1 前端接线 | 中 | 可与 3/4 并行 |
| **WO-2 引擎** | **重** | **同时只许 1 个 datacore vitest —— 这是唯一的重画像单** |
| WO-3 门与本体 | 轻 | 不设限 |
| WO-4 前端信息层 | 中（⑩ 待定，见单内） | ⑩ 若实测是重画像，须与 WO-2 串行 |

开工前后都跑：`bash scripts/dispatch-deficit.sh <待派数>`
（RC=0 均衡 / 1 失衡 / 2 工具自己坏了 —— 不许据 RC=2 说「调度正常」）

---

## WO-1 · 前端接上「后端已下发但零调用方」的两处（中画像）

**为什么这张排第一**：它闭的是**仓主原始需求的后半截**。

### 件一 🔴 databuilder pipeline 的配置面（✅ 实测·今天新查出）

`check-backend-frontend-seam` 当场抓到，棘轮 **175 → 180，新增 5 条**，五条全是同一批：

```
GET    /a/v1/databuilder/pipelines                 apps/datacore/src/app.ts:4326
GET    /a/v1/databuilder/pipelines/*               apps/datacore/src/app.ts:4332
PUT    /a/v1/databuilder/pipelines/*               apps/datacore/src/app.ts:4339
DELETE /a/v1/databuilder/pipelines/*               apps/datacore/src/app.ts:4347
POST   /a/v1/databuilder/workflow-runs/*/approve   apps/datacore/src/app.ts:4354
```

**这是「接了线接错地方」以外的第四种形态：后端整条做完，前端一个调用方都没有。**
pipeline 能跑，但**人没有任何界面去配置它** —— 而仓主的原话是
「配置一个 data builder 的低代码 pipeline，**配置每个节点的 SOP**」。功能只做了一半。

三个 kind：`story_build` / `intake` / `intake_import`。
`POST .../approve` 用的是契约里本来就有、此前**零生产者**的 `PAUSED` 状态（节点 SOP 的人工放行）。

**要做**：前端接上这五条，做出能真配置的界面。
- 至少：列出三个 kind 的 pipeline → 看每个节点的 SOP（干什么 / 失败怎么办 / 要不要人工放行）→ 改 → 存
- `approve` 要有真入口（`PAUSED` 状态的运行等在那里，没人能放行 = 死锁）

**验收（缺一不可）**：
1. `node scripts/check-backend-frontend-seam.mjs` RC=0 —— 那 5 条从棘轮里消失（**降回 175**）
2. 一条**驱动接缝**的测试：在界面上改 pipeline ⇒ `/a/v1/databuilder/intake` 的**实际处理行为跟着变**。
   ⛔ 「界面能渲染」不算，「CRUD 能存能取」也不算 —— 那都只测了一半

### 件二 · 求解器 scope 诚实位的前端消费（⚠️ 未复验）

分支 `claude/handoff-wo-solver-scope-fe` 上已有 4 个提交、工作区干净，但**没有交回报告**。

⚠️ **派单人的账在这条上自相矛盾**：我原来记「三个求解器的 scope 诚实位后端已下发、前端零消费方」，
但另一条欠账记的是「20 卡里仅 3+1 真按实参重算」——**两个数对不上**，说明至少有一处记错。
**别信「三个」这个数字。**

**第一步是取证**：读那 4 个提交做了什么，再决定还缺什么。

背景：求解器被问某个局部范围（某基地/某业务线/某客户）时，若它其实没按这个实参重算，
会在响应里带一个诚实位。后端下发了，前端没人读 ⇒ **用户屏上看到的是一个"看起来像局部答案"的全域数字**。

**判据**：后端**带**诚实位 ⇒ 屏上出现那句话；**不带** ⇒ 不出现。**两个方向都要咬。**

### 范围边界

`apps/frontend-shell/src/**`（含 `api/endpoints.ts`）· `apps/frontend-shell/test/**`。
`packages/contracts` **只读不改**（契约后端已定，前端不得重定义 —— contracts-only-shared）。
⛔ 不碰 `apps/datacore/**`、`apps/agentcore/**`、`scripts/**`。
⛔ 不碰 `apps/frontend-shell/src/views/sim/**`（WO-4 在那一带）。

### 主题合规

新增颜色必须走 `tokens.css` **真**令牌。写 `var(--text)` 而真名是 `--txt` 时，`var()` 替换失败
⇒ `fill`/`color` 是**可继承**属性 ⇒ 回落 `inherit` ⇒ 一路继承到根 = **纯黑**（控制台不吭声、测试全绿、屏上全黑）。
收工必跑 `node scripts/check-css-token-defined.mjs` RC=0。
浮层不许硬编码深色渐变（实测 6 处在冷蓝/暖砂下对比度 1.0–1.1:1，含登录页），用 `.popover-surface`。

---

## WO-2 · datacore 引擎两件（**重画像 · 唯一**）

### 件一 · `changeoverMin` 三处键名写错（✅ 实测）

- 真名是 **`minutes`**（`apps/datacore/src/synthetic/battery-extended.ts:152`）
- 三个写错的点：
  - `packages/contracts/src/capacity-factors.ts:71`
  - `apps/datacore/src/solvers/lever-meta.ts:29`
  - `apps/datacore/src/solvers/service.ts:366`
- ⚠️ **失效机制不是 `?? 0` 兜底算 0**（派单人原来的假设，**已被 dev 实测推翻**）。
  真机制是 `apps/datacore/src/solvers/service.ts:903` 的 `typeof o.props[b.prop] === "number"` **过滤**
  ⇒ 对象全被剔掉 ⇒ 杠杆**恒不出现**。两种失效方式修法不同。
- 🔴 **改名单独不足以复活**：`apps/datacore/src/solvers/capacity.ts` 全文 **0 次** `ChangeoverMatrix`，
  `patchCapacityContext` 的 switch **不认它** ⇒ override 被**静默丢弃**。

🔴 **别顺手改这个**：`Order.changeoverMin`（规则 C22）**没有写错** —— 那是**求解器注入命名空间**，
不是对象类型属性，`apps/datacore/src/solvers/chain-impediment.ts:136` 已诚实标注。
`Type.field` 在本仓是**四路同名词**（对象类型属性 / 仿真状态变量 / 规则注入命名空间 / 求解器注入命名空间），
动手前先确认你面对的是哪一路。

**判据**：⛔「字段名对上了」不算修好。必须**杠杆真的出现，且拨动它真的改变推演结果**。
接缝测试：改这个值 ⇒ 推演输出跟着变（贴数值差异）。
变异反证两条：还原改名 ⇒ 杠杆消失即红；**摘掉 `patchCapacityContext` 新分支 ⇒ override 被丢弃即红**
（后者最关键，证明你没只修上半截）。

顺带：`lever-binding-drift.test.ts` 的棘轮注释漏了最上游这一环，补上。

### 件二 · checkpoints 路由缺口 + 它会引爆的哑弹（✅ 实测·**两件必须一个人一起做**）

**半边 A**：`listCheckpoints` 三处实现俱在（`repo.ts` 接口 / `memory.ts` / `pg.ts`），
但 24 条 `/a/v1/sim/*` 路由里**没有 `GET .../checkpoints`**。病根在 route 层，不在前端。

**半边 B**：`apps/frontend-shell/src/store/eventInvalidation.ts:93` 的 `SIM_EVENT_GAPS` 里有一句**中文散文**：
「解法：开 GET /a/v1/sim/sessions/:id/checkpoints → 前端加 checkpoints useQuery」。
`check-backend-frontend-seam` 的路由抽取器从**字符串字面量**里切 URL，会把这句散文读成「前端在调这条路由」。

今天遮蔽半径 = **0**（后端还没开），**但这是一把上了膛没击发的枪**：
谁哪天真开了那条路由，门**第一天**就会认为前端已经在调它 ⇒ 真缺口**出生即豁免**。

**所以两件必须一起做**：开路由的那一刻就得处理那句散文。
拆两个人做，第二个人会看到一道绿门和一个不存在的缺口。

### 范围边界

`apps/datacore/src/**` · `packages/contracts/src/capacity-factors.ts` · `apps/datacore/test/**` ·
`apps/frontend-shell/src/store/eventInvalidation.ts`（只为件二那句散文）。
⛔ 不碰前端其他文件（WO-1/WO-4 在那）。

### 并发红线

**datacore vitest 同时只许 1 个。** 你是这一批唯一的重画像单。
开工前跑 `bash scripts/dispatch-deficit.sh` 确认没别人在跑。⛔ 禁止 `pnpm -r test` / `gate.sh`。

---

## WO-3 · 门与本体两件（轻画像）

### 件一 🔴 本体门的发射端抽取器只认字符串字面量（✅ 实测）

`scripts/check-system-ontology.mjs` 抽取发射端的正则形如 `outbox\.emit\(…,\s*"<字面量>"`。
**事件名来自变量或常量的 emit 对它完全不可见** —— 既不计入「真 emit N 个」，
也永远撞不上「§4 未登记」的棘轮。

**实测证据**：dev 新增 `rule.scope_unresolved`（常量引用）后，该数字**纹丝不动停在 22**。

已知盲区至少三条：`rule.alert` / `calibration.required`（事件名是三元表达式算出的变量）/ `rule.scope_unresolved`。
**这三条是人工登记进 §4 的，不是门逼出来的。**

形态（该门自己注释里就记着的病的**第三次**）：
**「我用『字面量 emit 的条数』当作『真发事件数』的证据，而前者并不度量后者。」**

**要做**：让抽取器认得非字面量事件名 —— 至少：同文件内 `const X = "..."` 求值 + 引用追踪 ·
常量表/映射取值（`EVT.RULE_ALERT` 这类）· 三元两支都是字面量的情形。

⛔ **判不出来的必须显式报「无法静态判定」并计入单独的桶，不许当作「没有 emit」静默略过**
—— 那正是本单要治的病换个形式复发。

**验收**：
- 「真 emit N 个」这个数会**跳**（从 22 往上）。**跳幅本身就是核心证据**，贴前后数字 + 新认出的事件清单，
  逐条标「真事件 / 误判」
- 若因新认出的事件未登记而红，那是**正确的红** —— 登记进 `docs/SYSTEM-ONTOLOGY.md` §4
- 双向变异：摘掉常量追踪 ⇒ 掉回 22；喂一个假的常量 emit ⇒ 必须被认出来
- 金丝雀与主逻辑**共用同一份实现**，钉死上面三条已知盲区；诚实位**现算不写死**

**范围**：`scripts/check-system-ontology.mjs` + 基线 + `docs/SYSTEM-ONTOLOGY.md` §4。
⛔ 不碰 `apps/**` 任何生产代码。发现某个 emit 本身有问题 ⇒ **停手写报告**。

### 件二 · 抢救分支定性（⚠️ 待查）

`claude/rescue-r13-drillfield-0811` @ `f9b0c0ec` —— 10 个**从没推过**的容器重启自动快照。
远端 `claude/handoff-wo-r13-drillfield` 已分叉。

✅ 实测：本地独有 3 个文件与远端**内容不同**：
`apps/datacore/src/solvers/service.ts` · `apps/datacore/test/prov-drillfield-truth.test.ts` · `docs/SYSTEM-ONTOLOGY.md`

**要回答一个问题**：这 10 个提交里有没有远端丢失了的东西？
对应欠账「R13 溯源口径错标：`drillField:"value"` 回的却是 `orderVal`，差 1e4」。

⛔ 不许强推覆盖任何分支。结论二选一（「有价值 ⇒ 择出来单独成单」/「已被远端收编 ⇒ 可删」），
两种都要给**逐文件的 blob 级证据** —— 不许只看提交图。
⚠️ 判据是内容不是哈希：cherry-pick 会改哈希、`merge-base` 恒 false，但**内容可能在**。

---

## WO-4 · 前端信息层两件（中画像）

### 件一 · 第一层信息降层 top3（✅ 实测）

分支 `claude/handoff-wo-ui-declutter-top3` 上有前人产出 + 一个 `wip:…未完成·未验证` 的现场快照。
🔴 **不许因为「已经改了」就当结论成立** —— 先 `git show --stat HEAD` 审查，再补验证。

普查实测（`docs/AUDIT-ui-first-layer-density.md`，95 个页面文件）：

| 文件 | 第一层块 | 口径公式 | 长说明 | 字号级 | 可折叠 | 原生 title |
|---|---|---|---|---|---|---|
| `views/RiskBoardView.tsx` | **227**（全仓最高） | 4 | 17 | **14** | 27 | 6 |
| `pages/admin/DataBuilderPage.tsx` | 189 | 0 | 21 | 7 | 29 | 16 |
| `views/DashboardView.tsx` | 137 | 0 | 6 | 10 | 5 | 4 |

全仓要害：第一层 4260 块、可折叠仅 **11.3%** ⇒ 近九成一层到底。
最刺眼：`RiskBoardView.tsx:1355` 第一层**直接渲染口径公式**
`为什么推荐？综合评分 = 见效 × 紧迫度 ÷（投入档 × 周期）——比对如下（评分降序）`。

**🔴 唯一红线：允许降到浮层，绝不允许删除。** 门里 D4 守恒判据两向都红：
拆浮层搬回第一层 ⇒ `【D4 守恒·浮层被拆】`；**纯删除** ⇒ `【D4 守恒·内容变少】`。
⚠️ 后者尤其记住：**只看第一层计数，删除恰好"看起来像变好了"**。

**原生 `title=` 不算浮层**（不可控样式 · 移动端不可达 · 本仓出过 SVG `<title>` 遮挡事故）。

**验收**：
1. `node scripts/check-ui-first-layer.mjs` RC=0，且三个文件**第一层降 + 第二层升**（两个同时成立才是降层）
2. `--selftest` RC=0 · `node scripts/check-css-token-defined.mjs` RC=0
3. `--update` 更新棘轮基线，贴基线 diff 原文
4. 咬这三页的既有测试仍绿 —— 先 `grep -rl "RiskBoardView\|DataBuilderPage\|DashboardView" apps/frontend-shell/test`
   把它们**都**找出来，⛔ 别只跑一个文件就宣布「测试全绿」

### 件二 · A6 竞争规则续做（⚠️ **未复验·派单人手上没有完整信息**）

分支 `claude/handoff-wo-a6-contention`，被中途叫停，最后一个提交是现场快照
（当时正在写引擎侧 `basis` 消费方与测试）。

⚠️ **派单人对这条的任何描述都不可信** —— 没拿到过完整交回报告。
**第一步：** `git log --oneline origin/claude/inspiring-gates-aqczjg..HEAD` +
`git diff --stat` 读懂它做到哪，**再决定继续还是重来**，并把判断写进报告。

⚠️ **先定画像**：它动过 `packages/contracts/src/chain-sim.ts`，很可能要跑 datacore vitest。
若确认是**重画像**，必须与 **WO-2 串行** —— 先跑 `bash scripts/dispatch-deficit.sh` 确认没人在跑 datacore。

### 范围边界

件一：`views/RiskBoardView.tsx` · `pages/admin/DataBuilderPage.tsx` · `views/DashboardView.tsx`
及各自 `.module.css`。
件二：以该分支已触及的文件为界，先读再定。
⛔ **绝对不碰 `apps/frontend-shell/src/views/sim/**`**（沙盘已并入 canonical，别再动）。
⛔ 不碰 `apps/frontend-shell/src/api/endpoints.ts`（WO-1 在改）。
