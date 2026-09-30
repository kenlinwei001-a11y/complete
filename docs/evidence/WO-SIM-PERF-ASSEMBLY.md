# WO-SIM-PERF-ASSEMBLY · 真服务读数

**这是在治什么（一句话）**：推演每一拍都要把整张本体图**从零重装一遍**（12,499 个对象 + 13,593 条链路，
逐对象 `structuredClone`），而**世界压根没变**。装配备忘录按「世界修订号 × 规则指纹 × 范围」复用上一跑的产物。

**归线**：`claude/inspiring-gates-aqczjg`。首版 `25bfe7043`；**修准后 `9f88ea53d`**（快进，非强推）。
⚠ **先并的那一版带着一条静默错答**（见 §⑥b）—— 真服务读数出自修准之后那一版，别拿 `25bfe7043` 的读数当准。

## 环境与自证

- 本 worktree 的 `dist`，`PORT=4018`，`JWT_SECRET=dev`，`SEED_DEMO=1`，内存模式。
- **自证连的是自己那一个**：`lsof -p <pid> -a -d cwd` → `.../worktrees/wo-copy-truth`。
  本机同时有另 3 台 datacore（4001 活服务 / 4011 / 4032，属别的 agent），**一台未动**。
- 共享机、未等安静窗口，取证期间负载均值 23–86。

## ① 一次装配到底多贵（同一进程·相邻两拍·只差「世界刚被写过」）

扳机 = `POST /a/v1/databuilder/workflow-runs`（`publish_build` 步经 pipeline **真物化对象**，回包 SUCCEEDED）。

| 拍 | graph | shadow | engine | total |
|---|---|---|---|---|
| 世界未改 | 0 | 209 | 922 | 1382 |
| 世界未改 | 0 | 323 | 1096 | 1837 |
| **写世界之后第 1 拍** | **2714** | 890 | 410 | **4541** |
| 写世界之后第 2 拍 | **2** | 91 | 749 | 1385 |

另一轮独立复现：**真冷装 = 1609 ms**（`ab7` 基线拍）。

⇒ 冷装 **1609 ~ 2714 ms**，复用 **0 ~ 2 ms**。**同一组数同时证明两件事**：
复用是真的；且**世界真被写过时它必须失效** —— 没有拿旧图糊弄（这是本单最要紧的安全性质）。

## ② 用户点名的那条：metric-series 与 tick 共用同一格

序列：写世界（⇒ 该格作废）→ **只用 `GET …/metric-series` 走一趟** → tick。

| 事件 | tick 的 graph |
|---|---|
| 基线（真冷装） | 1609 |
| 写世界 ⇒ 作废 | — |
| 仅 metric-series 装配一次 | — |
| **紧随其后的 tick** | **0** |
| 再 tick | **0** |

世界刚被写过、格已作废，中间只有 metric-series 走过 —— tick 却是 0。
⇒ **两条路吃的是同一份装配**，不是各装各的。若各装各的，这一拍必是 ~1600+。

## ③ 走错的路（留证，防复发）

- **扳机选错**：`POST /a/v1/growth/fill-data` 只落 `RawDataset`、**一条 `ObjectInstance` 都没写**
  （回包 `{connId,datasetName,rowCount,filename}` 无对象条数）⇒ 备忘录**正确地**命中。
  当时差点读成「世界写了却不失效 = 备忘录坏了」——**是扳机没度量世界，不是判据没度量世界**。
- **建会话不装配**：「同范围连建两次会话」冷反而更快（冷均 476 / 热均 768 ms，噪声主导）
  ⇒ 会话创建**不是**那个预热源，拿它当冷拍读数是错的。

## ④ 判据（对照实验 · 铁律 1.5 判据一）

**把世界改一下，graph 必须按可预言的方式变化**：写世界 ⇒ 2714（失效重装）；不写 ⇒ 0~2（复用）。
两端都取到了，且**反方向也验了**（世界变了不许给旧图）。

## ⑤ 未测到的（诚实报缺）

- **四包全量测试 NOT-MEASURED**：本机跑不动（铁律「四包全量门本机跑不动」）。
  已测 = 四包 `build` 全绿 + **本单 diff 半径**。⚠ **分两栏报，别加总**（§⑥b 那次修准在中间）：
  · **修准后（`9f88ea53d`）**：接缝门 **12/12** + 批次 3 **5 文件 / 68 测试 / 0 红**
    （`shadow-memo` · `seed-demo-propagation` · `sim-propagation` · `rule-scope-triad` · `edge-money-weight`
    —— 规则×推演最吃紧的那几条）。
  · **修准前（`25bfe7043`）**：批次 1 + 批次 2，共 **16 文件 / 195 测试 / 0 红**（清单见下）。
    其中 `shadow-memo` / `seed-demo-propagation` / `sim-propagation` 三条已在修准后重跑过。
  · **修准后未重跑的 13 个文件 = NOT-MEASURED**：`impact-propagation.seam` · `engine-scope-fidelity.seam` ·
    `engine-scope-fidelity-2.seam` · `sim-scope-trial.seam` · `sim-trial-scope-reconcile.seam` ·
    `sim-cert-contract-reconcile.seam` · `sim-certification` · `sim-act-close.seam` · `sim-session` ·
    `sim-session-lifecycle.seam` · `sim-seed-world.seam`（含批次 2 里剩下那些）。
    **判断依据不是「跑过了」**：§⑥b 那次改动**只增判据**（多盖一个仓 ⇒ 只可能更频繁地失效、
    不可能更频繁地命中），故结构上不会引入陈旧值；但这是**推理不是实测**，如实标 NOT-MEASURED。
- **pg 模式 NOT-MEASURED**：`PgStore.revision()` 恒回 `null` ⇒ 按设计**退回不缓存**（诚实降级），
  本机内存模式验不到那条支路。**代价是 pg 部署拿不到这份加速**，不是「也快了」。

### 测到的文件（按批次）

批次 0：`assembly-memo.seam.test.ts`（修准后 12/12）
批次 3（修准后，5 文件 / 68 测试）：见 §⑤
批次 1（8 文件 / 123 测试）：`shadow-memo.seam` · `seed-demo-propagation` · `sim-propagation` ·
`impact-propagation.seam` · `engine-scope-fidelity.seam` · `engine-scope-fidelity-2.seam` ·
`sim-scope-trial.seam` · `sim-trial-scope-reconcile.seam`
批次 2（8 文件 / 72 测试）：`sim-cert-contract-reconcile.seam` · `sim-certification` ·
`sim-act-close.seam` · `sim-session` · `sim-session-lifecycle.seam` · `sim-seed-world.seam` ·
`rule-scope-triad.seam` · `edge-money-weight.seam`

## ⑥ 为什么复用是安全的（不是「先跑跑看」）

- **装配是纯读**：`buildPropagationInputs` 只读仓储、不回写。
- **失效判据落在唯一漏斗上**：`MemStore` 的 `put/putMany/remove/removeWhere` +
  `MemExecutionLockStore.tryAcquire` 是全部 20+ 个写入点的必经处，`bump` 就挂在那儿。
  ⛔ **不能用 `epochs.next()` 替代** —— 它全仓只有 4 个调用点，与那 20+ 个写入点不重叠。
- **判据有一个洞就不缓存**：四个仓（objects / links / ontologyTypes / **rules**）任一回 `null` ⇒ 整体退回不缓存。
  ⚠ `rules` 是 §⑥b 补的第四个 —— 少那一个就是一条静默错答。
- **冻结**：命中时多个请求共用同一实例 ⇒ 产物深冻结，就地改当场抛，而不是静默污染后面的请求。
- **规则那一半**：`rulesFingerprint` 由装配备忘录与影子线备忘录**共用一份**实现（各写一份 = 两套真相源）。
  它的 `weightRef` 那一格是**被 §4b 金丝雀当场咬出来的**（`null` 与 `{basis:"bom_cost_share"}` 曾算出同一指纹）。

## ⑥b ⛔ 本单自己引入过一条**静默错答**，已修（留证，别删）

**症状**：装配备忘录的键只盖了三样（objects / links / ontologyTypes 的修订号 + `rulesFingerprint(rules 实参)`），
而装配体内**还读了第四个仓** `repos.rules`（拿来建 `ruleParams` —— `coefficientRef` 的解析表）。
`rulesFingerprint` 那一半**明确不含 `params`**（见该文件头注）⇒ **只改系数值时指纹不变 ⇒ 命中 ⇒
引擎拿到上一跑那张表**。而 `effectiveCoefficient` 吃的正是它（`propagation.ts`）
⇒ **推出来的数是错的，屏上一切正常**。

**金丝雀实测（先红）**：`C36.params["demo_base_load_to_line_util"]` 由 `0.185` 改成 `0.555`，
装配产物交给引擎的仍是 **`0.185`**。

**形态（照铁律 0.6 句式）**：
> **「我用『键上盖了三样』当作『装配读到的东西都盖全了』的证据，而前者并不度量后者
> —— 它体内还读了第四样。」**

**修**：`Promise.all` 里补 `repos.rules.revision(c.tenantId)`（第四个仓）。
规则的**全部 7 处写入**（`rules.ts` 6 处 + `databuilder/service.ts` 1 处）都走 `repos.rules.put`，
即同一个写入漏斗 —— 修复覆盖真实编辑路径。

**真服务复验（同一进程·相邻两拍）**：

| 事件 | graph |
|---|---|
| 世界未改 | 5 / 0 |
| **`POST /a/v1/rules` 写一条规则** | **4737** |
| 世界又没改 | 0 / 0 |

⇒ 规则写真的进判据了（修之前这一拍必然是 0，那就是那个静默错数），而复用本身没被这次修准吃掉。

**机制（机器先说话，别删）**：接缝门 §6 两条 ——
① **数值条**：只改 `C36.params` ⇒ 装配产物的 `ruleParams` 必须是新值（命中就红）；
② **逐仓扫描**：剥注释后列出装配路径（本函数体 + `pair-weights.ts`）读过的**每一个**仓，
断言它们**全部**出现在键的 `revision` 列表里，**不开任何例外**。
⚠ 上一版给 `rules` 开过一个口子（理由写的是「它走指纹那一半」）—— **那个口子正好放过本次的真缺陷**。
指纹盖的是**实参**，而 `repos.rules` 是**体内另读的存储**，两者不是替代品。

## ⑦ 顺带修掉的两个真缺陷

1. **`weightRef` 漏哈希**（上条）：只改分摊口径时指纹不变 ⇒ 引擎吃旧口径权重，屏上看不出来。
   同一处修复也进了影子线备忘录。
2. **三处字面 NUL 字节**（`rules-fingerprint.ts` / `propagation-inputs.ts` / `explain-slice.ts`）：
   源码里的原始 0x00 会让 git 把该文件判成 binary（`git diff` 只剩「Binary files differ」）⇒
   **这个文件的每一次改动都没人能看见**。第三处在**已提交的 blob 里**，属存量。
