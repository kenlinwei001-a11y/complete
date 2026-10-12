# WO-C0828-P1-R5 四包电池结果回填报告

日期：2026-09-27 · 审核方四包收口 · 对应 dev R3′ 报告中「四包在跑，结果待回填」

## 每包 HEAD 标签

| 包 | HEAD | 结论 |
|---|---|---|
| contracts | build RC=0 | 无测试电池（构建包） |
| llm-adapters | build RC=0 | 无测试电池（构建包） |
| datacore | `f6484af67` | 零断言红、零 R5 回归 |
| agentcore | `f6484af67` | 零真红 |
| frontend-shell | `6e47c0efb` | 零 P1-R5 新增真红 |

五包 build RC=0（09-25 13:03）。datacore/agentcore 证据头 `f6484af67` = 收编合并树（与 dev 实测 tip 逐字节同）；frontend 证据头 `6e47c0efb` = 用户后续收编（05051d605 等）+ battery.sh 两提交。

## datacore（363 文件，全包 30642s，RC=1）

34 红 / 16 文件，全部为超时族（测试级 120/180/300s、hook 级 180/300s、2× vitest-worker RPC 超时 = 负载指纹）。

- **允许存量红 2 文件**（上代已豁免）：solver-context-lazy-loading（SEAM-PERF 冷启 113.15ms > 80ms）、empty-tenant-bootstrap（幂等重入 1500s 超时）。
- 其余 14 文件缩减集 A/B：**12 文件转绿 = 28 红全为负载放大撤销**；剩 2 文件 4 红真 lone 串行跑 **RC=0 全绿**。
- 证据：`datacore-test-full.txt+.rc`（RC=1）、`datacore-reds-ab.txt+.rc`（RC=1）、`datacore-reds-solo.txt+.rc`（RC=0）。

**定性：34 红全处置（30 环境红 + 2 允许存量 + 2 solo 绿），零断言红，零 R5 回归。**

## agentcore（209 文件，RC=1）

- 已知红 dsh-degraded-seams A3：canonical 树 solo 6/6 绿（上代环境红撤销，canonical 自证）。
- 全包 206 绿 + 3 红（runtime-workflow R10 并行 279>250ms、solver-cancel-seam ②③ 计数）= 全时序敏感族。
- solo A/B（`agentcore-ab/battery-solo.txt+.rc` SOLO_RC=0）9/9 + 3/3 全绿 = 负载红撤销。

**定性：零真红。**

## frontend-shell（全包 12 红 / 8 文件，RC=1）

| 文件 | 全包红 | solo A/B | baseline 对照（4a8e02fc6） | 归因 |
|---|---|---|---|---|
| sandbox-three-zone | 4 | — | 29→6 存量集 | 存量 |
| sim-rail-forms | 1 | — | 29→6 存量集 | 存量 |
| sandbox-config-ux | 1 | — | 29→6 存量集 | 存量 |
| references-family | 2（①-A 卡满 30min 超时） | **12/12 绿** | — | 负载放大 |
| disruption-cards | 1 | 红存活 | **1/7 全同（同测试名同失败）** | 存量 |
| stale-claims | 1 | 红存活 | **1/17 全同（门本体通过，同失败）** | 存量 |
| sandbox-config-collapse | 1 | 红存活 | **10/10 红**（tip 只 1 红；tip 失败测试名逐字在 baseline 失败表） | 存量尾 |
| sandbox-kpi-layer | 1 | 红存活 | **2/2 红**（tip 只 1 红） | 存量尾 |

- 存量 6 红集 baseline 实测（`frontend-reds/baseline.txt+.rc` CAPTURED_RC=1）：4a8e02fc6 同 3 文件 29 红 → tip 6 红，用户的 sandbox-world-guard 收编已修 23。
- baseline 对照跑在 `/tmp/wt-base-front` @4a8e02fc6（node_modules/contracts dist/frontend-shell node_modules symlink canonical，健康）。
- 证据：`frontend-pack/battery-full.txt+.rc`（PACK_RC=1）、`frontend-ab/battery-solo.txt+.rc`（SOLO_RC=1：1 文件 12/12 绿 + 4 文件红存活）、`frontend-ab-baseline/battery-solo.txt+.rc`（SOLO_RC=1：4 文件 baseline 全红对照）。

**定性：12 红全处置（6 存量 + 2 负载 + 4 baseline 全同/存量尾），零 P1-R5 新增真红。**

## 成本结构披露（交仓主裁决，PRD §8.2 要求不改）

datacore 全包 8.5h（30642s）测出的 34 红中 30 个是负载放大（1h 缩减集 + 10min solo 全撤）；全包先行 + A/B 殿后的真实成本约 9.5h 在盘点共享机环境、0.5h 在验代码。四包全包的边际价值 = 环境盘点 + 覆盖回归线外的静默失败面；回归检测主要由 dev 回归线（5 文件 56 绿）与接缝文件承担。方法已按用户令固化为机器（`scripts/battery.sh`：已知红先 solo、A/B 直跳、不等窗口、RC 中间变量捕获、跨拍探针），本报告为该方法首轮产出。

## 证据清单（全部 txt+.rc 配对）

datacore-test-full / datacore-reds-ab / datacore-reds-solo / agentcore-test-full / agentcore-ab（battery-solo+battery.rc）/ frontend-reds（battery-solo+baseline）/ frontend-pack（battery-full）/ frontend-ab（battery-solo）/ frontend-ab-baseline（battery-solo）。
