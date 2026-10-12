# GOALMAP 7 条静态推断 · 实测复核

## 报告头（三个自证数）

| 项 | 值 |
|---|---|
| `git rev-parse --short HEAD`（开工时） | **`778cc589`** ⇒ 落后，已 detach |
| `git merge-base --is-ancestor HEAD fbfa88f1` | RC=0 ⇒ **HEAD 是 PIN 的祖先 = 落后** |
| `git rev-parse --short HEAD`（detach 后） | **`fbfa88f1`** |
| 树龄探针 `wc -l apps/datacore/src/synthetic/battery.ts` | detach 前 **1249** → detach 后 **7053** ✅ 移过去了 |

**取证环境**：真 datacore（`SEED_DEMO=1` 内存态，:4001，pid 1204）+ 真 agentcore（:4002）+ 真 vite dev（:5173，**未设 `VITE_MOCK`**）+ 真 Chromium（CDP :9334）。
**端口**：先用 `net.createServer().listen()` **真 bind** 探测（本机无 `ss`/`netstat`；金丝雀 `port 0` 报 free ⇒ 探针有效），4001/4002/5173 全空 ⇒ 用默认端口，**零配置改动**。
**自证连的是自己那一个**：`ps` 确认 4001 由本会话 pid 1204 提供；浏览器登录后左导航 51 项、视图 33 项与本树 workspace 回包一致。
**`docs/evidence/COO-GOALMAP-20260911.md` 不在 `fbfa88f1` 上**（`ls` 报 No such file）⇒ 按派单要求跳过，全部结论只来自本次实测。

---

## 结论总表

| # | 验的是什么 | 期望 | 实测 | 结论 | 证据 |
|---|---|---|---|---|---|
| **①a** | `GET /a/v1/me/workspace` 里有没有 `sopConfig` | 无 | 顶层键 = `["tenant","user","scenarioPackages","views","theme","navigation","features","configVersion"]`；全文 `grep -c sopConfig` = **0**。金丝雀：`navigation`(51 项)/`views`(33 项)/`theme` 均在 | **原判定成立** —— 后端不下发 `sopConfig` | `glv-workspace.json`（26,526 B，HTTP 200） |
| **①b** | S&OP ② 需求评审屏上那三行 | 69.0 / 45.0 / 13.6，合计 127.6 | **乘用车 69 · 储能 45 · 商用车 13.6，合计 127.6** ✅（滚动 P50 列 71/49/12 合计 132.0，上月实际 66.8/41.9/12.9 合计 121.6） | **原判定成立** —— 恒走前端常量。**未见 24.7–26.6 一档** | `glv-07-sop-step2.png`；逐格 `[input 69]/[input 45]/[input 13.6]` |
| **①c** | 这三行是不是真的没走网络 | —（加测） | 进入 ② 步时 **`Network.requestWillBeSent` 捕获到 0 条请求** | **加强坐实**：不是"后端给了默认值"，是**压根没问后端** | CDP Network 域全程录制 |
| **②** | 24 个求解器系数是否 100% 走内联兜底 | PUBLISHED 规则里不含任何 `*_coeffs` | 30 条 PUBLISHED 规则，key 全是 `C01–C35` 族；`*_coeffs` **0 条**；原始回包 `includes("_coeffs")` = false。金丝雀 C01/C06/C27 **全部命中** | **原判定成立**（但**数字要订正**：是 **30 条**不是 31 条） | `glv-rules.json`（9,086 B）；`?status=PUBLISHED` 与不带 status 回包**字节数相同** |
| **③** | 改多目标权重会不会真改变解 | 两次 `objectiveValues.delay` 必须不同 | **原判定拆成两半：「滑杆是装饰品」被推翻（引擎真重解、屏上真变）；「头条读数随权重变」不成立（头条四个数一个没动）**。详见专节 | `glv-w-A/B/CA.json`；`glv-screen-delay10.txt` / `glv-screen-delay0.txt`；`glv-09-slider-delay{10,0}.png` |
| **④** | 驾驶舱营收卡真值与标签 | 12 卡；营收 415.6；AOP 601.5 且 caption 含「≠ 订单簿已签金额加总」；无 DSO/应收/回款/准交率 | 上条 strip **恰 12 卡**；营收卡 **415.60亿 / 目标 700亿**（不是 700）；AOP 基准营收 **601.50亿**，caption 逐字含「≠ 订单簿已签金额加总」；`DSO`/`应收`/`准交率`/`准时交付`/`On-Time`/`OTD` 全 false。金丝雀 `营收`/`AOP 基准营收` = true | **原判定成立**（**一处要订正**：`回款` = **true**，见下） | `glv-04-dashboard.png`；`metric-strip` 11 子 = 1 健康度 + 10 KPI |
| **⑤** | 订单状态在新 demo 里动不动 | 10:20:70，两次完全相同 | T1 12:25:00Z / T2 12:37:57Z（**同一 pid 1204**，etime 15:18 > 间隔）：**OPEN 50 (10.00%) : IN_PRODUCTION 100 (20.00%) : COMPLETED 350 (70.00%)**，两次 **整包回包 `cmp` 字节级相同**，id→status SHA256 同为 `9d2aac47…`。`FULFILLED` **0 条** | **原判定成立** —— 状态永远停在播种比例；枚举外值**未被触发到** | `glv-orders-T1.json` / `glv-orders-T2.json`（各 401,144 B） |
| **⑥** | 一次求解多久 + 预算分支进没进过 | 外部 wall clock；预算分支"从未进入" | **见下方专节** | `glv-budget-1401{1,2,3}.json` |
| **⑦** | 决策台账里有没有实例 | 无 list 路由；草稿 origin 无决策 id | 无 list 路由**已坐实**（见下专节）；台账在未经人手的 demo 里 **0 条** | `glv-decision*.mjs` 输出 |

---

## ③ 多目标权重对照实验（**这条的原判定必须拆成两半**）

**先修一个派单里的坐标错误**：求解器 key 是 **`portfolio`**，不是 `portfolio_optimize`（后者 404 `solver portfolio_optimize not found`）。`portfolio_optimize_coeffs` 是**规则 key**，与求解器 key 不同名。

**确定性金丝雀**（缺了它整个实验无效）：A 与 C（同参数重跑）`data` 的 SHA256 **完全相同** ⇒ 求解器确定性成立，A/B 的任何差异都可归因于权重。

### 四个数（按派单要求给全）

| 读数位置 | A（delay 权重 **10**） | B（delay 权重 **0**） | 变了吗 |
|---|---|---|---|
| **`data.objectiveValues.delay`**（**顶层/头条**） | **2,220,218** | **2,220,218** | ❌ **逐字节相同** |
| **`data.objectiveValues.cost`**（**顶层/头条**） | **4,943,147** | **4,943,147** | ❌ **逐字节相同** |
| `data.methodScenario.objectiveValues.delay` | **1,560,986** | **2,742,306** | ✅ 差 **43.1%** |
| `data.methodScenario.objectiveValues.cost` | **2,259,688.6** | **2,136,103.6** | ✅ 差 **5.8%** |

**全响应逐字段比对：整个回包里只有 `methodScenario` 一个字段变。**
`scenarios[]`（max_ontime / min_cost 两方案）、`allocation`（176 行）、`schedule`、`capacityLedger`、`displaced`、`cost`、`objectiveValues` —— **全部 SHA256 相同**。
`methodScenario.allocation`（45 行）变了；`data.allocation`（176 行）没变。

### 屏上实拖（不是从回包推的 —— 真拖滑杆 + 点「联合求解」）

路径：`接单组合优选`（`/v/global-sim`）→ 滑杆 `global-sim-weight-delay`（min 0 / max 10）→ 按钮「联合求解」。
把 **整个视图 4 个步骤页的文本全量抓下来**，对 delay=10 与 delay=0 两臂做**内容级多重集差分**：

| 变了的文本 | delay=10 | delay=0 |
|---|---|---|
| 旋钮自身读数 | `10.0` | `0.0` |
| 方法解 · **按期(单)** | **33** | **26** |
| 方法解 · **代价** | **2,259,689** | **2,136,104** |
| 「该维无差异」提示 | 出现 | 不出现 |

**全视图只有这 4 类、共 7 行文本发生变化，其余逐字相同。**
而头条那一行的四个值 —— `4,943,147`(代价) / `2,220,218`(延误) / `108.8`(换型) / `5,809,454`(成品库存) —— **在两臂的截屏文本里同时存在**，即**一个数都没动**。
**金丝雀**：把 delay=10 这一臂**重抓一遍**，与第一次相差 **0 行** ⇒ 抓取稳定、差异不是噪声。
屏上 `2,259,689` / `2,136,104` 与接口 `2,259,688.6` / `2,136,103.6` 四舍五入后**逐位对上** ⇒ 屏上读的就是这条回包。

### 结论（两半，方向相反）

- **「滑杆是装饰品」——被推翻。** 引擎**真的按权重重解**了，方向符合帕累托常识：delay 权重 0→10，delay **降 43%**、cost **升 5.8%**；屏上也真变（33↔26、2,259,689↔2,136,104）。装饰品不会产生这种有向权衡。
- **但「改权重 → 屏上**头条**读数会变」——不成立。** 头条 KPI 行读 `primaryScen.objectiveValues`（`GlobalSimView.tsx:703-705`），对权重**完全不敏感**（已由上表实测坐实）；只有 `data-testid="global-sim-methodscenario"` 那条副读数行（`:1164-1170`）会动。
- **形态**：这不是「没接线」也不是「接了线没数据」，是**接了线、真重解了、但结果只落在副通道**——用户先看见的那排大字与旋钮无关。属铁律 1.5 那个「第四态：接对了、跑通了、但读数不对应」。
- ⇒ 「多目标优化=已有」**不必降级**；该降级的是「**权重驱动屏上主读数**」这个说法。

---

## ⑥ 求解耗时 + 预算分支

**量法自证**：`sop_reschedule` 缺参时走 400 错误路，p50 = **14.8ms** —— 这就是本机 HTTP+框架地板。真求解 21–25ms ⇒ 时钟**有鉴别力**，不是在量 HTTP 开销。

| 求解器 | p50 | p95 | max | min | 样本 | HTTP |
|---|---|---|---|---|---|---|
| `portfolio` | **25.1ms** | 27.6ms | 27.6ms | 23.4ms | 7（+1 预热丢弃） | 200 |
| `supply_demand_gap_attribution` | **21.4ms** | 25.4ms | 25.4ms | 21.0ms | 7 | 200 |
| `sop_reschedule`（`targetOrderId=SO-3391, advanceDays=10`） | **17.3ms** | 19.5ms | 19.5ms | 17.0ms | 7 | 200 |

> ⚠ `sop_reschedule` **必须带 `targetOrderId`**，空参 400 `VALIDATION_ERROR`。派单未给此参数。

### `SOLVER_INCUMBENT_BUDGET_MS` 三臂对照（每臂独立端口、独立进程，**不动 4001 那个**）

| 臂 | 预算 | `incumbent` | `solvedScenarios` | 分支进没进 |
|---|---|---|---|---|
| 1 | **未设**（生产缺省） | 字段**不存在** | 缺省不下发 | ❌ 未进入 |
| 2 | **2000ms**（派单建议值） | 字段**不存在** | 缺省不下发 | ❌ **仍未进入** |
| 3 | **1ms**（可达性金丝雀） | **`true`** | `["max_ontime"]`，planned `["max_ontime","min_cost"]`，summary 前缀 `【非最优·可行解 incumbent】` | ✅ **进入且行为正确** |

**结论**：「那条预算分支从未进入」——**在生产缺省与派单建议的 2000ms 下都成立**，因为一次全量求解只要 25–70ms，**比 2000ms 预算低 30–80 倍**，永远到不了截止点。
但它**不是死代码**：第 3 臂证明只要预算真的比求解时间小，分支就正确进入并诚实自述。
⇒ 该判定**成立，但理由要改写**：不是"实现没接线"，是"**阈值比被测量永远大两个数量级**"。这两种修法完全不同。

---

## ⑦ 决策台账

**关键判据是两条 404 的 message 不同**（这就是"路由不存在"与"路由存在但查无此物"的分辨器）：

| 请求 | HTTP | message |
|---|---|---|
| `GET /a/v1/decisions/does-not-exist-123` | 404 | **`decision not found`** ⇒ 路由**存在**，落到 handler 了 |
| `GET /a/v1/decisions` | 404 | **`route not found`** ⇒ 路由**不存在** |
| `GET /a/v1/decisions?page=1&pageSize=50` | 404 | `route not found` |
| 金丝雀 `GET /a/v1/rules` | 200 | — |

**「无 list 路由」被硬坐实**：我在一次性实例上**真的建出一条 Decision**（`POST /a/v1/decisions {metricKey:"material_cov", chosenOptionIds:["opt-backup-cert"]}` → **201**，`dec_1ue985p`，`PROPOSED`），此时
- `GET /a/v1/decisions/dec_1ue985p` → **200**（知道 id 就查得到）
- `GET /a/v1/decisions` → **仍然 404 `route not found`**

⇒ 404 **不是"没数据"造成的假象**，是真的没有这条路由。

**台账在未经人手的 demo 里是 0 条**：
- `GET /a/v1/action-drafts` → `[]`（2 字节）
- `GET /a/v1/decision-outcome-stats` → `[]`
- 写 `repos.decisions` 的只有 `kernel.ts:100/195/232`，而 `decisionKernel.*` 的**全部 src 调用方**只有 `app.ts` 的 6 个 HTTP handler（`:6705/6711/6716/6723/6727/6769`）—— **没有任何种子/后台任务路径**（已按铁律 0.5 追到调用点，不是只 grep 符号）

⇒ **「Decision 0 条，这个台账从没被真正用过」成立**，而不是"有但查不出来"。对排期的含义：要的是**让它被用起来 + 补 list 路由**，不是"修一个查询 bug"。

**⚠ 顺带发现（比原判定更要紧）**：`POST /decisions/:id/commit` → **200，status `COMMITTED`，但 `actionDraftIds: []`，`action-drafts` 仍是 0 条** —— 决策定了却**一张派工单都没派出去**。关联链路是**单向**的（`Decision.actionDraftIds` 指向草稿），草稿侧没有反向字段。

---

## 需要订正的三处（我实测与派单原文不一致）

1. **② 的条数**：派单写"种子规则表 31 条 key"，**实测 PUBLISHED 30 条**（C01–C35 之间有缺号：无 C07/C14/C17/C19/C20）。结论方向不变，数字要改。
2. **④ 的「回款」**：派单要求"找不到任何 DSO / 应收 / 回款 / 准交率卡"。**`DSO`/`应收`/`准交率` 确实全无**，但 **`回款` = true** —— 它出现在「回采校准 · 逐级反馈链（实际 → 月度 → 季度 → 年度）」下的说明句 `实际产出 / 销量 / 到货 / 回款` 里，**是一句流程说明文字，不是 KPI 卡**。判定实质成立，但"一个字都搜不到"的说法不准。
3. **③ 的求解器 key**：`portfolio_optimize` 不存在，正确是 `portfolio`（注册表 63 个 key 已全量列出）。

---

## 《未能验证的》

1. **ActionDraft 的 `origin` 里有没有决策 id —— 没能在活数据上验。**
   卡在哪：`commit` 虽然返回 200/`COMMITTED`，但**一张 ActionDraft 都没生成**（`actionDraftIds: []`），所以**没有活草稿可供检查 `origin` 形状**。
   我只能说契约里 `ActionDraftSchema.origin` = `{taskId?, agentId?, userId}`（`packages/contracts/src/actions.ts:47-51`）**没有决策字段**——但这是**读契约，不是实测**，按派单纪律**不当证据用**。
   下次怎么绕：先查明 commit 为什么"诚实不派"（`causal-graph.ts:794` 提到 `dryRunMitigation 跑不通` 这一态），把它跑通拿到真草稿；或直接走 S2 审批链**另外**造一张 ActionDraft 来看 `origin`。

2. **`supply_demand_gap_attribution` / `sop_reschedule` 的预算分支未单独验。**
   第 3 臂只对 `portfolio` 做了可达性验证（`incumbentDeadlineAt` 在 `portfolio.ts:561` 是全仓唯一消费点）。另两个求解器是否也受该预算约束，**没测**。

3. **⑤ 只覆盖了 12 分 57 秒的窗口。**
   期间无人操作。若自动推进的周期 > 13 分钟（例如按小时或按模拟时钟 tick），本次观测**看不见**。判定"永远停在播种比例"在**本窗口内**成立，跨更长窗口未验。

4. **④ 的 12 卡是"上条 strip"的计数。**
   屏上其实有**两条** strip：上条 12 卡（总产能/平均利用率/计划达成率/在手订单/需求P50/毛利总额/物料现货缺口/可供给/收入达成率/利用率瓶颈/AOP基准营收/现金垫C18），下条 `metric-strip` = 1 健康度 + **10** 个 `metric-kpi-*`。"12 个 KPI 卡"对应的是**上条**；营收 415.6 那张在**下条**。派单没区分，我按两条分别给数。

---

## 《我可能错在哪》（≤3 条）

1. **③ 的屏上差分是"文本级"的，不是"像素级"的。** 我抓的是 `main.innerText` 并走遍 4 个步骤页，结论"只有 7 行变"对**文本**成立。若某个读数是画在 canvas / SVG 里、或只在 hover 浮层里出现，`innerText` 抓不到，它变了我也看不见。截图已存（`glv-09-slider-delay10.png` / `glv-09-slider-delay0.png`），但我**没有逐像素比对**。

2. **⑤ 的"同一进程"我用 `etime` 证明，但没证明"seed 没被别的请求改写"。** 期间我自己调了求解器、建过 S&OP 版本。若某个调用会写回 `Order.status`，两次相同也可能是"改了又改回来"。字节级相同让这个可能性很低，但我没有独立证据排除它。

3. **② 我只查了 `/a/v1/rules` 这一个面。** 若存在运行期才播种、且不经该端点暴露的系数来源（例如求解器启动时从别处读一张表），我的"零 `*_coeffs`"只证明了"**规则表里没有**"，**不等于"系数一定走内联兜底"**。要真正坐实，得在 `service.ts:3451` 那行 `pubRules.find(...)` 上打点看它返回 undefined —— 那要改源码，本单不许。
