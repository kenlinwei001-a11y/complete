# 测试提示词 · S01 场景启动器变体路由复测（转发测试 dev）

> **一句话**：复测「产能可行性变体问句」是否已从**卡死 ~5 分钟**修复为**确定性秒级**。
> 关键前提：**先确认你测的是最新代码**（之前那条 4min42s 的 trace 是 S01 合入前的旧代码）。

---

## 0. 背景 —— 你在测什么

**病根**（旧代码）：场景启动器里「产能可行性」变体问句（如「4680-NCM 上浮10%、8周还能接吗」），改写成自由口语后**丢了 scenarioIntentKey** → 被误判开放题 → 甩给多角色 Coordinator → 拆成供应链/生产/质量三个子 agent，各自跑 ReAct loop 烧 Kimi 推理（实测 **99% 时间在等 LLM 返回**，真正调 solver <2s）→ 工具失败不早停 → 预算耗尽降级。总耗时 4 分 42 秒。

**S01 修复**（两条**确定性路径**·无 LLM·秒级）：
1. **会话继承**：同一对话里的追问，继承上次场景的 `scenarioIntentKey` + 确定性抽槽（「上浮10%」→0.1、「8周」→8、型号从问句/继承上下文）→ path-A 直调 `capacity_forecast`。
2. **compose 直路**：自由变体问句经 compose 直接编排 `capacity_forecast`，全程不落 agent loop。
3. **Coordinator 拒拆**：对这类变体 `planCoordination` 直接返 undefined，**不再三路会诊**。
4. **停滞早停**：loop 连续工具失败（ERROR/DENIED 都计，不只权限拒）+ 近 2 轮无成功产出 → 立即降级，不烧满预算。

---

## 1. 第一步（最重要）：确认你测的是最新代码

之前的 4min42s trace = **S01 合入前**的代码。务必先同步：

```bash
git fetch origin claude/inspiring-gates-aqczjg
git checkout claude/inspiring-gates-aqczjg
git pull origin claude/inspiring-gates-aqczjg
git rev-parse HEAD            # 必须是 3516c0c8 或更新

# 自查 S01 在不在（必须 > 0）：
grep -c parseCapacityFeasibilityVariant apps/agentcore/src/agent/sim-planner.ts

# 重新 build（旧 dist 不生效！）：
pnpm --filter agentcore build
```

**若 grep 输出 0 → 你的环境没有 S01，别往下测**，先解决代码同步（这就是上次 4min42s 的原因）。

### 1b. 可选·秒级确认（不起整套服务）

只想确认 S01 识别器/路由是否正确，跑这条 SEAM 测试即可（含"变体→capacity_forecast·零 agent 调用·无 coordinator"的端到端断言）：

```bash
cd apps/agentcore && npx vitest run test/s01-variant-routing-seam.test.ts
# 全绿 = S01 路由逻辑在位
```

---

## 2. 第二步：怎么测才能看到修复（**测法不对会看不到**）

满足**任一**条件就走确定性秒级路径：

### 测法① 用 demo 租户（最省事·推荐）
demo 租户默认开 `qos.compose-path`（compose 直路）。直接把变体问句作为**自由查询**提交 `POST /b/v1/queries`：

- **问句 A**（S01 原句）：`4680-NCM 加 20% 六周能不能接？`
- **问句 B**（口语改写·上次卡死的那句）：`如果需求只上浮 10%、交期拉长到 8 周，4680-NCM 这单还能接吗？`

### 测法② 同一对话追问（验证意图继承）
先经场景启动器启动 S01「订单可承接性评审」，拿到返回的 `conversationId`；用**同一个 conversationId** 提交问句 B。

---

## 3. 第三步：预期结果（对着 decision-trace 逐项核）

| 字段 | 期望值 |
|---|---|
| `path` | **WORKFLOW**（不是 AGENT） |
| `classification.model` | 测法①：compose 直路 · 测法②：`deterministic:scenario-inherit` |
| `coordinator.planned` 事件 | **不存在**（关键：不再三路会诊） |
| 工具调用 | `capacity_forecast` 一次·OK·`args={modelId:"4680-NCM", demandDelta:0.1(B)/0.2(A), weeks:8(B)/6(A)}` |
| `agentRequests` / runAgentLoop | **0**（不落 agent loop） |
| 总耗时 | **300–600 ms**（回到 S01 原句 / S02 水平，不再 4 分钟） |

**已在真代码验过**：问句 B `如果需求只上浮 10%、交期拉长到 8 周，4680-NCM 这单还能接吗？` → 识别器 `isVariant=true`、解析出 `{modelId:"4680-NCM", demandDelta:0.1, weeks:8}`。

---

## 4. 反例（这些应仍"正常"，别误判成回归）

- `SO-3402 提前两周交跨基地重排，产能够不够` → 应走 **sop_reschedule** 领域（不被变体劫持）。
- `综合分析连锁影响给个整体结论` / `邯郸是什么类型的基地` → 真开放题，仍可走 agent/coordinator（不该被强绑 capacity_forecast）。

---

## 5. 诚实边界（重要·避免误判"没修好"）

若你**既新开孤立对话、又用没开 `qos.compose-path` 的非-demo 租户**测——继承没上文可继承、compose 门又关——则：
- S01 **仍拦住 Coordinator 三路会诊**（落 path-B **单** agent + 导航切片直调 `capacity_forecast`，几秒，**不再是 4 分钟**）；
- 但拿不到 300–600ms 的**纯 path-A**。要纯 path-A，请用①（demo 租户，compose 默认开）或②（同对话继承）。

即：**demo 租户 + 测法① = 最完整的修复演示。**

---

## 6. 回报什么

把问句 A、B 在测法①（和可选②）下的 **decision-trace** 发回，重点标出：
`path` / `classification.model` / **有无 `coordinator.planned`** / `capacity_forecast` 的 args / `agentRequests` 数 / 总耗时。

任一项不符预期 → 附**完整 trace** + 用的**租户** + **conversationId** + `git rev-parse HEAD`，我据此定位是代码没同步、还是真有残缺接缝。
