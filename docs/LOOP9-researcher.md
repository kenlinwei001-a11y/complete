# LOOP9 · 研究者视角 —— 「本体系统能不能被人建起来、维护下去」

> 角色分工：其余四个视角向内看本仓，我向外看这一行。命题不是「能不能用」，是「**建 / 改 / 治理**」。
> 命名纪律：文内一律称 **参考产品 A/B/C** 与 **参考体系 O**，URL 见文末脚注（CLAUDE.md 铁律 0）。
> 本文是**评审报告**，不是 PRD，不提架构变更，故不含《本体引用与影响》章；文中出现的 `R4`、
> `R-UI-4` 两个记号分别摘自**屏上原文**与 CLAUDE.md 铁律 1.5，不是我新造的编号。

**实测环境**（全程真后端 + 真浏览器，⛔ 未用 `VITE_MOCK`）：
`datacore :4911`（`SEED_DEMO=1` 内存模式，播种 4,814 对象 / 32 类型 / 7,204 格）+
`agentcore :4912` + `vite :5311`，Playwright `chromium`，登录 `demo / admin / demo1234`
与 `demo / planner / demo1234`。测量日期 **2026-08-29**。

---

## 一 · 我的核心立场（2 句）

1. **本仓已经把这一行最难的那一半——「治理机制」——真的造出来了**：引用闸、域会签、版本快照、
   边界册影响图，都是可运行的真东西，不是 PPT；**但它把最容易的那一半——「让负责人坐进来」——漏了**。
2. 结果是一套**没有人能操作的治理**：**发起会签这个动作本身会把唯一能操作本体的那块屏打成白屏**
   （实测两个数：0 条待会签 = 23,974 字符可用；1 条待会签 = 66 字符「页面出错了」），
   而被后端点名的会签人 `usr_demo_planner` 在自己账号下**连一扇能签的门都没有**。

---

## 二 · 这一行的人一天是怎么过的（外部一手材料）

我没有去抄「本体产品有哪些功能」的概念清单——上一轮就是那么翻的车。我问的是**人怎么干活**。

### 2.1 日/周/月的节奏（岗位侧一手材料，参考材料 D）
> 日：「Review pipeline health dashboards…」「Investigate and fix data issues: schema mismatches,
> missing identifiers, **unexpected relationship explosion**.」
> 周：「**Run a modeling/ontology review with domain stakeholders and governance partners.**」
> 月/季：「Plan and execute a model evolution cycle: **versioning, deprecations, backfills,
> consumer migration support**.」
>
> 且这一行给这件事**定了 KPI**：「**Ontology/Schema Change Failure Rate — < 5% of releases
> require hotfix/rollback**」「Duplicate Entity Rate < 1–3% for core entities」
> 「Provenance Completeness > 98% for regulated domains」。

**读法**：这一行的日常不是「建模」，是「**改模型而不弄坏下游**」。所以工具的核心不是画图，
是**改之前查谁在用、改之后帮人迁移、改错了能回滚**。

### 2.2 变更怎么进（参考体系 O 的编辑者工作流，参考材料 B）
> 第 1 步就是开工单：「**no change to the ontology should be performed without a good ticket,
> describing the motivation and nature of the intended change**」，并明说这是
> 「**a very important part of the social contract of building an ontology**」。
> 之后：feature branch → QC → PR → CI → **社区复核**（「put a second set of eyes on the pull
> request…you have your work validated by the community you are trying to serve」）→ merge。

### 2.3 弃用怎么做（参考体系 O 的术语稳定性原则 FP-019，参考材料 A）
> 原则本身：「If a proposed change to the definition would substantially change its referents,
> then **a new term with new IRI and definition MUST instead be created**.」
> 弃用动作是**四步强制 + 两个指针**：`owl:deprecated=true` · label 前缀补
> `"obsolete "` · **剥掉全部逻辑公理** · 清理内部引用；并给
> **`term replaced by`（IAO:0100001，精确替代）** 或 **`consider`（部分替代）**。

**读法**：**弃用不是删除，是「留碑 + 立指路牌」**。指路牌（replaced_by / consider）才是让下游能
自己迁移的那个东西。

### 2.4 翻车模式（参考材料 C / E）
> 参考材料 C 直接点名头号病：「**No named owner per entity type, so definitional disagreements
> get resolved by adding optional fields until the model describes the disagreement instead of
> settling it.**」
> 它给的治理清单是四条：「**An owner per entity type with authority to settle definitions**,
> a change process for definitions and operations **with the same discipline as a production
> migration**, access control expressed at entity and property level rather than by table,
> and audit records tied to operations rather than to queries.」
> 还有一条正中本仓要害：「**Read-only scope, where the model informs decisions but never writes
> back, so operators keep the spreadsheet and the platform becomes a second place to look.**」
>
> 参考材料 E 列了本体「腐化」的六种走法，第 6 种叫 **Governance Gap**：
> 「Ontologies built under a data governance initiative get orphaned when the project closes.
> **No owner, no feedback loop.**」第 3 种叫 **Human Cost Kills Momentum**：
> 「Domain experts have finite patience… eventually produces the same outcome: **calendar declines**.」
> 它开的药方一句话：「**assign a named steward for each ontological domain. Establish versioning
> so definitions can be updated, rolled back, and change-managed like code.**」

### 2.5 工具形态（只看交互，不抄概念名，参考材料 F）
> 参考产品 A 的立论是：本体「**to a domain expert will look like code**」，而
> 「**there are no tools available that really address and support everyone involved**」，
> 所以它把编辑器做成可视化的、让**领域专家和业务用户自己改**，不必懂底层表示法。

**读法**：这一行公认的瓶颈**不是引擎，是「懂业务的那个人改不动模型」**。

---

## 三 · 逐条对本仓实测（屏上原文 + API 原文）

被评七面：本体关系 · 本体切片 · 切片库 · 建模与图谱 · 实体合并 · 边界治理 · 图谱体系。

| 这一行的标准做法 | 本仓有没有对应物（实测） | 判定 |
|---|---|---|
| 改之前查谁在用（2.1） | **有，而且很硬**：`下线类型` 走 `POST /a/v1/ontology/types/:key/retire`，被引用即 **409**，并**逐条点名引用处** | ✅ 优于多数同类 |
| 变更要经复核才生效（2.2） | **有**：屏上写「上面的建/停/下线写的是**工作集**，不是已发布真值。真值是 OntologyVersion 快照——经各域 owner 会签后由后端自动固化（全域 APPROVE → publishVersion）。**本页不提供「直接发布」按钮：那条路会绕开会签。**」 | ✅ 设计对 |
| 复核人真能复核 | **没有**：`planner`（后端点名的 `capacity` / `equip` 域 owner）的「建模与图谱」导航**只有「本体图谱」一项**；`/admin/ontology-relations` 只出 244 字符壳；`通知中心` 显示「**暂无通知**」 | ❌ 断 |
| 弃用要留 `replaced_by` 指路牌（2.3） | **没有**：弃用流程区块全文无「替代 / replaced / 后继 / 迁移」任一字样；retire 返回体只有 `{"key":…,"status":"RETIRED"}` | ❌ 缺 |
| 每个域有具名 owner 且屏上可见（2.4） | **半有**：`域管理` 副标题白纸黑字写「域是一等治理单元——对象类型归域、按域分组图谱、**域 owner 会签发布**」，但表头只有 **`域键 / 显示名 / 颜色` 三列，没有 owner 列**；owner 只活在会签 API 的响应里 | ❌ 名存屏亡 |
| 实体合并要有人审的候选队列（参考材料 G） | **架子全对，数据全空**：屏上写「多源同实体 → 匹配产候选 → 并排对照选 golden 合并；合并后检索/切片/聚合只见 golden，**72h 内可还原**」，点「扫描候选」→ `POST 200 /a/v1/objects/merge-scan >> {"candidates":[]}`，4,814 个对象扫出 **0 条** | ◑ 无法观测 |
| 改常数前看影响面 | **本仓最好的一块**：`边界册治理` 给了 semver `1.0.0` + digest `52f540b9`，逐册指纹（`BASE_REGISTRY·13条 524d94ee` / `SEG_REGISTRY·3条 97b2ee60` / `PLAN_GOAL_TARGETS·6条 29af6ad7`），并逐条列「派生消费端」与「下游受影响面」 | ✅ 但见 §5.3 |
| 业务专家自己改得动（2.5） | **没有**：`本体建模` 工作台唯一动作按钮是「AI 建议草案」；`边界册` 屏上直言「**改值＝改代码经 boundary-singlesource 门**」 | ❌ 断 |
| 图谱体系 | 8 条只读视图（`/v/graph-all` … `/v/graph-loop`），无编辑面；`/graph` 是 **404**，正确入口是 `/v/graph` | ◑ 只读 |

---

## 四 · 两个对照实验（每个都给修前修后两个数）

> 判据不是「跑得起来吗」，是「**把 X 改成 X'，Y 必须按可预言的方式变化**」（铁律 1.5）。

### 实验一 · 引用闸是真的（**这条是替本仓说好话，同样要用两个数证明**）

**预言**：被引用的类型不许下线，孤儿类型允许下线。同一个按钮、同一个后端函数，两种输入必须给两种结果。

| X | 动作 | Y（后端原文） | 屏上原文 |
|---|---|---|---|
| `Order`（有引用） | 下线类型 | `POST **409** /a/v1/ontology/types/Order/retire`<br>`{"error":{"code":"INVALID_STATE","message":"type 'Order' 仍被 1 处引用，无法 RETIRE：derivation:order_value@targetType"}}` | `INVALID_STATE` / `type 'Order' 仍被 1 处引用…` / `请求 ID: req_t72qd25m9c55y9bm` |
| `CommodityPriceTrend`（孤儿） | 下线类型 | `POST **200** …/CommodityPriceTrend/retire`<br>`{"key":"CommodityPriceTrend","status":"RETIRED"}` | `CommodityPriceTrend 已下线` |

**结论**：闸是真的，且**报错点名到了具体引用处**（`derivation:order_value@targetType`）——
比 §2.1 那份 JD 要求的「consumer migration support」的前半程做得好。**这是本仓的真本事，不是装饰。**

### 实验二 · 用了会签，本体关系页就废（**同一页面，两个字符数**）

**预言（业务常识，不需要读代码）**：走一次「发起发布会签」，页面应当从「暂无发布会签请求」
变成「有 1 条待会签、列出触及域与签署状态」。

**实测**：

| X | 待会签请求数 | Y = `/admin/ontology-relations` 正文 | 可操作控件 |
|---|---|---|---|
| X | **0** | **23,974** 字符，完整渲染 | `select` **8** 个（来源类型/去向类型/基数/经由结构边/启停/对象类型…） |
| X' | **1** | **66** 字符：`⚠ 页面出错了 / Cannot read properties of undefined (reading 'join') / 刷新` | `select` **0** 个 |

- 那条请求**后端是成功的**：`POST **201** /a/v1/ontology/publish-requests` →
  `{"id":"preq_demo_…","ontologyVersion":2,"status":"PENDING_SIGNOFF","signoffs":[{"domainKey":"capacity","ownerUserId":"usr_demo_planner","decision":null},{"domainKey":"commercial","ownerUserId":"usr_demo_admin","decision":null},…]}`
- **点击当下**屏上仍写「暂无发布会签请求」，同时弹出
  `Cannot read properties of undefined (reading 'length')`；
- **下次进页面**就变成整页错误边界，浏览器自报
  `TypeError: Cannot read properties of undefined (reading 'join')` at
  `OntologyRelationsPage.tsx:1645`（此行号是**浏览器自己打的堆栈**，不是我读源码得来的）。
- 「刷新」按钮**救不回来**——请求还挂在 PENDING，重进照旧 66 字符。
- 清白证明：全流程在**刚播种的干净 datacore** 上重跑，X 与 X' 前后两次加载各一遍，结论稳定复现。

**这一条的严重性**：`R4` 会签是**本页唯一合法的发布路径**（屏上明说不给「直接发布」按钮，
因为那会绕开会签）。也就是说——**唯一合规的那条路，一走就把路本身炸掉。**
这正是「绿测试 ≠ 能用」的第 N 形态：闸、快照、签署名单**每一件单独看都是对的**，
合起来的那一下没人真手点过。

---

## 五 · 清单之外我另找出的问题（要求 ≥3，实得 6）

### 5.1 两个建模者共用一个工作集，而**只有一个人看得见它**
**实测**（两个独立浏览器上下文，都登 `admin`，同租户）：
M1 下线 `DSO` → M1 屏上出现「状态（本次会话写回包） `DSO 已下线`」；
M2 整页重载 → **看不到 `DSO` 已下线，连「写回包」区块都不存在**；
**但 M2 屏上「发起发布会签」按钮是在的**（干净态下这个按钮不出现，说明它由服务端脏态驱动）。

⇒ **改动落在服务端（租户级），而「我这一次要发布什么」的清单只活在发起人的那块屏上。**
M2 完全可以对一份自己屏上拒绝显示的变更集发起会签。
参考材料 C 要求的「change process **with the same discipline as a production migration**」，
第一条就是**改之前能看见 diff**——这里没有 diff，只有一个按钮。

### 5.2 弃用没有指路牌，等于把迁移成本甩给下游
retire 返回 `{"key":…,"status":"RETIRED"}`，弃用区块全文不含「替代/replaced/后继/迁移」。
对照 §2.3：参考体系 O 把 `term replaced by` / `consider` 列为**必给**的两个指针。
本仓的引用闸能挡住「有人在用就别下线」，但**挡不住的那一天**（引用清完了、下线了），
下游只知道东西没了，不知道该改用什么。**闸做完了，指路牌没做。**

### 5.3 唯一有影响图的那块屏，恰好是**改不动**的那块——而且它把源码路径打在用户脸上
`边界册治理` 是全仓最接近 §2.1「consumer migration support」的东西：逐条列「派生消费端」与
「下游受影响面」。但两件事同时成立：
1. 屏上原文「**改值＝改代码经 boundary-singlesource 门**」⇒ **业务负责人在屏上改不了自己的常数**，
   完全命中参考材料 C 那句「read-only scope… **operators keep the spreadsheet and the platform
   becomes a second place to look**」。
2. 它把 `apps/datacore/src/synthetic/battery.ts · BASES`、
   `apps/frontend-shell/src/views/plan/OrderChainView.tsx · ECON / SEG_COLOR` 这类
   **源码文件路径直接打在用户屏上**——违反本仓自订的 `R-UI-4`（源码文件名/行号不许上用户屏，
   CLAUDE.md 铁律 1.5 判据二）。影响面**该给**，但该用业务语言给（视图名/求解器名/对象类型名），
   不是给一串仓库路径。

### 5.4 「切片库 99 条」里 **95 条是单类型包装**
`本体切片` 屏上原文：「**99** 条已注册切片 · **多跳业务切片 4 条** · **单类型覆盖切片 95 条**」。
真正表达业务链路的只有 4 条（`aop_scenario_chain` 3 跳 / `order_fulfillment_360` 12 跳 /
`order_to_cash_720` 23 跳 / `enterprise_360` 31 跳）。
「99」这个数**不度量建模成熟度**——它度量的是自动生成器跑了几遍。
（这正是铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」的一个现成实例，只不过发生在产品屏上。）

### 5.5 **20.4% 的对象类型是孤儿**，而没有任何一块屏把这当成待办
`本体关系` 页自己逐个列出了 **20** 个「（没有任何关系与它相连）」的类型：
`ARAging, AdoptedMitigation, BackupSupplierPool, BidRecord, Cadence, CommodityPriceTrend,
CompetitorPrice, CompetitorShare, DSO, DecisionGap, DemandSegment, ExternalSignal, FinancePlan,
GrossMarginBridge, LongTermAgreement, PipelineOpportunity, PriceRealization, RootCauseChain,
ScenarioTrigger, SopVersionRow`，对象类型总数 **98** ⇒ **20.4%**。
诚实地列出来是加分项；但页面把它当**说明文字**，不当**待办队列**——没有责任人、没有到期日、
没有「本季度清掉几个」的口径。对照 §2.1 的 KPI 表，这一行是**给这类数字设阈值**的。

### 5.6 「原型 intake」不是业务方提需求的入口，所以**反馈回路仍然缺一整段**
我原本以为 `原型 intake` 是术语/概念申请的 intake（那正是参考材料 E 说的 feedback loop）。
实测不是：屏上原文是「**粘贴 HTML 原型 → 确定性解析内嵌数据表（列+样例）与关系 → 与既有本体字段对账**」，
队列「待人确认 **0** / 共 **0** 条」。它解决的是「从原型倒灌结构」，不是「业务方发现模型错了怎么说」。
⇒ 全七面里**没有一块屏**能让看到错数字的业务用户把问题回抛给模型负责人。
参考材料 E 的第 6 种腐化就叫「**No owner, no feedback loop**」——本仓两半都缺，
而且缺的方式很特别：**owner 在后端有名有姓，只是屏上不给他座位。**

---

## 六 · 只有我会说、别的角色不会说的那一条

> **本仓把治理当成「门」来造，而这一行把治理当成「岗位」来造。这两者不是同一件事，
> 而本仓 101 道门证明了它非常擅长造前者、从未开始造后者。**

拆开讲：

- 别的四个角色会说「会签页崩了，修 `OntologyRelationsPage.tsx:1645`」。**那是对的但不够**——
  修完之后，`planner` 依然没有一扇门可以签，`域管理` 依然没有 owner 列，弃用依然没有指路牌。
  **崩溃是症状，缺岗位是病。**
- 这一行的一手材料在这一点上高度一致，而且都不是在讲功能：
  参考材料 C 的四条治理清单里，排第一的是「**an owner per entity type with authority to settle
  definitions**」——注意是 **authority**（裁决权），不是 permission（权限位）；
  参考材料 E 的药方第一句是「**assign a named steward**」；
  参考材料 D 把「**run a modeling/ontology review with domain stakeholders**」排进**每周**日程；
  参考材料 B 把开工单说成「**social contract**」——社会契约，不是技术流程。
  **四份互不相干的材料，指的都是同一件事：本体治理的载体是人，工具只是给人腾出座位。**
- 本仓的 `R4` 会签在架构上**已经把这个座位画出来了**（signoffs 数组、逐域 ownerUserId、
  全域 APPROVE 才固化），这在同类自研平台里已属少见。**差的只是最后一米：
  让坐在那个位置上的人，在自己的账号里看得见、点得动。**
  今天 `planner` 登录进去，`通知中心` 写着「暂无通知」，而服务端正躺着一条点名要他签的
  `PENDING_SIGNOFF`。
- 也正因如此，我**反对**把这轮的结论写成「本体治理没做」。做了，且做得比多数同类狠。
  真实的差距是一句更难听但更有用的话：
  **「这套治理今天只有一个人能操作，而那个人一旦按下唯一合规的那个按钮，连他自己也操作不了了。」**

---

## 七 · 金丝雀证据（报否定结论前的自证，铁律 0.6）

我报了若干「没有 / 0 条 / 看不到」，每条都先用**同一方法**验过一个确定存在的东西：

| 我的否定结论 | 同方法金丝雀（必须命中） | 命中证据 |
|---|---|---|
| `planner` 看不到任何会签入口 | 同一浏览器、同一取文本方法打开 `planner` 首页 | **644 字符**，含「经营驾驶舱」= true（另一次测得 498 字符含「规划」= true） |
| 弃用区块无「替代/replaced」 | 同一正则族在同页测「弃用/停用/下线」 | 命中（`对象类型 · 弃用流程` / `停用类型` / `下线类型` 三处原文已引） |
| `域管理` 无 owner 列 | 同一取文本方法在 `/admin/object-types` 上跑 | **4,857 字符**，含「对象/类型浏览器」= true；且 `域管理` 自身**并非空页**（244 字符，15 个域键全部列出，只是没有 owner 这一列） |
| 实体合并 0 候选 | 同一次点击的 API 拦截器在别处抓到了非 GET 请求 | 抓到 `POST 200 /a/v1/objects/merge-scan`（请求发出且成功，返回体就是 `{"candidates":[]}`，**不是没发请求**） |

**一次工具故障，如实记账**：第一版跨账号探测里，`planner` 首页只渲染 **26 字符**，金丝雀
「含『规划』」= false ⇒ 我**当场判定是我的工具坏了**，作废那一轮的「planner 看不到会签」结论，
换单浏览器顺序登录重测，金丝雀转绿（644 字符）后才敢下结论。
另有一次早期关键词扫描把**侧栏导航「运营与审批」**当成了页面内容，导致七块屏**全部**误报
「有提案/审批」——已改为「切掉导航壳（`系统自我` 之后）再扫正文」重测。这两笔都写在这里，
是因为**如果不写，这两个错误结论会比没有结论更危险**。

---

## 八 · 顶回主持方的前提

1. **「图谱体系」不是一块屏，是 8 条只读视图**（`/v/graph-all` `/v/graph-backbone` `/v/graph-flow`
   `/v/graph-source` `/v/graph-solver` `/v/graph-mvp` `/v/graph-agent` `/v/graph-loop`）。
   把它当第七个「面」来评会评空——它在导航里渲染成一个**看似没有子项**的分组
   （正文取不到子项，只有 `a[href]` 能列出来）。
2. **`/graph` 是 404**（屏上原文「404 / 页面不存在 / 该功能不存在或未开通」），
   `本体图谱` 的真实路由是 **`/v/graph`**。任何按 `/graph` 取证的结论都会得到「本体图谱是空的」
   这个**与事实相反**的结论。
3. **「本体关系」这块屏不能默认它渲染得出来**。它的可用性**取决于租户里有没有待会签请求**——
   见 §4 实验二。凡是在「用过会签」之后去测这块屏的人，会得到「本体关系页整体不可用」的结论；
   凡是在干净态测的人，会得到「功能齐备」的结论。**两个人都没测错，是这块屏有两种状态。**
   后续任何针对本页的复验，**必须先声明自己测的是哪一种状态**。

---

## 脚注 · 外部一手来源（检索日期均为 2026-08-29）

- **参考材料 A**（开放本体治理体系 · 术语稳定性原则 FP-019，含弃用四步与两个替代指针）
  https://obofoundry.org/principles/fp-019-term-stability.html
- **参考材料 B**（同体系的编辑者工作流：开工单 = social contract、PR + CI + 社区复核）
  https://obophenotype.github.io/uberon/odk-workflows/EditorsWorkflow/
- **参考材料 C**（企业本体工程：具名 owner、变更纪律等同生产迁移、只读模型让人退回电子表格）
  https://www.bdemerson.com/article/ontology-engineering
- **参考材料 D**（图谱工程岗位的日/周/月节奏与 KPI 表，含 Schema Change Failure Rate < 5%）
  https://www.devopsschool.com/blog/knowledge-graph-engineer-role-blueprint-responsibilities-skills-kpis-and-career-path/
- **参考材料 E**（企业本体腐化六式，含 Governance Gap「No owner, no feedback loop」与
  Human Cost「calendar declines」）
  https://www.moderndata101.com/blogs/how-enterprise-ontologies-fail-and-how-to-stop-it
- **参考材料 F**（可视化本体建模：本体「to a domain expert will look like code」、
  缺少支持全体干系人的工具）
  https://blog.metaphacts.com/visual-ontology-modeling-for-domain-experts-and-business-users-with-metaphactory
- **参考材料 G**（实体归并的人审队列：active learning 只把边缘案例推给 steward）
  https://www.moderndata101.com/blogs/entity-resolution-at-scale-deduplication-strategies-for-knowledge-graph-construction

> 两条**未能取到一手原文**、故未在正文引用的线索（如实记账，防止被当成已核实）：
> 某招聘站的本体/知识图谱工程师 JD 返回 **403**，某保险公司的同类 JD 返回 **410 Gone**。
> §2.1 的岗位节奏与 KPI 全部出自可打开的参考材料 D，不含这两条。

---

## 附 · 我不做的事

范围边界：本文只写 `docs/LOOP9-researcher.md`。**未改任何 `src`、未加门、未改基线 JSON**
（仓主禁令 3：新增门/棘轮/基线一律冻结）。§4 实验二那处崩溃我**只取证不修**——
修不修、怎么修，留给阶段⑤的行动清单裁决。
