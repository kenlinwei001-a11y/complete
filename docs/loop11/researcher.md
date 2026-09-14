# LOOP11 · 研究者 · 阶段① 第 1 轮发言

| 项 | 值 |
|---|---|
| base commit | `66a0bb3f`（父 = PIN `ec1e707c`，空提交起点） |
| 取证时刻 | 2026-09-07T03:44:47Z |
| 树龄探针 | `wc -l apps/datacore/src/synthetic/battery.ts` = **6618** |

---

## 发言（≈215 字）

**论点**：照 NATO 兵棋七要素（目标·想定·数据·裁决模型·规则与回合·参与方·分析）[1] 对表 —— 本系统齐前四项，**缺后三项**，而这三项正是仓主要的「长期防复发」那一半。

**论据**
① **对抗方 0 实现**：`redteam|adversar|opponent|竞争对手反应|counterMove` 全仓 0 文件（金丝雀：`lever|perturbation` 命中 74 文件）。NATO 原文：「wargames with a poorly represented adversary usually produce little of value」[1]。客户砍单、对手降价今天只能当外生扰动手输，不会反制。
② **无回合推进**：`SolverContext` 无时序访问（源注自陈），传导只有「事件→越线→订单→财务」四段展示，不是「我动—世界动—我再动」⇒ 只答得了应急。
③ **无复盘**：仅 `capacity_forecast` 一个求解器的参数标定（预测 vs 实测→提案→审批）；`ReviewView` 的「到货危机复盘」是 `livedin/engine.ts` 回放的种子串，非推演产出。AAR 第四问「下次怎么改」占 50% 时长[2]，本系统零记录。
④ **「脆弱点」被偷换成「断点」**：`CHAIN_IMPEDIMENT_KINDS = BOTTLENECK/CONGESTION/BREAK`，三类全是快照上**已经坏了**。业界标准是 REI + TTR/TTS 全节点穷举排序（福特实证：最大风险来自 10 美分的小供应商，正是你想不到去注入的那个点）[3] 与 FMEA RPN（严重度×发生度×可探测度）[4]；本仓 `timeToRecover|timeToSurvive|FMEA|RPN|detectability` **0 命中**，`MaterialAlternative`/二供数据在库但无引擎消费。⇒ 今天只能问「X 坏了会怎样」，问不了「我该担心哪个 X」。

**真缺口排序**（高敞口 ❌）：全节点 TTS/敞口排序 > 对抗方反制 > 推演—实际—流程规则改动的复盘台账。

---

## 外部一手来源（不计入 200 字）

1. **NATO STO** · *Introduction to Wargaming*, STO-EN-SAS-195, §6（七要素逐条定义：Objective / Scenario / Data / Methods, Models & Tools（裁决） / Rules and procedures（"there will be two turns per hour"） / Players / Analysis；"wargames with a poorly represented adversary usually produce little of value"；Perla: "Without human players, there may be a model, but there is no game."）
   https://publications.sto.nato.int/publications/STO%20Educational%20Notes/STO-EN-SAS-195/EN-SAS-195-06.pdf
2. **NWCG（美国联邦跨部门野火协调组）** · *After Action Reviews*（AAR 四问：What was planned / What actually happened / Why did it happen / What are we going to do next time —— 第四问约占 50% 讨论时间）
   https://www.nwcg.gov/wfldp/toolbox/aars
   · 美陆军原始条令 **TC 7-0.1 After Action Reviews**：https://rdl.train.army.mil/catalog-ws/view/100.ATSC/A6C09408-2436-47A4-93A3-6684A1B59042-1739993594606/TC7_0x1.pdf
   · **FM 7-0 Appendix K（After Action Reviews）**：https://www.first.army.mil/Portals/102/FM%207-0%20Appendix%20K.pdf
3. **MIT News** · *Companies use MIT research to identify and respond to supply chain risks*（Simchi-Levi 的 Risk Exposure Index + Time-to-Recover / Time-to-Survive；与福特 2013 起合作，落地施耐德电气；"tiny suppliers that provide Ford with components that cost about 10 cents"）
   https://news.mit.edu/2022/companies-use-mit-research-identify-respond-supply-chain-risks-0615
   · 同行评议原文 **Operations Research (INFORMS)**, *Disruption Risk Mitigation in Supply Chains—The Risk Exposure Index Revisited*：https://pubsonline.informs.org/doi/10.1287/opre.2018.1776
4. **FMEA / RPN 在供应链风险中的地位** · *Risk assessment in supply chains: a state-of-the-art review of methodologies and their applications*（RPN = 发生度 × 影响 × 可探测度，排序决定先治哪条风险）
   https://pmc.ncbi.nlm.nih.gov/articles/PMC9063627/
5. **Compton, J.** · *The Four Critical Elements of Analytic Wargame Design*（players / scenario / rule set / adjudication method —— 与 [1] 的七要素互为印证的更精简一版）
   https://www.researchgate.net/publication/330117550_The_Four_Critical_Elements_of_Analytic_Wargame_Design
6. **S&OP 与供应链风险管理的整合现状** · *Integrating supply chain risk management activities into sales and operations planning*, Review of Managerial Science（SCRM 并入 S&OP 被视为"下一代 S&OP"方向 —— 即本系统缺的那一半今天在业界也仍是前沿而非标配，可作为排序时的降权依据）
   https://link.springer.com/article/10.1007/s11846-024-00756-y

---

## 取证方法（金丝雀先行，供复核）

| 判据 | 命令 | 结果 |
|---|---|---|
| **金丝雀**（证明扫法可用） | `grep -rniE "lever|perturbation|扰动" apps/*/src packages/contracts/src --include=*.ts -l` | **74 文件命中** |
| **金丝雀**（证明"要素齐"这一档我能认出来） | `apps/frontend-shell/src/views/sim/GlobalSimScenarioBar.tsx` | 命名方案**存/分支/七维 KPI 横比矩阵**→采纳走 `plan_change` ActionDraft ⇒ 想定(Scenario)要素**在** |
| 对抗方 | `redteam\|adversar\|opponent\|竞争对手反应\|counterMove` over `apps/**/src` | **0 文件**（唯一 `adversary` 命中是 `contracts/src/solvers.ts:287` 注释里的测试文件名 `zz-adversary-adopt.test.ts`，非对抗方概念） |
| 回合 / 时序 | `apps/datacore/src/solvers/chain-impediment.ts:19–20` | 源注："`SolverContext` **无时序访问**（仅对象快照）—— 实测确认：`SolverContext` 十类里没有任何序列" |
| 传导轴形态 | `apps/frontend-shell/src/views/sim/PropagationTimeline.tsx` | 四段 stepper `event→cross→orders→finance`，非回合循环 |
| 三类阻滞点 | `packages/contracts/src/chain-sim.ts:720–731` | `BOTTLENECK`(卡点) / `CONGESTION`(堵点) / `BREAK`(断点，亚型 MATERIAL/LEADTIME/DATA) —— **无脆弱/未断态** |
| 脆弱性方法 | `timeToRecover\|timeToSurvive\|FMEA\|RPN\|detectability\|单点故障\|singleSource` over `**/src/**` | **0 命中**（`冗余` 的 10 处命中全是"冗余字段"，与供应冗余无关） |
| 二供数据在不在 | `apps/datacore/src/synthetic/materials-seed.ts:44` / `seed.ts:1703` | 在：「境内二供 SUP-008/009 保留（备份路径不变）」、P31「替代料评估与切换」carrier `MaterialAlternative` ⇒ **有数据、无消费引擎** |
| 复盘回路 | `apps/datacore/src/calibration/service.ts:33` | `const SOLVER_KEY = "capacity_forecast"` —— 标定只覆盖这一个求解器的参数；`autoApply` 默认 false，走 `ActionDraft` 审批 |
| 复盘展示的来源 | `apps/datacore/src/livedin/engine.ts:696–737` | 「到货危机复盘…覆盖天数 3→5」为**种子串回放**，非本系统推演产出 |
