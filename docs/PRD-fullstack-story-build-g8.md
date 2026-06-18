# PRD · 故事先行入口与全栈 scaffold（自成长发动机的主动建域扩展）

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 状态 DRAFT · 日期 2026-06-18 |
| 取代/扩展 | **扩展** `docs/PRD-demand-pulled-growth-engine.md`（自成长发动机，已落 P1–P6）与 `docs/PRD-unified-build-engine.md`；**不重建**其任何机制 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · **`docs/PRD-demand-pulled-growth-engine.md`（本 PRD 的母体）** · `docs/PRD-unified-build-engine.md` |
| 核心一句话 | 给已建成的自成长发动机加**第二个入口**：从"**一句失败的客户问句**反应式打补丁"扩成"**一段故事脚本主动倒推整个域**"——comprehend 故事 → 全栈 BuildPlan → 自描述补录(InputManifest) → **复用** 发动机的数据自动补/scaffold/工单/LOOP/账本，并把 scaffold **补齐到完整 B 栈**(workflow/skill/agent/mcp/scene)，顺手统一 rawin 填数到合成模块。问句驱动 ⊕ 故事驱动 = 同一台发动机的两个燃料口。 |

> **与母体 PRD 的关系（读前必看）**：`PRD-demand-pulled-growth-engine.md` 是**问句驱动、反应式**——客户问句失败 → QOS 探针 → GapReport → 补/工单 → LOOP 收敛。本 PRD 是**故事驱动、主动式**——一段故事描述目标域 → 一次性倒推全栈需求 → 建域。两者**下游机器完全共用**（GapReport / fill-data / scaffold / GrowthTicket / LOOP / 成长账本 / 驾驶舱），本 PRD 只加**前段入口 + 自描述补录 + 把 scaffold 补全到 B 栈 + rawin 去模板化**四件事，其余一律复用、不重定义。

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：
  - **复用（母体已立，本 PRD 不重定义、不回写）**：`GapReport` · `GrowthTicket` · `GrowthLedger`（自成长发动机 P1–P5）· `BuildPlan/BuildJob/ClosureReport/DataBuilderAgent`（A7）· `SyntheticJob/IndustryTemplate/Connector/RawDataset` · `OntologyType/SliceSpec/Rule/Solver/ActionType` · `Intent/ExecutionPlan/Workflow/Skill/Agent/MCP tool/Scenario/SceneEntry`（B 栈）。
  - **本 PRD 新增（落地时回写 §2，追加新行、不碰他人行）**：`StoryBuildRun`（故事先行的一次端到端建域记录，串 InputManifest→BuildPlan→scaffold→收敛→历史推演记录）· `InputManifest`（comprehend 后倒推"数据发动机页还需补录哪些字段"的自描述表单契约）。
- **触及链路**（§3）：数据构建发动机链（`StoryScript→BuildPlan→…`，扩出**完整 B 栈 scaffold** 支线）⊕ 母体的自成长闭环（`Query→Intent→Plan→Solver→render` 探针 + 补 + LOOP）。**新增接缝：故事入口 → InputManifest → BuildPlan → 复用 fill-data/scaffold。**
- **触及事件/数据流**（§4，遵守 R10/D-29）：**复用** 母体 `growth.gap_detected`/`growth.fill_proposed`/`growth.ticket_opened`/`growth.converged` 及 `ontology.published`/`materialize.completed`/`scenario.published` 等；**本 PRD 仅追加** `storybuild.run_recorded`（历史推演记录刷新；落地时登记 §4，**事件号顺延母体之后**，不占用其 L13）。
- **触及不变量**（§5，R1–R14）：R2 tenant（StoryBuildRun/InputManifest 带 tenantId）· R4 真值经 Action（B 栈 scaffold 一律 DRAFT，复用母体就地审批）· R6 确定性（同故事+同 seed → 同 BuildPlan 字节级一致；LLM mock）· R8 服务间（复用母体 OBO/SERVICE_TOKEN，不新开通道）· R11 全链闭包（**主动建域侧**：故事→全栈→可运行，与母体"运行时实跑"互补）· R12 双向闭包扩 B 栈无死路 · R3 entitlement（复用 `feature.growth-engine`，不新增 feature）。
- **关闭/影响的已知断点**（§8）：**G-8** ——母体从"运行时实跑"侧推进；本 PRD 从"**主动建域 + 完整 B 栈 scaffold**"侧补全（母体 scaffold 当前到切片/规则/意图且"待 P4、当前出工单"；本 PRD 把 workflow/skill/agent/mcp/scene 也纳入 scaffold）。协同 **G-1/G-5/G-6**（故事任意行业建域，rawin 去模板化）。
- **需走的检测门禁**（§7）：复用母体全链闭包门 · VLE · `scenarioClosure`（B 栈无死路）· `chain:check` · `prd:check` / `prd:coverage` · 断链审计。
- **回写承诺（注意纪律）**：因 `SYSTEM-ONTOLOGY.md` 当前由**自成长发动机分支**持有写权且已改 §2.H/§4，本 PRD **落地前不独立回写本体**；待母体合并后，仅以**零冲突追加**方式回写 §2（StoryBuildRun/InputManifest 新行）、§4（`storybuild.run_recorded` 顺延号）、§8（G-8 进度补注），**绝不编辑母体已占用的 GapReport 行 / L13 行**。

## 1. 目标 / 非目标

### 1.1 目标（全部为母体之上的增量）
1. **故事先行入口**：数据发动机页可持续输入（或自动生成）**故事脚本**，comprehend 一次性倒推**全栈需求**（数据/对象/切片/规则/求解器 ⊕ 意图/计划/工作流/技能/Agent/MCP/场景），主动建域——而非等某个问句失败才反应式补。
2. **InputManifest 自描述补录**：脚本未指明、构建必需的信息（规模/seed/时间跨度/复用哪些既有连接器/落点视图…）由发动机产出 → 数据发动机页**动态渲染补录表单**（HITL）。"发动机自己告诉页面还要问什么"。
3. **scaffold 补全到完整 B 栈（G-8 这一侧的收口）**：把母体已有的"切片/规则/意图/计划 scaffold"**延伸到 workflow/skill/agent/mcp/scene**，统一经 B 侧 `scenarioClosure` 无死路上架门；缺的仍走母体 GrowthTicket，不臆造。
4. **rawin 去模板化统一到合成**：A7 `rawin` 不再用独立 `genCsv`，统一调（泛化后的）`SyntheticService`——有模板走模板、无模板按 `BuildPlan.objectTypes` schema 驱动造数（seed 确定性）。消灭重复生成器（G-6 残留）。
5. **历史推演记录**：`StoryBuildRun` 持久化（脚本/InputManifest/BuildPlan/scaffold 回执/产物/答案），前端"构建历史/推演记录"时间线逐条可回放；源数据仍在连接器页可见，本页补"过程数据"。

### 1.2 非目标（一律复用母体，**严禁重建**）
- **不重建** GapReport / QOS 缺口探针 / 缺口分类法（复用母体 §5）。
- **不重建** 缺数据自动补（复用母体 `POST /a/v1/growth/fill-data` + 就地 Action 审批面板）。
- **不重建** generic-inference 兜底 / GrowthTicket 工单 / claim·submit·verify 施工闭环 / LOOP 收敛 / 成长账本 / 自成长驾驶舱（复用母体 P3–P6）。
- 不自动发明领域算法（缺求解器 → 母体 B 兜底 + C 工单）；不替换 QOS/合成器/Action/连接器/本体服务。

## 2. 现状与缺口（对照代码，带 file:line）

**已存在（复用，勿重造）**：
- **自成长发动机 P1–P6**（母体分支已落）：`POST /api/v1/growth/probe`（GapReport）· `POST /a/v1/growth/fill-data`（缺数据真人正门）· `POST /api/v1/growth/run`（LOOP 收敛，K 有界）· GrowthTicket 契约 + 成长账本（仓储四处 + migration007）· `claim/submit/verify` 施工闭环 + CLI 活查询面 · 自成长驾驶舱 `/admin/growth`（`GrowthCockpitPage`）。
- A7 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish`（`databuilder/service.ts:160-317`）；`BuildPlan{dataSources,objectTypes,rules,solverNeeds,kbDocs}`（`contracts/databuilder.ts:138`）+ `freezePlan+seed`（R6）。
- 合成器 `SyntheticService.runJob`（`synthetic/service.ts:479`，模板绑定）；B 侧 `scenarioClosure/probeMissingRefs` 无死路上架门。

**缺口（本 PRD 补，确认真实）**：
- 发动机只有**问句入口**（反应式），**无故事/主动建域入口**：comprehend 不产**完整 B 栈需求**，BuildPlan 缺 `intent/plan/workflow/skill/agent/mcp/scene` 字段（`contracts/databuilder.ts:138-151` 仅 5 字段）。
- 母体 scaffold **只到切片/规则/意图/计划，且"待 P4、当前出工单"**（母体 TODO P3 余项）；workflow/skill/agent/mcp/scene **不在 scaffold 范围**。
- **无 InputManifest**：脚本缺字段时静默用缺省 seed/规模，无"倒推补录表单"。
- `rawin` 用独立 `genCsv`（`service.ts:257`），**不调 `SyntheticService`** → 两生成器并存（G-6 残留）；`SyntheticService` 模板绑定，无法为故事现推的新对象类型造数。
- 无 `StoryBuildRun` 持久 + 故事建域的历史推演时间线（母体驾驶舱展示的是 growth run/账本，非故事建域全过程回放）。

## 3. 设计（复用现有接缝优先；标清"复用 / 绿地新建 / 门禁新增"）

### 3.1 BuildPlan 扩全栈字段（契约扩展，绿地字段，向后兼容 `.default([])`）
```
// A 栈补：sliceNeeds[]（复用 SliceSpec 形态）
// B 栈补（母体 scaffold 当前缺的部分）：
intentNeeds[] · planNeeds[] · workflowNeeds[] · skillNeeds[] · agentNeeds[] · mcpNeeds[] · sceneNeeds[]
```
`comprehend`（唯一 LLM 步）扩 prompt：故事 → 全栈需求（JSON-mode + 确定性兜底解析；plan 封存重放，R6）。

### 3.2 InputManifest（自描述补录 · 绿地）
```
InputManifest = { runId, fields: InputField[] }
InputField = { key, label, dataType, required, default?, source: "STORY"|"ASK_USER"|"REUSE_EXISTING", options?[] }
```
`source=ASK_USER` 渲染为数据发动机页动态补录表单；`REUSE_EXISTING` 给"复用既有连接器/本体"下拉。补录回填 BuildPlan → 进 gap/rawin。

### 3.3 scaffold 补全到 B 栈（复用母体 scaffold 机制 + 扩范围）
- **复用** 母体的 scaffold 通道与就地审批；**扩** scaffold 覆盖到 workflow/skill/agent/mcp/scene。
- 每件 B 栈制品 scaffold 为 **DRAFT**，跑既有 `scenarioClosure/probeMissingRefs`，缺的引用→**复用母体 GrowthTicket**（不另造工单机制）。
- closure 阶段把 B 栈 scaffold 回执并入全链判定；HARD 维断 → 拒发布（R11）。

### 3.4 rawin 去模板化统一合成（复用 + 重构）
- 删 `genCsv`；`rawin` 改调 `SyntheticService.generateFromSchema(objectTypes, links, seed)`——按属性 dataType + refToTypeKey 确定性造行 + 维 FK 一致；有 `IndustryTemplate` 优先模板（battery-manufacturing 字节级回归锁，R6）。
- **与母体 `fill-data` 的分工**：`fill-data` 是"运行时缺某表 → 单表补"；本项是"建域期按全 BuildPlan schema 批量造"。二者共用同一确定性生成内核（统一到 `SyntheticService`），避免三套生成器。

### 3.5 StoryBuildRun 历史推演记录（绿地持久 + 前端页）
- `StoryBuildRun` 仓储双实现（R9 四处同改）：`{runId, tenantId, script, inputManifest, buildPlan(frozen), scaffoldReceipt, gapReport?(复用), producedConnections[], producedDatasets[], answer?, status, createdAt}`。
- 前端"构建历史/推演记录"时间线：逐 run 卡片 → 下钻 脚本/补录项/scaffold/产物（源数据连连接器页）/答案回放。**与母体驾驶舱并列**（母体看 growth LOOP/账本；本页看故事建域全过程）。

## 4. 关键流程（端到端，沿 `sys.ingest.build_closure` ⊕ 母体自成长闭环）
```
数据发动机页 ── 故事脚本(输入/自动生成) ──> 故事先行入口
  ① intake → ② comprehend(LLM)：全栈 BuildPlan + InputManifest
  ② ½ 若 InputManifest 有 ASK_USER 项 → 页面动态补录 → 回填续跑
  ③ gap：幂等比对既有(连接器/本体/规则/求解器/B 制品) → REUSED 标记
  ④ rawin：SyntheticService(模板 or schema 驱动, seed) → Connection+RawDataset(连接器页可见)
  ⑤ transform：upsertType + materialize + rules + 派生（A 栈真值经 Action）
  ⑥ closure：A 三向闭包 + B 栈 scaffold(复用母体通道, 扩 workflow/skill/agent/mcp/scene)
              → 缺的 → 复用母体 GrowthTicket；全链 HARD 断 → 拒发布(R11)
  ⑦ publish：A 物化 + B 制品 PUBLISHED 均经母体就地审批(R4)
  ⑧ 记录 StoryBuildRun → 发 storybuild.run_recorded → 历史推演记录刷新
  ⑨（可选）以生成场景跑母体 LOOP/QOS 推演 → answer 回填 run
```

## 5. 与自成长发动机的分工边界（防重叠的法定划线）

| 维度 | 自成长发动机（母体，问句驱动） | 本 PRD（故事驱动） |
|---|---|---|
| 燃料 | 一句失败的客户问句 | 一段描述目标域的故事脚本 |
| 方式 | 反应式：探针断在哪补哪 | 主动式：一次倒推整个域 |
| 缺口检测 | **GapReport（owner）** | 复用 |
| 数据补 | **fill-data（owner，单表）** | 复用同一内核（批量建域） |
| 结构 scaffold | 切片/规则/意图/计划（owner） | **扩 workflow/skill/agent/mcp/scene** |
| 兜底/工单/LOOP/账本/驾驶舱 | **owner（P3–P6）** | 复用 |
| 自描述补录 | — | **InputManifest（owner）** |
| 历史记录 | growth run/账本 | **StoryBuildRun（建域全过程回放）** |

> 一句话：**母体管"问句→补"，本 PRD 管"故事→建域"；下游机器同一套，本 PRD 只加入口、补录、B 栈 scaffold 全集、rawin 去模板化。**

## 6. 非功能与约定（§5 不变量逐条满足）
- R2：StoryBuildRun/InputManifest/新表全列 tenantId；跨租户 403。
- R4：A 物化 + B 制品 publish 经母体就地审批；scaffold 仅 DRAFT。
- R6：`freezePlan+seed`；`generateFromSchema` 确定性；测试 LLM mock；battery 模板字节级回归锁。
- R8：复用母体 OBO/SERVICE_TOKEN，**不新开 A↔B 通道**。
- R11/R12：全链 + B 栈无死路，构建时 HARD 门（与母体运行时实跑互补）。
- R3：复用 `feature.growth-engine`，不新增 feature。
- R10/D-29：仅追加 `storybuild.run_recorded`（号顺延母体），下游订阅历史推演记录页。

## 7. 验收（DoD）
1. `pnpm -r build && pnpm -r test` 全绿；`pnpm gates`（ontology/chain/debattery/prd/prd-coverage）全绿。
2. **故事建域回归**：一段故事 → 全栈 BuildPlan（含 B 栈字段）→ scaffold 出 DRAFT 意图/计划/工作流/技能/Agent/场景 → `scenarioClosure` 通过。
3. **B 栈无死路回归**：故事缺 agent/求解器 → 全链 HARD FAIL 且 publish 被拒（R11）；缺的落**母体 GrowthTicket**（验证复用、未另造）。
4. **InputManifest 回归**：缺 seed/规模 → 列 ASK_USER 项；补录后续跑成功。
5. **rawin 去模板化回归**：故事现推全新对象类型（无模板）→ schema 驱动合成出 RawDataset 且物化；battery 模板字节级不变。
6. **复用证明（防重叠）**：缺数据走母体 `fill-data`、缺功能走母体 GrowthTicket、收敛走母体 LOOP——**本 PRD 代码无重复实现**（评审 + grep 证 0 重定义）。
7. **历史持久回归**：StoryBuildRun 双仓储 parity；前端时间线展示源/过程数据 + 答案回放。
8. **本体回写（合并后）**：仅零冲突追加 §2/§4/§8，`ontology:check` 不漂，不动母体 GapReport 行 / L13。

## 8. 分期
- **P1（最低风险，先行）**：rawin 去模板化统一 `SyntheticService`（消 `genCsv`，G-6 残留收口）+ StoryBuildRun 持久 + 历史推演记录前端时间线。
- **P2（故事入口）**：BuildPlan 扩 A 栈 sliceNeeds + InputManifest 契约 + comprehend 产出 + 数据发动机页动态补录表单。
- **P3（B 栈 scaffold 全集 · G-8 这一侧收口）**：BuildPlan 扩 B 栈字段 + scaffold 扩 workflow/skill/agent/mcp/scene（复用母体通道）+ closure 并入全链判定。
- **P4（贯通母体）**：建域产物接母体 LOOP/QOS 推演回填答案 + 故事脚本自动生成器（从母体 GapReport/账本派生，确定性可测）。
- **回写本体**：母体合并 main 后，零冲突追加回写。

---

> **施工前置（流程纪律）**：本 PRD 依赖自成长发动机先合 `main`。在那之前本分支只演进本 PRD 文档；落地需 rebase 到含母体的 main 上，再按 §0 回写承诺以追加方式更新本体。
