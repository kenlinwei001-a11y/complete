# WO-B AGENT-OBSERVATIONAL-MEMORY · FDE 真起真跑证据

**裁决**：不换框架·借模式（Agent-Native 观察记忆概念吸收进自有栈）。
**红线**：OBSERVED 只作路径参考·永不冒充真值（带免责·业务事实以工具结果为准·KILL-MOCK-RED）·确定性蒸馏默认（LLM 路 gated+mock）·R2 隔离·G-RET 留存。

## 复现

```bash
pnpm -r build
node docs/evidence/AGENT-OBSERVATIONAL-MEMORY-fde.mjs
```

真起真跑：真 Fastify 监听 `http://127.0.0.1:4102`（真 HTTP·真 orchestrator 终态钩子·真经验库仓储写读）。
LLM 一律 mock（项目铁律：测试不依赖网络/时钟随机·LLM mock）；DataCore 用平台自带内存 mock（无需起 A）。

## 实跑输出（`AGENT-OBSERVATIONAL-MEMORY-fde.mjs` 自校验）

```
[BOOT] agentcore 真监听 http://127.0.0.1:4102  (DataCore=内存mock · LLM=scripted)

[任务1] taskId=task_01KWQ1RC59PHWPYNDXGG9193NE status=COMPLETED path=AGENT

[OBSERVED 观察记忆写侧] 终态钩子写入的经验条目：
{
  "id": "exp_auto_task_01KWQ1RC59PHWPYNDXGG9193NE",
  "origin": "OBSERVED",
  "provenance": "task_01KWQ1RC59PHWPYNDXGG9193NE",
  "intentKey": "dash",
  "toolPath": "query_objects",
  "keyFindings": "储能基地平均利用率 68.2% ⟦ref:0⟧。",
  "scene": "dash"
}

[任务2 · search_experience 读侧] 顶层免责声明 disclaimer = 「仅供路径参考·业务事实以工具结果为准」
[loop 闭合] 二次跑检索命中任务1写入的 OBSERVED 路径提示：
{
  "origin": "OBSERVED",
  "provenance": "task_01KWQ1RC59PHWPYNDXGG9193NE",
  "toolPath": "query_objects",
  "disclaimer": "仅供路径参考·业务事实以工具结果为准",
  "score": 0.607
}

[R2 隔离] other-tenant 列到的经验条目数=0；含任务1条目？ false

✅ 全部断言通过：终态→OBSERVED写入(provenance真taskId·toolPath真序列)·search带免责(永不冒充真值)·loop闭合·R2隔离。
```

## 验证点对照

| 项 | 证据 |
|---|---|
| 终态钩子写 OBSERVED（写侧闭环） | 任务1 COMPLETED → `orchestrator.recordExperience` 写 `origin:OBSERVED` 条目 |
| provenance=真 taskId·toolPath 真序列 | `provenance=task_01KW…`（==任务1 id）·`toolPath="query_objects"`（decision-trace 真工具序列） |
| 确定性蒸馏默认（R6） | `keyFindings` = 结论首段模板蒸馏（非 LLM，`QOS_MEMORY_LLM` 未设） |
| 读侧带免责·永不冒充真值（KILL-MOCK-RED） | `search_experience` 顶层 + 每条命中 `disclaimer='仅供路径参考·业务事实以工具结果为准'` |
| loop 闭合 | 二次同意图跑经 `search_experience` 命中任务1写入的 OBSERVED 路径提示（`provenance`=首跑 taskId） |
| R2 隔离 | `other-tenant` 列到 0 条·不含任务1条目 |
| 先查经验库 prompt 步 | `UNIVERSAL_SYSTEM_PROMPT` 第 0 步「先查经验库」（`search_experience` 取历史路径提示·明标 OBSERVED 不引真值） |

## 牙齿（`apps/agentcore/test/experience-writeback.test.ts`）

- OM1 终态→OBSERVED 条目字段全（origin/provenance=taskId/toolPath/keyFindings/intentKey）·**revert 字段即红**
- OM2 逐条命中 + 顶层免责声明（OBSERVED 不冒充真值）
- OM3 R2 跨租户读不到
- OM4 R6 双跑蒸馏内容（toolPath/keyFindings/approach/embedding）字节一致
- OM5 gated LLM（`QOS_MEMORY_LLM=1` + mock compose）接管 keyFindings·默认 OFF 走确定性模板
- OM6 `agt_universal` systemPrompt 含「先查经验库」+ search_experience + OBSERVED + 免责声明
- OM7 loop 闭合：二次同意图检索命中首跑 OBSERVED（provenance=首跑 taskId）

`pnpm --filter agentcore test` → 436 passed；`pnpm gates` exit 0；四包 build exit 0。
