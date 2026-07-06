# FDE · AUTOFILL-SOP（自动补 before→after 前后端逐值可见 + 每类 NL-E2E）

> WO `AUTOFILL-SOP`（用户亲令 2026-07-06·`docs/SPEC-autofill-sop.md` §4/§5）。补自动补机制两处不达标：
> ① 每次自动补 before→after 前后端逐值可见（对后端 `GrowthLedger` 逐值勾稽）；② 每类自动补一条经 QOS NL 真跑的 E2E。
>
> 铁律 0.4 诚实注：本 FDE 为**真跑真数据真读退出码**（EXIT=0 only）。无 LLM key 时 NL-E2E 用 scripted classifier 证 harness 结构（走 `orchestrator.submitQuery` 非直调 solver）；**真 Kimi NL 端到端 + 真浏览器逐值对照属审核方复验**。合成/占位/骨架值一律诚实标 `dataMode`（SYNTHETIC/PROVISIONAL/DRAFT/NONE），绝不冒充真实。

## 本体引用与影响
- 对象类型：`GapFillEvidence`（新增·`contracts/growth.ts`）· `GrowthFillResult`（+fillEvidence）· `GrowthRunReport`/`GrowthLedgerEntry`（逐轮携带）· `GapReport`（复用）。
- 链路：growth `L13`（探针→补齐→重跑→收敛）· `sys.orch.query_to_answer`（NL-E2E via `probeRepresentativeNL`→`submitQuery`）。
- 不变量：R8（可信溯源·逐值勾稽）· R6（确定性 seed=42）· R13（真源投影）· R-NO-FAKE-DONE（dataMode 诚实位）。
- 断点：G-9（发育闭环招牌）。
- 回写：`docs/SYSTEM-ONTOLOGY.md` GapReport 行 **P8 段**（已回写）+ 切片重生成（`pnpm ontology:slices`·11 切片·母体 hash 2576444b9ae95e6b）。

## C1 · 契约 + 逐类产出（真跑证据）

`GapFillEvidence {gapCode, fillAction, before, after, evidence, dataMode}` 落 `packages/contracts/src/growth.ts`；
`GrowthFillResult += fillEvidence?`；`GrowthRound.fillApplied` 逐轮携带进 `GrowthRunReport`。

**真 dump**（`buildGrowthLoopWiring().fill()` provisionWorld 分支·mock dataCore 真返 objectCount=120）：

```json
{
  "gapCode": "EMPTY_DATA",
  "fillAction": "provisionWorld",
  "before": { "objectCount": 0, "worldEmpty": "true" },
  "after": { "objectCount": 120, "industry": "battery-manufacturing", "worldEmpty": "false" },
  "evidence": "空租户经真合成正门 provisionWorld（scale=S·seed=42）→ battery-manufacturing 起步世界·120 对象（SYNTHETIC·R6 确定性·可溯·非真实业务事实）",
  "dataMode": "SYNTHETIC"
}
```

逐类 before→after + 诚实 dataMode：

| 类 | fillAction | before | after | dataMode |
|---|---|---|---|---|
| 空世界 EMPTY_DATA | provisionWorld | `{objectCount:0}` | `{objectCount:120}` | **SYNTHETIC** |
| 单类型 EMPTY_DATA(SOFT) | fillData | `{rows:0}` | `{rows:6}` | **PROVISIONAL** |
| NO_PLAN | scaffoldDraftPlan | `{plan:"none"}` | `{plan:"plan_growth_*"}` | **DRAFT** |
| 驾驶舱登记在办（未实际补） | registerWorklist | `{status:"gap"}` | `{status:"OPEN"}` | **NONE**（诚实标未自动补） |

## C2 · 前后端逐值勾稽（后端 round-trip + 前端渲染）

- **后端**：`runGrowthLoop` 出 `GrowthRunReport`，`rounds[0].fillApplied.fillEvidence` 齐 before→after；插入 `growthLedger` → `GET /api/v1/growth/ledger` 读回，`before.objectCount==0 / after.objectCount==120` 逐值不丢（memory repo round-trip 保真）。
- **前端**：`TicketCenterPage`「诊断新缺口」逐轮渲染 `FillEvidenceBlock`——逐值 testid `tc-fe-{round}-{before|after}-{key}` + `tc-fe-{round}-datamode`。jsdom+MSW 真渲染，断言前端每个 before/after 键值 == 后端 MSW `growth/run` 真返 `GapFillEvidence`（PROVISIONAL: `before.rows=0→after.rows=6`·typeKey Object；NONE: `before.status=gap→after.status=OPEN`·worklistItemId=wli_demo）。
- 诚实注：jsdom+MSW = 结构逐值勾稽；**真浏览器 + 真起双服务逐值对照属审核方复验**。

## C3 · 每类自动补一条 NL-E2E（复用 WO-2 `probeRepresentativeNL`）

`agentcore/test/growth-autofill-evidence.test.ts` 对四类（SYNTHETIC/PROVISIONAL/DRAFT/NONE）逐一：构造缺口 → 跑自动补（断言 evidence dataMode）→ 代表问经 `probeRepresentativeNL` 真跑。
齿②监视：`vi.spyOn(orchestrator,"submitQuery")` 恰调 1 次 + `internal:true`；`probe.gap.path==="AGENT"`（走 QOS NL 分类路由·非手搓 args 直调 `/a/v1/solvers/{key}/invoke`）；`probe.acceptanceRan===true`（真跑到终态）。无 LLM key → 诚实降级（路径B 兜底文本·非承载数据），符合 SPEC §5「answered/CONVERGED 或诚实降级」。

## C4 · green→red 自证（revert 演练·亲跑两次 EXIT）

| 演练 | 破坏 | EXIT | 结果 |
|---|---|---|---|
| 后端 RED | `scenario-grow.ts` provisionWorld 分支摘掉 `fillEvidence` 附着 | **1** | 4 failed（C1/C2/C4 红） |
| 后端 GREEN | 恢复 | **0** | 10 passed |
| 前端 RED | `TicketCenterPage` 关掉 `FillEvidenceBlock` 渲染（`{false && ...}`） | **1** | 2 failed |
| 前端 GREEN | 恢复 | **0** | 2 passed |

## 亲跑退出码（EXIT=0 only·主控收口·未自跑全套 gates）

```
# 后端 10 齿
npx vitest run test/growth-autofill-evidence.test.ts    → EXIT=0（10 passed）
# 前端 2 齿（逐值勾稽）
npx vitest run test/f64.autofill-evidence.test.tsx       → EXIT=0（2 passed）
# 回归（无破坏）
npx vitest run test/growth-autofill.test.ts test/scenario-growth-wiring.test.ts \
  test/growth-worklist-human-fill.test.ts test/capability-verify.test.ts → EXIT=0（18 passed）
npx vitest run test/f62.ticket-center.test.tsx test/f63.growth-ticket-merge.test.tsx \
  test/growth-board-emptystate.test.tsx                  → EXIT=0（9 passed）
# 构建 + 类型
pnpm --filter @platform/contracts build  → 0err
pnpm --filter agentcore build            → 0err
pnpm --filter frontend-shell typecheck   → 0err
```

## 诚实边界总述
- 自动补产的合成/占位/骨架值**诚实标 dataMode**（SYNTHETIC/PROVISIONAL/DRAFT），登记在办未实际补标 **NONE**（before==after 数据不变）——不冒充真实（KILL-MOCK-RED 同源红线）。
- 无真实业务数据的 HARD 缺口仍走真人正门（不静默合成·既有 DF.9 分流不变）。
- NL-E2E 无 LLM key → scripted classifier 证 harness 结构（走 submitQuery）；真 Kimi NL + 真浏览器逐值对照留审核方复验。
