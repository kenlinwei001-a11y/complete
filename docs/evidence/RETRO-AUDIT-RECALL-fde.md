# RETRO-AUDIT-RECALL (WO-6) · 存量回炉 FDE 证据

> PRD `docs/PRD-trustworthy-self-accounting.md` §6 回炉审计清单 · 不变量 R-NO-FAKE-DONE(§5) · 事件 selfaccount.fake_detected(§4 L15) · 断点 G-16(§8)。
> 本单**只诚实曝光**证明 claim>实 的诈账为 actionable 开放缺口（非藏在"完成"里）；**不填洞**——填洞（接 NL 场景路由 + 落 E1/E2/N1/SCENE-C/AUDIT-OBS + 除假红）是随后 WO-7+ fill 批（每单以"代表问经 NL 真跑答出"验收）。**未自跑全套 pnpm gates（现含全套慢·主控收口）。**

## 1. 回炉前后计数（门实测）

| 指标 | 回炉前 | 回炉后 | 证据 |
|---|---|---|---|
| work-queue DONE | 95 | 92 | `node scripts/check-no-fake-done.mjs` 首行"扫 N 张 DONE" |
| no-fake-done FAKE | 1 | **0** | 门第二行 `FAKE ... N（基线 M）` |
| no-fake-done UNVERIFIABLE | 27 | **26** | 同上 |
| 棘轮基线条目 | 28 (1 fake + 27 unv) | **26 (0 fake + 26 unv)** | `scripts/no-fake-done.baseline.json` |
| work-queue OPEN（回炉降级/曝光） | 0 | **6** | 见 §2 |
| 门 EXIT | 0 | **0** | 回炉不破门 |

**门 EXIT=0**（回炉后，无基线外新 FAKE/UNVERIFIABLE）。
**green→red 自证**：植入一条引用幽灵求解器 `ghost_nonexistent_solver` 的假 DONE → 门 **EXIT=1**（`FAKE __SELFTEST_FAKE__`）；移除后回 **EXIT=0**。回炉未破门。

## 2. 诈账逐条降级证据（claim vs 实）

### 2.1 降级为 OPEN 的 3 张证明 claim>实 的假 DONE

| 单 ID | claim（原声称） | 实（file:line 实测） | 处置 | 移出基线 |
|---|---|---|---|---|
| **MULTISRC-FUSION** | "N1 多源融合+冲突仲裁+测谎完成"(DONE) | 6 条 curl 验收全打 `/a/v1/solvers/**source_conflict**/invoke`，但 `source_conflict` **全仓零命中**（真 key `multisource_fusion`·`solver-registry.ts:102`）→ 一执行即 404（教科书铁证）；且无真 ERP/MES 多源数据、`multisource_fusion` 未接进 QOS NL 场景路由 | DONE→**OPEN** + gap(`SOLVER_NOT_FOUND`,Q2) | ✅ fake{} 移出（1→0） |
| **QUERY30-ORCH** | "10 新求解器+**countermeasure 跨求解器编排**+7workflow+2agent"(DONE) | `countermeasureCombo`(`extended.ts:376`) 只**借子求解器名 + 魔数系数**（gap×0.3/0.15/0.1/0.2/0.5）拼答案·**从不真调** cert_schedule/changeover_sequence 等；10 求解器函数在但 `SCENARIO_CATALOG` S01–S20 无一指向通用求解器→NL 场景路由**零命中**（9 洞共性根） | DONE→**OPEN** + gap(`NO_CAPABILITY`,Q6) | ✅ unverifiable{} 移出（27→26） |
| **E1-E2** | "校准活体常态化 + 沙盘 what-if 进决策"(DONE) | note **自打脸**"仅设计零代码·NOT-LANDED"；E2 `propagateTick` 仍"待增量3"(`app.ts:1293`)——DONE↔note 结构矛盾 | DONE→**OPEN** + gap(`NO_CAPABILITY`,Q1/Q3/Q4/Q5) | （原不在基线·有 criteria） |

### 2.2 新增 3 张 actionable 开放缺口（诈账/洞无对应可降级 DONE）

| ID | 覆盖洞 | claim vs 实 | gap code |
|---|---|---|---|
| **GAP-SCENE-C** | Q6,Q8 | 5 个通用多跳求解器在 agentcore 场景/意图路由**零命中**；按角色接地(base_manager/planner/CEO)未全铺 | NO_INTENT |
| **GAP-AUDIT-OBS** | Q9 | `AUDIT-hand-run.md §③` 称"5 杀手多跳全落地+**真实 HTTP E2E**"，实为 **4 个直调**(shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius·手搓 args 直调 `/solvers/{key}/invoke`)·**NL→QOS 从未真跑**；classifyGap 把此洞误落 OTHER | NO_CAPABILITY |
| **GAP-XINDUSTRY-LAYOUT** | Q10 | 跨行业 config 即跑：求解器大部在，但视图 layout 仍**电池形**(G-5)·换行业不切换 | NO_CAPABILITY |

### 2.3 诚实边界（不降级 · 不作假 · 铁律 0.4）

- **KILL-MOCK-RED**：PRD §6.3 快照标 `status=TODO·未做`（"risk_timeline 无源仍哈希假红 risk.ts:342/358"）。**回炉复核发现已 LANDED**：`risk.ts:166/393/403` 无真源 → 返回 `{value:null, dataMode:MOCK}`（不再吐哈希假红）；`mockTightness` 已从无源回落路径删除（`risk.ts:328/201` 注"已删"）；`genuine-sim:check` 门在 `pnpm gates` 链且 **EXIT=0**。**降级它=为已完成项制造假缺口=作假（违铁律 0.4·KILL-MOCK-RED 同源红线）→ 不降级**，据实记为 LANDED。审核方可 `node scripts/check-genuine-sim.mjs` 复核；若复跑红则改判降级。
- **其余 25 张 UNVERIFIABLE**（UI 修复/重构真做·仅缺机器可校验 acceptance，如 GRAPH-PANORAMA-ONLY / CLARIFY-COMBOBOX-DISMISS）：**非** claim>实 诈账，只是"DONE 但无 acceptance.criteria"。一刀切降级会**制造假缺口**（反向诈账）→ 不降级，保留基线待 **WO-2** Capability.verifiedStatus 真派生。

## 3. 北极星距离表（9 洞逐个：缺什么·真填在哪个后续 fill 单·验收代表问）

> 本单让 9 洞**诚实可见为 actionable 开放缺口**（work-queue `OPEN`·带 what/where/acceptance/fillWO）。真正填上=WO-7+。Q7(shared_bottleneck=what_if_displacement) 是 10 题里唯一真通那 1 个（不在洞内）。

| 洞 | 代表问（NL 验收锚） | 缺什么（根因·非空壳） | 开放缺口载体 | 填在哪（fill 单） |
|---|---|---|---|---|
| Q1 | 毛利跌破+归因+择杠杆 | 多杠杆择优未进决策日常（缺 E2） | E1-E2 (OPEN) | WO-7+ E2 落地 |
| Q2 | 多源各执一词仲裁 | multisource_fusion 真在但验收指幽灵端点+无真多源+NL 未接 | MULTISRC-FUSION (OPEN) | WO-7+ N1 NL 落地 |
| Q3 | 断供 30 天传导 | 情景注入沙盘未进决策入口（缺 E2） | E1-E2 (OPEN) | WO-7+ E2 落地 |
| Q4 | 预测信几分 | 活体收敛趋势不可见（缺 E1） | E1-E2 (OPEN) | WO-7+ E1 落地 |
| Q5 | 行动回采对账 | 预期 vs 实际不闭（缺 E1） | E1-E2 (OPEN) | WO-7+ E1 落地 |
| Q6 | 保交付/毛利/信用三选二 | trade-off 不接地（countermeasure 借名+缺 SCENE-C） | QUERY30-ORCH + GAP-SCENE-C (OPEN) | WO-7+ NL 路由+真编排 |
| Q8 | 按角色不同接地答案 | 通用求解器未铺进角色场景 NL 路由（缺 SCENE-C） | GAP-SCENE-C (OPEN) | WO-7+ SCENE-C |
| Q9 | 审计还原决策链 | 审计散点未成一线·NL→QOS 从未真跑（误落 OTHER） | GAP-AUDIT-OBS (OPEN) | WO-7+ AUDIT-OBS（依赖 WO-3） |
| Q10 | 跨行业 config 即跑 | 视图 layout 仍电池形（G-5） | GAP-XINDUSTRY-LAYOUT (OPEN) | WO-7+ G-5 layout |

**9 洞共性根**：求解器函数多数在，但**没接进 QOS 自然语言场景路由**；或依赖 E1/E2/N1/SCENE-C/AUDIT-OBS/G-5 未落。每张 OPEN 缺口的 `acceptance` 均钉"代表问经 QueryDock NL→QOS 真跑答出（非手搓 args 直调 /solvers/{key}/invoke）"。

## 4. 门/脚本 EXIT 汇总（亲跑·只信 EXIT=0）

| 命令 | EXIT | 说明 |
|---|---|---|
| `node scripts/check-no-fake-done.mjs`（回炉后） | 0 | FAKE 0 + UNVERIFIABLE 26·基线内 |
| 植假 DONE → 门 | 1 | green→red 自证·回炉不破门 |
| 移除假 DONE → 门 | 0 | 复位 |
| `node scripts/check-genuine-sim.mjs` | 0 | KILL-MOCK-RED LANDED 复核 |
| `node scripts/build-ontology-slices.mjs --check` | 0 | 母体 §8 G-16 回写后切片一致（hash 806f0c8f35c2c6ee） |
| `pnpm -r build`（已装依赖的 checkout·同 base） | 0 | 本单**零 .ts/.tsx 改动**（只动 docs/json/scripts）→ 编译不受影响·天然绿。worktree 为全新 worktree 无 node_modules 故未在其内重跑（非代码错误） |

## 5. 本体回写

- `docs/SYSTEM-ONTOLOGY.md` §8 G-16 两行更新 WO-6 回炉进展（降级 3 假 DONE + 曝 9 洞 + 基线 28→26 + KILL-MOCK-RED LANDED 不入洞 + 填洞待 WO-7+），`pnpm ontology:slices` 重生成 11 切片（`ontology-slices:check` 绿）。G-9/G-16 判据机理未变（本单是执行 G-16 门的回炉，非改门），故仅更新收口口径状态行。

## 6. 诚实边界（钉死）

本单**只曝光非填洞**：把证明 claim>实 的诈账从假 DONE 降为 actionable 开放缺口、缩基线、写北极星距离表。**未**接 NL 路由、**未**落 E1/E2/N1/SCENE-C/AUDIT-OBS、**未**动 KILL-MOCK-RED（已 LANDED）——那些是 WO-7+ fill 批，每单以"代表问经 NL 真跑答出"验收。别在本单假装填了洞（那正是本 PRD 要根治的诈账模式）。
