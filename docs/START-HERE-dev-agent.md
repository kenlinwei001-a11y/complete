# START HERE · 开发 agent 单一入口

> 你是**实现/开发 agent**：照本文指向的施工合同**写代码、commit、push**。
> 写 PRD/SPEC 与**评审**由审核方负责——**你不改 PRD、不自评"可合"**；有歧义先问，别擅自扩大范围。
> 分支：所有改动**只**推 `claude/vigilant-knuth-b1nmxn`（不开新分支、不开 PR）。

---

## 0. 铁律 0（违反即返工）

**动手前先完整读 `docs/SYSTEM-ONTOLOGY.md`**（系统自我元模型 = 接线单一来源）。改了链路/事件/对象类型/不变量(R1–R17)/门禁 → **必须回写本体对应章节**。命名禁用外部产品名，用平台自有术语。

---

## 1. 按序读这些（canonical · 别跳）

| 顺序 | 文档 | 读它干嘛 |
|---|---|---|
| ① | `docs/SYSTEM-ONTOLOGY.md` | 系统大脑：对象类型/链路(§3)/不变量 R1–R17(§5)/门禁(§7)/断点 G-1…G-11(§8)。**铁律0** |
| ② | `docs/COMPLETION-LEDGER.md` | 全局目标真相表（~680 验收点/27 域）。**看清你这块在全局的位置**——但**别照它 680 点盲建**（见 §3 警告） |
| ③ | 你这轨的 HANDOFF（见 §2） | 你的施工合同：增量顺序 + 每增量 DoD + 红线 + 评审协议，**自洽，照它建** |
| ④ | `CLAUDE.md`（仓库根） | 架构地图/常用命令/关键约定（contracts-only/tenant_id/entitlement/确定性/错误信封/双仓储） |
| ⑤ | `.claude/skills/fde-delivery`（FDE 纪律） | **"绿测试≠能用"**：任何"完成"结论必须有"以用户身份亲手跑一遍"的证据 |

---

## 2. 现在该建什么（已就绪轨 · 按指派选）

**17 条已就绪轨**（每份 HANDOFF 自带《源↔现状↔设计》§1 追溯表 + 增量/红线/双轴评审。按指派认领一条）：

| 轨 | 项目 | 施工合同 `docs/` | 优先级 | 一句话（含关键红线） |
|---|---|---|---|---|
| **A** | 推演沙盘 UI 收口 | `HANDOFF-sandbox-build-and-review-contract.md`（活在 §6.1.A） | **P0 北极星** | 后端 0-4 齐、UI 仅~30-40%；**前端砌齐+demo 种数据，别重写后端**（采纳→Action/分支对比/向导/就绪面板/双雷达） |
| **B** | 优化求解器融合 | `HANDOFF-optimization-fusion-build-and-review-contract.md` | P1 | 零代码开工，先增量0；**许可证红线：不训练上游/不碰 Gurobi/CDLA 只取 Results**（`THIRD-PARTY-NOTICES`） |
| **C** | 数据构建发动机收尾 | `HANDOFF-comprehend-engine-build-and-review-contract.md` | **P0 北极星** | 引擎主体已建；收 3 断点(用途→model 路由/域不变量/入启动器)；**§1 标「真实」13 项只接不重写**；增量0 先 FDE 真跑 |
| **D** | 闭环验证引擎 VLE 收尾 | `HANDOFF-vle-build-and-review-contract.md` | P1 | ~30-40%已建；补**参照实现双算**(核心可证)+CI 门+前端段级矩阵；**别重写七段框架** |
| **E** | 规则即一等 G-10 收尾(P3) | `HANDOFF-rules-firstclass-p3-build-and-review-contract.md` | P1 | 编辑器/版本/事件**已建**；补 **11/19 求解器 payload 映射**+6 入口 FDE；**别重写编辑器** |
| **F** | 场景发育 G-9 收尾(P3) | `HANDOFF-ontogenesis-p3-build-and-review-contract.md` | P1 | runGrowthLoop/planSlice/规则解析**函数都在**；只是 **wiring**(growScenario 调它们)+ADVISORY；**别重写函数** |
| **G** | 管理面闭合+AC8 | `HANDOFF-admin-console-closure-build-and-review-contract.md` | P2 | 41 页都在；补 3 页(求解器目录/切片编辑器/评测 CRUD)+引用控件闭合+AC8 死路；**别重写已建 38 页** |
| **H** | P3 收尾杂项（Pass-2 wave1-5 · 全部模块 + 前端） | `PASS2-wave{1,2,3,4,5}-finishing-tasks.md` | P1-P2 | 全 50-95% 已建；活=钩子接线/补前端页(图谱配色/G-3预设上下文/对象360)/加字段头/B侧对称/求解器 LIVE 口径/多模板；**已建主体别重写（求解器核心算法/本体 O1-O10/三层权限/A2 全链/前端核心链路）** |
| **I** | 驾驶舱数据层颗粒（真半成品） | `PASS2-wave2-finishing-tasks.md §2` | P1（含高回归专项） | 25-30% 已建（求解器框架在）；缺八卡KPI数据源/八根因DAG/毛利勾稽；**三阶段必守：低回归先→中→高回归专项独立PR+FDE逐值核HTML过基线，别混 commit；求解器别重写** |
| **J** | 数据流闭环 TR1-8（"能用"命脉） | `PASS2-wave3-finishing-tasks.md §1` | **P0** | 50% 已建（订阅/outbox/前端失效框架在）；缺一串**产出事件发射** + **AgentCore→DataCore 跨栈 outbox 通道**→TR1-8 全不真通（违 D-29/UP-1）；DF-5 跨栈通道牵动大可升级独立 HANDOFF |
| **K** | QOS 全量真跑 + 数字可信（高风险✅坐实） | `PASS2-wave5-finishing-tasks.md §1` | **P0** | 骨架真，但 G-1/G-2"已修"是虚判（仅 4/20 卡真跑、求解器形状无真联测、种子自承"闭G-2残"）+ 路径B数字 provenance LLM 自填可谎报无反向校验；做 20 卡逐卡 probe-e2e+真 DataCore 联测 + 数字↔provenance 一致性校验 |
| ~~**L**~~ | ~~demo 本体 provenance 真实化~~ **✅已完成(2026-06-26 复验全闭·别再派)** | `HANDOFF-demo-ontology-provenance-build-and-review-contract.md` | ✅完成 | demo 已全程走真建模链(rawDataset→derive→草案PUBLISHED→publish→materialize)、34/34 类真 sourceBindings、obj id 字节不变、ModelingPage 真值闭合——审核方真跑坐实。**轨 M 同源底座可在此地基上建** |
| **M** | 三板块对齐设计母版（驾驶舱/规划/项目 · **含真推演红线**） | `HANDOFF-three-boards-html-alignment-build-and-review-contract.md`（它指向 `AUDIT-three-boards-…` / `AUDIT-fake-simulation-inventory` / `SPEC-trust-traceability-interaction`） | **P1** | 三板块多已建(项目~90%/规划~80%/驾驶舱壳70%·数据层30-40%)；补数据颗粒+同源底座+母版级深度；**融合优先(接现有/扩后端/换·禁新建并行)**；**🔴真推演红线**：7 处假推演(mock/哈希/写死冒充真,见 `AUDIT-fake-simulation-inventory`)必修或诚实标 dataMode；溯源接 RuleRef/Provenance、下钻去死路 |
| **N** | 全域可信溯源交互（HANDOFF③ · **先于 O 做**） | `HANDOFF-trust-traceability-build-and-review-contract.md`（带 `SPEC-trust-traceability-interaction`/`AUDIT-fake-simulation-inventory`） | **P1** | 基建已全(`RuleRef`/`Provenance`/`DagNodeDrawer` 都在)只没接全：① **接** RuleRef/Provenance 到所有裸渲染点(`OrderChainView.tsx:465` C02 裸文本)② **扩** Rule += 谁设定/时间/有效边界 ③ 下钻去死路(modal/面包屑)④ 溯源数据必真(禁包装 mock)；**禁新建并行展示组件** |
| **O** | 主题/配色开关（HANDOFF② · 浅色↔黑曜石） | `HANDOFF-theme-switch-build-and-review-contract.md`（带 `AUDIT-…master-alignment §5`） | P1 | 母版有 light/dark 开关,系统 `tokens.css` 有 CSS 变量(仅暗)+`applyTheme` 按租户覆盖、无开关：**扩** 加浅色 token 组 `[data-theme=light]` + header toggle + localStorage + 收口 ~10-20 处硬编码十六进制；**语义域色 theme-invariant**、与租户覆盖叠加不冲突、不重构 CSS |
| **P** | 1:1 复刻·**建模族**（数据流DAG+L0-L4认证+对象配置） | `SPEC-replica-modeling-family.md`（**先读地基 `SPEC-replica-design-system.md`**） | P1 | 竞品像素级复刻 ModelingPage：左画布换数据流DAG(接轨L provenance·复用PmDag/FdeGraph)+中L0-L4认证面板(接 deriveCertification 现成)+对象配置抽屉+逐对象gauge；**接现有不新建并行·认证数字接真closure非写死·无外部产品名·域色theme-invariant**<br>**【评审棘轮 6-27】① 数据流DAG ✅复验闭合(92160da)** ② **L0-L4认证 ✅复验闭合(bc93ff0)**——审核方两路真跑取证(curl 真 deriveCertification + 真浏览器):绿环35%/L1真级/三维54·100·28·18/L4四真勾+二显式RESERVED **全=后端实算值,非写死**;entOff 诚实降级亦验真。<br>**③ 对象配置抽屉+逐对象gauge ✅复验闭合(3730ef5)**——审核方三重取证:curl 8 对象 LOCAL cert 全异 + 真浏览器 3/3(Order83%/Base65%/Line100% 各匹配自身 LOCAL oracle·三维各异·**非复用全局35/54**) + PATCH e2e(setDomain/renameProperty 真落库·刷新仍在·非乐观);已发布草案**只读诚实降级**(后端409锁+前端不提供假编辑)、③类tab/字段标RESERVED不画假。<br>**④ 收尾 ✅复验闭合(f51a022+06605ff)**——审核方真跑+网络拦截+API/SSE取证:6子tab全渲染(图查询**显式RESERVED无假壳**·日志真outbox·Skills/MCP真B4/B3或诚实降级)、token主题;**Agent指挥台真接QOS·非假壳**:点真场景卡→`scenarioIntentKey`确定性绑定(§2.4·跳LLM classify)→`path=WORKFLOW conf=1.00`→`answer.final`真出 score=50/verdict=站不住/规则X05/**provenance(invoke_solver·snapshot1.3)**·信任徽✓已验证·工作流(审核方API/SSE亲证 + dev真浏览器截图佐证)。06605ff 另修 SSE跨源CORS(reply.hijack)。<br>⚠️**审核方自纠(诚实)**:我此前误判"packageId少`.id`致6处404"——**错,无此bug**。前端 `api/types.ts:55-58` WorkspaceSchema 已`.transform`把 scenarioPackages 归一化为**id字符串数组**,`packageId`本就是字符串(直接抓浏览器载荷=`"pkg_battery_manufacturing"`证实);我先前凭**原始后端响应形状+代码行臆断**、未查前端transform、未抓真实载荷,实证后撤回。我浏览器探针的404/401是harness的token加载竞态,非dev bug。端到端QOS真通。**③类图查询页后端未建→不做·登记TO-DO(`design-system §10.1`·禁硬造壳)。** **轨P Phase1(①接现成)1→4全闭。** |
| **Q** | 1:1 复刻·**沙盘族**（初始化向导+运行驾驶舱+评估·**分层交付b**） | `SPEC-replica-sandbox-family.md`（**先读地基 `SPEC-replica-design-system.md` §10**） | P1 | **本轮只做①接现成**:初始化向导(scope-precheck)+运行台骨架(tick/checkpoint/branch)+评估清单(L0-L4/三维准备度)+风险榜(risk_timeline·MOCK诚实标·守轨M红线)+主题/Agent-QOS;**③类后端未建→暂不做登记 TO-DO**(`§10.1`):6维健康/4维信任雷达·业务动作+RL4·分层目标·GEO_WITHIN约束。**禁画假数据雷达** |

> ⚠ **每条轨摸底都翻案过——真代码比文档建得多得多**。所以每份 HANDOFF §1 都标死"哪些已建只接不重写、哪些才真建"。**照文档/TODO 从零重写=红线打回。**
> ⚠ **别同时铺多轨**——一轨一轨来，每增量一组 commit、跑通再下一个。**先读你那轨 HANDOFF §1 追溯表**再动手。
> ⚠ **全局路线图**见 `docs/HANDOFF-ROADMAP.md`（A8时序/M11校准等待 Pass-2 定级再配 HANDOFF——**没出 HANDOFF 的别动**）。

---

## 3. ⚠ 关于 COMPLETION-LEDGER 的警告（别盲建）

`COMPLETION-LEDGER.md` 里 ~679 点是 **"待真跑"**，**不是"待建"**——其中很多**很可能已经能用，只是没被真跑核实过**。**照它 680 点逐条建 = 重建已能用的东西、白费力、还可能砸坏现成的。**

正确分工：**审核方先做 Pass-2 真跑定级**（起真系统逐条验，判 ✅/◐/❌），把"待真跑"收敛成**精确的"❌真缺/◐真半通"队列**，再交给你建。**你现在的确定性工作就是 §2 两份 HANDOFF**；其余等 Pass-2 出队列再说。**看到 ⬜未跑别自己去建。**

---

## 4. 同分支协同纪律（多 agent 同推此分支 · 违反=评审打回）

1. **不开新分支、不开 PR**：每增量 = 直接 commit + push 到 `claude/vigilant-knuth-b1nmxn`。
2. **每次 push 前先 rebase**：`git fetch origin claude/vigilant-knuth-b1nmxn && git rebase origin/claude/vigilant-knuth-b1nmxn`（多 agent 同推，不 rebase 必非 fast-forward）。冲突自解、解完复跑 `pnpm -r build && pnpm -r test && pnpm gates` 再 push。
3. **三类高冲突文件改动须在 commit 描述单独点名**：`packages/contracts/**` · `package.json`（新门并入 `pnpm gates`）· `docs/SYSTEM-ONTOLOGY.md`（本体回写）。

---

## 5. 红线速查（越线即停）

- **十红线**（沙盘落地纪律，见本体 §5）：RL1 本体先行 · RL2 暗发(defaultOn:false) · RL3 单一来源(不重写校验/不重算) · **RL4 走正门**(采纳才经 R4 写真值，模拟态不写真值) · RL5 零业务常数(换租户=换配置，`debattery:check` 守) · RL6 确定性(无 Date.now/random，同输入同输出) · RL7 CLI 先于 UI · RL8 倒序长出 · RL9 additive 可回退 · RL10 不与在建分叉。
- **关键约定**（CLAUDE.md）：跨包只依赖 `@platform/contracts`；所有读写/事件/缓存键带 `tenantId`；功能关=404 `FEATURE_NOT_FOUND`（entitlement 先于 authz）；凭据 AES-GCM 落库**不回显明文**；错误信封 `{error:{code,message,requestId}}`；新表四处同改(migrations+pg+memory+repo 接口)。
- **融合专属**：`THIRD-PARTY-NOTICES.md` 三条——不训练上游内容 / 不碰 Gurobi / CDLA 只取派生 Results。
- **提交物洁净**：**模型标识符不得出现在任何提交物**（commit message / PR / 代码注释）。commit co-author 用 `Claude <noreply@anthropic.com>`。

---

## 6. 提交规范（让评审高效）

每 commit 描述按此模板：
```
增量N · <标题>
- 做了什么（对照 HANDOFF 增量N / §6.1.A 哪条）
- 复用了什么既有 PRD/代码（证不分叉）
- 本体回写：§? 改了什么
- 高冲突文件：contracts? / package.json? / SYSTEM-ONTOLOGY.md?（改了哪个点名）
- CLI：新增 platform ...（cli-parity 绿）
- 测试：命名门 + pnpm gates 输出（贴绿）
- FDE 亲手证据：CLI 输出 / 截图（不是只有单测绿）
- 北极星距离：还差___ · happy-path/合成的部分：___
- 回退：flag 关 / 迁移 down / 旧路径
```
push 前自检：**rebase 干净 ✓ 本体回写 ✓ CLI 注册 ✓ 命名门 ✓ pnpm gates ✓ 零业务常数 ✓ 暗发可回退 ✓ FDE 亲手 ✓ 北极星距离 ✓ 高冲突文件点名 ✓**。

---

## 7. 评审协议（审核方按此 review 你的 commit）

每增量逐项核对，**全过才"可合"，任一不过列具体红线/门打回**（详见 HANDOFF §5）：
① 十红线不违反 · ② `pnpm -r build && pnpm -r test && pnpm gates` + 该增量命名门全绿 · ③ 本体回写 · ④ CLI 对等 · ⑤ 不分叉 · ⑥ **FDE 亲手证据**（非只单测绿）· ⑦ PR 描述含"还差什么 + 哪些是 happy-path/合成" · ⑧ 可回退 · **⑨ UI 增量两轴核对**（轴1 对竞品 `GROUNDING §F` 逐元素 / 轴2 对设计 mockup 逐元素是否真实现 + 真启动 Playwright 实拍佐证——**只验功能不验设计完整性=打回**）。

---

## 8. 禁止清单（速查）

- ❌ 改 PRD/SPEC、自评"可合"、擅自扩范围（你建，审核方评）。
- ❌ 开新分支 / 开 PR / 推别的分支。
- ❌ 照 `COMPLETION-LEDGER` 680 点盲建（§3）。
- ❌ 碰 Gurobi 示例 / 把上游内容喂训练 / 原样转发 CDLA 数据文件。
- ❌ 删旧页 / 不可回退 / 用合成冒充真实数据源。
- ❌ 模型标识符进任何提交物。
- ❌ 用测试绿 + commit 冒充"完成"（FDE：完成=亲手用一遍能用）。

---

## 9. 第一步（建议立刻做）

**轨 A**：读 ①②③，跑 `pnpm install && pnpm -r build && pnpm -r test`（4 包应全绿）→ 起内存态双服务 + 前端真看一眼当前沙盘（`/v/sim-sandbox`，需开 `sim.*` entitlement）→ 照 HANDOFF §6.1.A 挑一个 **P0** 开做 → 按 §6 提交。
**轨 B**：读 ①②③ + `THIRD-PARTY-NOTICES` + `SPEC-optimization-template-pool` → 做增量 0（本体先行 + 许可证门，零业务代码）→ 提交。
**轨 C**：读 ①②③ + `HANDOFF-comprehend-engine §1 追溯表` → 做增量 0（起内存态 datacore，用一个**新颖故事**调 `runStory`，贴真输出坐实引擎能不能用，**只看不改**）→ 再动 3 断点。
**轨 L**：读 ①②③（③=`HANDOFF-demo-ontology-provenance-…`）→ 做增量 0（起 `SEED_DEMO=1` datacore，导出**下游基线三件**：全 type key 集 / 全 obj id 集 / 沙盘 `view-config.nodeObjectIds`，存 `docs/evidence/demo-provenance-baseline.md`，**只看不改**）→ 再按增量 1→2→3。**这是后面证"字节不变"红线的标尺，跳过即返工。**
**轨 M**：读 ③=`HANDOFF-three-boards-html-alignment-…`（它再带你读 `AUDIT-three-boards`/`AUDIT-fake-simulation-inventory`/`SPEC-trust`）→ 做增量 0（demo 真浏览器走驾驶舱/规划/项目三板块**实拍** + **复现"洛阳红色越线却受影响订单暂无数据"** + 逐推演结果标 **真/半真/假**，存 `docs/evidence/three-boards-baseline.md`，**只看不改**）→ 按增量 1（**真推演红线优先**：7 处假推演修或诚实标 dataMode）→ 2→3。
**轨 N**：读 ③=`HANDOFF-trust-traceability-…` → 增量 0（全仓审计裸渲染规则号/数字 + 下钻死路清单，实拍，只看不改）→ 增量1 接 RuleRef/Provenance 到所有裸点(`OrderChainView.tsx:465` 起)+下钻去死路 → 2 扩 Rule provenance(谁定/时间/边界,种子诚实标系统基线)→ 3 风险详情+`traceability:check` 门。**基建现成,大头是接全。**
**轨 O**：读 ②=`HANDOFF-theme-switch-…`（带 `AUDIT-…§5`）→ 增量 0（grep 全仓硬编码十六进制 + 实拍暗色基线，只看不改）→ 增量1 加浅色 token 组 → 2 header toggle+localStorage → 3 收口硬编码逐页真浏览器核。**只扩 tokens/applyTheme,别重构 CSS。**
**轨 P/Q（1:1 复刻）**：**先读地基 `SPEC-replica-design-system.md`**（双 shell+导航IA+token+组件库,各页都依赖它）→ 再读你那族 SPEC（P=`SPEC-replica-modeling-family` / Q=`SPEC-replica-sandbox-family`）→ 增量 0（起 demo 真跑现 ModelingPage / SandboxView 实拍定基线，标哪些现成接着用）→ 按各族增量 1→4。**铁律：像素 1:1 但平台术语（无外部产品名）+ 每个雷达/数字/DAG 接真后端（deriveCertification/PmDag/QOS/propagateTick），禁视觉空壳/禁 mock 裸红（继承轨M 真推演红线）。接现有不重写。**

有歧义、或发现要动红线级/架构级的东西 → **先问，别擅自决定**。
