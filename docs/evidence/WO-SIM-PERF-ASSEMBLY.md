# WO-SIM-PERF-ASSEMBLY · 真服务读数

**这是在治什么（一句话）**：推演每一拍都要把整张本体图**从零重装一遍**（12,499 个对象 + 13,593 条链路，
逐对象 `structuredClone`），而**世界压根没变**。装配备忘录按「世界修订号 × 规则指纹 × 范围」复用上一跑的产物。

**归线**：`claude/inspiring-gates-aqczjg`，tip `25bfe7043`（快进，非强推）。

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
  已测 = 四包 `build` 全绿 + **本单 diff 半径**：datacore **17 文件 / 205 测试 / 0 红**（清单见下），
  其中接缝门 `assembly-memo.seam.test.ts` **10/10**。
- **pg 模式 NOT-MEASURED**：`PgStore.revision()` 恒回 `null` ⇒ 按设计**退回不缓存**（诚实降级），
  本机内存模式验不到那条支路。**代价是 pg 部署拿不到这份加速**，不是「也快了」。

### 测到的 17 个文件

批次 0：`assembly-memo.seam.test.ts`
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
- **判据有一个洞就不缓存**：三个仓（objects / links / ontologyTypes）任一回 `null` ⇒ 整体退回不缓存。
- **冻结**：命中时多个请求共用同一实例 ⇒ 产物深冻结，就地改当场抛，而不是静默污染后面的请求。
- **规则那一半**：`rulesFingerprint` 由装配备忘录与影子线备忘录**共用一份**实现（各写一份 = 两套真相源）。
  它的 `weightRef` 那一格是**被 §4b 金丝雀当场咬出来的**（`null` 与 `{basis:"bom_cost_share"}` 曾算出同一指纹）。

## ⑦ 顺带修掉的两个真缺陷

1. **`weightRef` 漏哈希**（上条）：只改分摊口径时指纹不变 ⇒ 引擎吃旧口径权重，屏上看不出来。
   同一处修复也进了影子线备忘录。
2. **三处字面 NUL 字节**（`rules-fingerprint.ts` / `propagation-inputs.ts` / `explain-slice.ts`）：
   源码里的原始 0x00 会让 git 把该文件判成 binary（`git diff` 只剩「Binary files differ」）⇒
   **这个文件的每一次改动都没人能看见**。第三处在**已提交的 blob 里**，属存量。
