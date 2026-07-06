# FDE 真跑证据 · `no-fake-done:check` 门（PRD-trustworthy-self-accounting WO-1）

> 铁律 0.4 真实测试：以下为**亲自前台跑门读退出码**的真输出（非报告冒充）。门为纯静态确定性门（R6·无起服务/无网络/无时钟），故 FDE = 真跑门本体三态。
> 门：`scripts/check-no-fake-done.mjs` · 基线：`scripts/no-fake-done.baseline.json` · 不变量 `R-NO-FAKE-DONE`（本体 §5）· 断点 `G-16`（§8）· 事件 `selfaccount.fake_detected`（§4 L15）。

## 门设计（抽取 + 存在性 + 棘轮）
1. **抽取**：遍历每张 work-queue `DONE` 自带的 `acceptance.criteria[].assert`(+`.run`/`method[].run`)，正则 `/a/v1/solvers/([a-z0-9_]+)/invoke` 抽取被引用的求解器 key（assert 是自然语言散文·门不直接 curl 跑）。
2. **存在性校验**：抽出的 key 对**真实制品集** DataCore `SOLVER_REGISTRY`（单一来源·静态读 `apps/datacore/src/solvers/solver-registry.ts`·当前 48 key）核验——引用幽灵 key（零命中）→ **FAKE**；DONE 但 `acceptance` 缺失/`criteria` 空 → **UNVERIFIABLE**（同 FAKE 处置）。
3. **棘轮基线**（仿 `check-debattery.mjs`）：`no-fake-done.baseline.json` 诚实记当前存量 **1 FAKE(MULTISRC-FUSION) + 27 UNVERIFIABLE**（非洗白·每条注明待 WO-6 回炉重置为开放缺口）。门只在**基线外新 FAKE/UNVERIFIABLE**（或基线该缩未缩）时红。查出 FAKE 报 `selfaccount.fake_detected` 事件语义。

## C2 · MULTISRC 幽灵照出（教科书铁证·PRD §6.1）
`MULTISRC-FUSION`(DONE) 的 6 条 curl 验收全指 `/a/v1/solvers/source_conflict/invoke`，但 `source_conflict` 求解器**全仓零命中**（`grep -rl source_conflict --include=*.ts apps/ packages/` = ZERO；真求解器 key 为 `multisource_fusion`）→ 制品缺失=诈。

**C2-A 基线内跑（照出但基线覆盖 → 绿 EXIT 0）**：
```
· no-fake-done：扫 94 张 DONE 自我账目（求解器 key 存在性静态校验，单一来源 SOLVER_REGISTRY=48 key）
· FAKE(引用幽灵求解器) 1（基线 1）· UNVERIFIABLE(空验收) 27（基线 27）
  selfaccount.fake_detected: MULTISRC-FUSION → 引用幽灵求解器 source_conflict（真求解器集无此 key）
✓ no-fake-done:check 通过（无基线外的新 FAKE/UNVERIFIABLE；存量见基线，待 WO-6 回炉重置为开放缺口）。
EXIT=0
```

**C2-B revert 演练（从基线移除 MULTISRC → 门行为随之变红 EXIT 1）**：
```
✗ no-fake-done:check 未通过（出现基线外的新诈账 / 无验证 DONE → 违反 R-NO-FAKE-DONE）：
  - FAKE MULTISRC-FUSION：acceptance 引用幽灵求解器 source_conflict（SOLVER_REGISTRY 零命中）→ 制品缺失=诈
EXIT=1
```
（演练后基线复原 → 复绿 EXIT 0。证：门确以 SOLVER_REGISTRY 真值裁决·非桩。）

## C3 · green→red 自证（植假 DONE 指不存在求解器 `__fake_ghost__`）
往 work-queue 植一条假 DONE，其 acceptance 指幽灵求解器 `__fake_ghost__`：
```
✗ no-fake-done:check 未通过（出现基线外的新诈账 / 无验证 DONE → 违反 R-NO-FAKE-DONE）：
  - FAKE __C3_FAKE_PLANT__：acceptance 引用幽灵求解器 __fake_ghost__（SOLVER_REGISTRY 零命中）→ 制品缺失=诈
EXIT=1
```
移除该假 DONE → 复跑 **EXIT=0**（绿）。

## C4 · 空验收即红（植 DONE 无 acceptance/空 criteria）
往 work-queue 植一条 DONE 无 `acceptance`：
```
✗ no-fake-done:check 未通过（出现基线外的新诈账 / 无验证 DONE → 违反 R-NO-FAKE-DONE）：
  - UNVERIFIABLE __C4_EMPTY_PLANT__：DONE 但无 acceptance.criteria → 无从校验（同 FAKE 处置）
EXIT=1
```
移除该假 DONE → 复跑 **EXIT=0**（绿）。

## 门三态总结（真跑读退出码）
| 场景 | 期望 | 实测 EXIT |
|---|---|---|
| C2-A 基线内（存量诈账被基线覆盖） | 绿 | 0 |
| C2-B revert（基线移除 MULTISRC） | 红 | 1 |
| C3 植假 DONE（幽灵求解器） | 红 | 1 |
| C3 移除后 | 绿 | 0 |
| C4 植空验收 DONE | 红 | 1 |
| C4 移除后 | 绿 | 0 |

## 基线内容（诚实记录·非洗白）
- **FAKE ×1**：`MULTISRC-FUSION`（acceptance 6 条 curl 全指幽灵 `source_conflict`·真 key `multisource_fusion`）。
- **UNVERIFIABLE ×27**：DONE 但无 `acceptance.criteria`（ACTUATE / OBSERVABILITY / ONTO-SCEN-* / QUERY30-* / TICKET-CENTER-UNIFIED 等）。
- 每条注明**待 WO-6 回炉重置为开放缺口**。新 DONE 引幽灵制品/空验收**不得进基线**（即红）。

## 诚实边界（静态校验 vs 运行时留后续 WO）
- 本门**静态**守"求解器 key 存在性"（work-queue DONE 的 acceptance 里最可靠、最确定的制品锚）。
- **留后续**：① 更广端点/契约/文件引用校验 + "代表问经 QOS NL 真跑答出 ANSWERABLE+dataBearing"的**运行时 E2E 判据** → WO-2（Capability 一等对象 + verifiedStatus 派生）；② meta 镜像 `SystemBreakpoint.status` 交叉核对运行时真相（DRIFT 检测）→ WO-4；③ 存量诈账**回炉重置为开放缺口** → WO-6；④ `selfaccount.fake_detected` 真事件入 outbox → 运行时（本静态门只 console 报清单 + 可落缺口）。

## 门环境证据
- `pnpm -r build` 4 包 EXIT=0；`check-system-ontology.mjs`（漂移门·文件锚点 0 缺失）EXIT=0；`check-ontology-writeback.mjs`（§7 漏登 0·含 no-fake-done）EXIT=0；`build-ontology-slices.mjs --check`（切片一致）EXIT=0；`check-meta-sync.mjs` EXIT=0。
- 未自跑全套 `pnpm gates`（现含 `pnpm -r test` 慢·主控收口）——本单验到门三态正确 + build 0 + ontology-writeback/slices/drift/meta:sync 门绿即止。
