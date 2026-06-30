# 审核复验 · WO-FORECAST-SIM（推演接需求-产能真源）· 暂不核发（功能✅·门红阻断）

> 提交物 `1dbea2a`。审核方真跑：功能逻辑**四证确认正确**，但**破了 `genuine-sim` 门（`pnpm gates` 红）**——CI 会失败，**不可合并**，故暂不核发。这正是"绿 solvers.test ≠ 全门绿"——dev 只跑了 solvers.test V5d、没跑 `pnpm gates`。

## 结论

| | 状态 | 说明 |
|---|---|---|
| **功能逻辑** | ✅ 验证正确 | 紧张度真由需求-产能派生·非哈希·可溯（四证，见下） |
| **门禁** | ❌ **genuine-sim 红（阻断）** | CI `pnpm gates` 会失败·不可合并 |
| **核发** | ⏸ **暂不核发** | 待门修绿后复验核发 |

## 功能逻辑 · 四证确认正确（这部分做对了）

1. **读源**：`risk.ts demandCapacityTightness` = `computeRollup` 真产能 ÷ DemandSegment(p50/p90/tgt)+SopVersionRow(demand/supply) 真需求 → 量纲无关负载比 → 张力；`live=true` 仅当有真预测·否则回落 mockTightness(live:false 诚实)。确定性 R6。
2. **V5d 测试绿**：「改 DemandSegment p50 → 曲线上抬（非哈希恒定）+ R6 字节一致」。
3. **对抗撤回**：把 `demandCapacityTightness` 真路径 neuter（强制回 hash）→ V5d + V5 即红「expected 'MOCK' to be 'LIVE'」→ 还原 14 绿（测试真守真行为）。
4. **真起 datacore 真 invoke**：`risk_timeline(常州·物料齐套)` → 物料齐套卡带 `demandGap={gapWan:0.0897, source:"DemandSegment(p50/p90)+SopVersionRow.demand−产能"}`，设备OEE 卡无（正确·非需求驱动）；dataMode=PARTIAL（诚实混合）。前端 A★ `AffectedOrdersModal` 读 `card.demandGap` → 绿色"真需求-产能缺口"溯源面板（gated `!isMock && demandGap`·禁裸 none）。

## 🔴 阻断：genuine-sim 门红（CI 会失败）

- **现象**：`node scripts/check-genuine-sim.mjs` → ✗「RiskBoardView MOCK 卡把 mock 基线标成"实测"」。**FORECAST-SIM 前绿、后红**（本会话多次跑过绿）；其余门（no-silent-mock/css-vars）仍绿——**孤立于 genuine-sim**。
- **根因**：门 ④ 的正则 `/dataMode === "MOCK"[\s\S]{0,400}?\}\)/` 现匹配到 FORECAST-SIM 新增的 **`RiskBoardView.tsx:470 const isMock = card.dataMode === "MOCK";`**（其 400 字窗口终止于新代码 `{ gapWan: number; source: string })` 的 `})`）。该窗口既无"无实测"也无"实测当前" → 命中 `!/无实测/` 分支报红。**门是按窗口找 JSX MOCK 徽章块、却被新 `const isMock` 行抢匹配**（门偏脆 + FORECAST-SIM 触发）。
- **本质**：门 ④ 本意校验"MOCK 徽章块须标'无实测'、不得叫'实测当前'"（line 79-86 的 JSX 块**本身是对的**·写了"估算·无实测"），但正则错抓了 line 470 的赋值行。

## 修法（小改·二选一·dev 任一即可绿）

- **A（改代码·最省）**：`RiskBoardView.tsx:470` 别用字面 `card.dataMode === "MOCK"`——改 `const isMock = card.dataMode !== "LIVE";`（或 `!isLiveMode(card.dataMode)`），避开门正则的字面锚点。语义不变。
- **B（改门·更稳）**：`check-genuine-sim.mjs` ④ 正则锚到 JSX MOCK 徽章块（如要求 `card.dataMode === "MOCK" &&`，带 `&&`），不匹配裸赋值——根治门脆性，防后续再被无关 `=== "MOCK"` 误伤。
- **建议 A+B 都做**：A 立即解锁本单、B 防复发（门脆性本身是债）。

## 诚实边界

- 我**未**改任一侧（设计+审核·不改 dev 代码）——上述修法是给 dev 的施工指引。
- 本单**功能是对的**（态势真源派生真实现），只差门绿——dev 修门后我**即刻复验核发**（重跑 genuine-sim + 全 datacore 回归）。
- 教训登记：**FORECAST-SIM commit 只称"门 solvers.test V5d"、未称 pnpm gates 全绿**——印证"只跑子测试、没跑全门"的老坑（同 GATE-B 立门初衷）。

## 本体引用与影响

- 链路：数据→推演链（DemandSegment/SopVersion → risk_timeline·dev 已回写 §3）——**逻辑接线正确**。
- 不变量：R6（确定性·V5d 字节一致证）不破；R13（诚实位·demandGap 溯源 + live 标）成立。
- 门禁 §7：`genuine-sim` 当前红——本单**未闭**直至门绿（守"门红不核发"）。

---
*审核方独立复验（design+review·真跑+对抗+门禁为据·暂不核发待门修）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
