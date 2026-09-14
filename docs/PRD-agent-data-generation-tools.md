# PRD · Agent 合规数据生成工具（fill_data / run_synthetic / build_domain · R4/未审核态门控）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端（agent 工具）+ 轻契约 |
| 取代/扩展 | 新建 · 补 `BUILTIN_TOOLS` 缺的"产数据"工具 · 与 `PRD-in-dialog-gap-fill-loop`（前端面）/`PRD-A1`（能力即工具）/`PRD-data-closure-spec`（单一上传口/R4）/`PRD-A18`（未审核态状态机）同源四面 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R4/R6/R13 · §2.D1/D7 · §8 G-3）· `apps/agentcore/src/tools/registry.ts:4`（`BUILTIN_TOOLS`，**无产数据工具**）· `apps/agentcore/src/tools/executor.ts:199-265`（case 分派）· `apps/agentcore/src/tools/clients.ts:31`（`fillData` 客户端已在）· `apps/agentcore/src/tools/datacore-http.ts:93`（→ `POST /a/v1/growth/fill-data`）· `apps/datacore/src/app.ts`（`/a/v1/synthetic/jobs` · `/a/v1/databuilder/runs`）|

> 一句话：经营驾驶舱"生成模拟数据再推演"失败，根因不是诚实纪律出错（agent 拒绝伪造是**对的**，R13），而是 **agent 的 `BUILTIN_TOOLS` 里根本没有"触发产数据"的工具**——只有读/查 + `create_action_draft` + 工单。后端 `fillData` 客户端已在（datacore-http.ts:93），但**没注册成 agent 可调工具**，于是 path-B agent 在"自己编（违铁律）"和"整体拒绝"之间只能拒绝。本 PRD 给 agent 三把**合规触发工具** `fill_data`/`run_synthetic`/`build_domain`：触发**确定性、走管线、可溯源**的合成（非伪造）→ 数据落 **未审核态(PROVISIONAL，R4 未发布)** → agent 用既有 `query_timeseries_agg`/`query_objects` **读回真实物化值**再推演，答案显式标注"基于本轮合成的未审核数据"。**触发合成 ≠ 伪造**——这是本 PRD 的核心立论。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.D7/D1）：`Tool(BUILTIN)`（新增 3 个）·`SyntheticJob/Connection/RawDataset`·`BuildPlan/StoryBuildRun`·`ObjectInstance`（PROVISIONAL 态）·`TsSeries`（合成时序）·`ActionDraft`（发布转正走 R4）。
- **触及链路**（§3 / §10.3 `sys.orch.query_to_answer`）：`agent loop → tool: fill_data|run_synthetic|build_domain → DataCore 合成/建域端点 → 数据物化(PROVISIONAL) → agent: query_timeseries_agg/query_objects 读回真实值 → final_answer(标注未审核)`。读数仍走查询工具（铁律：数字来自工具结果），生成工具只**触发管线**、回执含 jobId/seriesKeys/rowCount，**不直接产业务数字**。
- **触及事件/数据流**（§4）：复用 `syntheticJob`/`raw_dataset.uploaded`/`storybuild.run_recorded`；R4 发布转正走 `action.executed`。
- **触及不变量**（§5）：
  - **R13（诚实，核心）**：生成工具**不返回业务数字**，只返回回执；业务值由 agent 后续查询工具读回的**真实物化数据**承载 → 答案数字仍"来自工具结果"，不破铁律。答案对未审核数据**显式标注**（PROVISIONAL/未审核），与真值区分。
  - **R4 / 未审核态**：合成数据落 **PROVISIONAL**（未发布真值，A18 状态机）——可读可推演（ADVISORY），但**不计入真值**；转正发布走 Action 审批。
  - **R6**：`run_synthetic`/`fill_data` 确定性（seed）；同 (industry,seed) 字节一致。
  - **R3**：三工具受 entitlement 门控；**R14/单一上传口**：合成数据经唯一 DataCategory 入管线，不旁路、不双口写同字段。
  - **R2**：租户隔离（OBO 透传用户 JWT）。
- **关闭/影响断点**（§8）：**G-3**（对话坞/agent 未消费缺口→无法自助补数据）——本 PRD 让 agent 能在"信息不足"时**自助触发合成**，是 G-3 的 agent 侧闭合；与 in-dialog-gap-fill（前端侧）配对。
- **门禁**（§7）：`chain:check`（工具命中真实端点）· 跨服务冒烟（agent→DataCore 真触发）· `cli-parity:check`（三工具同步登记 `OPERATION_CATALOG`，CLI 可调，R15）· FDE 亲手跑（空租户→触发合成→读回→推演）。
- **数据闭环合规**（`PRD-data-closure-spec.md §6`）：触发产出走 **I1 单一上传口 + M1 物化(PROVISIONAL→R4 转正) + V2 溯源 + C3 缺口诚实**；生成工具不写死值（R14）；时序经 A8 管线（T3 种子配置）。
- **回写承诺**：3 新 BUILTIN_TOOLS + executor case + OPERATION_CATALOG 登记 → 回写本体 §2.D7（工具集）+ §3（链路）+ §7（cli-parity）+ §8（G-3 agent 侧）。

## 1. 目标 / 非目标
### 目标
1. **三把合规生成工具进 `BUILTIN_TOOLS` + executor case**：
   - `fill_data`：缺数据真人正门补（→ `POST /a/v1/growth/fill-data`，`fillData` 客户端已在，仅注册为工具）。
   - `run_synthetic`：触发合成作业（→ `POST /a/v1/synthetic/jobs`，含 industry/scale/seed + 时序剧本）。
   - `build_domain`：故事驱动建域（→ `POST /a/v1/databuilder/runs`，故事=用户问句）。
2. **未审核态门控**：生成数据落 **PROVISIONAL**（A18 状态机），agent 可读可推演（ADVISORY），**不计真值**；答案显式标注"未审核合成数据"。
3. **铁律自洽**：生成工具回执只含 jobId/seriesKeys/rowCount/connId；业务数字由 agent **后续 `query_timeseries_agg`/`query_objects` 读回真实物化值**——数字仍来自工具结果，不伪造。
4. **闭环可跑**：空租户问"6 月达成率未达成原因" → agent 判缺数据 → `run_synthetic`/`fill_data` 产真序列(PROVISIONAL) → 读回 → 推演 → 答案(标未审核 + 溯源)。
5. **四面同源**：与前端缺口卡（in-dialog-gap-fill）、CLI op（A15 OPERATION_CATALOG）、后端管线同一能力，GUI=对话=CLI 同源（R15）。

### 非目标
- 不让 agent **在答案里编数字**（铁律不变）；生成工具只触发管线、不产业务值。
- 不把合成数据直接当真值（必经 R4 转正）。
- 不重写合成/建域后端（端点已在，仅注册为 agent 工具）。

## 2. 现状与缺口（带 file:line）
| 元素 | 现状 | 缺口 |
|---|---|---|
| agent 工具集 | `BUILTIN_TOOLS`（registry.ts:4）：读/查 + `create_action_draft` + 工单 | **无 fill_data/run_synthetic/build_domain** |
| fillData 能力 | ✅ 客户端 clients.ts:31 → datacore-http.ts:93 `/a/v1/growth/fill-data` | **未注册成工具**（executor 无 case） |
| 合成/建域端点 | ✅ `/a/v1/synthetic/jobs` · `/a/v1/databuilder/runs` | agent 无对应工具/客户端 |
| 读时序 | ✅ `query_timeseries_agg`（executor.ts:253）| — |
| 现象 | 空租户 + 无产数据工具 → agent 诚实拒绝"无法生成模拟数据" | 缺合规触发工具 → 无法自助补 |
| 未审核态 | A18 PROVISIONAL 状态机（已设计）| 合成数据接入该态 |

## 3. 设计
### 3.1 三工具定义（registry.ts BUILTIN_TOOLS + executor case）
- `fill_data{typeKey, fields[], rows?, seed?}` → `dataCore.growth.fillData`（已有客户端）→ 回执 `{connId, rowCount}`。
- `run_synthetic{industry, scale, seed?, livedIn?}` → 新客户端 `POST /a/v1/synthetic/jobs` → 回执 `{jobId, producedSeriesKeys[], objectCounts}`。
- `build_domain{story}` → 新客户端 `POST /a/v1/databuilder/runs` → 回执 `{runId, producedArtifacts, gapReport}`。
- 三者回执**只含元信息**（无业务数字）；输出携 `provisional:true` + lineage（R13）。
### 3.2 未审核态门控（R4 / A18）
- 生成数据 origin 标 `SYNTHETIC` + 状态 `PROVISIONAL`（未发布真值）；query 工具读回时附 `unverified:true`，agent `final_answer` 必带"基于本轮合成的未审核数据"标注。
- 转正：用户/agent 经 `create_action_draft`（已有）发布 → R4 审批 → GOVERNED 真值。
### 3.3 铁律护栏
- executor 对三工具的结果做 schema 校验：**禁止把生成工具回执当业务答案数字**；答案数字必须引自 `query_*` 工具的 `⟦ref⟧`（沿用 compose 引用纪律）。
### 3.4 CLI/前端同源
- 三工具同步登记 `OPERATION_CATALOG`（A15）→ CLI `platform fill-data|synth|build` 可调；前端缺口卡（in-dialog-gap-fill）触发同一能力。

## 4. 契约 / 端点
- `agentcore/tools`：registry 加 3 ToolDefinition；executor 加 3 case；`clients.ts` 加 `synthetic.runJob`/`databuilder.runStory` 客户端（datacore-http）。
- 复用 DataCore：`/a/v1/growth/fill-data`（已）· `/a/v1/synthetic/jobs` · `/a/v1/databuilder/runs` · `/a/v1/timeseries/agg-query`（读回）· `/a/v1/action-drafts`（转正）。
- 契约：工具 IO schema（含 `provisional` 标记）；无新真值源。

## 5. 关键流程
agent 判缺数据 → `run_synthetic`/`fill_data`/`build_domain`（回执元信息，PROVISIONAL）→ `query_timeseries_agg`/`query_objects` 读回真实物化值 → 推演 → `final_answer`（数字带 ⟦ref⟧ + "未审核合成"标注）→（可选）`create_action_draft` 转正 R4。

## 6. 非功能（§5）
R13（不伪造：生成只触发、数字读回；未审核显式标注）· R4/未审核态 · R6（确定性）· R3/R2 · 单一上传口。

## 7. 验收（DoD）
- 三工具进 `BUILTIN_TOOLS` + executor，命中真实端点（chain:check / 冒烟过）。
- 空租户"6 月达成率未达成原因"：agent **能自助触发合成** → 读回真实序列 → 推演出答案（标"未审核合成数据" + 溯源），**不再整体拒绝、也不伪造**。
- 生成工具回执无业务数字；答案数字均引自 query 工具 ⟦ref⟧（铁律自洽测试）。
- 合成数据落 PROVISIONAL，未经 R4 不计真值；转正走 Action。
- 三工具登记 `OPERATION_CATALOG`（cli-parity:check 过）；前端缺口卡同源。
- `pnpm -r build && test` 全绿（工具 + 铁律护栏回归）；FDE 亲手跑全程。
- 回写本体 §2.D7/§3/§7/§8。

## 8. 分期
- **ADT.1** `fill_data` 工具（客户端已在，仅注册 + case + PROVISIONAL 标 + 铁律护栏）+ 空租户闭环。
- **ADT.2** `run_synthetic` + `build_domain` 工具（新客户端）+ 读回推演 + 未审核标注。
- **ADT.3** OPERATION_CATALOG 登记（CLI 同源）+ 前端缺口卡对接（in-dialog-gap-fill）+ 转正 R4 + 全链回归。

> 四面同源拼图：**前端缺口卡（in-dialog-gap-fill）· agent 工具（本 PRD）· CLI op（A15）· 后端管线（合成/建域/fill-data）** —— 同一"合规产数据"能力的四个面，GUI=对话=CLI 同源（R15），数据走单一上传口 + 未审核态 + R4 转正。基线分支：agentcore 工具层 + 轻客户端，冲突小。
