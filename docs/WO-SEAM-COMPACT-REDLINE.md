# WO-SEAM-COMPACT-REDLINE · 压缩不得吃掉红线（效果层断言 + 垃圾摘要防线 + 丢失声明）

> **本单与 pi 无关。** 它治的是我们自己已存在的缺口，pi 只是提供了一个把后果演示得很干净的反例。
> 任何**引入 pi 代码/依赖/机制**的改造都需仓主单独决策，**不在本单范围内，dev 不得自行引入**。

## 🚦 范围边界（= 本单 dev 的身份，只碰这些）

```
apps/agentcore/src/agent/context.ts     摘要器出口校验 + 兜底标记
apps/agentcore/src/agent/loop.ts        摘要注入措辞 / 降级声明
apps/agentcore/test/                    新增 SEAM 测试（可扩既有 context-compression-seam.test.ts）
```

**不碰**：`apps/datacore`、`apps/frontend-shell`、`packages/contracts`。
若判断确需动契约（例如给摘要加 `degraded` 标记字段），**先报审核方，不要自行改** —— 跨包改动要么整单做要么不做，半截接不上正是本仓反复炸的根。

## 背景（已核实的现状，不要重新调研）

压缩链**已经接通且有测试**，不要重做：

- `router/orchestrator.ts:1669` 注入 `makeLlmRollingSummarizer(...)` → `runAgentLoop.summarizer`
- `agent/loop.ts:333` `const summarize = opts.summarizer ?? defaultRollingSummary`
- `agent/loop.ts:340/343` 每轮压成摘要，注入 system：
  `【前情摘要（已折叠轮次蒸馏，仅供回忆；业务事实仍以工具结果为准）】`
- `test/context-compression-seam.test.ts` 已有 5 条断言：compose 被调 · provider 不可用退兜底（字节一致）· compose 抛错 fail-open · 返空退兜底 · 端到端折叠触发后摘要真进 system

**这五条全部是「运输层断言」**（参数/调用到达了），**没有一条是「效果层断言」**（结果因此不同）。本单只补效果层与两处防线。

## 三条缺口（已逐条核实，附证据）

### G1 · 效果层断言缺失
现有断言证明「摘要这个字符串出现了」，不证明「压缩之后 agent 还守着压缩前确立的业务约束」。
压缩是一次**不可逆有损变换**；变换后行为是否守恒，当前无人咬。

### G2 · 非空垃圾摘要零防线 🔴
`context.ts:243` 出口校验只有一句：

```ts
const s = (out ?? "").trim();
return s.length > 0 ? s : defaultRollingSummary(notes);
```

只挡空串。**一段非空但语义无关的文本会被原样当作合法摘要注入 system**。
外部实证（评估 pi 时录到的真实失败态）：摘要提示词严格要求结构化模板，模型回了 8 个不相干的字，
宿主原样注入 `<summary>…</summary>` 并**永久丢弃原文**。我们的出口校验挡不住同一形态。

### G3 · 丢失不声明
回落 `defaultRollingSummary` 时不留任何标记。下游（以及排障的人）无法区分
「这段是真蒸馏」还是「这段是摘要器挂了之后的兜底拼接」——**可信度不同，呈现却一样**。

## 交付要求

### 1) 出口防线（G2）
`makeLlmRollingSummarizer` 的返回值校验从「非空」升级为「像不像一份摘要」。判据由 dev 定，但必须满足：

- 判据**不得是纯长度阈值**（长垃圾照样过）；建议做**内容锚定**：摘要须至少命中输入 notes 中的关键实体/数字之一，否则视为失效 → 退兜底。
- **失效必须可观测**：退兜底时置标记（见 G3），不许静默。
- 校验本身**不得抛错阻断循环**（fail-open 铁律不变）。

### 2) 降级声明（G3）
兜底产出的摘要，注入 system 时措辞必须与真蒸馏**可区分**，且明说这轮摘要不可依赖。
现有措辞「仅供回忆；业务事实仍以工具结果为准」保留不动 —— 那是**常态**声明；本单加的是**异常态**声明。

### 3) SEAM 测试（头号判据 · 效果层）

| 编号 | 断言 | 说明 |
|---|---|---|
| **SEAM-A 红线穿越压缩** | 会话前段确立「外协红线 20%」→ 折叠触发压缩 → 压缩后就同一业务问题提问 → **答案仍受 20% 约束** | 效果层。断言的是**行为守恒**，不是"摘要串还在" |
| **SEAM-B 垃圾摘要被挡** | mock `compose` 返回非空但与 notes 完全无关的文本 → 必须**退兜底 + 置降级标记**，不得注入 | 直咬 G2 |
| **SEAM-C 降级可见** | 摘要器失效路径下，注入 system 的措辞与正常路径**可区分**；且下游能读到降级标记 | 直咬 G3 |
| **SEAM-D 常态不回退** | provider 正常 + 摘要合格时，行为与今天**逐字节一致** | 防止本单把好路径也降级了 |

### 4) 变异反证（必做，缺一退单）
先证 `npx tsc --noEmit` RC=0（红是牙不是编译失败），然后**逐条**：

- 删掉 G2 的新校验 → **SEAM-B 必须红**
- 删掉 G3 的降级标记 → **SEAM-C 必须红**
- 把 `loop.ts:343` 的「业务事实仍以工具结果为准」删掉 → **必须有测试红**（若无，说明这句话从来没被咬过，本单顺手补上）

把每条变异的**红色原文**贴进交单说明。

### 5) 门与交付
- `bash scripts/gate.sh` 五包全绿（**禁止** `cmd | tail; echo $?` —— `$?` 取的是 `tail` 的码，本仓真出过事故）
- 一条 handoff 分支 `claude/handoff-wo-seam-compact-redline`，**不碰正线**
- 若新增求解器/对象类型/断点 → 同步金值与 `docs/SYSTEM-ONTOLOGY.md`（本单预计不新增；若你发现需要，先报）

## 已知坑（我实测踩过，替你省时间）

1. **压缩触发判据是「内容 token」，不是 provider 上报用量。** 造测试时要把消息真做大，把 usage 数字调大没用。
2. **摘要一旦生成，原文就没了。** SEAM-A 要断言的是"红线仍在答案里/仍被遵守"，不是"原文还在上下文里"——后者必然失败，且失败得没有意义。
3. **`defaultRollingSummary` 是确定性拼接**，本身没有"丢失了什么"的概念。G3 的标记要加在**调用点**，不是改它的返回值格式（改了会破 SEAM-D 的字节一致）。

## 《本体引用与影响》

- **触及对象类型**：无新增（复用既有 Agent 执行链）
- **触及链路**：`意图 → runAgentLoop → 折叠 → summarizer → effectiveSystem 注入 → 后续轮`
- **触及不变量**：**R13 结论可溯源**（本单主战场：压缩点是溯源链的断点候选）· **R6 确定性**（SEAM-D 守常态字节一致）· fail-open 铁律（不得因校验阻断循环）
- **触及断点**：拟新增候选 **G-COMPACT-DROPS-CONSTRAINT**（压缩静默吞掉已确立约束）。**闭合后须回写 `docs/SYSTEM-ONTOLOGY.md` §8**；若本单只闭一半，如实标 🔴 未闭并写清剩什么。


---

# 交付记录（审核方自办 · 2026-08-02）

> dev 未开工（GitHub 上无 `claude/handoff-wo-seam-compact-redline`），仓主指示「如果 dev 没做，你自己直接完成」。
> **本单作者 = 审核方本人，没有第三方独立复审** —— 这是本单最大的方法论弱点，如实记在这里，
> 不用「我自己验过了」冒充「有人复验过」。补偿手段：三条变异反证逐条真打 + 效果层断言 + 全门。

## 实际改动

| 文件 | 改了什么 |
|---|---|
| `apps/agentcore/src/agent/context.ts` | 新增 `SUMMARY_DEGRADED_MARK` / `isDegradedSummary` / `stripDegradedMark` / `summaryLooksAnchored`；`makeLlmRollingSummarizer` 出口从「非空」升级为「非空 **且** 内容锚定」，三条失效路径（抛错 / 返空 / 锚定不过）统一走 `degraded()` 置标记 |
| `apps/agentcore/src/agent/loop.ts` | `effectiveSystem` 识别降级标记 → 换异常态措辞；标记本身不泄漏进模型上下文 |
| `apps/agentcore/test/context-compression-seam.test.ts` | 既有 5 条按新契约更新（不是放宽：③/③b 从「字节等于兜底」升级为「**剥标记后**字节等于兜底 **且** 必须带标记」）；新增 SEAM-A/B/B2/C/D/D2 + 锚定判据边界，共 13 条 |
| `docs/SYSTEM-ONTOLOGY.md` §8 | 登记 `G-COMPACT-DROPS-CONSTRAINT`（标 ✅ 已闭） |

## 三处与工单原文的偏差（如实记，勿当成已按原样交付）

1. **G2 判据落地为「内容锚定」**，不是工单里留白的「判据由 dev 定」。锚点 = 笔记里的数字（含小数/百分比）与 ≥4 位标识符样 token。
   理由：摘要指令本就要求「保留已验证事实 + 工具名 + 关键数字」，一份真摘要几乎不可能一个锚点都不含；而 8 个字的垃圾必然不含。
   **已知弱点**：这是启发式，不是证明。一份「用完全不同措辞正确复述、但恰好不含任何原词」的摘要会被误判为失效 → 退兜底（**fail-safe 方向**：宁可退确定性拼接，不让不可信文本冒充摘要）。
2. **SEAM-A 不断言「答案里还有 20%」**。本套件的 LLM 是脚本化的，答案是我自己排的队——那样断言等于测我的脚本，又掉回运输层。
   改断言**上下文信息完整性**：折叠后要么约束仍在、要么系统明说可能已丢，「既不在也不说」即红。
3. **工单猜错一处**：我写「删掉 `loop.ts:343` 那句若不红，说明它从来没被咬过」。实际**本来就被咬着**
   （`runtime-context.test.ts` 一条字符串匹配），M3 变异打出 2 红。SEAM-A 的价值在于从**效果层**再咬一遍，不是「补上没人咬的洞」。

## 变异反证（三条真打 · 均先证 `tsc --noEmit` RC=0）

```
M1 删 G2 锚定校验        → 2 红   AssertionError: 垃圾摘要不得进入上下文: expected true to be false
                                  AssertionError: 长垃圾同样必须被判失效: expected false to be true
M2 删 G3 降级标记        → 5 红   AssertionError: 摘要器失效必须置降级标记，否则下游分不清真蒸馏与兜底
M3 删 loop.ts 常态措辞   → 2 红   AssertionError: 折叠后既没保住约束、也没有任何「别据摘要推断」的声明 —— 这是静默错答入口
                                  AssertionError: 后续 system 注入了折叠轮的前情摘要
```

## 《本体引用与影响》

- **对象类型**：无新增。
- **链路**：`runAgentLoop 折叠 → opts.summarizer → 出口锚定校验 → effectiveSystem 注入（常态/降级两种措辞） → 后续轮 system`。
- **不变量**：**R13 结论可溯源**（主战场——压缩点是溯源链的断点候选，本单把「静默丢失」变成「显式声明丢失」）；
  **R6 确定性**（SEAM-D/D2 守常态与 provider 不可用路径逐字节不变）；**fail-open 铁律**（校验与降级绝不阻断循环，SEAM-C 用 `outcome=ANSWERED` 守）。
- **门禁**：未新增静态门。判据活在 SEAM 测试里，且三条变异反证证明它有牙。
- **断点**：新增并闭合 `G-COMPACT-DROPS-CONSTRAINT`（§8 已回写）。

## 仍未做的（不许当成已闭）

- **压缩点未落为可回放的会话条目**。评估 pi 时看到它把压缩存成 `CompactionEntry`（可审计「这条结论是压缩前还是压缩后得出的」）。
  我们没有。本单只保证「丢了会说」，**没保证「事后查得出哪一轮丢的」**。这属 R13 的下一层，需单独立单。
- **结构化 checkpoint 模板**（目标/红线/已采纳方案/待审批 Action/证据引用）未做——摘要指令仍是自由文本。
