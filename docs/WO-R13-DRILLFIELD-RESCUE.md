# WO-R13-DRILLFIELD-RESCUE · 抢救分支择出（内容级取证已完成，本单只需搬运 + 复验）

> 出处：WO-3 件二（抢救分支定性）。**结论 = 有价值 ⇒ 择出来单独成单**。
> 取证方式按判据要求走**内容/blob 级**，不看提交图（cherry-pick 会改哈希、`merge-base` 恒 false）。

## 0. 先纠正派单人两条事实（以实测为准）

| 派单人写的 | 实测 | 证据 |
|---|---|---|
| 「10 个**从没推过**的容器重启自动快照」 | ❌ **已在远端**：`refs/remotes/origin/claude/rescue-r13-drillfield-0811` @ `f9b0c0ec` | `git for-each-ref \| grep rescue` |
| 欠账口径「`drillField:"value"` 回的却是 `orderVal`，差 1e4」 | ⚠️ 那是 **#96 原病，已由 `61a1d9f0` 修复**且不复现。抢救分支真正的内容是**同族另一半**：`drillId` 填基地键冒充对象主键 ⇒ **下钻路径悬空** | 见下 §1 |

## 1. 定性结论：有价值（三项内容在 canonical 与 handoff 上**都不存在**）

判据 = 内容存在性，逐文件 blob 级：

| 内容 | rescue | `handoff-wo-r13-drillfield` | **canonical** |
|---|---|---|---|
| `solvers/service.ts` 里 `drillId: "*"` | **4 处** | 0 | **0** |
| 测试第二个 describe「溯源口径通用判据·无静默跳过」 | **有（160 行）** | 无 | **无** |
| 本体断点 `G-PROV-DRILL-DANGLING` | **有** | 无 | **无** |
| 本体 R13「溯源口径子不变量」段 | **有** | 无 | **无** |

复核命令（任何人可复现）：

```bash
C=origin/claude/inspiring-gates-aqczjg; R=origin/claude/rescue-r13-drillfield-0811; H=origin/claude/handoff-wo-r13-drillfield
for b in $C $H $R; do echo -n "$b drillId\"*\"="; git show $b:apps/datacore/src/solvers/service.ts | grep -cE 'drillId: "\*"'; done
for b in $C $H $R; do echo -n "$b G-PROV-DRILL-DANGLING="; git show $b:docs/SYSTEM-ONTOLOGY.md | grep -c 'G-PROV-DRILL-DANGLING'; done
git show $C:apps/datacore/test/prov-drillfield-truth.test.ts | grep -c '溯源口径通用判据'   # 0
git show $R:apps/datacore/test/prov-drillfield-truth.test.ts | grep -c '溯源口径通用判据'   # 1
```

## 2. 内容实质（rescue 相对 merge-base `c0b7ee0d` 的净贡献：3 文件 / +176 −8）

**① 根因修复**——`gapAttribution` 四个**聚合**节点把基地键填进 `drillId` 位冒充单对象主键：

- `Order` 主键是 `so`（`SO-3391`…），仓储里没有 `id=hefei` 的订单
- `Equipment` 主键是 `equipId`（`LINE-WS-…-E1`），同样查无此物
- 且设备叶那个数本就是该基地 `oee_current` 的**均值**（聚合，非单台）

改法走契约 `GapProvenanceSchema` **已备**的「按类型聚合」约定 `drillId:"*"`（**非**改字段名、**非**改取值；基地上下文不丢——L1 节点自带 `baseId`/`displayName`，设备叶在 `id`(`equip:<base>`)/`factor` 里）。

**② 门升级为通用判据**（这是比修复本身更值钱的一半）——旧门遇到解析不出真值的节点 `continue` **静默跳过**，于是只咬得住「取值取错」，咬不住「字段名/对象 id 标错」，而两者**修法相反**。新块：深走求解器输出收全部 provenance，类型/字段/主键现查**已发布本体**，每个三元组必须落入且仅落入 SINGLE / AGGREGATE 两类且**两类都断言**，**「跳过」这个动作被删掉**。扫全 8 条 `gap_attribution` 路径。

**③ 本体回写**——R13 子不变量 + 断点 `G-PROV-DRILL-DANGLING`。

## 3. 本单要做什么

1. `git checkout -B claude/handoff-wo-r13-drillfield-rescue origin/claude/inspiring-gates-aqczjg`
2. 把 rescue 的净贡献搬过来（**内容搬运**，不是 merge 那 10 个 autosave 快照）：
   ```bash
   git checkout origin/claude/rescue-r13-drillfield-0811 -- apps/datacore/test/prov-drillfield-truth.test.ts
   # service.ts 与 SYSTEM-ONTOLOGY.md 必须**手工择取**：canonical 自 08-06 起已大幅前进，
   # 直接 checkout 会把 canonical 的新增内容整片回滚（实测 rescue→canonical 反向 diff 达 −773 行）。
   ```
3. `service.ts`：把 4 处聚合节点的 `drillId: e.base` / `drillId: scopedBaseId` 改成 `drillId: "*"`（连同注释）
4. 本体：补 R13 子不变量段 + `G-PROV-DRILL-DANGLING` 断点行
5. **复验（本单没做，留给你）**：`pnpm --filter datacore exec vitest run prov-drillfield-truth`
   —— ⚠ datacore vitest **同时只许 1 个**，开跑前 `bash scripts/dispatch-deficit.sh` 确认没别人在跑
6. 变异反证（rescue 的交回声称做过 5 次，本单**未复跑**，你要自己跑）：取值错 1e4 / 字段名换 `valueWan` / 悬空 `drillId` 回退 / 聚合回万元权重 / 设备聚合回 `oeeDeficit`

## 4. 本单**没有**做的事（诚实边界）

- ❌ 没跑过 rescue 的测试（datacore vitest 属重画像，WO-3 是轻画像单、且同刻 WO-2 独占该资源）
- ❌ 没验证 rescue 的「5 次变异反证全部真红」这一自述
- ❌ 没动 `apps/**` 任何生产代码（WO-3 范围边界外）
- ❌ 没强推/覆盖任何分支（rescue 分支原样保留在远端，可随时复查）

## 5. 处置建议

**保留** `origin/claude/rescue-r13-drillfield-0811` 直到本单落地并绿；落地后再删也不迟（远端有备份，删除无收益、误删有代价）。
