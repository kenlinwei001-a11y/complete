# PRD · A17 · 未审核态全域构建（PROVISIONAL 模式：本体/数据/规则/Agent… 皆作临时件先用）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 5（新增需求，再修订闭包门红线） |
| 取代/扩展 | **推广** `PRD-A16`（LLM 临时求解器）至**整条域**；改 `databuilder/closure.ts` 加 PROVISIONAL 模式；扩 `PRD-A5`（节点图显未审核态）· `PRD-A10`（验证区分 PROVISIONAL_ANSWER）· `PRD-fullstack-story-build-g8`（HARD 闸前置 → 加并行未审核车道） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H StoryBuildRun · §3 构建链 · §5 R4/R6/R11/R12/R13 · §8 G-8） · `apps/datacore/src/databuilder/{service.ts,closure.ts,artifacts.ts}` · `PRD-A16-llm-provisional-solver.md`（临时件生命周期范式） |
| 索引 | `PRD-A-series-roadmap.md` |

> 用户裁决：**跟求解器一样，本体/数据/规则/约束/Agent/工作流/技能/意图/计划/场景 都按"未审核状态"使用**——不再让闭包门一票否决成全 0，而是**允许整条域以临时/未审核态建出来并端到端跑通**，全程贴"未审核"标，**写真值受门控**，人工事后**审核/晋升/替换**。
> **设计哲学转向**：守"不谎报"靠**标注 + 写真值门控 + 绝不报 ANSWERABLE/VERIFIED**，而**不**靠"阻断成 0"。STRICT 原子闸保留为"发布真值"默认；PROVISIONAL 为"未审核预览/推演"并行车道。
>
> **「未审核态」定义（用户钉死 2026-06-21）**：未审核 = **立即可用**（可被推演/预览/调用），但**尚未走完"全流程审核 → 发布"**。它是生命周期的一个**中间可用态**，不是终态：
> ```
> 生成(LLM/comprehend) → 【未审核·可用】 → 全流程审核(逐制品 review + 求解器过 VLE/校准 + 闭包缺口清零) → 发布(R4 审批落真值) → 【GOVERNED·真值】
> ```
> 即"未审核"对应 `status=PROVISIONAL · trustLevel=UNVERIFIED`：**能用，但带'未走完审核发布'标，且不写真值**；走完审核+发布即晋升 GOVERNED。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H/A/B）：`StoryBuildRun`（加 `buildMode: STRICT|PROVISIONAL` + `domainTrustLevel`）·`ClosureReport`（gate 在 PROVISIONAL 下为 ADVISORY）·`OntologyType/Rule/SliceSpec/ObjectInstance(数据)/Agent/Workflow/Skill/Intent/ExecutionPlan/Scenario`（全部加 `origin` + `status: PROVISIONAL|GOVERNED|RETIRED`，复用 A16 状态机）·`Solver`（A16 临时求解器=本机制的特例）·`ActionDraft`（写真值门控）。
- **触及链路**（§3 构建链）：`comprehend → BuildPlan → [PROVISIONAL 模式] closure(ADVISORY) → 缺求解器=A16 临时生成 → 全栈以 PROVISIONAL 建出(本体/数据/规则/B栈) → 端到端推演 → PROVISIONAL_ANSWER(未审核) → 人工审核 → 晋升 GOVERNED(发布真值) / 替换 / 丢弃`。
- **触及事件/数据流**（§4，D-29）：复用 `storybuild.run_recorded`；**新增** `domain.provisional_built`（未审核域建成，NOTIFY）· `domain.promoted`（人工晋升 GOVERNED，IN_SESSION 失效相关页）· 复用 A16 `solver.*`。
- **触及不变量**（§5）——**重点：怎么"全用未审核件"又不破不变量**：
  - **R4 真值经 Action → PROVISIONAL 域不可写真值**：未审核的对象/数据/规则/Agent **只供推演/预览，禁止驱动 Action 真值写回**；晋升 GOVERNED 后才解锁。**这是守住"不污染真值"的关键门，不是靠阻断构建。**
  - **R6 确定性 → 未审核件"生成一次即冻结"**：LLM 生成的本体/规则/数据规约/求解器代码冻结（verbatim+hash+版本，同 A16），同件同结果；合成数据走确定性 GenSpec。
  - **R11/R12 闭包 → 在 PROVISIONAL 下转为 ADVISORY**：闭包门**照常检测并如实记录所有缺口/断链**（CHAIN/SHAPE/OBJECT/DATA/FORWARD），但**不 HARD 阻断**——记为 `findings[].severity=ADVISORY` 附在域上；**STRICT 模式仍 HARD 阻断（发布真值默认）**。
  - **R13 可溯源/不谎报（红线）**：未审核域的**每个制品 + 推演答案**强标 `status=PROVISIONAL · trustLevel=UNVERIFIED · origin=LLM`；终态 verdict 只能是 **`PROVISIONAL_ANSWER`，绝不报 `ANSWERABLE`/`VERIFIED`**（守 AUDIT-hand-run 旧账"谎报 ANSWERABLE"不复发）。
  - **R2 隔离 → 未审核件命名空间隔离**：PROVISIONAL 对象/数据**打 `origin=LLM_PROVISIONAL` 标 + 隔离视图**，**不混入受治理真值查询/推演**（governed 查询默认排除 PROVISIONAL，除非显式 provisional 上下文）——防"未审核数据污染真值库"。
- **关闭/影响断点**（§8）：闭合 G-8 的"缺一环就全断、闭环跑不完"——PROVISIONAL 模式让闭环**总能跑完(未审核)**；同时**新增风险登记**：未审核件误当真值的风险，由"写真值门控 + 强标 + 隔离命名空间"管住。
- **门禁**（§7）：`closure`（STRICT=HARD / PROVISIONAL=ADVISORY 双模）· **新增 `provisional-honesty:check`**（静态/运行时验证：PROVISIONAL 域的答案不得标 ANSWERABLE/VERIFIED、不得驱动真值写回、所有制品带未审核标）· A16 `solver-sandbox:check` · `debattery:check`。
- **回写承诺**：回写本体 §2.H（buildMode/domainTrustLevel + 各制品 origin/status）· §3（PROVISIONAL 构建链 + 晋升链）· §4（domain.provisional_built/promoted）· §5（R4/R6/R11/R13 在未审核态下的措辞补充）· §7（双模闭包 + provisional-honesty:check）· §8（G-8 收尾 + 新风险登记）。

## 1. 目标 / 非目标
### 目标
1. **全域未审核态可用**：本体/数据/规则/约束/Agent/工作流/技能/意图/计划/场景 + 求解器，**都能以 PROVISIONAL 态建出并端到端推演**（不被闭包门否决成 0）。
2. **闭环总能跑完**：缺求解器 → A16 临时生成；缺数据 → 确定性合成（PROVISIONAL）；缺本体/规则 → comprehend 倒推（PROVISIONAL）→ 推演出 **PROVISIONAL_ANSWER**。
3. **诚实不谎报**：全程贴"未审核"标；闭包缺口照常如实暴露（ADVISORY）；终态绝不报已验证/能答。
4. **真值受控**：PROVISIONAL 域不写真值、与真值库隔离；人工**审核→晋升 GOVERNED（发布真值）/ 替换 / 丢弃**。
5. **A16 归一**：LLM 临时求解器是本机制在"求解器"维的特例；统一同一套 origin/status/晋升生命周期。

### 非目标
- 不把 PROVISIONAL 当默认发布路径——**STRICT 原子闸仍是"写真值"的默认与唯一路径**。
- 不允许未审核件**自动**写真值或混入受治理推演（必须晋升）。
- 不取消闭包检测——只在 PROVISIONAL 下把"阻断"降为"如实告警"。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 闭包门 | `closure.ts` HARD 阻断（CHAIN/SHAPE/OBJECT/DATA/FORWARD）→ 缺一环 status=FAILED/BLOCKED（实证：全 0） | 无 PROVISIONAL/ADVISORY 模式 |
| 制品状态 | producedArtifacts 有 DRAFT/PUBLISHED | 无统一 `origin/status=PROVISIONAL` + 隔离 + 写真值门控 |
| 数据 | 闭包过才物化 | 无"PROVISIONAL 合成数据(隔离标注)" |
| 终态 | FAILED/BLOCKED 或 VERIFIED/ANSWERABLE | 无 `PROVISIONAL_ANSWER`（未审核但跑通） |
| 晋升 | A16 求解器晋升（设计中） | 无"全域晋升"（一次性把整条未审核域审核发布） |

## 3. 设计（双模闭包 + 全域 PROVISIONAL 生命周期 + 隔离 + 晋升）
### 3.1 构建模式开关
- `runStory(..., { buildMode: "STRICT" | "PROVISIONAL" })`。STRICT=现状（HARD 闸、原子、0-或-全、写真值）。PROVISIONAL=新（ADVISORY 闸、建透、全标未审核、不写真值）。
### 3.2 PROVISIONAL 模式管线
- 闭包门照常算所有维 → 缺口记 `severity=ADVISORY`（不阻断）。
- 缺求解器 → **A16 临时生成 + 沙箱跑通**（PROVISIONAL solver）。
- 本体/规则/切片 → 创建为 `status=PROVISIONAL, origin=LLM`（冻结）。
- 数据 → 确定性 GenSpec 合成为 **PROVISIONAL ObjectInstance**（`origin=LLM_PROVISIONAL`，隔离命名空间/标签）。
- B 栈（Agent/工作流/技能/意图/计划/场景）→ scaffold 为 `status=PROVISIONAL`（可调用，标未审核）。
### 3.3 隔离（防污染真值，R2）
- PROVISIONAL 制品全打 `origin=LLM_PROVISIONAL`；受治理查询/推演**默认排除** PROVISIONAL；仅在显式 provisional 上下文（如该 StoryBuildRun 的预览/推演）可见可跑。
### 3.4 端到端推演（PROVISIONAL_ANSWER）
- 在未审核域上跑主问句 → 出答案，**trustLevel=UNVERIFIED**，每个数字 provenance 标"基于未审核临时件（本体/数据/求解器皆未审核）"。
- 终态 `verdict=PROVISIONAL_ANSWER`（**绝不** ANSWERABLE/VERIFIED）；ADVISORY 缺口随答案一并显示（"以下环节未验证：…"）。
- 写真值门控（R4）：基于 PROVISIONAL 域的 ActionDraft 一律拒/需先晋升。
### 3.5 人工审核与晋升
- 审核台（DataBuilderPage / A4）：逐制品看 `origin/status` + 代码/定义 + ADVISORY 缺口 + 试运行。
- **全域晋升**：人工逐项或整域 `promote` → 对象/规则/切片发布真值（R4 审批）、求解器过 VLE/校准、数据物化为真值、B 栈 DRAFT→PUBLISHED → `status=GOVERNED`；发 `domain.promoted`。亦可**替换**（手写确定版）/ **丢弃**。
### 3.6 A5/A10 接入
- A5 FDE 节点图：节点显 `PROVISIONAL` 态（黄/紫"未审核"标）+ ADVISORY 缺口（不再红"BLOCKED"，而是"未审核可跑"）。
- A10 验证：区分 `PROVISIONAL_ANSWER`（未审核跑通）vs `VERIFIED`（晋升后真验证）。

## 4. 契约 / 端点
- `contracts`：`StoryBuildRun.buildMode/domainTrustLevel`；各制品 `origin/status`（复用 A16 枚举）；`ClosureFinding.severity: HARD|ADVISORY`；`verdict` 加 `PROVISIONAL_ANSWER`。
- 端点：`POST /a/v1/databuilder/runs`（body 加 `buildMode`）· `POST /a/v1/databuilder/runs/:id/promote`（全域/逐项晋升，R4）· `GET /a/v1/databuilder/runs/:id`（含 provisional 制品 + ADVISORY 缺口）。
- 事件 `domain.provisional_built/promoted` 入 `event-subscriptions.ts`。
- 仓储：制品 origin/status 字段（R9）；PROVISIONAL 对象隔离标。

## 5. 关键流程（端到端 · 续实证）
那道"30% 储能→动力"问句 `runStory(buildMode:PROVISIONAL)` → comprehend 倒推全栈 → 闭包记 `capacity_switch_optimizer/delivery_delay_forecast` 为 ADVISORY → **A16 临时生成这 2 个求解器 + 沙箱跑通** → 本体7类型/4规则/7切片/合成数据/B栈 全建为 PROVISIONAL（隔离标） → 端到端推演 → **PROVISIONAL_ANSWER**：收入↑X/毛利↑Y/延迟客户 Z（**全标"未审核·基于临时件"**，写真值被挡）+ "未验证环节：求解器逻辑、细分经济性数据" → 人工审核 → 整域晋升 GOVERNED（发布真值、求解器过 VLE/校准）或替换 → 此后成可信真值。

## 6. 非功能（§5）
R4（不写真值/晋升解锁）· R6（未审核件冻结确定）· R11/R12（闭包 ADVISORY 如实记缺口）· R13（强标未审核 + 绝不谎报）· R2（隔离防污染）。

## 7. 验收（DoD）
- `buildMode:PROVISIONAL` 下，缺环不再全 0：本体/数据/规则/Agent/求解器全以 PROVISIONAL 建出，端到端跑出 `PROVISIONAL_ANSWER`。
- 全程强标"未审核"；ADVISORY 缺口如实显示；**绝不报 ANSWERABLE/VERIFIED**（`provisional-honesty:check` 守）。
- PROVISIONAL 制品**不写真值、不混入受治理查询/推演**（隔离）。
- 人工可整域晋升/替换/丢弃；晋升后过 R4/VLE/校准成真值。
- STRICT 模式行为**不变**（默认、原子、写真值）。
- `pnpm -r build && pnpm -r test` 全绿（双模闭包 + 隔离 + 晋升 + provisional-honesty 用例 + 字节一致）；`chain:check`/`ontology:check`/`debattery:check` 过。
- 回写本体 §2.H/§3/§4/§5/§7/§8。

## 8. 分期
- **A17.1** buildMode 开关 + 闭包双模（PROVISIONAL=ADVISORY）+ 终态 `PROVISIONAL_ANSWER` + `provisional-honesty:check`。
- **A17.2** 全域 PROVISIONAL 生命周期（本体/规则/切片/数据/B栈 标 origin/status + 隔离）+ 接 A16 临时求解器。
- **A17.3** 端到端 PROVISIONAL 推演（trustLevel 标 + 写真值门控）+ 人工审核台 + 全域晋升/替换 + A5/A10 接入。

## 9. 需你确认（3 点）
1. **默认模式**：默认 **STRICT**（写真值），PROVISIONAL **opt-in**（推演/预览/探索时显式选）。还是你要 PROVISIONAL 成某些入口（如数据构建发动机页）的默认？默认 STRICT。
2. **未审核数据可见范围**：PROVISIONAL 对象默认**隔离**（不进受治理查询/推演，仅该 run 的预览可见）。若你要"未审核数据也直接进对象库供普通查询"，需明示——会增加"未审核混入真值"的风险（我建议保持隔离）。
3. **晋升粒度**：默认支持**整域一键晋升** + **逐制品晋升**两者。求解器晋升仍需过 VLE/校准（A16）。是否同意？

> 与 A16 关系：A16（临时求解器）= 本 PRD 在"求解器"维的特例；A17 把同一套"生成→冻结→未审核可用→人工晋升"推广到**整条域**。基线分支：closure/service/contracts 多处 + 制品加字段(migration)，对准基线。
