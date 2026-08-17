# PRD · 「所有推演的功能都要借鉴这个设计 UX」的**验收判据化**

> 基线 `origin/claude/verify-reclaim-6` @ `b3a3030b` · **未改任何 `apps/**` / `packages/**` 源码** · 全程未跑 vitest / build（轻画像）
> 本单**不改页面**。头号交付物是把一条至今只有 🟡「已融入」三个字的要求，变成**可核对**的东西。

---

## 0 · 头条结论（三条，按重要性排）

### 0.1 ⛔ 派单前提写错了 —— 「这个」**不是** deepseek-harness，仓内三处记录互相打架且从未对账

工单原文：「『这个』指的是他之前让我评估的 **deepseek-harness**（换心可行性那条线，报告在
`docs/REPORT-harness-migration-feasibility.md`）」。**这句话在本仓找不到支持，且与仓内另外两处记录冲突。**

仓里对同一句仓主原话有**三份互不相同的指代**，出自**同一个审核方**，从未对上账：

| # | 落款 | 记的原话 | 记的「这个」指什么 | 证据强度 |
|---|---|---|---|---|
| **甲** | `docs/REQUIREMENTS-TRACE.md` §G「Agent 系统换心（deepseek-harness）」G2 行 | 「所有推演的功能都需要**借鉴这个设计 UX**」 | 由**章节标题**隐含 = deepseek-harness | **最弱**：全文没有一句说明为什么这条归 §G；「这个」二字从未被解释过 |
| **乙** | `docs/WO-ACTIVE-EDGE-UX.md:43-45`（与 harness 工单**同一个提交** `a069c976`「派两张单」） | 「所有推演的功能，包括"推演沙盘"就需要借鉴这个设计UX」 | 「仓主给的**参考 HTML** 里那个能力：关系边上有 active 开关」 | **中**：写明了指代物与能力，但（见 §1.3）该能力在**仓内那份**参考 HTML 里查无实据 |
| **丙** | `docs/ASSESS-pi-agent-harness-replacement.md:272` | 仓主校正提法：「不是替换运行时，而是**把 agent 的 UI/UX/CLI 升级到 pi 的水准**」 | `earendil-works/pi` | **强**：原文明确，但**它管的是 agent 的 UI/UX，不是推演页** |

**本单收到的工单把甲的归属 × 乙的原话缝在了一起**（引用乙那句更完整的原话，却按甲的章节归属去认指代物）。
照铁律 0.6 的句式，这是同一个形态：

> **「我用『这条记录躺在 §G 里』当作『它说的是 deepseek-harness』的证据，而前者并不度量后者。」**

**处置**：本单**不替仓主裁决**指代物（那是产品/需求决策，做错要返工）。本单做两件能做的：
① 把三份记录的冲突显式登记（本节 + §6 门判据⑤）；② 从**有实物、可复算**的那份材料（参考件 HTML）里抽判据。

### 0.2 从 deepseek-harness 材料里**抽不出** UX 判据 —— 如实报，附金丝雀

工单允许这个答案（「若材料里根本没有足以支撑『UX 设计主张』的内容，如实报」）。实测就是这个答案。

```
$ grep -c -E "UX|界面|布局|排版|信息密度|视觉|配色|三栏|单页|交互设计" \
    docs/REPORT-harness-migration-feasibility.md docs/WO-HARNESS-FEASIBILITY.md \
    docs/ASSESS-pi-agent-harness-replacement.md docs/ASSESS-pi-VERDICT.md docs/PRD-agent-react-harness.md
docs/REPORT-harness-migration-feasibility.md:0
docs/WO-HARNESS-FEASIBILITY.md:0
docs/ASSESS-pi-agent-harness-replacement.md:1     ← 唯一一条，见下
docs/ASSESS-pi-VERDICT.md:0
docs/PRD-agent-react-harness.md:0

$ 金丝雀（同一命令形态、同一批文件）：grep -c -E "harness|Harness|agent|Agent" <同上五文件>
47 / 21 / 77 / 17 / 46        ⇒ 工具是好的，0 是真的 0
```

唯一那一条命中是 `ASSESS-pi-agent-harness-replacement.md:272`，且它说的是 **pi 不是 dsh**、
管的是 **agent 的 UI/UX/CLI 不是推演页**（即上表的丙）。

`REPORT-harness-migration-feasibility.md` 全文 436 行，回答的是「引擎能不能换」：插件模型 / Agent Preset /
MCP client / 持久化 / 可编程 API / 事件流 / 56 个契约字段三档映射 / 210–361 vs 49–89 人日。
**它一句 UI 主张都没有**，连截图都没有。dsh 自己是 CLI + headless 形态
（`packages/bundle/headless/README.md:5`「The process opens no listening port.」），
它有 `packages/bundle/web-app`，但**本仓没有任何人看过那个 web-app 的界面并落过一行记录**。

**还缺什么才能从 dsh 抽出 UX 判据**（写全，便于仓主决定要不要补）：
1. dsh `packages/bundle/web-app` 的**实跑截图或 DOM 结构**（本仓零记录）；
2. 仓主口中「这个设计」的**指认物**——一句「我说的是 X」即可终结甲乙丙三方分歧；
3. `dshpocplan.md`（`REQUIREMENTS-TRACE.md` G4 记着仓主发过的 POC 测试报告）——**不在本仓**：
   `git ls-files | grep -i poc` → **0 命中**；金丝雀 `git ls-files | grep -ci harness` → **8**（工具是好的）。

### 0.3 真正能抽出判据的材料在仓里：`docs/reference-prototype-decision-platform.html`

5436 行、`7a613c74` 提交、标题逐字是 **「全域数字化智能决策支撑系统 · 决策中台 + AIP」**——
即本平台自己的参考原型。仓内多处已把它当「参考 HTML」在用
（`SYSTEM-ONTOLOGY.md` prototype-intake 段「导入真实参考 HTML 24 表」·`AUDIT-prd-reality-batch1.md:121`
「参考 HTML 的 6 目标 / 5 路径 / 3 方案 / 五维雷达」）。

**它是唯一一份「可逐行引用、可机检、每条主张都带 file:line」的 UX 材料。** §2 的九条判据全部从它抽出。

---

## 1 · 材料盘点（先读，别猜）

### 1.1 找了哪些、各是什么

| 文件 | 行数 | 是什么 | 能不能抽 UX 判据 |
|---|---|---|---|
| `docs/REPORT-harness-migration-feasibility.md` | 436 | dsh **引擎**换心可行性 | ❌ 零 UX 内容（§0.2 金丝雀） |
| `docs/WO-HARNESS-FEASIBILITY.md` | 157 | 上文的派单 | ❌ |
| `docs/ASSESS-pi-agent-harness-replacement.md` | 525 | **pi** 评估（另一个项目） | ◐ 只有 agent 的 UI/UX/CLI，不是推演页 |
| `docs/ASSESS-pi-VERDICT.md` | 178 | pi 六 agent 实测判决 | ❌ |
| `docs/PRD-agent-react-harness.md` | 375 | **本平台自己的** ReAct 七要素 harness | ❌（同名不同物，别混） |
| `dshpocplan.md` | — | 仓主发的 POC 报告 | ⛔ **不在本仓** |
| **`docs/reference-prototype-decision-platform.html`** | **5436** | **本平台参考原型（决策中台 + AIP）** | ✅ **判据全部出自这里** |
| `docs/ARCH-redlines-and-R17-decision-page.md` | — | 从「竞品 UX 8 图」抽出的 R17 决策单页 7 条子原则 | ✅ 已在本体 §5 立为 R17（🚧 拟立），本单与它对齐不重造 |

⚠ **命名纪律**：本文一律用「参考件 / 参考原型」，不写外部产品名（CLAUDE.md 铁律 0 末条）。

### 1.2 R17 已经做过一次抽取 —— 本单**不重造**，只补它缺的那一层

`SYSTEM-ONTOLOGY.md:1677` R17 已把「一页看全 数据→推演→溯源→动作→AI」立为不变量，7 条子原则
（17.1 决策闭环单页 / 17.2 三栏 / 17.3 信息密度 / 17.4 就地下钻 / 17.5 AI 贯穿 / 17.6 可溯源内联 / 17.7 配置驱动密度）。
状态是 **🚧 拟立**，配套门 `decision-page:check` **待建**。

**R17 缺的那一层正是本单要补的**：它的 7 条是**版面级**原则（页面长什么样），
而参考件里另有一批**推演专属**的行为主张（改输入即重演 / 每步标数据·求解器·规则 / 反事实排除是一等节点 /
同源勾稽），R17 一条都没覆盖。本单九条判据里 **U7/U8 与 R17.5/17.4 同源**（标注复用，不另立），
其余七条是新的。

### 1.3 ⚠ 顶回来一条：乙记的「参考 HTML 里关系边上有 active 开关」，在**仓内那份**参考件里查无实据

```
$ grep -c "active" docs/reference-prototype-decision-platform.html
18                       ← 全部是 CSS 类名 .tab.active / .lg-active 与 JS 的 activeView 视图态
$ grep -n "开关|toggle|checkbox|switch" …                （金丝雀：toggle 命中 15+，工具是好的）
只有 :391 「时间轴折叠开关（体检卡内）」一处，与关系边无关
```

参考件里与之最接近的是**根因 DAG 上的一类节点**：
`:4158` `RK_KIND={result:'结果', excluded:'反事实排除', factor:'主因', …}` ·
`:4214` 「层层下钻：结果 → **反事实排除**/主因 → 影响项目 → 事件 → 机制根因」。
**那是「把已排除的因素画出来」，不是「拨一个开关关掉一条边」**——两者都属反事实家族，但落点不同。

**结论**：`WO-ACTIVE-EDGE-UX` 交付的 `EdgeActivePanel`（会话级 `disabledRuleKeys` + 开/关两版对照）
**是一个好东西且已落地 9 页**，但**它不能被记作「参考件里那条 UX 已借鉴」**——
参考件里没有那个控件。它该记作「本平台在反事实这一族上做得**比参考件更进一步**」。
本单把这条改记为判据 **U4**（反事实一等呈现），并把参考件真正主张的那半（**排除项与主因同图呈现**）
单独列为 **U4b** —— 今天 9 页一个都不满足（§4）。

---

## 2 · 判据表（九条 · 每条带参考件 file:line + 「用户读了能做什么决定」）

> 判据的合格线不是「好不好看」。每条必须回答：**这句话用户读了能做什么决定？**
> 答不出来的一律不进表（本单丢弃过三条候选：配色、圆角、玻璃拟态——它们改变观感，不改变任何决策）。

> **⚠ 2026-08-16 WO-HARNESS-UX-GAP-1 改写过 6 条**（U1/U2/U3/U5/U7/U8）。改写的**唯一动因**是
> §4 里 **57 格「判不了」**——而逐格追下去发现，这 57 格**不是**「页面情况不明」，
> 是**判据自己问了一个没法回答的问题**。改写记录与逐条理由见 §2.1，**原措辞一字不删地留在那里**。

| # | 判据（可判断的陈述） | 参考件出处（逐字） | 用户读了能做什么决定 | 可机检？ |
|---|---|---|---|---|
| **U1** | **改输入即重演**：页内输入控件的值**直接进**求解入参 / `queryKey`；**不存在提交闸**——不存在「必须先点某个按钮，结果才更新」的中间态 | `:3737`「型号 × 需求量 × 交付窗口 · **改输入即重演**」；`:4926`「基线：2026-07 月度 V7 · **改任意字段即时体检**」 | 「我改这个数到底影不影响结论」——当场知道。有提交闸时，用户改完不点、以为看到的是新结果，**实际在看旧结果** | ✅ 静态可判（提交闸形态 + 输入是否进 `queryKey`） |
| **U2** | **分步可见 + 每步标口径**：页内有**推演过程**的步骤态（同一份结果按步展开），且每步能看到它的 数据 · 求解器 · 规则。**业务流程步骤（评审→平衡→定稿）与行动计划步骤不算**——那是「事情分几步做」，不是「这个数分几步算出来的」 | `:3766`「🧭 分步推演 · 第 N/M 步」+ 副标题「**每步标明 调用的数据 · 求解器 · 规则**」；`:3734` | 「这一步能不能信」「数不对该找哪一环的人核」——没有这层，用户只能整体信或整体不信 | ✅ 静态可判（步骤态驱动的是结果还是流程） |
| **U3** | **过程图 + 点节点看凭什么**：页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**（有这两样，判定逻辑/输入数据必然也在） | `:3773`「随步骤逐层点亮：需求 → 型号 → 可产基地 → 驱动因子 → 求解器 → 产能预测」；`:3361`「**点击任意节点看判定逻辑 / 输入数据 / 来源 / 本体链 / 规则**」 | 「数字不对时，定位到是哪一环坏了」——把「结论错了」变成「第 3 步的规则用错了」 | ✅ 静态可判（图 + `onNodeClick` 实参 + 面板字段） |
| **U4** | **反事实一等呈现**：能在页内排除/关闭一个因素，并**同屏**看到排除前后的差异 | `:4158` `excluded:'反事实排除'`；`:4214`「结果 → **反事实排除**/主因 → …」 | 「这个主因是被排除法证出来的，还是只是排第一」——决定要不要照它下单 | ✅ `EdgeActivePanel` 挂载点（**已有门** `check-edge-active-mounts.mjs`） |
| **U4b** | **排除项与主因同图**：被排除的因素**留在图上并可见地降级**，不是从图上消失 | `:4218` 图例六色并列，`excluded` 与 `factor`/`rootcause` **同一张图** | 「我关掉的是什么」——消失了用户就不知道自己关了什么，也无法解释给别人听 | ◐ 有图的页可静态判；**无因果/推演图的页 = 不适用**（判据无处落脚，见 §4.3） |
| **U5** | **结论数字标出处**：屏上的结论性数字带**指名道姓**的出处——求解器名 / 快照版本 / 推导链 / 依据规则，任一即可；裸数字不算 | `:1187`「所有数字派生自同一本体（**一个事实一个出处**）」；`:1118`「全部派生不录入：一个事实一个出处」 | 「这个数是谁算的」——数不对时知道该找哪一环，而不是整屏一起怀疑 | ✅ 静态可判（`SnapshotBadge` / `<Provenance>` / 屏上求解器名） |
| **U6** | **结论即动作**：推演结论可**一键采纳** → 生成 Action 并留审批痕，不需另开工单系统 | `:3390`「**采纳即生成 Action（C10 审批留痕）**；条件写入工单」 | 「看完就能下发」——决定这一屏是「看看而已」还是「真能动手」 | ✅ 静态可判（真有 action-draft / decisions commit 调用，**文案不算**） |
| **U7** | **同屏问答带本页上下文**：问答入口常驻同屏，**且它知道自己在哪一页**——本页把视图键报给会话上下文，随查询搭车送出 | `:3532`「🤖 AI 对话 · … **基于本页实时数据回答** · 编排Agent 调用求解器与本体」 | 「追问一句不用丢掉当前上下文」——不报到，问答答的是上一页 | ✅ 静态可判（经 `ViewPage` 分发 或 自己调 `usePageView`） |
| **U8** | **看明细不换页**：页内「看明细」落在**受控展开态**（抽屉/浮层/内联展开），不是路由跳转。**跳去另一张页做别的事（交接/切视角）不算违反**——违反的是「想看细节 ⇒ 被带走」 | `:2483`「**悬停任意点看当日影响**」；`:3361`「点击任意节点看…」 | 「看细节不丢现场」——跳一次页 = 上下文清零一次 | ✅ 静态可判（受控展开态 vs `<Link>`/`navigate()` 用在哪） |
| **U9** | **导出带口径与时间戳**：导出物自带口径说明与生成时间，可被第三方复算 | `:3582`「导出时间 ${now} · 所有数字派生自同一本体（一个事实一个出处）」 | 「把这屏放进 S&OP 决议附件时，别人能复算」 | ✅ 静态可判（导出物正文里有没有那两样） |

**丢弃的候选（写出来防止后人再捡）**：三栏定宽 248/1fr/340（`:34`）——它是 **R17.2 已立的不变量**，
本单不重复立；深色玻璃拟态、圆角、`JetBrains Mono` 数字字体——**改观感不改决策**，进不了判据表。

### 2.1 判据改写记录（6 条 · 原措辞逐字保留 · 每条写明「为什么原措辞判不了」）

> ⛔ **先说清这一节**不是**什么**：它**不是**「把题目改简单好拿分」。
> 判据改写唯一合法的动因是**原措辞把两件事缝成了一句**，其中一件可判、另一件不可判，
> 于是整格只能记「判不了」。改写 = **把缝在一起的两件事拆开**，可判的那半留在表里逐页判，
> **不可判的那半原封不动挪进 §4.2 并点名交给门 B** —— 一格都不许凭空消失。
> 判据表本身的读数因此变化：**「判不了 57」不是变成 0，是被拆成「表内 0 + 表外 4 条明账」**（§4.2）。

| # | 原措辞（逐字） | 缝在一起的两件事 | 改写后表里留哪半 | 挪出去的那半去哪 |
|---|---|---|---|---|
| **U1** | 「改动任一输入控件后，结果**自动更新**」 | ① 有没有**提交闸**（结构问题）② 改完**多久**出结果（运行期时延） | ① 提交闸 | ② → §4.2 门 B（真浏览器：改一个输入、不点任何按钮、断言结果 DOM 变了） |
| **U2** | 「推演过程按步呈现」 | ① **推演过程**分几步算（判据要的）② **业务流程/行动计划**分几步做（长得一模一样） | ① 且**显式排除**② | 无需外移：原措辞本就只想要①，是**漏了排除句**导致 `sop-balance`/`decision-play` 判不了 |
| **U3** | 「点任意节点看到 判定逻辑 / 输入数据 / 来源 / **本体链** / 规则」 | ① 点得开且看得到凭什么 ② 那五样**逐字齐全**（「本体链」在本仓多数页无对位实现） | ①，判据收敛到**来源 + 规则**两样（有这两样，另两样必然在） | ②「本体链逐字齐全」→ §4.2（属 R13 溯源链的另一条线，不在本表射程） |
| **U5** | 「同一事实**全屏**只有一个出处；聚合数 = Σ 明细且可逐层下钻核对」 | ① 单页内数字**标没标出处**（页内可判）② **跨屏**同一事实两处值一不一致（要同时开两屏比） | ① | ② → §4.2 门 B（跨屏比对，静态与单页渲染都够不着） |
| **U7** | 「AI 对话常驻同屏，回答**基于当前页的实时数据**」 | ① 问答**在不在**同屏、**知不知道**自己在哪一页（结构，可判）② 它答出来的**内容**对不对（要真跑一次编排 + 真模型） | ① | ② → §4.2 门 B / 编排侧评测（本表不判模型答得对不对） |
| **U8** | 「悬停 / 点击在**原地**展开明细，不导航离开」 | ① 看明细走的是**展开**还是**跳页**（结构，可判）② 展开出来的浮层**几何**对不对（贴不贴边、挡不挡） | ① | ② → §4.2 门 B（几何要渲染后量） |

**改写没有动的三条**：U4 / U4b / U6 措辞照旧 —— 它们本来就只问一件事。
U4b 的 1 格「判不了」不是措辞问题，是**缺证据**（没人读过 `DecisionPlayPanel`），已按 §4.1 逐行读完补上。

---

## 3 · 「所有推演的功能」实测是哪几页（可复算 · 不手抄）

### 3.1 枚举命令（三源并集，逐源可复跑）

```bash
# 源 A · 后端内置视图单一来源：title 或 featureName 含「推演/沙盘」
grep -nE '\{ key: "[^"]+", title: "[^"]*(推演|沙盘)' apps/datacore/src/synthetic/view-manifest.ts
grep -nE 'featureName: "[^"]*(推演|沙盘)'              apps/datacore/src/synthetic/view-manifest.ts
# 源 B · Entitlement 注册表：VIEW/BLOCK 级功能名含「推演/沙盘」
grep -nE 'key: "[^"]+", name: "[^"]*(推演|沙盘)'        apps/datacore/src/features.ts
# 源 C · 左导航「推演」组 + 组外标签含「推演」
sed -n '/title: "推演"/,/^  },$/p'                     apps/frontend-shell/src/pages/ShellLayout.tsx
# 源 D · 沙盘模式收编表（原独立推演页 → 沙盘模式）
sed -n '/SANDBOX_MODE_ORIGIN_VIEW/,/^};$/p'            apps/frontend-shell/src/views/sim/sandboxModes.ts
```

**金丝雀（先自证工具，再报数）**：拿一个**确定是推演页**的键跑同一条命令 ——
`sim.sandbox`（推演沙盘）在源 B 命中 `features.ts:92`；`project-sim`（项目推演）在源 A 命中
`view-manifest.ts:116`、在源 C 命中 `ShellLayout.tsx:159`。**金丝雀命中 ⇒ 下面的「不在集合里」才可信。**

### 3.2 实测结果 —— **三个源头互不一致，今天没有单一来源**

| 页（用户看到的名字） | key | 源 A 内置视图 | 源 B 功能名 | 源 C 导航「推演」组 | 源 D 沙盘模式 | 既有门 `check-edge-active-mounts` |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 推演沙盘 | `sim-sandbox` | — | ✅ `sim.sandbox` | ✅ | 本体 | ✅ |
| 项目推演 | `project-sim` | ✅ | — | ✅ | — | ✅ |
| 全局项目推演 | `global-sim` | ✅ | ✅(BLOCK) | ✅ | — | ✅ |
| 产能推演 | `risk` | ✅（featureName「风险推演看板」） | — | ✅ | — | ✅ |
| 订单全链 | `order-chain` | — | — | ✅ | — | ❌ **不在门里** |
| 决策推演 | `decision-play` | —（本体明写「诚实排除」） | — | ✅ | — | ✅ |
| 假设推演 | `what-if` | — | — | ✅ | ✅ 试一手 | ✅ |
| 优化推演 | `optimize-whatif` | — | — | ✅ | ✅ 求最优 | ✅ |
| 归因（净室） | `cleanroom-attr` | — | — | ❌「归因与风险」组 | ✅ 归因 | ❌ **不在门里** |
| 影响半径 | `disruption-radius` | — | — | ❌「归因与风险」组 | ✅ 影响半径 | ❌ **不在门里** |
| 方案生成 | `plan-generate` | ✅（title 无「推演」） | — | ❌「规划与平衡」组 | — | ✅ |
| 月度规划 | `sop-balance` | ✅（title 无「推演」） | — | ❌「规划与平衡」组 | — | ✅ |

- **三源并集**（含名/导航/沙盘模式）＝ **10 个**：`cleanroom-attr decision-play disruption-radius global-sim
  optimize-whatif order-chain project-sim risk sim-sandbox what-if`
- **既有门 PAGES** ＝ **9 个**（`check-edge-active-mounts.mjs:39-49`）
- **两者并集 ＝ 12 个**，**交集只有 8 个**。分歧 4 个：门有而枚举无 `plan-generate`/`sop-balance`；
  枚举有而门无 `cleanroom-attr`/`disruption-radius`/`order-chain`（3 个）。

### 3.3 这个分歧不是笔误，是**没有判据**

- 既有门的 `PAGES` 是**手抄的**：注释自陈「前 8 条来自工单 §1；第 9 条 `risk-board` 是复核时补的」。
  它抄对了两个 title 里没有「推演」二字的页（方案生成 / 月度规划），却漏了三个沙盘模式页。
- 导航把 `cleanroom-attr`/`disruption-radius` 归「归因与风险」，理由写在
  `ShellLayout.tsx` 组注释里：「它答的是**现状为什么这样**（归因），不是**改一个假设会怎样**（推演）」。
  **这个判据是清楚的**——但 `sandboxModes.ts` 又把这两个页当作沙盘的两个**模式**并列在
  「现状 → 归因 → 试一手 → 求最优 → 影响半径」这条决策链上。**同一个东西两处两个归属。**
- **争议候选（不进主表，登记备裁）**：`plan-audit`（规划体检）——参考件 `:4926` 那句
  「改任意字段**即时体检**」正是它，行为上完全是推演；但它 title/featureName 都不含「推演」，
  导航归「规划与平衡」。**是否纳入属产品判断，本单不替仓主定，登记在门的争议表里。**

**⇒ 第一优先级的欠账不是改页面，是给「推演页」定一条判据并落成单一来源**（§5 P0）。

---

## 4 · 逐页 × 逐判据差距表（四态 · 「判不了」不许混进「符合」·「不适用」不许混进「判不了」）

**取证方式**：只读源码 + 静态探针（探针带金丝雀，见 §4.1 开头）+ **逐条再追一层调用**（铁律 0.5）。
**四态定义**：
- `符合` = 读到实现且在主渲染路径上；
- `不符合` = 读到明确的相反证据；
- `判不了` = 静态源码里不存在这个量（需渲染后的行为/几何/跨屏比对）；
- `不适用` = **这条判据在这一页上无处落脚**（如「排除项与主因同图」而该页根本没有图）。
  ⚠ **`不适用` 与 `判不了` 是两个不同的命题**：前者是「问题问错了对象」，后者是「问题对但答不出来」。
  混在一起，前者会被当成欠账排进优先级（做一件本来就不该做的事），后者会被当成已裁决（漏掉真欠账）。

| 页 | U1 改输入即重演 | U2 分步标口径 | U3 DAG点节点 | U4 反事实开关 | U4b 排除项同图 | U5 结论标出处 | U6 结论即动作 | U7 同屏问答带上下文 | U8 看明细不换页 | U9 导出带口径 |
|---|---|---|---|---|---|---|---|---|---|---|
| 推演沙盘 `sim-sandbox` | **符合** | 不符合 | **符合** | **符合** | 不符合 | **符合** | **符合** | **符合** | **符合** | **符合** |
| 项目推演 `project-sim` | **符合** | **符合** | **符合** | **符合** | 不符合 | **符合** | **不符合** | **符合** | **符合** | **符合** |
| 全局项目推演 `global-sim` | **符合** | 不符合 | **不符合** | **符合** | 不适用 | **符合** | **符合** | **符合** | **不符合** | **符合** |
| 产能推演 `risk` | **符合** | 不符合 | **不符合** | **符合** | 不符合 | **符合** | **符合** | **符合** | **符合** | **符合** |
| 订单全链 `order-chain` | **符合** | 不符合 | **符合** | **符合** | 不符合 | **符合** | **符合** | **符合** | **符合** | **符合** |
| 决策推演 `decision-play` | **符合** | **不符合** | **不符合** | **符合** | 不适用 | **符合** | **符合** | **符合** | **符合** | **符合** |
| 假设推演 `what-if` | **符合** | 不符合 | **不符合** | **符合** | 不适用 | **符合** | **不符合** | **符合** | **符合** | **符合** |
| 优化推演 `optimize-whatif` | **不符合** | 不符合 | **不符合** | **符合** | 不适用 | **符合** | **不符合** | **符合** | **符合** | **符合** |
| 归因 `cleanroom-attr` | **符合** | 不符合 | **不符合** | 不适用 | 不适用 | **符合** | **不符合** | **符合** | **符合** | **符合** |
| 影响半径 `disruption-radius` | **符合** | 不符合 | **符合** | **符合** | 不符合 | **符合** | **不符合** | **符合** | **符合** | **符合** |
| 方案生成 `plan-generate` | **符合** | 不符合 | **不符合** | **符合** | 不适用 | **符合** | **符合** | **符合** | **符合** | **符合** |
| 月度规划 `sop-balance` | **不符合** | **不符合** | **不符合** | **符合** | 不适用 | **符合** | **符合** | **符合** | **符合** | **符合** |

**合计（12 页 × 10 判据 = 120 格）：符合 80 · 不符合 32 · 不适用 8 · 判不了 0。**

> **这一行的口径，以及它为什么只许有一行**（2026-08-17 解合并冲突时定死）：
>
> - **两个独立口径对过账**，不是抄来的：① 逐格数上表 = 符合 80 / 不符合 32 / 不适用 8 / 判不了 0（和 = 120）；
>   ② 门现算 `node scripts/check-sim-ux-criteria.mjs` 打印「符合 80（基线 80）」。两者一致才落笔。
> - ⚠ **本节一度同时存在三行互相矛盾的「合计」**（68/45/0/7 · 62/50/0/8 · 70/43/0/7），
>   是三次合并各留一行、且**夹在未解决的 `<<<<<<< / >>>>>>>` 冲突标记里**造成的。
>   三行**没有一行**等于上表逐格现算的结果 —— **合计与表脱节，读者信哪一行都是错的**。
>   形态（铁律 0.6）：**「我用『合计那行写着的数』当作『表里现在是什么』的证据，而前者并不度量后者。」**
> - ⇒ **规矩：本节只许有一行合计，且必须与上表逐格现算一致。** 改表必须同改这一行，
>   两者脱节由门 `sim-ux-criteria:check` 的棘轮当场报红（它读表现算，不读这行字）。
>   历史版本的数不再堆在这里（堆着就会有人拿旧行当现状）；版本流水见 §4.5 与各轮 WO 的逐格去向表。

> **2026-08-16 WO-SANDBOX-53CELLS 改的 8 格**（逐格实现与测试见 §4.5）：
> U1 `what-if` · U3 `order-chain`/`disruption-radius` · U5 `global-sim`/`what-if`/`optimize-whatif` ·
> U8 `cleanroom-attr`/`disruption-radius`。**方向全部是 不符合 → 符合**（棘轮只升不降，无一格反向）。


> **本轮（WO-EDGE-PANEL-3PAGES）动了 3 格，全在 U4 列**，逐格写清去向，不许只报总数：
>
> | 页 | U4 改前 → 改后 | 凭什么 |
> |---|---|---|
> | `order-chain` | 不符合 → **符合** | `OrderChainView.tsx` 主组件挂 `<EdgeActivePanel pageKey="order-chain">`（`<details oc-edge-details>` 内，第一层留可见记号）。判据要的是「页内能排除一个因素 + 同屏看到前后差异」，面板自带差值表即同屏 |
> | `disruption-radius` | 不符合 → **符合** | **两处**：① 本页自有的关系边开关（`dr-edges`）—— 关掉一跳 ⇒ 倒推改道或断链 ⇒ `dr-radius`/`dr-total`/`dr-fanout` **本页自己的读数**真变；② `<EdgeActivePanel pageKey="disruption-radius">` |
> | `cleanroom-attr` | 不符合 → **不适用** | 见 §4.3 —— **本页三块的数一个都不来自可断的传导链**，判据预设的那个对象在这一页上不存在 |
>
> ⚠ **「不符合 → 不适用」这一步最容易被当成消红，故判据写死在这里**：只有当
> 「排除一个因素」这个动作**在这一页上无处落脚**时才允许改判；只要页面上存在任何一个
> 关掉之后读数会变的东西，就仍是 `不符合`（欠账），不是 `不适用`。
> `cleanroom-attr` 的逐块取证在 §4.3，**三块拆开说**，不许一句盖住三个事实。

> ⚠ **「判不了 57 → 0」不许读作「都验过了」——那是本表最容易被误读的一行数。**
> 57 格的去向是**三条互不相同的路**，逐条写在这里，谁也不许含混过去：
>
> | 去向 | 格数 | 说明 |
> |---|---|---|
> | **判据改写后落地** | 44 | 原措辞把「可判的一半」与「不可判的一半」缝在一句里（§2.1 六条改写）。拆开后可判的那半逐页判出了 符合/不符合 |
> | **补取证后落地** | 6 | 判据本来就能判，只是**没人去看那个页**（U4b/U6/U9 在 `decision-play`、U6 在 `project-sim`/`order-chain`、U9 在 `risk`）。去读了源码就落地了 |
> | **改判「不适用」** | 7 | U4b 在**没有因果/推演图**的 7 个页上无处落脚（§4.3）。**这 7 格不是欠账，是问错了对象** |
>
> 而**被拆出去的那一半没有消失**：4 条明账登记在 §4.2，明确交给门 B（真浏览器），
> 本表**不假装能判它们**。「表里判不了 0」与「这条要求已经验完」之间隔着那 4 条明账。
>
> ⚠ 上一版这行数字的教训照抄在此：**这些数必须以门为准，不许手数。**
> 上一版我手数第一版是 21/45/54，三个全错，是 `node scripts/check-sim-ux-criteria.mjs` 第一次跑
> 就打印「符合 17」把它顶回来的（铁律 0.6：机制的判据 = **机器先说话，不是人想起来**）。

### 4.1 每格判定依据（逐格带 file:line · 2026-08-16 全表重测）

> **取证工具先自证（铁律 0.6）**：本轮 11 条静态探针每条都带一个**已知必中**的页做金丝雀，
> 金丝雀不中 ⇒ 报「工具坏了」并作废该条，**不许**报「各页都没有」。这不是仪式，本轮真抓到两次：
> - **探针选错金丝雀**：`U8 路由跳转` 原选 `order-chain` 作金丝雀，实测 **0 命中** ⇒ 当场报工具坏（RC=2）。
>   复核 `git grep -l "useNavigate\|<Link\|navigate("` 发现 `order-chain` 本来就不在命中集里，
>   金丝雀选错了页。改选 `sim-sandbox`（3 命中）后才敢报其余页的 0。
> - **探针词表写窄**：`U1 提交闸` 原写 `data-testid="[a-z-]*-run"`，把 `sop-run-1..5` 全漏了
>   （它们以 `-1` 结尾不是 `-run`）⇒ `sop-balance` 报 0，而它明明有**五个**提交按钮。
>   当时的金丝雀（`optimize-whatif`）是**中的** —— 所以**一个金丝雀救不了「词表写窄」这一类**：
>   探针漏掉的那一半刚好不在金丝雀上。补第二个金丝雀（`sop-balance`）后命中 10。
>   **教训单独记一笔：金丝雀证明的是「工具活着」，不是「工具覆盖全」。**
>
> **且探针只是线索，不是结论**（铁律 0.5）。下面每一格都再追了一层调用，追到「真正被谁调用、
> 在什么条件下触发」为止。本轮因此推翻了三个探针给出的初判，逐条记在对应判据下。

**U1 改输入即重演**（判据：输入进求解入参/`queryKey` ∧ 无提交闸）
- **符合 9 页**：
  `global-sim` `GlobalSimView.tsx:296` `useLiveSolver("portfolio", args, …)`（`args` 含 `levers`）·
  `risk` `RiskBoardView.tsx:158/695/970` `queryKey` 直含 `horizon`/`baseFilter`/`rcFactor` ·
  `project-sim` `ProjectSimView.tsx:169` `useLiveSolver("capacity_forecast", args, …)` ·
  `plan-generate` `PlanGenerateView.tsx:84` `useLiveSolver(…)`，入参逐项来自 `goals` state（`:88-95`），
  而 `goals` 由 `:166` 的 `onChange` 直接写 ·
  `order-chain` `OrderChainView.tsx:372/787/792` `queryKey` 含 `baseFilter`/`modelId`/`custName`，
  `:785` 注释逐字「换基地 → `args.base` 变 → `queryKey` 变 → 真重调」·
  `cleanroom-attr` `CleanroomAttrView.tsx:182/276/365` `queryKey: [..., cand.args]`，`cand` 由主类型下拉的
  `sel` state 选出 · `disruption-radius` `DisruptionRadiusView.tsx:135` `queryKey` 含 `rootType`/`rootId`/`layers` ·
  `decision-play` `DecisionPlayPanel.tsx:608` `queryKey` 含 `metricKey`/`factorId`/`locus*` ·
  `sim-sandbox` 无任何提交闸（探针命中 0），杠杆/开关变更即重算。
  ⚠ **沙盘「推进一格 tick」不算提交闸** —— 那是**时间前进**（推演语义本身），不是「填完表再点一下」。
  这两者长得像，混了会把一个正确实现判红。
- **不符合 2 页**：
  `optimize-whatif` `OptimizeWhatifView.tsx` `queryKey` 挂 `submitted` + `enabled: submitted != null` ·
  `sop-balance` `SopBalanceView.tsx:391/501/594/660/754` **五个** `sop-run-N` 提交按钮。
- ✅ **`what-if` 于 2026-08-16 WO-SANDBOX-53CELLS 闭**（不符合 → 符合）：`wi-run` 提交闸**已删**，
  假设四维直接进 `queryKey`（`["a","what-if","infer",typeKey,objectId,prop,value]`），改任一项即重调求解器。
  自由文本框配 300ms 防抖 —— **防抖不是提交闸**：它只推迟发请求、不推迟输入回显，
  且「不点某个东西结果永远不更新」这个态**结构上不存在了**。机检见 §4.5。

**U2 分步标口径**（判据：**推演过程**分步 ∧ 每步标 数据/求解器/规则；业务流程步骤不算）
- `project-sim` **符合**：`ProjectSimView.tsx` 的 `step` 驱动同一份 `forecast` 结果分层展开，
  配 `views/sim/PmDag.tsx`（参考件 `pmDagSVG` 的对位实现）随步点亮。
- 其余 11 页 **不符合**。两格**从「判不了」落地**，靠的是 §2.1 给 U2 补的那句排除：
  - `sop-balance`：探针命中 10 处，但逐处读下来全是 `sop-run-1..5` 串起来的 **S&OP 业务流程**
    （评审→平衡→定稿），是「事情分几步做」不是「这个数分几步算出来的」⇒ **不符合**。
  - `decision-play`：`DecisionPlayPanel.tsx:104` `steps: DPStep[]` / `:342` `recommendedPlan.steps` ——
    那是**行动计划**的步骤（引擎按 `cycleDays` 排的执行顺序），同样不是推演过程 ⇒ **不符合**。

**U3 过程图 + 点节点看凭什么**（判据：有图 ∧ 节点点击真接到面板 ∧ 面板含 来源 与 规则）
- **符合 2 页**（两格均从「判不了」落地）：
  - `project-sim`：`ProjectSimView.tsx:453` `<PmDag … onNodeClick={setDagNode}>` → `:506` 抽屉
    `DagNodeDrawer`，其 `DagDetail`（`:978` `dagNodeDetail`）字段是
    `title / verdict / **src** / formula / inputs / **rule**` —— 来源与规则俱全。
  - `sim-sandbox`：`SandboxConsole.tsx:261` `selectedNodeId` ← `:446/:458` 节点点击 →
    `:1065` `<NodeInspectorView …>`，面板里 `InspectorNodePanel.tsx:374-381` 逐条渲染
    `ruleRef.ruleKey / params.<param> / path / note`（规则码看得见），另有来源说明段。
- ✅ **`order-chain` / `disruption-radius` 于 2026-08-16 WO-SANDBOX-53CELLS 闭**（不符合 → 符合）：
  病**不是「没有图」**，是**接了线接错地方**（铁律 0.5 第三形态）——
  `@/components/Dag/LayeredDag.tsx:104` 的 `onClick={() => onNodeClick?.(n)}` 里 `onNodeClick` 是**可选**的，
  三处挂载（`ofc-dag` / `problem-dag` / `dr-fanout`）**都没传** ⇒ 点节点静默什么都不发生，**屏上分辨不出**。
  修法是**补挂载点**，不是造组件。新增 `views/sim/DagNodeInspector.tsx`（一份实现、三处挂载），
  `src`(来源)/`rule`(规则) **必填**、空值 `assertDagNodeFacts` 直接抛（判据写生产入口，不只写测试）。
  逐格实现与测试见 §4.5。
- **不符合 8 页**。其中 **`risk` 仍是「有图但点了没反应」**：`ProvenanceDag`（`RiskBoardView.tsx:1310`）
  的 `NodeProv` 是 **hover** 浮层且给的是 来源 + 依据（`basis`），**没有规则**；
  且该组件被 cockpit 等页共用，改它会外溢 —— 本单**没做**，诚实挂账（§5 新 P1）。
  余下 7 页（`global-sim`/`decision-play`/`what-if`/`optimize-whatif`/`cleanroom-attr`/`plan-generate`/`sop-balance`）
  **连图都没有**。金丝雀：同一探针 `project-sim`=3 · `order-chain`=4 · `disruption-radius`=3 ⇒ 工具是好的。

**U4 反事实开关**（唯一此前已有机检的判据）
- **符合 11 页** / **不适用 1 页**（`cleanroom-attr`，见 §4.3）。
- **2026-08-16 WO-EDGE-PANEL-3PAGES 收口前**：符合 9 / 不符合 3
  （`cleanroom-attr` / `disruption-radius` / `order-chain` 探针 `<EdgeActivePanel` 命中 **0**；
  金丝雀：同探针 `what-if`=1 · `decision-play`=1 ⇒ 工具是好的）。
  **这三页正是 §3.2 里「枚举有而门无」的三个** —— 既有门 `check-edge-active-mounts.mjs` 的 `PAGES`
  手抄漏了它们，于是它们**从未被这道门问过**。
- 收口后逐页复验（`node scripts/check-edge-active-mounts.mjs`，名册**现算**不再手抄）：
  **挂对 9 · 在册裁决 1**，判据②③④ 全过。
  · `order-chain` `OrderChainView.tsx` 主组件内 `<EdgeActivePanel pageKey="order-chain">`；
  · `disruption-radius` `DisruptionRadiusView.tsx` 主组件内 `<EdgeActivePanel pageKey="disruption-radius">`，
    **另加**本页自有的关系边开关（`dr-edges`）—— 那一半才是台账 A4 原话「关系边（本体图谱结构）」
    直接点名的东西：关掉一跳 ⇒ `deriveDisruptionLayers` 倒推时跳过 ⇒ **改道**或**断链** ⇒
    `dr-radius` / `dr-total` / `dr-fanout` 真的换一批数（求解器按 `layers` 现算）。
    ⚠ 这里有一个**极易做错且看不出来**的分岔：把它实现成「截断到第 i−1 跳」时，数照样变小、
    屏上看不出破绽，但**改道那一支永远不出现**。接缝门为此专设一条模型用例
    （`test/edge-panel-3pages.seam.test.tsx` §模型），截断式实现当场红在
    `expected [] to deeply equal [{ type: 'Warehouse' }]`。
  · `cleanroom-attr` **判不适用**，理由与「差什么才能收」逐条登记在
    `scripts/edge-active-mounts-baseline.json` 的 `gaps.cleanroom-attr.why`（不是空挂账）。

**U4b 排除项同图**
- **不符合 5 页**（有图，但排除项没画进去）：`sim-sandbox` · `project-sim` · `risk` · `order-chain` ·
  `disruption-radius`。`EdgeActivePanel` 是**独立面板**（`views/sim/EdgeActivePanel.tsx`），
  不是画在因果/传导图上的一层；参考件 `:4218` 的图例把 `excluded` 与 `factor`/`rootcause` **并列在同一张图**。
  （`DisruptionRadiusView.tsx:268` 确有 `state:"dim"`，但那标的是「本层 count=0 断链」，
  不是「被反事实排除的因素」——两者都叫「灰掉」，语义完全不同，不许混。）
- **不适用 7 页**：见 §4.3。
- `decision-play` 的那格**从「判不了」落地**：上一版记「本单未逐行读该面板」；本轮读了 ——
  `DecisionPlayPanel.tsx` 全文 `excluded|排除` **0 命中**，且该页无因果图 ⇒ 归入「不适用」。

**U5 结论数字标出处**
- **符合 9 页**：`project-sim` `:437` `<SnapshotBadge … tool="capacity_forecast">` + `:846/:858` `<Provenance>` ·
  `risk` `RiskBoardView.tsx:392/808/815/822/833/840/847/903/1518` `<Provenance src=… formula=… inputs=…>` ·
  `sop-balance` `:368` 六卡统一走共享 `<Provenance>`（六要素）·
  `order-chain` `:442` `<SnapshotBadge … tool="affected_orders">` + `:324` 每句旁挂溯源弹窗 ·
  `plan-generate` `:191` `<SnapshotBadge … tool="plan_generate">` ·
  `decision-play` `DecisionPlayPanel.tsx:1473` 屏上渲染「依据 `{o.provenance.kind}` · `{o.provenance.basis}`」·
  `sim-sandbox` `SandboxConsole.tsx:1505` 屏上渲染「求解器 `{c.provenance.solverKey}` · 输入 …」·
  `cleanroom-attr` `:118-124` 倒推参数 chips 与结果同屏（标「真对象结构·非写死」）+ 求解器 `summary` 原文照登 ·
  `disruption-radius` `:202-211` 「反向扇出链（本体 ref 倒推）：X →（via 字段）Y」+ `:357` 求解器 `summary` 原文。
  ⚠ 这里踩过一次坑：初版探针只认 `SnapshotBadge|Provenance|snapshotVersion|依据|出处`，
  `sim-sandbox` 报 1（疑似注释），差点判「不符合」；**再追一层**才看到它走的是 `provenance.solverKey`
  这条路 —— **「我 grep 不到」和「它不存在」是两个命题**。
- ✅ **三页于 2026-08-16 WO-SANDBOX-53CELLS 全闭**（不符合 → 符合），三页的病各不相同，逐页记：
  - `global-sim` —— 改前全文无 `SnapshotBadge`/`<Provenance>`，`provenance` 只出现在类型定义与
    hover 的 `title=` 串里。现把出处挂到**已有的**三个读数（按期率/总代价/被挤单）上。
    ⚠ 刻意**不新开第一层信息块**：本文件在 `ui-first-layer` 棘轮里 `first=209`（只降不升），
    而 `<Provenance>` 是 hover 浮层，计 `deferred` 不计 `first` —— 改完该门 RC=0。
  - `what-if` —— 改前 deltas 表与影响面计数全裸；**唯一**提到求解器名的地方在**导出物**的 `basis` 里。
    「导出里写了」**不度量**「屏上标了出处」（照铁律 0.6 句式，这是两件事）。现挂 `SnapshotBadge` + 六要素浮层。
  - `optimize-whatif` —— 改前屏上唯一的出处 `ow-family-source` 说的是**模板清单**的出处，
    不是**目标值**的出处；拿它当 U5 成立就是「我用 X 当作 Y 的证据」。现给 Δ 挂溯源，
    并写清优化解敏感的那三样（**模板族 · seed · 扰动清单**），另加一条第一层出处行 `ow-objective-source`。
    对应的机检也刻意落在**那个数字自己**的浮层上，不是「屏上出现过求解器名」。

**U6 结论即动作**
- **符合 8 页**：`sim-sandbox` · `global-sim` · `risk` · `plan-generate` · `sop-balance`（原判不变）＋
  两格**从「判不了」落地**：
  - `order-chain` **符合**：`OrderChainView.tsx:10` `import { useActionDraft }` → `:874` `const adopt = useActionDraft()`
    → `:953` 「采纳结论 → 工单（C10 留痕）」按钮。上一版记「4 处，疑为字段名」——追一层就见真身。
  - `decision-play` **符合**：`DecisionPlayPanel.tsx:1523` `CommitBar` → `POST /a/v1/decisions`
    → `/commit` → `:1539` 「已提交决策 → 派发 ActionDraft，进入 S2 审批链」。
    ⚠ 这一格探针报 **0** —— 因为它走的是 `decisions/commit` 而不是探针词表里的
    `useActionDraft|createActionDraft`。又一次「探针词表写窄」，与 §4.1 开头那两次同形态。
- **不符合 4 页**：`what-if` · `optimize-whatif` · `cleanroom-attr` · `disruption-radius`（探针 0，追一层确认无）
  ＋ `project-sim` **不符合**（**从「判不了」落地**）：全文 `ActionDraft|action-draft|actionTypeKey|adopt`
  **0 命中**；唯一的「采纳」二字在 `ProjectSimView.tsx:1069` 的 `note:` 文案里
  （「结论可采纳为 Action（参数组合 + 推演快照写回）」）—— **屏上写着能采纳，代码里没有那条路**。
  这是本轮最值得单独记一笔的一格：**文案承诺了一个不存在的动作**，比干脆没有更糟。

**U7 同屏问答带本页上下文**（判据：经 `ViewPage` 分发 或 页面自己调 `usePageView`）
- 先说清**这条不是「没接线」，是「接了线接错地方」**（铁律 0.5 三形态，修法完全不同）：
  同屏问答 `QueryDock` 由 `ShellLayout.tsx:563` 在**所有** `/v/` 路径上常驻挂载
  （`onViewPage = location.pathname.startsWith("/v/")`），所以「问答在不在同屏」从来不是问题。
  问题在另一半：`setView()` 的生产调用方只有 `pages/ViewPage.tsx:27` 与
  `components/ScenarioLauncher/useScenarioLaunch.ts:32/85` 两处，而 `App.tsx:141-149` 里**六个页面是专用
  route 直挂**（`v/sim-sandbox` / `v/decision-play` / `v/disruption-radius` / `v/what-if` /
  `v/cleanroom-attr` / `v/optimize-whatif`），**不经过 `ViewPage`** ⇒ 这六页上 `setView` 一次都不会被调到。
  后果全程静默：① `QueryDock.tsx:28` 的 `fetchScene(view)` 带 `enabled: view !== ""` ⇒ 不取本页场景，
  建议问句退化成通用兜底；② `sessionStore.ts:84` `derivePageContext` 把 `view` 塞进 `pageContext.view`
  随查询搭车 ⇒ 编排侧收到的「用户在哪一页」是**上一页残值或空串**。**问答是在的，但它答的不是本页。**
- **符合 12 页（全闭）**：经 `ViewPage` 分发的 6 页（`project-sim`/`global-sim`/`risk`/`order-chain`/
  `plan-generate`/`sop-balance`）＋ WO-HARNESS-UX-GAP-1 接线的 4 页（`what-if`/`optimize-whatif`/
  `cleanroom-attr`/`disruption-radius`，各调 `usePageView(...)`，见 §4.4）＋ **WO-U7-U9-REST 接线的
  末两页**：`sim-sandbox`（`SandboxView.tsx`：`mode === "now"` 时 `setView("sim-sandbox")`——
  收编模式整屏换内嵌页、内嵌页各自报到，沙盘只在主屏态写，无覆盖竞争；视图键定案 = `sim-sandbox`，
  论据链：route `v/sim-sandbox` · entitlement `sim.sandbox` · `NAV_GROUPS key:"sim-sandbox"` ·
  roster 判据库 `EXTRA_ALIAS` 显式 `sandbox→sim-sandbox`）与 `decision-play`（`DecisionPlayView.tsx`
  调 `usePageView("decision-play")`——挂壳不挂面板，面板被 `OrderChainView`/`ChainImpedimentView`
  嵌入复用，嵌入场由宿主页报到）。
  机检：`harness-ux-u7-u9.test.tsx` 的 U7 段对 12 页逐页断言「整应用渲染到该 URL 后
  `sessionStore.view` === 该页键」，每条带**前置哨兵**（先把 view 污染成哨兵值，逼页面自己改回）
  与**反向哨兵**（哨兵不会自己变真键 ⇒ 断言非恒真）。

**U8 看明细不换页**
- **符合 8 页**：有受控展开态（抽屉/浮层/内联）承担「看明细」：
  `sim-sandbox`(21 处) · `risk`(12) · `project-sim`(6) · `order-chain`(5) · `decision-play`(4) ·
  `plan-generate`(4) · `sop-balance`(4) · `what-if`(1) · `optimize-whatif`(1)。
  ⚠ `sim-sandbox` 与 `project-sim` 各有路由跳转，但**追一层后不算违反**：
  `SandboxConsole.tsx:1310` 的 `JumpList onOpen={navigate}` 是**阻滞点交接**（把这条阻滞点交给另一张页去处置），
  `ProjectSimView.tsx:232/233/251` 的 `<Link to="/v/global-sim">` 文案是「把这批一起求全局最优 →」
  「接不住？回全局重排 →」—— 都是**切视角/交接**，不是「想看细节被带走」。
- **不符合 1 页**：
  - `global-sim` —— `GlobalSimView.tsx:153/851` `<Link className={styles.drillLink} to="/v/project-sim?order=…">进项目推演细排 →`。
    **类名逐字就叫 `drillLink`**：下钻本身是靠跳页实现的，正是这条判据点名的那件事。（本单未动，仍排 §5 P1。）
- ✅ **`cleanroom-attr` / `disruption-radius` 于 2026-08-16 WO-SANDBOX-53CELLS 闭**（不符合 → 符合）。
  这两页的病与 `global-sim` **不同**（那是跳走，这是没有），修法也不同 ——
  它们的病是「**求解器早就把明细回来了，页面一行都没渲染**」，于是屏上出现一个数之后**无路可走**：
  - `disruption-radius`：`dr-layer-*` 超出 `CHIP_CAP=12` 的部分只写一句「+N 更多」——**死路**。
    改为内联 `<details>` 就地展开其余对象（首屏仍只出 12 个，第一层密度不涨）。
  - `cleanroom-attr`：① 共享瓶颈只显 `{sharerCount} 方争用`，而「**是哪几方**」（`contention[].sharers`）
    整个丢掉；② 毛利倒挂只显一个「主驱动」徽标，而**逐项成本拆解**（`attribution[]`）整个丢掉。
    两处都改为内联 `<details>` 就地展开，并在成本拆解里显式写清「占比分母 = 总成本，不是营收」
    （不写清会被读成毛利率，读反结论）。
  ⚠ 机检落在 `<details>` 的 **`open` 属性**上，**不落在「那个 id 在不在 DOM 里」**：
  `<details>` 折叠时子节点照样在 DOM 里（jsdom 与浏览器一致），拿「DOM 里没有」当「屏上没显示」的证据
  会当场红 —— 本单第一版就是这么写的（同一形态：「我用 X 当作 Y 的证据，而 X 并不度量 Y」）。

**U9 导出带口径与时间戳**
- **符合 12 页（全闭）**：`what-if` / `optimize-whatif` / `cleanroom-attr` / `disruption-radius` ——
  WO-HARNESS-UX-GAP-1 接线（§4.4）；其余 8 页由 **WO-U7-U9-REST** 接线，全部复用同一份共享件
  `ExportReportButton` + `exportProvenance.ts`（缺口径/缺时间戳直接抛），逐页挂载点见 §4.4：
  `sim-sandbox`（全局读数 + 逐状态变量均值，basis 含会话/tick/世界态出处 MEASURED|DERIVED）·
  `decision-play`（根因/对症方案/推荐方案，逐方案 provenance kind·basis 原文照登；面板嵌入复用时
  不渲染按钮，宿主页不该冒出 pageKey=decision-play 的导出）· `project-sim`（capacity_forecast +
  快照 + **全部入参**）· `global-sim`（portfolio twoStage + 快照 + 主目标口径）·
  `risk`（处置计划表换共享件——**旧 `exportPlanRows` 整个退役**，它页脚自称「含口径」却通篇无生成时间
  无出处，正是上一版落地的那格）· `order-chain`（affected_orders + 快照 + 基地筛选口径）·
  `plan-generate`（plan_generate + 快照 + 目标面板全量入参含硬约束开关——这页「改动即重算」，
  少记一个目标值第三方就复不出屏上这三个方案）· `sop-balance`（非单次求解而是**版本仓记录**，
  出处 = 记录 id + 状态 + updatedAt，未选中版本时各段诚实空态）。
  机检：同一份测试的 U9 段对 12 页逐页断言屏上导出入口 + `?` 记号在位，另三条纯函数断言
  （文档含生成时间+口径与出处+表格本体 · 缺口径/缺时间戳必抛 · 空结果诚实留白不补编）。

### 4.2 被拆出去的那一半 —— 4 条明账，交给门 B（**本表不假装能判**）

§2.1 的六条改写各把「不可判的那半」拆了出来。**拆出去 ≠ 消失**，逐条登记如下。
门 B（真浏览器 / Playwright）至今**未建** —— 所以这四条今天**确实没有验收方式**，如实写在这里。

| # | 拆出去的那半（原判据的另一面） | 为什么静态与单页渲染都够不着 | 要判它得有什么 |
|---|---|---|---|
| **B-1** | **U1 的时延面**：改完输入到结果更新**要多久**、中间有没有一段仍在显示旧值的窗口 | 「多久」是运行期量，源码里不存在这个数；页面可能既自动重算又留着按钮（两者并存不矛盾） | 真浏览器：改一个输入、**不点任何按钮**，断言结果 DOM 在 N 毫秒内变了 |
| **B-2** | **U3 的「本体链」面**：点节点弹出的面板里，那条**本体链**是否逐字齐全 | 本仓多数页无「本体链」对位实现；逐字要求会让每一格永远判不了。它属 R13 溯源链的另一条线 | 归 R13 溯源链验收，不在本表射程 |
| **B-3** | **U5 的跨屏面**：**同一事实**在两屏上的值一不一致（口径分家还是有一处算错） | 需要同时开两屏比对同一个数，静态与单页渲染都够不着 | 真浏览器：两屏同开，断言同一 `objectId.prop` 两处读数相等 |
| **B-4** | **U7 的内容面** ＋ **U8 的几何面** | U7 内容面要真跑一次编排 + 真模型才知道答得对不对（本表只判「问答知不知道自己在哪一页」）；U8 几何面要渲染后量浮层贴不贴边、抽屉挡不挡 | U7 归编排侧评测；U8 归门 B |

⚠ **这四条不许被读作「大概也行」。** 它们和「符合」是两个不同的命题 ——
**「表里判不了 0」与「这条要求已经验完」之间，隔着的就是这四条。**

#### 4.2.1 门 B 已建（2026-08-16 · WO-GATE-B-SPLITACCOUNT）—— 它守住了什么，**没有**守住什么

> ⛔ 先说清最容易被误读的那一句：**门 B 建成 ≠ 这四条验完了。**
> 上一版这里写「门 B（真浏览器 / Playwright）至今**未建**」，那句话现在**部分过期**：
> 门建了，但它建成的是**账的守卫**，不是**真浏览器**。两者差得很远，所以本节把界限写死。

`scripts/check-harness-ux-splitaccount.mjs`（别名 `harness-ux-splitaccount:check`，已接 `pnpm gates`）。
**七条判据**：① 账形态完整（三栏非空 + 点名 `U#`）· ② **双向绑定**（§2.1 说挪走的必须有人认领；
B-x 认领的 `U#` 必须在 §2 判据表里真实存在）· ③ **出口不指向空气**（`R13` ⇒ 本体里必须真有 R13；
「门 B」⇒ **本门必须真在 `pnpm gates` 里**，自指接线证明；「编排侧评测」⇒ §5 必须有单）·
④ **每条账有单**（§5 里必须有一行点名它且归属栏非空）· ⑤ **B-2 内容面现算**（见下）·
⑥ **不许静默销账**（棘轮：销账 / 改绑 / 改口 / 新账都要显式 `--tighten`）· ⑦ **自陈不许超发**（见下）。

**逐条可机检判定（本单的核心产出 · 四条各判一次 · 不能机检的写清「差什么」）**：

| # | 内容面今天能不能机检 | 判定理由（不许只写「不能」） | 差什么才能机检 → 派单 |
|---|---|---|---|
| **B-1** | **不能** | 「改完到结果更新要多久」是**运行期量**，源码里不存在这个数。它的失败态（存在一段仍显示旧值的窗口）也只在渲染后才有 | 一个能渲染真页面的 harness（Playwright / happy-dom）+ 一条「改一个输入、不点任何按钮、断言结果 DOM 变了」的用例 → §5 `WO-GATE-B-BROWSER-HARNESS` |
| **B-2** | **必要条件能**（本门判据⑤ 已机检）· **充分条件不能** | 账面原写的理由是「本仓多数页无『本体链』对位实现」—— **那不是「判不了」，那是「可判且判出来是不符合」**。这一条今天已从「写在文档里的承诺」变成机器判据；「逐字齐全」仍需渲染后看，归 R13 | 充分条件需渲染后读面板 DOM；归 R13 溯源链验收 → §5 `WO-R13-ONTOCHAIN-PANEL` |
| **B-3** | **不能**，且**缺的前置比 B-1 更靠前** | 要比对「同一事实在两屏上的值」，先得知道**哪个事实出现在哪两屏**。本仓今天**没有**「事实 → 读取它的页面集合」的可枚举注册表 —— 没有它，连「该比哪两个数」都列不出来，真浏览器也无从下手 | ① 先建那份注册表（或从各页 `useQuery` 的 queryKey + 取值路径静态抽一份）② 才谈得上两屏比对 → §5 `WO-FACT-USAGE-REGISTRY`（前置）+ `WO-GATE-B-BROWSER-HARNESS`（后续） |
| **B-4** | **不能**（两面各缺一样，**不许合成一张单**） | U7 内容面要**真跑一次编排 + 真模型**才知道答得对不对（本表只判「问答知不知道自己在哪一页」）；U8 几何面要**渲染后量**浮层贴不贴边、抽屉挡不挡 | U7：一份编排侧评测集（问题 + 期望要素 + 判分口径）→ §5 `WO-QOS-PAGECTX-EVAL`；U8：渲染后几何量测（同 harness）→ §5 `WO-GATE-B-BROWSER-HARNESS` |

**判据⑤ 的现算口径（B-2）**：扫描面 = §4.1 的 U3「**符合**」段里点名的**面板文件**（现算不手抄；
刻意不含「不符合」段的 `LayeredDag.tsx` —— 那是共享组件不是面板，收进来就成了代理指标）。
逐个**剥注释后**看有无 `本体链`/`ontologyChain` 对位实现，并断言 B-2 账面那句「本仓多数页无对位实现」
**仍然属实**（`有对位实现 × 2 ≤ 面板文件数`）。**2026-08-16 现算 = 3 个面板文件
（`ProjectSimView.tsx` / `SandboxConsole.tsx` / `InspectorNodePanel.tsx`）· 有对位实现 0 个** ⇒ 账面属实。
若将来某个面板长出了本体链，这个数会变、门会红，**逼着回来重判这条账**（对位实现过半 ⇒ 账面理由不再成立）。

**门 B 今天到底机检了这四条的哪一面 —— 自陈，且被门自己核对（判据⑦）**：
**内容面机检 1/4**（仅 **B-2**，且只到**必要条件**）。其余 **3 条（B-1 / B-3 / B-4）的内容面本门一律不机检**，
只机检它们的**账**：不许消失、不许悬空、不许无人认领、不许改绑不吭声。
这个 `1` 是**门现算**出来的（`CONTENT_CHECKED`），谁把这句话改成 `4/4` 而没有真加判据，门当场红 ——
拦的正是本门建成之后最可能发生的那件事：**「门 B 建好了 ⇒ 那四条都验了」**。

### 4.3 「不适用」逐格登记（8 格 · 每格带理由 · 不许空着）

| 页 | 判据 | 为什么这条判据在这一页无处落脚 |
|---|---|---|
| **`cleanroom-attr`** | **U4** | **本页没有可关的因果边** —— 详见下方「U4 那一格为什么是不适用」，**三块拆开说** |
| `cleanroom-attr` | U4b | 同上 |
| `decision-play` | U4b | 同上：`DecisionPlayPanel.tsx` 全文无因果图组件，`excluded\|排除` 0 命中 |
| `global-sim` | U4b | 页内无因果/根因图（U3 已判「连图都没有」）。**没有图，就谈不上「排除项留不留在图上」** |
| `optimize-whatif` | U4b | 同上 |
| `plan-generate` | U4b | 同上 |
| `sop-balance` | U4b | 同上 |
| `what-if` | U4b | 同上 |

`不适用` **不是** `判不了` 的近义词，也**不是**免死金牌。它只在一种情形下合法：
**判据预设的那个对象在这一页上不存在**，于是问题本身问错了对象。
本表今天有**两条**判据出现这种情形（U4b 七格 + U4 一格）：
#### U4 那一格为什么是「不适用」（2026-08-16 · WO-EDGE-PANEL-3PAGES 逐块实测）
⚠ 先声明这不是「没做」：同批的另外两页（`order-chain` / `disruption-radius`）**判定可挂并已收口**。
三页同一批判、结论相反，靠的是同一把尺，不是各挑一个说法。
**尺**：U4 问的是「能在页内**排除/关闭一个因素**，并同屏看到排除前后的差异」。
落到实现上就是一句话 —— **这一页的数，是不是由一条条可断的因果边推出来的**。
**实测（含金丝雀，报否定结论必须给）**：
```
grep -rn "sim/|SimSession|propagation|counterfactual|stateVar|tick" apps/frontend-shell/src/views/cleanroom/
  → 只命中 2 行 import ... from "../sim/shared"（共享的 usePageView / 导出按钮，是 UI 件不是推演概念）
金丝雀（同一命令、同一扫描面，只换符号）：grep -rc "invokeSolver" .../CleanroomAttrView.tsx  → 5
⇒ 工具是好的，那个「零个推演符号」是真的零。
```
⇒ 在本页拨动任何一条传导边（`PropagationRule`），屏上**没有一个数会动**。
挂 `EdgeActivePanel` 上去就是「点不动的面板」，那是把『不适用』伪装成『符合』。
**本页确实有边，但不是这一族 —— 三块必须拆开，不许一句盖住三个事实**（这正是铁律 0.6 点名的病）：
**与 `disruption-radius` 的分野（同一把尺量出相反结论，理由必须写出来）**：
那一页**整页**就是一条可断的链（求解器唯一入参就是 `layers`，屏上 `dr-fanout` 逐跳画的就是它），
故本单给它做了页自有的关系边开关；本页只有三分之一块有链，
给一页三块里的一块加开关 ⇒ 「切到另一个 tab 开关就没了」，那是把横向能力做成局部特例。
**差什么才能把这一格从「不适用」翻成「符合」**（不许只写「未做」）：一张单做两件事 ——
(a) **接线**：给 `views/cleanroom/deriveArgs.ts` 的 `walk()` 加 `disabledEdges` 形参，
与 `DisruptionRadiusView.deriveDisruptionLayers` 已落地的那一版**同构**（判据可直接照抄：
排序在过滤之前 ⇒ 关掉首选则次选顶上，是确定性的）；
(b) **产品裁决**：三个 tab 只有一个有开关，是接受这种不对称，还是把三块「可关的东西」
统一抽象一层（瓶颈那块可关的其实是『某个争用方』、毛利那块是『某个成本项』——
那是另一种反事实，不是关系边）。(b) 不是接线，故本单不单方面做。
**U4b 那 7 格不是欠账，别排进优先级。** 它们的用户价值（「我关掉的是什么，不能让它凭空消失」）
由 **U4** 承担 —— `EdgeActivePanel` 对关掉的边用**三路编码**表达降级
（虚线 ＋ 不透明度 0.72 ＋ 显式「已关闭」文字标记，见该文件头注释），排除项本来就不会消失。
本轮新增的 `disruption-radius` 页自有开关**照搬同一条纪律**（虚线 ＋ 显式「已关闭」文字 ＋
关掉的边留在列表里可拨回），并另加一条本页特有的：**「已关 N 条 · 下方是假设关掉后的读数」徽标留在第一层**
（面板折起来也看得见）—— 否则用户会把反事实读数当成现状，那比看不到开关更坏。
**这 8 格全部随页面结构变化而失效，届时必须当场改回 `不符合`**：
U4b 的 7 格 —— **若将来这几页长出了因果图**，判据的对象出现了，豁免就失效；
U4 的 1 格（`cleanroom-attr`）—— **若本页长出以 `SimSession` 为世界的推演块**，同理失效。
（这是 `不适用` 与 `符合` 的关键区别：前者随页面结构变化而失效，后者不会。）

### 4.4 本单真改了哪 4 页（判据 U7 ＋ U9 · 各改前/改后）

挑页判据 = §4 表里「**同一条判据在多个页面上同时不符合**」——那类改动一份实现能收多页。
本轮选 U7（当时 12 页全判不了，落地后 2 页不符合）与 U9（当时 10 页不符合），
落在**同一批 4 个页**上：它们恰好都是走专用 route 的净室/通用推演页，一次接线两条判据同时闭。

| 页 | U7 改前 → 改后 | U9 改前 → 改后 | 挂载点 |
|---|---|---|---|
| `what-if` | 判不了 → **符合** | 不符合 → **符合** | `WhatIfView.tsx` `usePageView("what-if")` + 标题行 `<ExportReportButton pageKey="what-if">` |
| `optimize-whatif` | 判不了 → **符合** | 不符合 → **符合** | `OptimizeWhatifView.tsx` 同上 |
| `cleanroom-attr` | 判不了 → **符合** | 不符合 → **符合** | `CleanroomAttrView.tsx` `usePageView` + **三个求解器块各挂一处导出**（各块出处不同，不合并） |
| `disruption-radius` | 判不了 → **符合** | 不符合 → **符合** | `DisruptionRadiusView.tsx` 同上 |

**一份实现、多页挂载**（对位参考件 `:3587` 把「导出」与「同屏问答」并成一条跨页 chip 条）：
- `views/sim/exportProvenance.ts` —— 纯函数拼导出物。**缺口径或缺时间戳直接抛**：
  U9 的失败模式是「导出了一份没人能复算的表」，而那种失败**在屏上看不出来**（表格照样漂亮），
  所以判据写在**生产代码入口**，不是只写在测试里。
- `views/sim/shared.tsx` 的 `usePageView` / `ExportReportButton` —— 报到与导出按钮。
- 各页的 `basis`（口径行）**逐页不同且必须逐页写**：净室三块带**倒推参数**（入参非写死，
  不写清则复算时会用另一组），优化推演带**模板族 + seed + 扰动清单**（解对这三样都敏感）。

**分层与主题**（本仓踩过的两个坑，逐条对上）：第一层只留「⬇ 导出」按钮 ＋ `?` 记号（那是「名字」不是说明），
「导出物里有什么、凭什么能复算」是口径 ⇒ 进 `InfoPopover`（R-UI-3）。应用内**零字面色值**，
颜色全走既有 `btn` 类，`.exportWrap` 刻意不设 `font-size`（不顶 D3 字号棘轮），暗/亮两套主题各自成立。
导出物自己那套浅色排版是**刻意**的：它是**离开应用的独立文档**，那里不存在本应用的 `:root` 变量表，
写 `var(--txt)` 会解析成空值把字变透明 —— 与 `RiskBoardView` 的「导出最终规划」同一处理。

### 4.5 WO-SANDBOX-53CELLS 真改了哪 8 格（2026-08-16 · 逐格 file:line + 机检）

**挑格判据同 §4.4：「同一条判据在多个页面上同时不符合」优先** —— 那类改动一份实现能收多页。
本轮按「一次改法能复用到几页 × 每页改动量」排序（完整排序表见 §5.1），做了收益最高的四条判据。

| # | 判据 | 页 | 改前的**具体**病 | 改法 | 机检 |
|---|---|---|---|---|---|
| 1 | **U3** | `order-chain` | `ofc-dag`/`problem-dag` 挂 `LayeredDag` 时没传 `onNodeClick`（该 prop 可选）⇒ 点了静默无事 | 补挂载点 + `DagNodeInspector`；规则栏取后端真值 `judges.*.ruleRefs` | `sim-ux-u3-u8` U3-C1/C2/C3 |
| 2 | **U3** | `disruption-radius` | 同上（`dr-fanout`） | 同上；规则标 `projection`（净室页无业务规则库） | `sim-ux-u3-u8` U3-C4 |
| 3 | **U1** | `what-if` | `wi-run` 提交闸 + 命令式 `run()` 写 state | 假设四维进 `queryKey`，闸删除；文本框 300ms 防抖 | `what-if` U1 那条 |
| 4 | **U5** | `what-if` | deltas 表与影响面计数全裸；求解器名只在**导出物**里 | `SnapshotBadge` + `<Provenance>` 六要素 | `what-if` C1/C3 沿用 |
| 5 | **U5** | `global-sim` | 全文无 `SnapshotBadge`/`<Provenance>` | 三个读数各挂溯源（浮层，不占第一层） | `sim-ux-u1-u5` U5-C1 |
| 6 | **U5** | `optimize-whatif` | 唯一出处 `ow-family-source` 说的是模板清单不是目标值 | Δ 挂溯源（模板族·seed·扰动清单）+ 第一层出处行 | `sim-ux-u1-u5` U5-C2 |
| 7 | **U8** | `disruption-radius` | 「+N 更多」是**死路** | 内联 `<details>` 就地展开其余对象 | `sim-ux-u3-u8` U8-C1 |
| 8 | **U8** | `cleanroom-attr` | `contention[].sharers` 与 `attribution[]` 求解器已回、页面零渲染 | 两处内联 `<details>` + 占比分母诚实位 | `sim-ux-u3-u8` U8-C2 |

**一份实现、三处挂载**（`views/sim/DagNodeInspector.tsx`，对位 §4.4 的 `exportProvenance.ts` 同一处理）：
- `src`(来源) 与 `rule`(规则) **必填**，空值 `assertDagNodeFacts` **直接抛**。
  理由与 U9 那次相同：U3 的失败模式是「面板点得开，里面只有一句标题」，
  而那种失败**在屏上看不出来**（抽屉照样弹、照样好看），只有真去核数字的人才发现无从下手。
  所以判据写在**生产代码入口**，不是只写在测试里。
- `ruleKind` **分两档且屏上分得出**，这是诚实位不是装饰：
  `ruleKey`（规则库里查得到 —— `order_fullchain` 的 `judges.*.ruleRefs` = C02/C06/C15…）
  与 `projection`（**确定性投影规则** —— 净室页与 `problem-dag` 无业务规则库时代码里逐字实现的判定逻辑）。
  在没有规则键的地方硬写一个规则键 = **把用户支去规则库里找一个不存在的东西**。
  `problem-dag` 归 `projection` 是**实测**出来的：`OrderRootChainSchema`（`packages/contracts/src/planviews.ts`）
  的 `layers[]` **只有 `kind` 与 `label`，没有任何 ruleRef**。

**测试为什么是接缝测试而不是组件测试**（假绿第 9 形态的对策）：三条 U3 断言全部**真渲染页面 →
真点 DAG 节点 → 断言面板两栏**，且规则栏**咬后端真值**（`ruleRefs`）而非前端字面量 ——
页面改成写死一个「C02」它仍绿，但**引擎改了 `ruleRefs` 而页面没跟上它会红**。它验的是接缝。
另配两条**反向断言**：关闭后面板真的消失（防「面板一直在 DOM 里」）、`<details>` 的 `open` 真的翻转。

**分层与主题**：新文件 `DagNodeInspector` 实测 `first=1 / deferred=12`，已 `--tighten` 落进
`ui-first-layer` 基线的 `unlisted` 段（只收紧）；`.module.css` **零字面色值**（全走既有 token，暗/亮各自成立），
**不新开字号档**（只复用已有的 12 / 12.5 两级，D3 棘轮只降不升）。
#### 4.4.1 WO-U7-U9-REST（2026-08-16）：剩两页 U7 ＋ 剩八页 U9 —— 至此两条判据 12 页全闭

| 页 | 判据 | 改前 → 改后 | 挂载点 |
|---|---|---|---|
| `sim-sandbox` | U7 ＋ U9 | 不符合 → **符合**（两条） | `SandboxView.tsx`：`mode === "now"` 时 `setView("sim-sandbox")`（收编模式零写入，不盖内嵌页报到）＋ 头部 `<ExportReportButton pageKey="sim-sandbox">` |
| `decision-play` | U7 ＋ U9 | 不符合 → **符合**（两条） | `DecisionPlayView.tsx` 壳调 `usePageView("decision-play")`；`DecisionPlayPanel.tsx` 挂导出（`embedded` 时不渲染，宿主页不冒 pageKey=decision-play 的导出） |
| `project-sim` | U9 | 不符合 → **符合** | `ProjectSimView.tsx` `.head` 挂导出（capacity_forecast + 快照 + 全部入参） |
| `global-sim` | U9 | 不符合 → **符合** | `GlobalSimView.tsx` header 挂导出（portfolio twoStage + 快照 + 主目标口径） |
| `risk` | U9 | 不符合 → **符合** | `RiskBoardView.tsx` 处置计划表旧 `exportPlanRows` **整个退役**换共享件（页脚自称「含口径」却无时间戳无出处，§4.1 U9 段有案） |
| `order-chain` | U9 | 不符合 → **符合** | `OrderChainView.tsx` `.head` 挂导出（affected_orders + 快照 + 基地筛选口径） |
| `plan-generate` | U9 | 不符合 → **符合** | `PlanGenerateView.tsx` `.head` 挂导出（目标面板全量入参 + 硬约束开关进 basis） |
| `sop-balance` | U9 | 不符合 → **符合** | `SopBalanceView.tsx` `.head` 挂导出（版本仓记录：id + 状态 + updatedAt 为出处） |

**沙盘视图键定案 = `sim-sandbox`**（上一版 §5 P1 挂账的「报哪个要先对齐」已裁决）。
论据链：route 路径 `v/sim-sandbox`（`App.tsx`）· entitlement `sim.sandbox`（`SimSandboxGuard` 查它）·
`NAV_GROUPS key:"sim-sandbox"`（`ShellLayout.tsx`）· 本体 §7 判据⑦ 记的也是 `sim-sandbox`；
`sandbox` 裸键只剩两处局部叫法（`SandboxView.tsx` 的 `EdgeActivePanel pageKey` 与
`check-edge-active-mounts.mjs` 的旧手抄名单）；ssot 单建的 roster 判据库
（`scripts/lib/sim-page-roster.mjs`）`EXTRA_ALIAS` 显式 `sandbox→sim-sandbox` —— 四票对一个别名，
且别名方向一致指向 `sim-sandbox` 为规范键。

**复用不重写**：8 处挂载全部是同一个 `ExportReportButton` + `exportProvenance.ts`（WO-HARNESS-UX-GAP-1 建），
本单零新增导出实现；各页只写自己的 `basis`（口径行）与 `sections`。
机检扩展：`harness-ux-u7-u9.test.tsx` 的 PAGES 从 6 页扩到 **12 页**，U7/U9 两段各 12 条逐页断言
（沙盘为全仓最重页，单页 timeout 显式给到 60s——断言没松，只是加载本来就慢），28/28 绿。

---

## 5 · 优先级

| 级 | 事项 | 为什么是这一级 | 归谁 |
|---|---|---|---|
| **P0** | **给「推演页」定判据并落成单一来源** | §3.2 三个源头给出三个不同的集合，`check-edge-active-mounts.mjs` 的 9 页是**手抄**的。不定这个，「所有推演的功能」这句话永远不可核对——**后面所有工作都建在流沙上** | 审核方（产品判断）+ 一张接线单 |
| ~~**P0**~~ **已闭** | ~~**`cleanroom-attr` / `disruption-radius` / `order-chain` 三页补 U4**~~ | 这三页是沙盘决策链上的模式（归因/影响半径），却从未被 U4 那道门问过。**不是"没做好"，是"没被问过"** | ✅ `WO-EDGE-PANEL-3PAGES`：2 页补挂 + 1 页判**不适用**（§4.3 逐块带理由 + 差什么才能收）。棘轮基线 3 → **1** |
| **P2**（本轮新立） | **`cleanroom-attr` 隐性集中度那一块的多跳 ref 链做成可关的边** | 上一条收口时逐块实测发现：本页三块里**只有这一块有可断的边**，而它今天关不了。接线部分与 `disruption-radius` 已落地那版**同构**（可照抄），卡的是产品裁决：三 tab 只有一个有开关是否可接受 | 一张前端单 + 一次产品裁决（判据全文见 §4.3） |
| **P1** | **U1 改输入即重演** —— `what-if` / `optimize-whatif` / `sop-balance` 撤提交闸 | 参考件里这条是**逐字写着的**，且它的失败模式最坏：用户改完不点，**以为在看新结果，实际在看旧的** | 一张前端单（三页，注意 `optimize-whatif` 走真 CP-SAT，需先确认重解成本） |
| **P1** | **U2 分步标口径** 横向铺开（今天只有 `project-sim` 一页） | 它是「凭什么信这个结论」的唯一抓手；没有它，R13 可溯源在推演页上只剩一句口号 | 逐页单 |
| **P2** | **U4b 排除项与主因同图** | **5 页不符合**（有图但排除项没画进去），另 7 页**不适用**（无图 ⇒ 判据无处落脚，§4.3——别把这 7 页排进来） | 一张前端单 |
| **P2** | **~~U9 导出带口径与时间戳~~ ✅ 已闭（WO-U7-U9-REST，2026-08-16）** | 决定这一屏能不能进 S&OP 决议附件。**12 页全闭**：前 4 页 WO-HARNESS-UX-GAP-1，剩 8 页 WO-U7-U9-REST，全部复用同一共享件（§4.4.1） | ~~逐页单~~ 已交付 |

**⇩ 以下四条是 2026-08-16 WO-HARNESS-UX-GAP-1 新增/改写的优先级（前面几条保持原样）。**

| 级 | 事项 | 为什么是这一级 | 归谁 |
|---|---|---|---|
| **P0** | **`project-sim` 的 U6：屏上写着能采纳，代码里没有那条路** | `ProjectSimView.tsx:1069` 的 `note:` 文案写「结论可采纳为 Action（参数组合 + 推演快照写回）」，而全文 `ActionDraft\|actionTypeKey\|adopt` **0 命中**。**文案承诺了一个不存在的动作** —— 这比干脆没有更糟：用户按这句话去等一张工单，永远等不到。两条路二选一（接上 / 撤文案），但**不许维持现状** | 一张前端单（先裁决接不接） |
| **P1** | **~~`sim-sandbox` / `decision-play` 补 U7 报到~~ ✅ 已闭（WO-U7-U9-REST，2026-08-16）** | 视图键已裁决（**`sim-sandbox`**，论据链见 §4.4.1）：route / entitlement / NAV_GROUPS / 本体 §7 四票对一个别名。两页各一行接线（沙盘带 `mode === "now"` 条件防覆盖内嵌页报到），机检 12 页逐页断言全绿 | ~~一张前端单~~ 已交付 |
| **P1** | **`global-sim` 的 U8：下钻靠跳页** | `GlobalSimView.tsx:153/851` 的类名逐字就叫 `drillLink`，`<Link to="/v/project-sim?order=…">进项目推演细排 →`。这是判据点名的那件事本身：**想看细节 ⇒ 被带走 ⇒ 现场清零** | 一张前端单 |
| **P2** | **~~`risk` 的 U9：「含口径」是页脚自称~~ ✅ 已闭（WO-U7-U9-REST，2026-08-16）** | 旧 `exportPlanRows` **整个函数退役**换共享件 `ExportReportButton`：basis 含 risk_timeline 窗口/阈值 + livePlan 杠杆注记，导出物带生成时间与求解器出处（缺口径直接抛，那句自称再也没有生存空间） | ~~一张前端单~~ 已交付 |
| **P2** | **`cleanroom-attr` / `disruption-radius` 的 U8：不是跳页，是根本没有下钻** | 这两页受控展开态命中 **0**，明细全平铺。与 `global-sim` 的病**不同**（那是跳走，这是没有），修法也不同——别合成一张单 | 一张前端单 |
| **P3** | **U5/U7/U8/U3 的判不了项 → 门 B 真浏览器判据** | 静态永远判不了它们；要么上 Playwright，要么**如实承认这四条今天没有验收方式**（后者也比假装有强） | 门 B 单 |

**⇩ 以下四条是 2026-08-16 WO-GATE-B-SPLITACCOUNT 新增 —— §4.2 四条明账各自的「差什么才能机检」，
逐条落成一张可派的单。** 在此之前它们只是四行承诺：**登记了、有理由、但没有任何人被指派去做**。
门 B 判据④ 现在盯着这张表：**某条 B-x 在这里没有归属栏非空的行 ⇒ 门红**（挂账不许退化成「诚实地永远不做」）。

| 级 | 事项 | 为什么是这一级 | 归谁 |
|---|---|---|---|
| **P2** | **`WO-GATE-B-BROWSER-HARNESS` · 建真浏览器 harness，闭 **B-1** 的时延面 ＋ **B-4** 的 U8 几何面** | 这两条是**同一个缺口**（缺渲染后的量），一份 harness 同时收两条，拆两张单是重复投入。**范围写死**：Playwright（或 happy-dom + jsdom 量测）跑起 `VITE_MOCK=1` 前端，两条用例 —— ① 改一个输入、**不点任何按钮**，断言结果 DOM 在 N ms 内变了（B-1）；② 打开抽屉/浮层，断言其 bounding box 不越出视口且不遮挡结论区（B-4·U8）。**先做 `what-if` 一页打通链路**，别一上来铺 12 页 | 一张门单（中画像：跑 frontend vitest + 一个 headless 浏览器） |
| **P2** | **`WO-FACT-USAGE-REGISTRY` · 建「事实 → 读取它的页面集合」注册表，这是 **B-3** 的**前置**（不是 B-3 本身）** | **B-3 卡的不是浏览器，是「连该比哪两个数都列不出来」。** 今天没有任何地方能回答「`objectId.prop` 这个事实出现在哪几屏」。修法二选一：① 各页显式登记读取的事实键；② 从各页 `useQuery` 的 queryKey + 取值路径**静态抽**一份（可先抽后核，抽不出的诚实留白）。**没有它，B-3 派给谁都做不了** | 一张接线单（轻画像：只读 + 建注册表 + 加一致性断言） |
| **P3** | **`WO-R13-ONTOCHAIN-PANEL` · **B-2** 的充分条件（「本体链逐字齐全」）归 R13 溯源链验收** | 必要条件（对位实现在不在）门 B 判据⑤ 已机检，**今天实测 3 个面板 0 个有** ⇒ 现状是**不符合**而非判不了。要不要补这条实现属产品判断（补了才谈得上「逐字齐全」）。**先裁决补不补，再谈怎么验** | R13 线（先由审核方裁决补不补） |
| **P3** | **`WO-QOS-PAGECTX-EVAL` · **B-4** 的 U7 内容面：编排侧评测集** | 「同屏问答答得对不对」要真跑一次编排 + 真模型，**这不是前端门能判的**，也不该混进 B-4 的 U8 那张 harness 单（两面缺的东西完全不同）。要一份评测集：问题 + 期望要素 + 判分口径，跑在 agentcore 侧 | 一张编排侧单（重画像：要真调模型或高保真 mock） |

⚠ **本单刻意不排 U6 的优先级**：「结论即动作」在 `what-if`/`optimize-whatif`/`cleanroom-attr`/
`disruption-radius` 四页缺失，但这四页是**净室通用页**（与租户本体无关），它们该不该产生 Action 草稿
**是产品决策不是缺陷**——硬补会造出「在一个通用假设页上生成全租户 Action」这种更糟的东西。**登记备裁。**

### 5.1 「不符合」全量优先级表（2026-08-16 WO-SANDBOX-53CELLS 建 · 按**判据**排不按页排）

**排序判据不是「哪页最烂」，是「一次改法能复用到几页」。** 逐页做等于把同一件事想 12 遍；
按判据做的话，一份实现（共享组件 / 同一种接线）能一次收多页 —— §4.4 与 §4.5 都是这么挑的。

> 起点是本单开工时的 **53 格不符合**。⚠ 其中 **13 格不归本单**：
> `U7`(2) + `U9`(8) 由 `WO-U7-U9-REST` 做，`U4`(3) 由 `WO-EDGE-PANEL-3PAGES` 做 ——
> 三张单**靠判据编号分工，不靠页面分工**，所以同一页的不同判据可能由不同单在改。

| 序 | 判据 | 开工时不符合页数 | 一次改法能复用几页 | 预估改法 | 本单处置 |
|---:|---|---:|---:|---|---|
| **1** | **U3** 点节点看凭什么 | 10 | **3**（有图的那 3 页）+ 7 页要先造图 | 有图的：补 `onNodeClick` + 共享 `DagNodeInspector`（**改动量最小、收益最高**：组件本就支持，页面没挂）。无图的：得先有过程图，那是造功能不是接线 | ✅ 做了 2 页（`order-chain`/`disruption-radius`）· `risk` 挂账（见下） |
| **2** | **U2** 分步标口径 | 11 | **≈11**（若建共享「求解步骤条」组件） | 每页声明**自己那条真实求解链**（数据源/求解器键/规则），共享组件渲染「第 N/M 步」并让步骤态真正**分段揭示结果**。⚠ 不是把业务流程步骤改个名字冒充 —— `sop-balance`/`decision-play` 正是被这一点判红的 | ⛔ 未做（最大的一块，需一张专单，见 §5.2） |
| **3** | **U5** 结论数字标出处 | 3 | **3** | 已有 `SnapshotBadge`/`<Provenance>` 两个共享件，逐页挂即可；难点只在**写对每页的口径**（谁算的·算在什么之上） | ✅ **3 页全闭** |
| **4** | **U8** 看明细不换页 | 3 | **2 + 1**（两种病，修法不同） | ①「明细已取回却没渲染 / 只留一句『+N 更多』」⇒ 内联 `<details>` 就地展开（2 页）；②「下钻靠 `<Link>` 跳页」⇒ 要把目标页那段搬成抽屉，改动量大得多（1 页） | ✅ 做了①的 2 页 · `global-sim` 属②，挂账 |
| **5** | **U4b** 排除项与主因同图 | 5 | **5**（若把 `EdgeActivePanel` 的关闭态投影进各页的图） | 让被 `disabledRuleKeys` 关掉的边**留在因果/传导图上并可见地降级**（虚线＋降透明度＋「已关闭」标记），而不是只活在独立面板里 | ⛔ 未做（见 §5.2；且它与 `WO-EDGE-PANEL-3PAGES` 在动的 `EdgeActivePanel` 有耦合面，**刻意避让**） |
| **6** | **U6** 结论即动作 | 5 | **1 + 4** | `project-sim` 那格是**真缺陷**（文案承诺了不存在的动作，已排 P0）；其余 4 页是**净室通用页**，该不该产生 Action 属产品裁决，**不许硬补** | ⛔ 未做（1 格待裁接不接 · 4 格备裁） |
| **7** | **U1** 改输入即重演 | 3 | **1 + 2** | `what-if` 是纯前端撤闸（廉价）；`optimize-whatif` 走**真 CP-SAT**、`sop-balance` 的五个闸串的是 **S&OP 业务流程**（评审→平衡→定稿），两者撤闸前都得先量重解成本/先裁决语义 | ✅ 做了 `what-if` · 另 2 页挂账（见 §5.2） |
| — | U7 / U9 / U4 | 13 | — | — | 🚦 **不归本单**（`WO-U7-U9-REST` / `WO-EDGE-PANEL-3PAGES`） |

**为什么 U2 排第 2 却没做**：它的页数最多（11），但它是**唯一一条今天在本仓没有任何共享件可复用**的判据 ——
U3 有 `LayeredDag`、U5 有 `<Provenance>`、U8 有 `<details>` 惯例，而「推演过程分几步算」这件事
每页的**语义**都不同（`cleanroom-attr` 是三块各一条链、`risk` 是三层求解、`order-chain` 是三判并联）。
硬在一天内铺 11 页，产出的会是 11 个长得像步骤条、但**步骤态不真正驱动结果分段**的装饰件 ——
那正是判据 U2 本身点名要排除的东西（「业务流程步骤不算」）。故拆成独立一张单，见 §5.2。

### 5.2 本单挂账的格 —— **差什么才能做** + 对应的可派单

| 格 | 差什么才能做（不是「未做」，是**前置**） | 可派的具体单 |
|---|---|---|
| **U3 × `risk`** | `ProvenanceDag` 是 **cockpit 等页共用**的组件，且它的 `DagNode` 契约里**只有 `basis`（依据）没有 `rule`**；`NodeProv` 又是 **hover** 不是 click。差两样：① 一个**不外溢**的改法（给该组件加**可选** `onNodeClick`，不传则维持今天的 hover 行为，零回归）；② `plan_rootcause` / `gap_attribution` 的节点上**有没有规则键可给** —— 若引擎侧确实没有，就得照本单 `problem-dag` 的办法记 `projection` 并说清 | **WO-U3-RISK-DAG**（中画像）：给 `components/ProvenanceDag.tsx` 加可选 `onNodeClick` + 在 `RiskBoardView` 挂 `DagNodeInspector`；先实测引擎节点有无规则键，有则 `ruleKey`、无则 `projection` 并在报告里点名缺口 |
| **U3 × 无图的 7 页** | 差的是**图本身**（`global-sim`/`decision-play`/`what-if`/`optimize-whatif`/`cleanroom-attr`/`plan-generate`/`sop-balance` 连过程图都没有）。这不是接线是造功能，且**每页画什么图是产品判断**（净室通用页画「本体倒推链」还是「求解步骤」？） | **WO-U3-DAG-DESIGN**（先出设计裁决，再逐页派）：本单建议这 7 页与 **U2** 合并做 —— 「分步标口径」的步骤条与「过程图」是同一份结构的两种画法，分两张单做会造出两套平行结构（RL3 单一来源禁止） |
| **U2 × 11 页** | 差一个**共享的求解步骤契约**：每页要能声明「这条结论分几步算出来、每步的 数据源 / 求解器键 / 规则」。今天求解器输出里**没有这层结构**（只有终值 + 少量 provenance），所以要么前端逐页手写步骤声明（可行，但得逐页核对不许编），要么引擎侧补一个 `steps[]` 回执 | **WO-U2-STEPWISE-1**（重画像·先做 2–3 页样板）：定共享组件 + 步骤声明形状，先在 `cleanroom-attr`（三块三条链，语义最清楚）与 `risk` 上落地并驱动结果分段揭示；样板过了再铺其余页 |
| **U1 × `optimize-whatif`** | 差**一次实测**：撤闸后每改一个基线数值格就要重跑一次真 CP-SAT，**重解成本没人量过**。防抖能挡住键入抖动，但挡不住「一次求解要 3 秒」这种情形 | **WO-U1-OPT-COST**（轻画像）：量 `optimize_whatif` 在本仓样例上的 p50/p95 求解耗时；< ~300ms 则照 `what-if` 的办法撤闸，否则给「自动重演 / 手动求解」两态并把理由写进屏上 |
| **U1 × `sop-balance`** | 差一次**语义裁决**：那五个 `sop-run-1..5` 串的是 **S&OP 业务流程**（评审→平衡→定稿），不是「填完表再点一下」。撤掉它们等于取消流程节点 —— 这是产品决策不是缺陷 | **WO-U1-SOP-VERDICT**（先裁决）：请仓主定「月度规划的五步是流程节点还是提交闸」。若是流程节点，本格应从 `不符合` 改判为**不适用**并按判据⑥逐格登记理由；若是提交闸，再派前端单 |
| **U8 × `global-sim`** | 差的是**把目标页那段搬成抽屉**：`drillLink` 跳的是 `/v/project-sim?order=…`，那是一整张页的功能。要做成「不换页」得先决定**抽屉里放哪一部分**（全量细排？还是只放该单的排产结果？） | **WO-U8-GLOBALSIM-DRAWER**（中画像·先出设计）：把「进项目推演细排」改成同屏抽屉，保留跳页作为「要做别的事」的出口（判据明写「切视角/交接不算违反」） |
| **U4b × 5 页** | 差一个**决定**：`EdgeActivePanel` 今天是独立面板，要让排除项「留在图上」得把 `disabledRuleKeys` 的投影下沉到各页的图组件里。⚠ 该文件正被 `WO-EDGE-PANEL-3PAGES` 改动，**本单刻意避让** | **WO-U4B-ONGRAPH**（等 `WO-EDGE-PANEL-3PAGES` 收编后派）：在 `LayeredDag`/`PmDag` 上加一个「已关闭」态（虚线＋降透明度＋文字标记，复用 `EdgeActivePanel` 已有的三路编码），5 页统一挂 |
| **U6 × `project-sim`** | 差一次**裁决**：`ProjectSimView.tsx:1069` 的文案写「结论可采纳为 Action」而代码里没有那条路。接上 / 撤文案二选一，**不许维持现状** | 已排 §5 P0（`WO-PROJSIM-U6`） |
| **U6 × 净室 4 页** | 差一次**产品判断**：净室通用页该不该产生全租户 Action 草稿（R2 tenant 语义） | 登记备裁（§5 已写明不排优先级） |

---

## 6 · 门 · `sim-ux-criteria:check`（本单新建 · 纯静态）

`scripts/check-sim-ux-criteria.mjs`，别名 `sim-ux-criteria:check`。**它不判 UX 好不好，它判「这份判据表还算不算数」。**

### 6.1 为什么门只做这件事（而不是去机检九条判据）

九条里只有 U4 今天真能机检，且**已有门**（`check-edge-active-mounts.mjs`）。
再造一道去机检 U1/U3/U6/U9 会得到一堆**代理指标**——「文件里有没有 `运行` 二字」度量的是**写法**不是**行为**，
正是铁律 0.6 点名的「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
**所以本门守的是判据表本身的完整性与不可倒退**，这是今天唯一能机械化且不失真的那一层。

### 6.2 七条判据（⑥⑦ 为 2026-08-16 WO-HARNESS-UX-GAP-1 新增）

| # | 判据 | 拦什么 |
|---|---|---|
| ① | **枚举一致**：现算的推演页全集（三源并集 ∪ 既有门 `PAGES`）与本文 §4 表的行**逐个对齐**，多一页少一页都红 | 「手抄漏页」——本仓已发生过（既有门漏 3 页、工单 §1 漏 1 页） |
| ② | **四态合法**：§4 表每一格必须是 `符合`/`不符合`/`判不了`/`不适用` 四者之一 | 把「判不了」写成「部分」「已融入」这种含糊词 —— **本单存在的全部理由** |
| ③ | **判不了必须有理由**：§4.2 必须逐条覆盖所有出现「判不了」的判据 | 「判不了」变成免死金牌 |
| ④ | **棘轮 + 反向松弛检测**：`符合` 数只许升不许降；**反向遍历基线**，基线记 `符合` 而实测非 `符合` ⇒ 倒退红；基线记非 `符合` 而实测 `符合` ⇒ **免检名额**，同样红并要求 `--tighten` | 悄悄把一格从「符合」改成「判不了」；以及基线比实测松 ⇒ 页面改好了门却还留着旧额度 |
| ⑤ | **指代冲突登记不许丢**：§0.1 那张三方分歧表必须仍在，且三行俱全 | 下一个人再把「这个」当成已经定案的东西 |
| ⑥ | **`不适用` 逐格登记**：每一个记 `不适用` 的格，必须在 §4.3 有**带理由**的那一行（理由栏写「—」不算） | `不适用` 变成比 `判不了` 更好用的免死金牌。举证责任按「有多像豁免」定：`判不了` 逐**判据**给理由就够，`不适用` 要**逐格** |
| ⑦ | **拆账不许丢**：§4.2 里必须至少有一条 `B-x` 明账 | 判据改写把「不可判的那半」拆了出去；删掉那张表，「表里判不了 0」就会被下一个人读成「这条要求已经验完了」。形态：**「我用『判据表里没有判不了』当作『这条要求验完了』的证据，而前者并不度量后者。」** |

⚠ **加第四态 `不适用` 是有代价的，代价写在这里**：多一个词就多一条逃生通道。
所以它的**唯一**合法用法是「判据预设的那个对象在这一页上不存在」（§4.3），
且由判据⑥ 逐格咬住。**若将来那个对象出现了（如某页长出因果图），该格必须当场从 `不适用` 改回 `不符合`**
—— 这是 `不适用` 与 `符合` 的关键区别：**前者随页面结构变化而失效，后者不会。**

### 6.3 纪律落点

- **金丝雀与主判据共用同一份 `analyze()`**：两个内嵌样例（一个合法表、一个把「判不了」写成「部分」的表），
  跑的是同一个解析器；任一不符预期 ⇒ 打印「⛔ 工具坏了」并 **RC=2**，**不许**打印「表是合规的」。
- **退出码三分**：`0` 干净 · `1` 真违规（漏页/非法三态/倒退/松弛/冲突表被删） · `2` **门自己坏了**。
- **顶层兜底**：`const isMain = …; try { if (isMain) main(); } catch (e) { toolBroken(…) }`，
  `try` 是 Program 的直接子语句；**不用** `process.on` 全局 handler（本文件的 `analyze` 可被测试 import）。
- **基线写入内联调 `scripts/lib/baseline-doc.mjs` 的 `buildBaselineDoc`**（不另手写 `{note: 常量}`），
  并在开跑前跑 `baselineDocCanary()`，不过 ⇒ RC=2。
- **争议页登记**：`plan-audit` 等三源判定不一致的页放在基线的 `disputed` 段，
  **必须带理由**，且**只登记不放行**——它不进 §4 表，但门会提醒它还没裁。

### 6.4 复验

```bash
node scripts/check-sim-ux-criteria.mjs             # 门
node scripts/check-sim-ux-criteria.mjs --selftest  # 只跑金丝雀
node scripts/check-sim-ux-criteria.mjs --census    # 打印现算的推演页全集与三源分歧
node scripts/check-sim-ux-criteria.mjs --tighten   # 收紧基线（只收紧不放松）
```

### 6.5 变异反证 7/7 实跑（每条先证「变异体 ≠ 原文」再显式捕获退出码）

`out=$(node scripts/check-sim-ux-criteria.mjs 2>&1); rc=$?` —— **不用** `cmd | tail; echo $?`（管道尾恒 0）。

| # | 变异 | 结果 |
|---|---|---|
| M1 | 删 §4 表的 `order-chain` 行 | **RC=1** · ①枚举一致点名 `order-chain` ＋ ④棘轮死账 |
| M2 | 把 `sim-sandbox × U1` 写成「部分」 | **RC=1** · ②三态合法点名该格 |
| M3 | 删 §4.2 里 `U3` 那条理由 | **RC=1** · ③判不了必须有理由点名 U3 |
| M4 | `global-sim × U1` 符合 → 判不了 | **RC=1** · ④棘轮倒退 ＋ 总量 17→16 |
| M5 | `what-if × U1` 不符合 → 符合 | **RC=1** · ④棘轮松弛（免检名额，**反向遍历基线才发现得了**） |
| M6 | 删 §0.1 的「丙」行 | **RC=1** · ⑤指代冲突登记「只剩 2/3 行」 |
| M7 | 在无扫描面的 cwd 跑 | **RC=2** ＋ 「本次结论作废，不许读作表合规」 |
| — | 逐条还原 | **RC=0** 复绿 · `git status --porcelain` 空 |

### 6.6 ⚠ 需要审核方点头的两件事（本单不擅自当作已批准）

1. **待接线棘轮 13 → 14**（`scripts/gate-ledger-baseline.json` 的 `pendingWireCount`）。
   本门是**已建未接线**（`binding=NONE` / `disposition=WIRE`）——本单的 🚦范围边界禁改
   `package.json` 与 `scripts/gate.sh`，接不进 `gates` 串。该棘轮**只降不升**，故必须上调基线并写明理由。
   **若不接受这次上调，正确动作是把它接进 `gates` 串（该数当场回落 13），不是删门。**
   刻意**不改成** `disposition=MANUAL` 避红：MANUAL 要写得出「为何刻意不接链」的理由，
   而本门是纯静态、零依赖、单次 <1s 的文档判据检查，写不出这样的理由 ——
   **编一个假理由换一个绿数字，比红着更糟**。
2. **建议新增断点 `G-GATE-ROSTER-HANDCOPIED`**（§7.5）：门的名单是手抄的 ⇒ 漏掉的对象永远绿。
   编号与措辞属本体治理，本单只列建议不擅自加。

### 6.7 与其它门的关系（跑过的实测）

| 门 | RC | 说明 |
|---|---|---|
| `gate-exit-discipline:check` | **0** | 82/82 守纪律（含本门：有 RC=2 出口 + 顶层兜底） |
| `ontology-writeback:check` | **0** | §7 登记齐 · 待接线 14（基线 14，已随本单上调） |
| `baseline-writer-honesty:check` | **0** | 本门走共享 `buildBaselineDoc`，不进手搓豁免名单 |
| `gate-ledger:check` | 2 | **环境态**：28 条 `guardedPaths` 指向未构建的 dist（本单轻画像禁 build）。输出明写「其余判据（账无遗漏/无幽灵 · binding 与现算一致 · escalation/disposition 合法）本次均已核过且相符」⇒ 本单的账是过的 |
| `ontology-anchors:check` | 1 | **存量漂移**：7 条全部落在 `handlers.ts` / `databuilder.ts` / `orchestrator.ts` / `engine.ts`，本单一个字都没碰（本单新增 §7 只有 1 行，`git diff | grep '^+' | grep -c` 这四个文件 = **0**）。⚠ 这道门**当场抓到过本单一个真错**：我把 `WO-ACTIVE-EDGE-UX.md:43-45` 写进了反引号，抽取器不区分「举例」与「锚点」⇒ 判 `FILE_MISSING`；改写成「第 43–45 行」后消失。**机器先说话** |
| `system-ontology:check` | 1 | **环境态**：缺的两个锚点是 `apps/agentcore/dist/mocks/seed.js` 与 `packages/contracts/dist/index.js`，两者在**基线版本的本体里就已引用**（`grep -c` 基线副本 = 2），dist 未构建所致 |

---

## 7 · 《本体引用与影响》

> 前置阅读已完成：`docs/SYSTEM-ONTOLOGY.md` §2（对象类型目录）· §3（关系图谱）· §5（R1–R19）·
> §7（检测/门禁）· §8（已知断点登记）。

### 7.1 触及的对象类型

| 对象类型 | 章节 | 本单怎么触及 | 改了吗 |
|---|---|---|---|
| `ViewConfig` / 内置视图（`BUILTIN_VIEWS`） | §2 · §7 `nav-group-coverage` 判据① | 作为**推演页枚举的源 A** 被读取（title/featureName） | 否（只读） |
| `FeatureDef`（VIEW/BLOCK 级 entitlement） | §2 · R3 | 枚举源 B（`sim.sandbox` 等功能名） | 否（只读） |
| `SimSession.disabledRuleKeys` | §2.I 推演沙盘域（`SYSTEM-ONTOLOGY.md` 反事实链路段） | 判据 **U4** 的承载物 | 否 |
| `PropagationRule.status` | 同上 | 与 `disabledRuleKeys` **正交**（本体已写明，本单沿用不改） | 否 |
| `ActionDraft` | §2 · §6 行动 | 判据 **U6**「结论即动作」的落点 | 否 |

### 7.2 触及的链路

| 链路 | 本单怎么触及 |
|---|---|
| **反事实链路**（`EdgeActivePanel → POST /a/v1/sim/sessions/:id/counterfactual → simAdvanceTicks(persist:false) ×2`） | 判据 U4 的实现链路；本单**只判它挂没挂到页上**，不改链路本身 |
| **视图派单链**（`BUILTIN_VIEWS → SEEDED_VIEW_KEYS → scenarioSeed.views → GET /a/v1/me/workspace → ViewPage 双闸 → registry 字符串键 → renderer`） | 枚举源 A 走的就是这条；`cleanroom-attr`/`disruption-radius`/`what-if`/`optimize-whatif` 走的是并联的**专用 route** 那条（`App.tsx`），**两条链给出两个不同的页集合**——§3.2 分歧的结构性成因 |
| **可发现性链**（`workspace.navigation → ShellLayout.NAV_GROUPS`） | 枚举源 C |
| **沙盘模式收编链**（`sandboxModes.SANDBOX_MODE_ORIGIN_VIEW ↔ ShellLayout.CONSOLIDATED_INTO_SANDBOX`） | 枚举源 D |

### 7.3 触及的事件

**本单不新增、不改变任何事件。** 只读涉及：`{kind}.updated`（视图/功能变更 → B 侧缓存失效）——
若 P0「推演页单一来源」落地时新增一个注册表，**须同步考虑它变更时要不要发事件**（留给那张单）。

### 7.4 触及的不变量

| 不变量 | 关系 |
|---|---|
| **R17 决策单页**（🚧 拟立·§5:1677） | **本单是 R17 的推演域细化**。R17 的 7 条是版面级；U1/U2/U3/U4/U4b/U5/U6/U9 是**推演行为级**，R17 一条都没覆盖。U7 ≡ R17.5、U8 ≡ R17.4，**标注复用不另立**。R17 的配套门 `decision-page:check` 至今**待建**——本单的 `sim-ux-criteria:check` 不是它，两者判的东西不同（一个判版面五要素齐不齐，一个判判据表算不算数），**不许互相冒充** |
| **R13 结论可溯源** | 判据 U2/U3/U5 是 R13 在推演页上的具体化：「每步标 数据·求解器·规则」= 逐步溯源；「一个事实一个出处」= 单一真相源 |
| **R4 真值经 Action** | 判据 U6「采纳即生成 Action 并留审批痕」直接引用 R4；本体已写明的 **R4-sim 豁免边界**（仿真世界自己那一行不经审批）是 U4 成立的前提 |
| **R6 确定性** | U1「改输入即重演」的前提是同输入同输出，否则「改完结果变了」分不出是我改的还是它自己在飘 |
| **R2 tenant_id everywhere** | §5 里 U6 之所以**不排优先级**：净室通用页硬补 Action 草稿会造出跨租户语义不清的写入 |
| **R3 Entitlement 先于 authz** | 枚举源 B 用的就是功能注册表；`sim.sandbox` 关 ⇒ 沙盘及其五子视图**不存在**（不是 403）——所以「推演页全集」**随租户 entitlement 变化**，这是 §3.2 分歧的第二个结构性成因 |
| **R1 contracts-only-shared** | 本门必须是**脚本**不能是前端 vitest：真相源在 `datacore`（`view-manifest`/`features`），消费方在 `frontend-shell`，R1 禁前端跨 app import 源码 ⇒ 只有门脚本能把两侧对上账（与 `nav-group-coverage:check` 同一条理由） |

**本单不新增不变量。** 若 P0 落地（推演页单一来源），**那时**应考虑立一条
「凡自称推演的功能必须在唯一注册表里登记」——但那要等仓主先裁定判据，现在立就是替他决定。

### 7.5 触及的断点

| 断点 | 关系 |
|---|---|
| **`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`**（假绿第 9 形态） | §4 里 `cleanroom-attr`/`disruption-radius`/`order-chain` 三页的 U4 缺失是**同族的又一形态**：不是「实现有测试绿零调用方」，是「**门有、判据有、但这三页不在门的 `PAGES` 里，于是从未被问过**」。**门的覆盖面漏了，与被测代码无关** —— 建议登记为新亚型 `G-GATE-ROSTER-HANDCOPIED`（门的名单是手抄的 ⇒ 漏掉的对象永远绿） |
| **`G-NAV-FALLBACK-BUCKET`**（可达 ≠ 可发现） | §3.2 的三源分歧与它同源：同一个页在「后端派单 / 导航归组 / 沙盘模式」三处有三个身份 |
| **`G-11`**（推演沙盘域） | 本单全部 12 页落在这个域里 |

### 7.6 需要回写本体的部分

- **§7 检测/门禁**：新增 `sim-ux-criteria:check` 条目（本单同批回写）。
- **§5 R17**：在 R17 行内补一句「推演域细化见 `docs/PRD-harness-ux-adoption.md` §2 九条判据」——
  **本单同批回写**（不改 R17 的判据本身，只加指路）。
- **§8**：`G-GATE-ROSTER-HANDCOPIED` 属**新增断点**，需要审核方裁定编号与措辞，**本单不擅自加**，
  在此列明建议。

---

## 8 · 本单认为这张工单写错 / 漏说了什么（照实写，不空着）

1. **写错（最重要）**：「『这个』指的是 deepseek-harness」——见 §0.1。仓内三处记录互相打架，
   工单取了其中最弱的一份**并且**把它和另一份的原话缝在一起。照这个前提做，第一步（从 harness 材料抽判据）
   必然空手而归，而真正有实物的参考件会被完全绕过。
2. **写错**：「我在台账里记了 🟡 部分（metro/分层/诚实位已融入）」——**台账里还有另外两行同一件事**：
   `REQUIREMENTS-TRACE.md` A4「关系边（本体图谱结构），为何目前系统里没有这个功能？」✅ 与
   A5「目前系统的页面都参照这个做了调整吗？」✅ **9/9 页 + 门逐页点名**。
   也就是说：**这条要求在台账里同时是 🟡 和 ✅**（§G 记 🟡，§A 记 ✅），而两处指的是同一句话。
   工单只提了 🟡 那一半，于是「拿不出任何可机检的东西」这个自我判断**本身就不准**——U4 是有门的。
   真实的缺口比工单说的**更具体也更小**：不是「一条都没有」，是「**九条里只有一条有门，且那道门的名单是手抄的**」。
3. **漏说**：没要求区分「判据抽不出」与「判据抽出来了但今天判不了」。这两者处置完全不同——
   前者要去要材料，后者要上门 B。§4 里 54 格属后者，若不分开会被一起记成「不知道」。
4. **漏说**：没要求处理**枚举本身的分歧**。工单只说「不许手抄页名，用可复算的方式枚举」，
   预设了「枚举出来是一个确定的集合」。实测**三个源头给出三个集合**（§3.2），
   而这个分歧比任何一页的 UX 缺口都更根本——它让「所有推演的功能」这句话今天无法被证实也无法被证伪。
5. **漏说**：没说 **R17 已经做过一次同类抽取**（`ARCH-redlines-and-R17-decision-page.md` → 本体 §5:1677，
   7 条子原则 + 待建的 `decision-page:check`）。不知道这件事会造出第二套平行判据 ——
   正是本仓 RL3「单一来源，不出双份」点名禁止的。本单因此把 U7/U8 标为「与 R17.5/17.4 同源，复用不另立」。
6. **措辞可能误导**：「本单的头号交付物不是改页面，是把这条要求变成可核对的东西」——方向是对的，
   但**「可核对」有两档**：可机检（机器先说话）与可逐页对照（人照表核）。九条里只有一条属前者，
   其余八条只能是后者。若把「写出判据表」当成「已经机制化」，就是本仓反复犯的那个病换了个马甲。
   本单因此把门设计成**守判据表本身**（§6.1），而不是假装能机检九条。

---

## 9 · 交付与保质期

- 基线：`origin/claude/verify-reclaim-6` @ `b3a3030b`
- 参考件基准：`docs/reference-prototype-decision-platform.html` @ `7a613c74`
- **保质期**：§3.2 的页集合随 `BUILTIN_VIEWS` / `NAV_GROUPS` / `sandboxModes` 三处任一变动而漂移；
  §4 的判定随页面改动而漂移。**两者都由 `sim-ux-criteria:check` 守着**——门红了就是本文该更新了，
  不是门坏了。
- ⚠ 上一版（WO-HARNESS-UX-ADOPTION）**未跑任何 vitest / build / gate**（轻画像纪律），
  §4 全部判定为**静态取证**；标 `判不了` 的那些格**不许**被读作「大概符合」。

### 9.1 2026-08-16 WO-HARNESS-UX-GAP-1 增补（改了什么 · 没做什么）

- 基线：`origin/claude/verify-reclaim-6` @ `12260423`；handoff 分支 `claude/handoff-wo-harness-ux-gap-1`。
- **判据改写 6 条**（U1/U2/U3/U5/U7/U8，§2.1，原措辞逐字保留）＋ **加第四态 `不适用`**（§4.3）
  ＋ **门加两条判据 ⑥⑦**（§6.2）＋ **真改 4 页**（§4.4）。
- 三态 → 四态读数：**符合 17 → 60 · 不符合 46 → 53 · 判不了 57 → 0 · 不适用 0 → 7**。
  ⚠ **「判不了 0」的正确读法只有一个**：可判的那半已逐页判完；不可判的那半**原样挪进 §4.2 的
  4 条 B-x 明账**，交给至今**未建**的门 B。**这四条今天确实没有验收方式** —— 这句话必须跟着那个 0 一起念。
- **本单没做的（诚实挂账，别当成做了）**：
  1. `sim-sandbox` / `decision-play` 两页的 U7 报到 —— 与已改的 4 页同病同源，但沙盘的视图键
     在 `registry` 侧是 `sandbox`、四源侧是 `sim-sandbox`（见 §6 `EXTRA_ALIAS`），报哪个要先对齐，
     不该顺手拍。已排 §5 P1。
  2. 其余 8 页的 U9 导出 —— 本单只闭了 4 页。`risk` 那页尤其便宜（改用 `exportProvenance.ts` 即可），
     已排 §5 P2。
  3. 门 B（真浏览器）**一行没写**。§4.2 那 4 条明账因此全部悬着。
  4. §5 原有的两条 P0（推演页单一来源 / 三页补 U4）**一条没动** —— 那是接线单与产品裁决，不在本单边界内。
- **保质期**：§4.4 的 4 页判定随那 4 个文件改动而漂移；§4.3 的 7 格 `不适用` 随「那几页长不长出因果图」
  而失效。**两者都由 `sim-ux-criteria:check` 的判据 ④⑥ 守着** —— 门红了就是本文该更新了，不是门坏了。

### 9.2 2026-08-16 WO-SANDBOX-53CELLS 增补（改了什么 · 没做什么）

- 基线：`origin/claude/verify-reclaim-6`；handoff 分支 `claude/handoff-wo-sandbox-53cells`。
- **本单第一产出是 §5.1 的全量优先级表**（53 格按**判据**排、不按页排，附「一次改法能复用几页」），
  ＋ §5.2 的**挂账表**（每格写清「差什么才能做」并各配一张可派单）。
- **真改 8 格**（§4.5）：U1 `what-if` · U3 `order-chain`/`disruption-radius` ·
  U5 `global-sim`/`what-if`/`optimize-whatif` · U8 `cleanroom-attr`/`disruption-radius`。
  读数：**符合 60 → 68 · 不符合 53 → 45 · 判不了 0（不变）· 不适用 7（不变）**。
- **棘轮方向核对**（照判据④）：`sim-ux-criteria-baseline.json` 的 diff **只有 8 行，全部
  `不符合 → 符合`，零反向**。而且这 8 格**不是我数出来的** —— 是门先报「⑧ 条免检名额」逐格点名，
  再 `--tighten` 收紧的（机器先说话）。
- **本单没做的（诚实挂账，别当成做了）**：
  1. **U2（11 页）一页没做** —— 页数最多但今天**没有可复用的共享件**，一天内硬铺会产出 11 个
     「步骤态不真正驱动结果分段」的装饰件，正是判据 U2 自己点名要排除的东西。已拆 `WO-U2-STEPWISE-1`。
  2. **U4b（5 页）一页没做** —— 与 `WO-EDGE-PANEL-3PAGES` 正在改的 `EdgeActivePanel` 有耦合面，**刻意避让**。
  3. **U3 × `risk`** —— `ProvenanceDag` 是跨页共用组件且契约里没有 `rule` 字段，改它会外溢。已拆 `WO-U3-RISK-DAG`。
  4. **U1 × `optimize-whatif` / `sop-balance`** —— 前者差一次**重解成本实测**，后者差一次**语义裁决**
     （五个闸串的是 S&OP 业务流程，撤掉等于取消流程节点）。两张单都已写在 §5.2。
  5. **U6 / U7 / U9 / U4** —— U7/U9 归 `WO-U7-U9-REST`、U4 归 `WO-EDGE-PANEL-3PAGES`（判据编号分工）；
     U6 的 1 格待裁、4 格备裁。
  6. 门 B（真浏览器）**仍一行没写**，§4.2 那 4 条 B-x 明账**继续悬着** —— 与上一版同。
