# 后续工单 · 2026-08-13 收编批（R1/R2/R6）沿途查出的真缺口

> 本文只收**今日亲手复验过**的条目。每条给出：形态（铁律 0.6 句式）· 证据（file:line 或命令）· 修法 · 为什么不在本批修。
> **一条被退回的条目也列在 §5** —— 我原先记成缺陷、复验后证伪的，照铁律 0.6「错账要回写」留痕，免得下一轮又照旧账派单。

## §1 · 🔴 租户隔离：mock 客户端 0 参实现，静默吃掉租户上下文

**形态**：**「我用『接口声明了 ctx』当作『所有实现都拿到了 ctx』的证据，而前者并不度量后者。」**

**证据（2026-08-13 实测）**：

| 位置 | 签名 |
|---|---|
| `apps/agentcore/src/tools/clients.ts:48` | `listObjectTypeKeys(ctx: ToolAuthCtx): Promise<string[]>` |
| `apps/agentcore/src/tools/clients.ts:141` | `listPublishedRuleKeys(ctx: ToolAuthCtx): Promise<string[]>` |
| `apps/agentcore/src/mocks/clients.ts:376` | `async listObjectTypeKeys(): Promise<string[]>` ← **0 参** |
| `apps/agentcore/src/mocks/clients.ts:705` | `async listPublishedRuleKeys(): Promise<string[]>` ← **0 参** |

TypeScript 的函数型变规则允许**少参实现**满足多参签名 ⇒ **类型照样编译通过**，而租户上下文在 mock 路径上被整个丢掉。
本仓铁律「**tenant_id everywhere**：所有仓储读写、事件、缓存键都带 tenantId」在这条路上是断的。

**为什么危险不止于「测试用的 mock」**：`mocks/clients.ts:301` 里 `listObjectTypeKeys()` 的返回值直接参与
`req.types` 缺省推导 —— 也就是说它不只是被断言，它**参与了取数口径**。跨租户场景下，
「拿到全量类型键」与「拿到本租户类型键」返回的是不同集合，而两者都不会报错。

**属三形态里的哪一种**：**接了线接错地方**（不是「没接线」，也不是「接了线没数据」）——
调用方在、数据在，只是实现挂在一个丢掉了裁剪维度的签名上。修法是补参数，不是补数据。

**修法**：
1. 两个 mock 方法补 `ctx: ToolAuthCtx` 形参，并**真的按 `ctx.tenantId` 过滤**（不许只加形参不用）。
2. 加一道**门或测试**咬住「实现的形参个数 ≥ 接口声明」——否则下一个 0 参实现照样溜过去。
   判据必须是**机器先说话**：本条本身就是「人肉 review 看不见」的证明。
3. ⚠️ 变异反证要求：把过滤去掉后**必须变红**。若加了断言仍绿，说明测试的两个租户种子数据恰好同解
   （今日实测过这个形态：`toContain` 在未过滤的超集上恒真，删掉真过滤 21 条用例照样全绿）。

**为什么不在本批修**：本批范围边界是「捞欠账分支的内容」，本条是沿途发现的**新缺陷**，
改它要动 agentcore 的取数口径与租户种子，属独立一单。

---

## §2 · 🟡「守门的门」的盲点：只认字面 `process.exit(2)`，不解析常量绑定

**形态**：**「我用『全文件搜得到 `process.exit(2)`』当作『这道门有 RC=2 出口』的证据，而前者并不度量后者。」**

**证据**：`scripts/check-gate-exit-discipline.mjs` 静态搜字面形 `process.exit(2)`。
而 `check-prd-data-grounding.mjs` 写的是 `process.exit(RC_TOOL_BROKEN)`，其中顶部 `const RC_TOOL_BROKEN = 2`。
⇒ 该门**本来就有** RC=2 能力，却被判「无 RC=2 出口」。

**收编时的临时处置**：把出口改回字面量并加注释说明「这里刻意写字面量不是风格问题」。
**这是打补丁，不是解决根源** —— 下一道用命名常量的门还会被误判。

**真修法**：让 `check-gate-exit-discipline.mjs` 解析 `const X = 2` 这层常量绑定。
改既有 canonical 门属治理决策，故单独立单而非在收编单里顺手改。

---

## §3 · 🟡 `coverage-blind` 检测器的假阳性源：看不见 vitest 双参 `expect`

**证据**：`hasCardinalityAnchor` 要求 `)` 紧跟 `.length` / `.size`，
故 **`expect(value, message)` 这种双参写法一律识别不到** —— 而本仓大量使用该写法。

**后果方向要说清**：这是**假阳性**（把有基数锚点的测试判成没有），会让棘轮基线虚高，
把本来合格的测试记进「盲」账。不是漏报，是误报。

**修法**：判据从「`)` 紧跟」放宽到「同一 `expect(...)` 调用的**任一实参**里出现基数锚点」，
并**在放宽后重算基线**（放宽会让命中数下降，基线必须同步下调，否则棘轮会把差额读成「有人修好了」）。

---

## §4 · 🟡 交接：3 个 datacore 测试文件在收编单里从未被执行

R6 单明确禁跑 datacore vitest（4 核机的重画像红线），故这三个文件**只过了 `tsc`**，其中一个还被改动过
（`action-metrics-tenant.seam.test.ts` 补基数下限）。

> **「tsc 过了」不度量「测试跑得过」。**

**处置**：已在本批并线门里由拿到重画像槽位的人（审核方）实跑，结果随并线报告一并给出。
**本条留在文档里是为了记住这个交接口子** —— 派单时禁跑某类测试，就必须显式记一笔「谁来补跑」，
否则它会以「报告里全绿」的形态混过去。

---

## §5 · ⚪ 已证伪：撤回一条我自己记错的账（照铁律 0.6 回写）

**我原先记的**：
> 🔴 WO-1 的 seam 测试断言 `expect(after.status).toBe("PAUSED")`，测的是 **mock-only 行为**；
> 真后端没有暂停能力（`intake-pipeline.ts:49-53` 直接 FAILED）。PAUSED 计数：真后端 **0**、mock **4**。

**复验后证伪（2026-08-13 实测）**：

1. 真后端 **有** PAUSED，且是真实现：`apps/datacore/src/databuilder/workflow-engine.ts:194` `run.status = "PAUSED"`
   （`:191` 注释：「未获放行 → 把 run 置 PAUSED 停在该步（保留现场），等 approve 后 resume 续跑」），
   放行入口 `apps/datacore/src/app.ts:4539`。datacore `src/` 全树 PAUSED 命中 **9 处**，不是 0。
2. 那条断言驱动的是 `engine.start(...)`（`apps/datacore/test/databuilder-pipeline.seam.test.ts:384`），
   **正是 workflow-engine 这条真路径**，不是 mock。
3. `intake-pipeline.ts:50-53` 确实不能暂停，但它是**同步接入口**，且给了显式错误
   （「该节点 SOP 要求人工介入，但同步接入口无法在此暂停」）——这是**诚实的能力边界声明**，不是缺陷。

**我错在哪（形态）**：**「我用『某文件里没有 PAUSED』当作『真后端没有暂停能力』的证据，而前者并不度量后者。」**
我只 grep 了 `intake-pipeline.ts` 一个文件就下了全后端的结论，**少追一层**——
这正是铁律 0.5 点名的病，而我是写那条铁律的人。

**教训落点**：「真后端 0 / mock 4」这个数当时看起来很有说服力，正因为它是个**数字**。
铁律 0.6 的句式在这里成立：**拿一个看起来相关的数字当判据，而没验证这个数字真的在度量我要度量的东西。**

---

## §6 · 两件交仓主裁决的事（我未擅自决定，但已按仓里惯例落了默认值）

| 事项 | 现状 | 我的判断依据 | 仓主要改的话 |
|---|---|---|---|
| `admin.plan-builder` 的 `defaultOn` | 两侧注册表均 **`true`**（`apps/datacore/src/features.ts:59` · `apps/agentcore/src/features/registry.ts:96`） | 仓里 `level:"BLOCK"` 的 admin 特性**清一色 `defaultOn: true`**（实测同列 12 条）；且 `apps/agentcore/test/plan-builder.test.ts:167` 是**显式 disable** 来测 404 路径 ⇒ 测试的缺省预期就是「开」 | 一行改 `false`，两侧同改 |
| 导航信息架构：plan-builder 归入 `orchestration` 组 | `adminRegistry.ts:101` 归「编排与场景」 | 该组现有 catalog/agents/workflows/skills/scenes/resources，计划构建器属同一族 | 改 `adminRegistry.ts` 的 `paths` 归属 |

**为什么没有阻塞等答复**：两者都是**一行可逆**、且都落在仓里既有惯例上，
阻塞会把 93 条欠账的推进停住。按「先做能做的，把裁决点收敛成一个真问题」处置。
