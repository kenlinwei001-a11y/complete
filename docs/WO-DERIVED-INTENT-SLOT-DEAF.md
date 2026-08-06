# WO-DERIVED-INTENT-SLOT-DEAF · 16 个派生意图对用户实体完全失聪（静默错答）

> **代号** `G-DERIVED-INTENT-SLOT-DEAF`
> **登记** 欠账 #112 · 铁律 0.5 第三形态「**接了线接错地方**」
> **发现路径** #105 真 Kimi 10×5 验收（10/10 全绿）**之后**的作用域探针 —— 即：**这道病 10/10 全绿也测不出**

---

## 🚦 范围边界（本单只碰这些）

```
apps/agentcore/src/mocks/seed.ts                  ← 派生意图的 slots/args 装配（病灶）
apps/agentcore/src/scenarios-catalog.ts           ← preset 语义（只改注释/结构，**不改业务默认值**除非本单结论要求）
apps/agentcore/src/router/slots.ts                ← 若需要 merge 语义改动
apps/agentcore/test/<本单新增测试>.test.ts
docs/SYSTEM-ONTOLOGY.md §8                        ← 回写断点（必做）
docs/WO-DERIVED-INTENT-SLOT-DEAF.md               ← 本文件（收口时补实测结论）
```

**不碰**：`apps/datacore/**`（求解器实现）、`apps/frontend-shell/**`、已并线的 4 个原生意图的既有槽位定义。
若结论要求动 datacore 的 arg spec，**先停下来在报告里写清楚要动什么、为什么，交审核方裁**，不要自己扩边界。

---

## 1 · 病是什么（先看证据，再看代码）

**实测（真 Kimi·真服务·非 mock）**：
```
问：「常州下周哪些订单缺料开不了工？」→ shortageCount=8 · 首行 SO-3391 · 8 行
问：「金华下周哪些订单缺料开不了工？」→ 答案**逐字节相同**
```
把基地换掉，答案一个字都不变 —— 因为用户说的「常州」**从来没到达求解器**。

而这一跑的终态是 `COMPLETED` + `clarificationRounds=0`，
在 #105 的验收判据（`COMPLETED && rounds===0`）下**记为通过**。
**判据本身是瞎的**：它能看见「答没答」，看不见「答的是不是这个问题」。
这一条必须写进本单的验收设计里（见 §4）。

## 2 · 真因（已追到定义处，dev 请复核而非重查）

`apps/agentcore/src/mocks/seed.ts:534-569`，从 `SCENARIO_CATALOG` 派生意图的那个循环：

```ts
const solverArgs = (ARG_OVERRIDE[effectiveSolver] ?? card.presetContext.slotPresets) as Record<string, TemplateValue>;
//    ↑ 求解器入参**只**来自这里，与用户槽位无关
const steps = [{ id: "s1", type: "invoke_solver", params: { solverKey: effectiveSolver, args: solverArgs } }, …];
intents.push({ …, slots: [], … });
//                  ↑ 声明**零槽位** ⇒ 用户实体无处可落
```

于是链路是：
```
LLM 抽出 {base:"常州", timeWindow:"下周"}
  → fillSlots(intent.slots = [])        ← 声明无槽，逐个填的循环体一次都不进
  → taskSlots = {}                       ← 整袋丢掉（不是丢一个字段，是全丢）
  → invoke_solver(args = slotPresets)    ← 用写死的 preset 顶上
```

`SCENARIO_CATALOG` 20 张卡，4 张已有原生意图（S01/S02/S03/S06 走 `seededKeys` 跳过），
**其余 16 张全在此形态上**。

### 2.1 · 比「丢作用域」更糟的一档：preset 里写死了具体业务实体

不是所有卡的 preset 都只是中性默认值。以下几张**写死了一个具体对象**，
于是用户问 A、系统答 B，而且答得理直气壮：

| 卡 | intentKey | preset 里写死的实体 | 用户问别的会怎样 |
|---|---|---|---|
| S12 | `yield_diag` | `base: "常州"` | 问「枣庄良率为什么掉了」→ 拿到**常州**的诊断 |
| S11 | `changeover_opt` | `lineId: "常州·动力线-A"` | 问别的产线 → 拿到常州动力线-A |
| S15 | `quote_margin_q` | `custName: "电网公司F"` | 问别的客户毛利 → 拿到电网公司F |
| S16 | `credit_check` | `custName: "商用车集团G"` | 问别的客户信用 → 拿到商用车集团G |
| S20 | `carbon_q` | `modelId: "4680-NCM"`, `baseName: "成都"` | 问别的型号/基地 → 拿到 4680-NCM·成都 |
| S08 | `kit_analysis` | `fromDay:1, toDay:14`（无 base） | 问任何基地 → 全网口径 |

**这不是「功能没做」，是「答错了还不告诉你」** —— 本仓一贯判定：静默错答比跑不通更糟。

## 3 · 要求怎么修（治本，不打补丁）

### 3.1 槽位声明必须**派生**，不许再手抄一份

`slots: []` 的反面**不是**「手写 16 份槽位清单」——那只是把单源问题换个地方犯
（本仓已有前科：D1/E1 各造一套节点词表 = 欠账 #99）。

要求：**从求解器已声明的入参规格派生**意图槽位。
先做取证再动手：
- 找到求解器入参规格的**单一来源**（候选：datacore 的 `SOLVER_ARG_SPECS` / `argHints` /
  `SOLVER_OUTPUT_SHAPES` 邻近处；`apps/datacore/src/solvers/service.ts` 的入参校验）。
  **按铁律 0.5：grep 到之后必须再追一层，确认它真被谁消费、在什么条件下触发**，
  不要拿一个只有 test 引用的常量当单源。
- 若**确实不存在**这样的单源，如实写进报告，并给出最小的立源方案交审核方裁 —— 不要自己在 agentcore 侧造第二套。

### 3.2 merge 语义：preset 是**默认值**，不是**覆盖值**

```
args = { ...slotPresets, ...filledUserSlots }     // 用户赢
```
今天是 preset 独占。改完必须保证：用户没说 → 行为与今天逐字节一致（加性·可回退）；
用户说了 → 用户的值真的进到求解器。

### 3.3 取不到就诚实缺，不许兜底

若某槽位用户给了、但解析不出对应对象（如基地名不认识），
走**已有的**澄清/诚实缺席路径，**不得**静默回落到 preset 那个写死的实体 ——
回落就是把「我没听懂你说的枣庄」渲染成「枣庄的答案就是常州这份」。

### 3.4 §2.1 那 5 张写死实体的卡，逐张给结论

每张要么：① 该实体确实是合理默认（写清理由）；② 改成中性默认；③ 改成必填槽位。
**三选一，逐张写明**，不许整批一句话带过。

## 4 · 验收判据（本单的命门·比修法更重要）

> #105 的 `COMPLETED && rounds===0` 判据放过了这道病。本单的门**必须能咬住它**，
> 否则修完照样是假绿。

### 4.1 必须是**差分门**，不是状态门

对每个被修的意图，同一问句只换实体，断言**答案必须不同**：

```
kit_analysis：「常州下周缺料」vs「金华下周缺料」→ 求解器实参里的 base 不同，且输出不同
yield_diag ：「常州涂布良率」vs「枣庄涂布良率」→ 同上
```
断言点建议放在**求解器实参**（最接近病灶、最不脆），
并至少有一条断到**输出真的不同**（防止实参传对了但求解器忽略它 —— 那是另一种病，要能分开）。

### 4.2 变异反证（必做·必须真红）

把 `args` 的 merge 改回 preset 独占（即复现今天的行为）→ 上面的差分门**必须转红**。
把反证的**真实输出原文**贴进报告。若某条反证**没红**，不许悄悄跳过：
写清哪一条没红、为什么（F4 收口就诚实报了一条不可咬代码，照此办理）。

### 4.3 加性证明

用户不给实体时，16 个意图的求解器实参与改前**逐字节一致**。给出实测比对。

## 5 · 纪律（与本仓其余工单一致）

- **每完成一个可命名单元就 commit + push** 到 `claude/handoff-wo-derived-intent-slot-deaf`。
  本沙箱当日已重启 8 次，未 push 的工作会归零（真丢过一次 dev 产出）。
  push 与「过 gate」是两回事：推旁支零风险。
- **禁止** `bash scripts/gate.sh`，**禁止**全量 datacore vitest（4 核机，审核方在跑 gate）。
  只跑与本单相关的测试文件：`cd apps/agentcore && npx vitest run test/<file>`。
- **门必须显式捕获退出码**：`out=$(cmd 2>&1); rc=$?`。
  禁止 `cmd | tail -n; echo "EXIT=$?"`（取的是 `tail` 的退出码，恒 0 —— 本仓已因此把编译失败判为通过）。
- 报告里区分**实测**与**推理**，没跑过的就写没跑过。
- 回写 `docs/SYSTEM-ONTOLOGY.md` §8 断点表：`G-DERIVED-INTENT-SLOT-DEAF`
  （若最终闭合则标 ✅，含三形态定性）。**只写描述不登记 = 悬空引用**，D2 收口刚因此被门退过。

## 6 · 收口时本文件要补的内容

- 求解器入参单源的取证结论（存在/不存在，file:line，谁消费）
- §2.1 五张卡的逐张裁决
- 差分门 + 变异反证的**真实输出原文**
- 加性证明的实测比对
- 明说没做到的部分
