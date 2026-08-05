# WO-SLOT-HARVEST-DETERMINISTIC-FLOOR · 槽位从问句到 fillSlots 的完整通路（整单一人做）

> 由来：#105 修完（`4a5fc124` 已让中文名可解析）之后，真 Kimi k2.5 端到端 10 题验收 **3/10**。
> 病灶换了形态：不再是「槽抽到了填不进去」，而是 **`extractedSlots={}` —— 槽位在解析层被丢掉**。
> 本单**不是** #105 的续，是新的两条根因，且必须**一个 dev 整单做**（拆两半 = CLAUDE.md 明令的 metric-aware 反复炸的根）。

## 🚦 范围边界（= 本单 dev 的身份）

只允许碰：

```
packages/llm-adapters/src/openai.ts          根因 A 主场
packages/llm-adapters/src/anthropic.ts       仅当需要共用 harvest（单源）
packages/llm-adapters/src/degrade.ts         同上
packages/llm-adapters/src/openai.test.ts     解析半 SEAM 测
apps/agentcore/src/router/l2-decompose.ts    根因 B：确定性抽取器（现只服务 L2）
apps/agentcore/src/router/orchestrator.ts    根因 B：接线点
apps/agentcore/src/router/slots.ts           仅当 fillSlots 需配合（能不动就不动）
apps/agentcore/test/**                       接线半 SEAM 测
docs/SYSTEM-ONTOLOGY.md                      §8 断点登记（必回写）
```

**不许碰**：datacore 任何文件、frontend 任何文件、`packages/contracts`（本单不改契约）、任何 golden 计数文件（本单不新增 solver/对象类型）。

---

## 1 · 根因 A（解析层）· 已用真实报文坐实

### 现象
同一道题 `常州物料齐套 D+5 为什么越线？` 连跑 5 次（真 Kimi k2.5），**5 次全部抽对了槽**，但只有 2 次进得了系统：

| 跑次 | 终态 | Kimi 把槽写在哪 |
|---|---|---|
| #1 | ✅ COMPLETED | 顶层 `extractedSlotsJson`（JSON 字符串） |
| #2 | ❌ 反问 | **`candidates[0].extractedSlots`**（且多一个 `reason` 字段） |
| #3 | ❌ 反问 | `candidates[0].extractedSlots` |
| #4 | ❌ 反问 | `candidates[0].extractedSlots` |
| #5 | ✅ COMPLETED | 顶层 `extractedSlotsJson` |

### 病灶（两处，缺一不可）

**A-1 · schema 自己销毁证据** —— `packages/llm-adapters/src/openai.ts:113`

```ts
const OpenAiClassificationSchema = z.object({
  candidates: z.array(z.object({ intentKey: z.string(), confidence: z.number() })).max(3),
  //                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //  zod 默认剔除未知键 → Kimi 放进 candidate 的 extractedSlots 在这一行被删掉
  outOfCatalog: z.boolean(),
  extractedSlotsJson: z.string().optional(),
  extractedSlots: z.record(z.string(), z.unknown()).optional(),
});
```

**A-2 · 断言性兜底，却从不检查它所断言的条件** —— `openai.ts:209`

```ts
let extractedSlots: Record<string, unknown> = parsed.data.extractedSlots ?? {};
```

这个 `?? {}` 说的是「没有槽位」。但它从没验证过真的没有 —— 它只知道**自己看的那一个位置**是空的。
（与 `execute-plan.ts` 裸 catch 报「未接入 LLM provider」、E1 `STRUCTURAL_GAPS` 无条件断言「全仓没有 Cadence」同族。）

### 为什么不能用 `strict: true` 收口
`openai.ts:192` 的注释是实测结论：**Moonshot/Kimi 在 `strict:true` 下返空 / 不可解析**。
所以方向是**让读的一方容忍**，不是让模型更听话。请求侧 JSON schema 允许原样保留。

### 要求的根治形态（不是"多读一个字段"）

在 `packages/llm-adapters/src` 建**单源** slot 收割器，供 openai / anthropic / degrade 三条路共用：

```ts
export function harvestClassificationSlots(raw: unknown): {
  slots: Record<string, unknown>;
  /** 每个槽来自哪个位置（审计/可观测，别让下次再变形时又无声） */
  sources: Record<string, "topJson" | "topObject" | "candidateObject" | "candidateJson">;
  /** 出现了 slot 形状的数据但本收割器没消费 —— 必须能被看见，不许静默 */
  unconsumed: string[];
}
```

硬要求：

1. **必须跑在 `raw` 上，不是 `parsed.data` 上** —— 窄 schema 会先把证据删掉。这是本条的命门。
2. 收全合法形态：顶层 `extractedSlotsJson`(string) / 顶层 `extractedSlots`(object) / `candidates[i].extractedSlots`(object) / `candidates[i].extractedSlotsJson`(string)。
3. **合并顺序确定性且写进注释**：顶层 > candidate；candidate 之间按 **confidence 降序，同分按数组下标**（不许出现"看运气"的合并）。
4. **`unconsumed` 是本单的诚实闸**：raw 里出现了键名匹配 `/slot/i` 的对象/字符串而收割器没吃掉 → 必须进 `unconsumed`。调用方至少要能把它打进日志。**不许再出现"我没找到 = 它没有"。**
5. 旧的 `?? {}` 全部删除；空结果只允许在**收割器确实一处都没找到**时产生。

---

## 2 · 根因 B（架构层）· 铁律 0.5 第三形态：接了线接错地方

### 事实
确定性槽位抽取器 **已经存在**：`apps/agentcore/src/router/l2-decompose.ts:102 buildSlotBag(query, pageContext)`
它能直接从问句抽出 `base`（遍历 `BASE_REGISTRY` 匹配中文名或 baseId）/ `modelId` / `demandDelta` / `weeks`。

它的**唯一** src 调用方是 `orchestrator.ts:1092`，在 `tryL2Decompose` 里。
主链路 `classify → fillSlots` **从头到尾没有任何东西在看问句文本**。

于是：一次 LLM 格式抖动，就能决定用户拿不拿得到答案 —— 因为**没有第二个东西在看那句话**。
而那句话里明明白白写着「常州」。`risk_root_cause` 的必填槽只有 `base` 一个。

### 要求的根治形态

在主链路补一层**确定性槽位底座**（LLM 之下，不是之上）：

```
effectiveSlots = { ...deterministicFloor(query, pageContext, intent), ...llmExtractedSlots }
                    ^ 填空白                                            ^ 冲突时 LLM 赢（它有语义）
```

硬要求：

1. **底座由意图声明的槽位驱动**，不是固定 4 键的袋子。逐 `intent.slots[]` 尝试确定性抽取：
   - `objectRef` 且槽名含 base → `BASE_REGISTRY` 中文名/baseId 命中
   - `date` → `D+N` / `下周` / `本周` / `明天` 等**字面**形态（复用 `slots.ts` 已有的 `resolveRelativeDate`，别另造）
   - 型号 / 百分比 / 周数 → 复用 `buildSlotBag` 现成正则，**不许复制一份**（单源；要抽公共函数就抽，别 copy-paste）
2. **只抽问句里真的有的东西**。不许推断、不许默认、不许调 LLM、不许读时钟/随机（R6 纯函数）。
3. **L2 路径必须字节兼容**：`buildSlotBag` 现有行为与返回形状不许变（它有自己的门）。要扩展就新增函数或加可选参数。
4. 接线点：`orchestrator.ts` 里 `classify` 返回之后、`proceedWithIntent`/`fillSlots` 之前。**同时覆盖 `trySelectMultiIntent`（:1092 附近那处 `fillSlots`）与主路 `proceedWithIntent`（:811）两个入口** —— 只接一个 = 又一次「接错地方」。

---

## 3 · SEAM-GATE（本单头号验收判据 · 两半都在同一个 dev 的单里）

### 3.1 解析半 —— 用**真实抓到的 Kimi 报文**，不是我编的
下列 5 条是 2026-08-05 从真 Kimi k2.5 抓的原样响应体，**逐字节照抄进 fixture**，用 stub 的 `OpenAiChatPort` 喂进 `classifyOnce`：

```
run1: {"candidates":[{"intentKey":"risk_root_cause","confidence":0.9}],"outOfCatalog":false,"extractedSlotsJson":"{\"base\": \"常州\", \"day\": \"D+5\"}"}

run2: ```json
{"outOfCatalog":false,"candidates":[{"intentKey":"risk_root_cause","confidence":0.9,"extractedSlots":{"base":"常州","day":"D+5"},"reason":"用户询问特定基地（常州）在指定日期（D+5）风险越线的根因，完全匹配 risk_root_cause 意图的触发场景"}]}
```

run3: ```json
{"outOfCatalog":false,"candidates":[{"intentKey":"risk_root_cause","confidence":0.95,"extractedSlots":{"base":"常州","day":"D+5","factor":"物料齐套"}}]}
```

run4: ```json
{"candidates":[{"intentKey":"risk_root_cause","confidence":0.92,"extractedSlots":{"base":"常州","day":"D+5"}}],"outOfCatalog":false}
```

run5: {"candidates":[{"intentKey":"risk_root_cause","confidence":0.95}],"outOfCatalog":false,"extractedSlotsJson":"{\"base\":\"常州\",\"day\":\"D+5\",\"factor\":\"物料齐套\"}"}
```

断言：**5/5 都得到 `base==="常州" && day==="D+5"`**（run3/run5 另含 `factor`）。
注意 run2 带 ```` ```json ```` 围栏 + 额外 `reason` 字段 —— 两个都得容忍。

**变异反证（必须真跑一遍并把结果贴进交付说明）**：把收割器改回只读顶层 → **run2/3/4 必须转红**。改完不红 = 这条测没有咬到东西，退单。

### 3.2 接线半 —— 断言必须落在**终态**，不是路由
orchestrator 级组合测：LLM mock 返回 **candidate 内嵌形态**（或直接返回 `extractedSlots:{}` 模拟坏骰子），
query = `常州物料齐套 D+5 为什么越线？`，`context.selectedObjects = []`（不给任何上下文兜底）。

断言：task 终态 **`COMPLETED` 且 `clarificationRounds === 0`**。

> 为什么判据是这两条：本仓的措辞门就是因为只断言 `routedIntent`（路由对了就绿）才漏掉了整个病 ——
> 上一轮 10 题里 7 个失败**全部 `routed` 正确**。**断言落在路由 = 假绿。**

**变异反证**：拆掉确定性底座 → 本条必须转 `AWAITING_CLARIFICATION`。

### 3.3 mock 必须有失败模式
本单新增/改动的 LLM mock **必须能返回 candidate 内嵌形态和空槽形态**，不许只有 happy shape。
「mock 只会成功」是这个病此前躲过全部 2639 条测试的原因之一。

---

## 4 · 完成判据（缺一不可）

1. `bash scripts/gate.sh` 显式捕获退出码 = 0（**禁止** `cmd | tail; echo $?`）。四包全绿。
2. §3.1 / §3.2 两条 SEAM 测都在，且**两条变异反证都真跑过、都真转红**，结果贴进交付说明。
3. `unconsumed` 通路真接了消费方（至少落日志），**不是只定义不调用**（假绿第 9 形态：只有 test 引用 = 已排练，不是已实现）。
4. `docs/SYSTEM-ONTOLOGY.md` §8 登记两条断点并标状态：
   - `G-SLOT-HARVEST-BLIND` —— 分类结果只在单一位置找槽，找不到即报"无"（本单修复）
   - `G-SLOT-LLM-SINGLE-POINT` —— 槽位填充对 LLM 单点依赖，问句文本无确定性兜底（本单修复）
5. push 到 `claude/handoff-wo-slot-harvest`，**不碰正线**。

## 5 · 本体引用与影响

- **对象类型**（§2.H 交互/编排域）：`ClassificationResult`（`extractedSlots` 字段语义收紧：空 = 收割器确认无，不再是"我没看见"）、`IntentDefinition.slots`（成为确定性底座的驱动源）、`QueryTask`（终态分布改变：反问↓）
- **链路**（§3）：`用户问句 → classify(LLM) → [新增: harvest] → [新增: deterministicFloor] → fillSlots → proceedWithIntent → path A/B`。本单在这条链上补两个此前不存在的节点。
- **事件**（§4）：不新增 §8.2 事件名（保 `ontology:check` 计数）。`clarification.required` 的**触发频次**会下降，这是预期效果不是回归。
- **不变量**：R6（纯函数·底座不许读时钟/随机/LLM）必须守住；R1（跨包只依赖 contracts）—— 收割器落在 `llm-adapters`，AgentCore 经既有依赖用，不新增跨包源码 import。
- **断点**：关闭 `G-SLOT-HARVEST-BLIND`、`G-SLOT-LLM-SINGLE-POINT`（均本单新登记）。与已修的 `G-SLOT-REF-ID-ONLY`（#105）同属槽位链，但**是不同的病**——那条是"抽到了填不进去"，这条是"抽到了被丢掉"+"丢了也没人兜"。

## 6 · 纪律

- 独立 `git worktree`，**不许**跑 `bash scripts/gate.sh` 全量 datacore vitest（机器 4 核，会把整机拖垮）；跑 `pnpm --filter llm-adapters test` + `pnpm --filter agentcore test` 即可，整包 gate 由审核方做。
- 里程碑就 commit，`wip(slot-harvest):` 前缀，**尽早 push**（容器会重启，未 push 的工作会丢，本会话已发生两次）。
- 交付说明里必须分清三种"不工作"：没接线 / 接了线没数据 / 接了线接错地方。本单根因 B 属**第三种**。
