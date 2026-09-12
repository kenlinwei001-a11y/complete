# WO-RULE-SCOPE-TRIAD 交单报告（2026-08-20）

分支：`claude/handoff-wo-rule-scope-triad`（基线 = 集成线 `claude/verify-reclaim-6` tip `e1694f00`，3 提交）
仓库：`kenlinwei001-a11y/complete`

---

## ① 我自己量的数（非工单文本转述）

| 量 | 数值 | 量法 |
|---|---|---|
| 修复前 C31 判定数 | **0**（零信号期是连"0"都不报；DROP 单后每轮发 1 条 `rule.scope_unresolved`） | `rule.scope_unresolved` outbox 信号（DROP SEAM-3 实测口径） |
| 修复后 C31 判定数 | **1 条 BLOCK**，落在 `os_sep_film`（0.91 < 0.92） | TRIAD-1：`ruleScan.scan("demo")` 真扫 + `rule.alert` outbox 事件 |
| Outsource 实例数 | **8**（每物料 1 批，恰好 1 批越线） | `repos.objects.listByType("demo","Outsource")` |
| `material_has_outsource` 链路边 | **8 条**（每批连回物料，防孤岛） | `repos.links.list` |
| 修复后 scope_unresolved 信号集 | **恰好 `["C10:Action","C10:Scenario"]`**，RENAME_CANDIDATE 零条 | TRIAD-2 / DROP SEAM-3 同口径实测 |
| 本体类型数 | **94 → 95** | demo-chain-provenance 金值 |
| 对象数（S·seed42·viaModelingChain） | **11329 → 11337**（+8 Outsource） | 同上金值 |
| C10 `audited` 字段承载 | **全本体 0 个类型有该属性**（金丝雀：`approver` 存在于 OverdueRecord·Approvable，证明扫描工具没瞎） | TRIAD-4 |
| 切片连通 | 类型 95 · 链路 101 · 切片库 52 · 连通边 575 · **孤岛 0** | `node scripts/check-slice-connectivity.mjs` RC=0 |

## ② 三条断点的修法与理由

**① NAMESPACE-CONFUSION（◑→✅ 闭合）**：复核结论是剩下的两条**都不是命名漂移**（C31=NO_CARRIER、C10=CATEGORY-ERROR），命名漂移类至此清零；机制（`rule-scope.ts` 三态判据 + 每轮扫描诚实位）不动，TRIAD-6 用活本体钉抗复发：Outsource 不再被咬、敲掉一个字母的 `Outsourc` 照样被咬且给出 RENAME_CANDIDATE 建议。

**② NO-CARRIER-C31（🔴→✅ 已修）**：走「补建承载类型」。新建 `Outsource` 外协批次类型（`outsourceId/matId ref→Material/supplierId ref→Supplier/qty/yieldRate/minYieldRate`）：
- **yieldRate 真值源 = `Material.outsourceYield` 单一来源**——同一物理量不另编一份，种子里早埋的 sep_film=0.91 越线直接生效；
- `minYieldRate = OUTSOURCE_MIN_YIELD_RATE = 0.92`（数据侧配置常量·R14，取值保证 sep_film 越线、其余 0.95 合规）；
- 实例 id/qty 走 `hashString` 加盐子流，**零 rng() 消耗**（R6 字节基线不动）；
- 链路 `material_has_outsource(1:N)` 8 条接入本体图（孤岛 0）；类目归 procurement（守 duplicateTypes==[]）。
- **为什么补建而非退役**：外协良率数据语义真实存在，缺的只是一等承载；退役会把「外协质量门」业务能力连同缺口一起丢掉。

**③ CATEGORY-ERROR-C10（维持 🔴 未修·诚实登记）**：裁决维持「**任何改名都错**」，三条新证据（比工单定性更深）：
1. 唯一现存「行动上的规则」落脚处接不住它——`ActionType.checkRules` 对 `draft.payload` 求值，`approver/audited` 是 Action 制品自身治理字段、不在 payload 里；且 `actions*` 有在途 domainExecutor 单，本单边界禁碰；
2. **expression 引用的字段本身就无承载**——`audited` 在全本体任何类型的属性里都不存在；即使另立作用域维度也无处取值；
3. **规则意图今天已被结构性保证**——S2 审批链（空链⇒validation_failed、approvalSteps 落库、action.* outbox 事件）即留痕机制，C10 作为 DSL 规则是错误的载体、不是缺失的能力。
处置：规则保留 + 每轮扫描 2 条诚实信号当缺口标记（不删不改名）。**差什么才能闭**：「治理制品规则维度」单（与 domainExecutor 错峰后动 `actions*`），或产品裁决退役 C10。

## ③ T1–T5 原始输出

**T1 变异反证**（`C31: ["Outsource"]` → `["OutsourceLot"]`，跑 triad seam 全文）：
```
× TRIAD-1 → expected +0 to be 1                          ← 红在「C31 判定消失」
× TRIAD-2 → expected ['C10:Action','C10:Scenario',…(1)]  ← 红在「机器报出了空作用域信号」
× TRIAD-3 → expected [] to include 'C31'                 ← 图谱侧同步红
× TRIAD-5 → expected ['OutsourceLot'] to deeply equal ['Outsource']
× TRIAD-6 → expected [{ruleKey:'C31',…}] to deeply equal []
✓ TRIAD-4（C10 对照组）保持绿
Test Files 1 failed · Tests 5 failed | 1 passed · RC=1
```
红全部落在「规则不在评估结果里 / 机器报了空作用域」，**无一条红在「函数不存在」**。验完已 `git checkout` 还原（树干净，`C31: ["Outsource"]` 复核在 3219 行）。

**T2 干净 room 复现**（detached worktree `complete-wt-triad-t2` @ `c63c2864`）：
```
pnpm install --prefer-offline        → INSTALL_RC=0（1m25s）
pnpm --filter @platform/contracts build  ┐
pnpm --filter @platform/llm-adapters build ┘ → T2_BUILDS_RC=0
vitest run triad+drop+demo-chain（--maxWorkers=1）
  → Test Files 3 passed (3) · Tests 16 passed (16) · T2_TESTS_RC=0
```

**T3 金丝雀两侧**：TRIAD-1 内嵌 C03 对照组（`canaryRuleFires > 0` 先于 0/1 断言）；T1 变异侧 TRIAD-4（C10）保持绿 = 阴性对照。TRIAD-4 的「audited 零承载」否定结论带 approver 金丝雀。

**T4 基线方向**：类型 94→95（+1 Outsource）、对象 11329→11337（+8 外协批次）——方向=只增不减，全部来自本单新增类型/实例，无既有对象改写（service.ts 纯新增 5 行 0 删除，`git diff` 核过）；R6 同 seed 重跑字节一致由 demo-chain 用例②钉住。

**T5 交单前三查**：
```
git status --porcelain                → 空（STATUS_RC=0）
check-branch-base.mjs <branch> --onto=origin/claude/verify-reclaim-6
  → 分叉点 e1694f00 · 落后集成线 0 提交 · RC=0
check-merge-conflict-markers.mjs      → RC=0
```

**补充（rebase 后新底重验）**：开发中途集成线 9945e77c→e1694f00 前进 10 提交，已 rebase 到新 tip；incoming 与本单文件交集仅 `docs/SYSTEM-ONTOLOGY.md`（git 自动合并无冲突，我的 §2/§3/§8 改动逐条复核仍在）；incoming 零触 synthetic/金值/rule-scope/切片文档；新底下 contracts+llm-adapters+datacore 三包 build RC=0、`check-slice-connectivity.mjs` RC=0（类型 95·链路 101·孤岛 0，与提交文档字节一致）。

## ④ 基线变更

- `demo-chain-provenance.test.ts`：类型 94→**95**、对象 11329→**11337**（注释链已补 WO-RULE-SCOPE-TRIAD 段）。
- `rule-scope-drop.seam.test.ts` SEAM-3 期望信号集 4 条→**2 条**（C31 移出，加「C31 重现即回归」断言）；SEAM-7 注释更新。
- `docs/ONTOLOGY-SLICE-GAPS.md`：类型 94→95、链路 100→101（门禁脚本再生，非手改；切片库 52/连通边 575/孤岛 0 不变——Outsource 与 Material 同域 supply，链内域，不产生新切片，故文档无 "outsource" 字样属预期）。

## ⑤ 与其他 dev 的文件重叠

本单触及：`apps/datacore/src/synthetic/{battery.ts,battery-extended.ts,service.ts,data-categories.ts}`、`apps/datacore/test/{rule-scope-triad.seam.test.ts(新),rule-scope-drop.seam.test.ts,demo-chain-provenance.test.ts}`、`docs/{SYSTEM-ONTOLOGY.md,ONTOLOGY-SLICE-GAPS.md}`。
- 与在途 domainExecutor 单（`actions*`/`features.ts`）：**零重叠**（本单严守边界未碰）。
- 与集成线新收编的 10 个提交：仅 `docs/SYSTEM-ONTOLOGY.md` 一份共触，已 rebase 吸收、无冲突标记（门 RC=0）。
- 边界禁碰清单（`apps/frontend-shell/**`、`apps/agentcore/**`、`apps/datacore/src/features.ts`、`apps/datacore/src/actions*`、`apps/datacore/src/seed.ts` 等）：**零触碰**（`git diff --name-only` 可核）。

## ⑥ 没做完的部分 + 缺什么

- **C10 本体行保持 🔴 未修**（有意为之，非遗漏）：闭合需要「治理制品规则维度」新单（规则引擎扩展对 Action 制品求值的作用域维，或先在 Action 制品上补 `audited` 语义字段），**必须与 domainExecutor 在途单错峰**（都动 `actions*`）；或走产品裁决退役 C10（意图已由 S2 结构保证）。两条路都超出本单边界，已在 §8 行内写成可派判据。
- 本单未跑四包全量 gate（工单纪律禁止 `bash scripts/gate.sh` / `pnpm -r test`）；重画像期间 datacore vitest 全程 `--maxWorkers=1` 自限。
