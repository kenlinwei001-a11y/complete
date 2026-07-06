# SPEC · 自动补 SOP（标准作业 · 前后端逐值可见 · 检测标准 · 测试流程）

> 状态：审核方设计，派 dev 施工（WO `AUTOFILL-SOP`）。用户 2026-07-06 亲令产出并同步 dev。
> 目的：把"系统答不出时自动补缺"的流程钉成**成文标准**——补什么、怎么补、前后端怎么可见、怎么算补对、怎么测。补两处现不达标项：**① 每次自动补前后端逐值可见 ② 每类自动补一条"代表问经 QOS NL 真跑答出"的 E2E**。

## 0. 本体引用与影响
- **对象类型**：`GapReport`(§2.H)·`GrowthRunReport`/`GrowthLedgerEntry`(§2.H)·`Capability`(WO-2 §2.H)·`GrowthTicket`。
- **链路**：growth `L13`(§4)·`sys.orch.query_to_answer` 的 gap 块(§10.3)。
- **不变量**：R16(发育闭环)·R4(fill 经 Action·scaffold 为 DRAFT)·R6(确定性)·R13(可溯源)·R-NO-FAKE-DONE(WO-1)。
- **断点**：G-9(发育闭环招牌)·关联 R8 可信溯源。
- **回写**：若新增前端证据块契约/事件 → 回写 §2.H/§4。

## 1. 范围界定：什么算"自动补"（诚实·代码实证）
`scenario-grow.ts:96-162` + `probe.ts:27-37 gapDisposition`：

| 类别 | 缺口码 | 真自动(无人) or 人工闸控 |
|---|---|---|
| **AUTO_DERIVE** | NO_INTENT · NO_PLAN | 从卡基因组确定性重建;补不上→回落工单 |
| **图连通即自动** | NO_SLICE | `planSlice` 确定性图搜索(图连通);缺 link→人工建模 |
| **兜底自动** | SOLVER_NOT_FOUND | 绑 `generic_inference` |
| **人工闸控 NEEDS_HUMAN** | EMPTY_DATA · NO_RULE · SHAPE_MISMATCH · NO_CAPABILITY | 数据真人正门 / 规则 DRAFT+R4 / 工单 |

> **铁律(代码实证 `scenario-grow.ts:100/136`)**：默认 UI 流(`registerWorklist=true`)里，自动补**登记在办项、待人点「补数据缺口」才触发**，**不静默改真数据/真世界**。造真值/约束一律经 R4。真·静默自动仅 `provisionWorld`/`fillData` 确定性合成(SYNTHETIC 可溯)在 direct 模式。

## 2. 逐类 SOP（从代码规范化 · 每类同一外壳 `loop.ts`）
**通用外壳**：`probe`(代表问经 QOS 真跑→`classifyGap`) → `fill`(按码分派) → 发 `growth.gap_detected`/`fill_proposed` → `advanced=true` 重跑 → `dataBearing`门+`ANSWERABLE` → `CONVERGED`/`BOUNDARY`/`NEEDS_HUMAN`/`MAX_ROUNDS` → 留痕。

| 类 | 补的动作(file:line) | 终态/产物 |
|---|---|---|
| 世界全空 | 探测 types 全 0 → 登记在办 provisionWorld / direct 真合成一致世界(`scenario-grow.ts:96-117`) | 世界 ready→槽位可填 |
| EMPTY_DATA | `decideDataGap`→HARD 出 DataRequest 真人正门 / SOFT 登记在办 fillData(`:118-149`) | PROVISIONAL(诚实标合成) |
| NO_PLAN 等 | `scaffoldDraftPlan`→DRAFT 计划 `[invoke_solver(generic_inference),render_answer]`待 R4(`scaffold.ts:21-38`) | DRAFT 待审批 |
| NO_SLICE | `planSlice` BFS root→target 最短路→hops;不可达→NO_PATH(`slice-planner.ts:30-42`) | SlicePlan / 落人工建 link |
| NO_INTENT | 卡基因组 re-seed+re-publish+grow 重验(`server.ts:2258`) | 升相 / 回落工单 |
| SOLVER_NOT_FOUND | 绑 generic_inference / 出求解器骨架工单 | 兜底 / 工单 |

## 3. 检测标准（补对没对 · 已在代码,须成文引用）
- **`verifyScenario`(`server.ts:2079`)**：代表问真跑 → `verdict===ANSWERABLE` **且** `dataBearing`(有 kpi/table/rule/action 块或 `⟦ref:⟧`)→ `maturity=GOVERNED`;空投影→`RENDER_NOT_PROJECTED`;失败→`RUNTIME_FAIL`。**未 VERIFIED 即诚实 not-ready + 挂 issue，绝不靠"结构存在"假绿**(`:2343`)。
- **`Capability.verifiedStatus`(WO-2)**：三真(制品在∧acceptance 跑∧代表问 NL 答出)派生,`RUNTIME_PROBE` 活证据,禁手写。
- **门**：`check-ontogenesis.mjs` · `check-scenario-ontogenesis-runtime.mjs` · `no-fake-done:check`(WO-1)。

## 4. 前后端逐值可见【★不达标·本 WO 补】
- **后端(已有)**：`growth.gap_detected/fill_proposed/converged` 事件 + `GrowthLedgerEntry` + `GrowthRunReport`(逐轮 rounds+terminalState)。
- **前端(须补·R8/铁律0.4)**：每次自动补产出一个**证据块** `{gapCode, fillAction, before, after, evidence, dataMode}`,前端在自成长/工单中心**逐轮渲染 before→after**,且**前端所见逐值可对后端**(GrowthLedger 同值勾稽·合成标 PROVISIONAL/SYNTHETIC 不冒充真实)。

## 5. 测试流程【★不达标·本 WO 补】
- **每类自动补一条 E2E**：构造该缺口 → 跑自动补 → **代表问经 QOS NL 真跑(复用 WO-2 `probeRepresentativeNL`,走 `orchestrator.submitQuery` 非直调求解器)** → 断言 `answered`/`CONVERGED` 或诚实降级。
- **green→red 自证**：revert 自动补逻辑 / 篡改证据块 → 对应测试红。
- **前后端勾稽测**：前端证据块渲染值 == 后端 GrowthLedger 值(逐值)。
- 诚实边界：无 LLM 环境用 mock classifier 证 harness 结构;真 Kimi NL 真跑 env-gated。

## 6. 派 dev 的验收（见 work-queue `AUTOFILL-SOP`）
本 SPEC §4/§5 落为可核验 acceptance：前端证据块契约 + 逐轮渲染 + 前后端勾稽测 + 每类自动补 NL-E2E。审核方独立真跑复验（含 green→red 骗测）。
