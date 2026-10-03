# HANDOFF · WO-ONTO-TRUNCATE-GUARD（受保护文件截断/清空门）

## ① 实测数（全部本机复算，非转述）

- 事故复核：提交 `3298add3aa52` 对 `docs/SYSTEM-ONTOLOGY.md` **2127 删 / 0 增**，事故后 blob = 空 blob 常量 `e69de29b`；其父提交该文件 2127 行；救援合并 `8d70bcdb`（vs 第一父仅 +3）救回；当前文件 2270 行（本单回写后 2273）。
- 阈值取证：受保护现存清单 172 个文件（1 本体 + 138 PRD + 33 baseline），全历史「提交×文件」样本 **926 个**。删除比分布 **p50=0.0016 · p90=0.0197 · p95=0.0612 · p99=0.7247 · max=1.0**；ratio≥0.8 共 9 个样本，逐个数剩余行数后分三类：事故（2127→0）· 整文件重写（new≈old：1140→1146、869→869、89→89、502→493）· 小文件合法收紧（10→1、89→6）。
- 整删历史快查（`git log --diff-filter=D`）：仅 2 笔——`2eeeb2c2` 删 21 行 dark-launch-baseline、`7a613c74` 换版删 PRD-addendum-a9（207 行），两笔均在集成线祖先里、落在任何 merge-base..HEAD 区间之外 ⇒ 豁免册天生为空 `[]`。

## ② 改法与论据

**交付**：`scripts/check-file-truncation.mjs`（门 `file-truncation:check`）+ `scripts/file-truncation-exemptions.json`（空册）+ 台账登记 + 接 `pnpm gates` + 本体 §7 登门 / §8 新行 `G-ONTO-TRUNCATE-NO-GATE`（✅ 已闭）。

**判据（阈值是扫历史分布定的，不是拍的）**：① `new=0`（清空/整删，无论多大）⇒ 红；② `old≥100 行 且 剩余比 ≤0.2` ⇒ 红。926 样本里**唯事故命中**：重写靠剩余比排除（new≈old），合法收紧靠 old≥100 排除（10、89 < 100）。
⚠️ **对工单的一处实测顶回**（铁律 0.5）：WO-QUEUE 与 `G-OEE-DUAL-TRUTH` 行内预案写的是「少 50% 以上」单阈值 —— 50% 会把两次合法收紧误报（10→1 剩 10%、89→6 剩 7% 均 <50%）。双阈值取代之，事故照样必咬（剩 0%）。

**形态选择（工单要求二选一给论据）：选 (b) 门链，弃 (a) pre-commit 钩子。** 论据三条：
1. `.git/hooks/` **不进版本管理** —— 别的 dev、容器、worktree 全都没有它（本仓 `.git/hooks/pre-commit` 已有自匹三次的坑，且多 dev 派单全部在隔离 worktree 里跑，钩子根本不在场）。门要守的是「收编进 canonical」这个唯一入口，守在仓里（`pnpm gates` + 台账）才人人有份。
2. (b) 被诟病「只能事后」——但本仓的准入闸本就在**收编时**（handoff 分支 → 审核复验 → 并 canonical），区间 `merge-base(HEAD, 集成线)..HEAD` **逐提交**审，收编前照样拦得住；拦的是「进正线」，不是「进本地历史」。
3. 逐提交审而不只比 `HEAD~1`：区间中段的事故会被后续合法提交盖过去（净 diff 为零但事故事实存在），`rev-list` 全段 + 每提交对第一父 diff 堵这个洞。

**金丝雀 16 条，与主逻辑共用同一份 `judge()`/`scanCommit()`**：必咬 3（事故原样 2127→0 · 1000→150 · 边界 100→20）· 必不咬 5（重写 1140→1146 · 小收紧 10→1 · 新建 0→500 · 99→5 · 100→21）· 豁免配对 2 · glob 4 · **真史双向 2**（工单点名：真 `3298add3` 必咬在本体、正常小改 `2e94e7ff` 4增4删必不咬）。

## ③ T1–T5 实测输出原文

**T1 变异反证（红对地方）**：真把本体截成 50 行提交（探针提交，已 `reset --hard` 撤销）：
```
⛔ 受保护文件被清空/截断 1 处（判据落行数比，不看提交信息说了什么）：
   473d737d9 docs/SYSTEM-ONTOLOGY.md —— 大文件截断：2270→50 行，剩余比 2.2% ≤ 20%
RC=1
```
红在**报出该违规**（commit+路径+行数比），不是「门崩了」。同轮实证豁免通道：加带理由豁免 ⇒ RC=0 且打印「豁免在案」；理由 <20 字 ⇒ RC=2「工具坏了」；基线 ref 缺失 ⇒ RC=2。撤销变异后 `wc -l docs/SYSTEM-ONTOLOGY.md` 回 2270、`git status` 干净。

**T2 没碰的东西没被弄红（merge-base `2a1a412b0` 对拍）**：
- `check-gate-ledger`：基线与 HEAD **同一条**既存红「check-branch-base.mjs 未登账」（基线台账 grep 0 次确认既存，本单范围外）。我的门 ③④ 判据（binding/disposition）接线后已消。
- `check-wo-anchors`：两树**逐字相同** 7/13（同 7 个文件清单）。
- 金丝雀前置声明：基线树未装依赖时 gate-ledger 会多报「dist 未构建无法核」23 条环境噪声（与内容无关），对拍只取内容失败行。

**T3 金丝雀正反**：`--selftest` RC=0，「金丝雀全中（必咬 3 · 必不咬 5 · 豁免配对 2 · 真史 2 · glob 4，均与主逻辑共用同一份实现）」。

**T4 基线方向**：本单**零基线改动**——豁免册是新文件且为 `[]`；`gate-ledger-baseline.json` 未触碰（provenRed NEVER 35/35 不变，我的条目 kind=MUTATION）；无任何 `--update`。方向：没动。

**T5 交前三条**：`git status --porcelain` 空（提交后复核）· `check-branch-base HEAD` RC=0 · `check-merge-conflict-markers` RC=0。另跑 `check-ontology-anchors` RC=0、`check-system-ontology` RC=0（断点编号闭合：§8 已登记 173 个、悬空 0）、`check-gate-exit-discipline` RC=0（94 门全有 RC=2 出口+顶层兜底，含新门）、`check-no-raw-nul` / `check-case-collision` RC=0。

## ④ 基线变化

没动。豁免册 `[]` 是新文件不是基线；台账 NEVER 计数 35→35。

## ⑤ 与其他 dev 的文件重叠

`git log --oneline -5 -- scripts/check-file-truncation.mjs scripts/file-truncation-exemptions.json`：全新文件无历史。
⚠️ **已知重叠**：`docs/SYSTEM-ONTOLOGY.md` §7/§8 与 P2（WO-ONTO-STATUS-BACKFILL，§8 加状态标记）和 P3（§8 去重）同文件 —— 我的改动是**追加型**（§7 末尾 +1 bullet、§8 末尾 +1 行），不与 P2 的「只加标记」改法冲突；与 P3 合一行时需人工并（我的新行 `G-ONTO-TRUNCATE-NO-GATE` 无重复编号）。
`package.json` gates 串与 P4（WO-FACT-USAGE-REGISTRY 收尾）同点追加 —— 后并者解一处行冲突即可。
`scripts/gate-ledger.json` 与 P4 同文件 —— 各加各的键，JSON 对象级合并无冲突。

## ⑥ 没做的部分 + 差什么才能做

1. **本门守不住「集成线本体上跑」的场景**：merge-base==HEAD 时区间为空、无事可审（已在门输出与 §7 条目里如实写明）。要守「canonical 上直接推了一个截断提交」这条路径，需要 canonical 侧在收编流水线里以 `--range <旧tip>..<新tip>` 调本门 —— 属审核方流水线改造，非本单范围。
2. **numstat rename 花括号形态**（`dir/{a => b}/f`）不匹配 —— 受保护清单历史上零出现，如未来出现需扩展 `scanCommit` 的路径解析（现已在头注诚实边界②声明）。
3. 既存红 `check-branch-base.mjs 未登账`（gate-ledger 判据①）与 `check-wo-anchors` 7/13 —— **基线既存、非本单范围**，如实挂账；前者登账是 5 分钟的活，可并入任一下一张 scripts 侧工单。
