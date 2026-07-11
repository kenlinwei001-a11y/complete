# FDE 证据 · WO-SANDBOX-SHOCK-NO-FLOOR（Dev-1·用户扩红线）

**用户 2026-07-11 亲定扩红线：绝不无 LLM 起推演。** 当前 `maybeRenderSandbox` 对 `classification.model === "deterministic:*"`（关键词级 bigram 兜底分类·无 LLM 语义）的 shock 也装配沙盘推演——用关键词级匹配做对象/stateVar 选取。本 WO 收紧：**只有真 LLM 语义分类的 shock 才起推演·deterministic 分类的 shock 走 DEFERRED**（诚实缩范围）。

## 铁律 0 · 本体引用与影响
- 链路：QOS `submitQuery` → `runPathA` → `maybeRenderSandbox`（`orchestrator.ts`·仅方法内收紧·不碰 runPathA/planner/serve）。
- 断点：§8 新登 **G-SANDBOX-DET-SHOCK ✅ 已闭**（无 LLM 语义分类的 shock 不起推演·诚实缩范围）。
- 不变量：KILL-MOCK-RED（DEFERRED 诚实缩范围·绝不假跑关键词级推演）。
- 门：`genuine-sim:check`、`ontology-slices:check`。

## 实现（判据 = 分类真实性·router 关注点）
`maybeRenderSandbox` 中 `assembleSimulationRequest` 返 READY(shock) 后：若 `task.classification?.model` 以 `deterministic:` 开头（关键词级 bigram 兜底·非真 LLM）→ 诚实 DEFERRED 文本·**不装配** `sandbox_render`；只有真 LLM 分类（model ≠ `deterministic:*`·如 `claude-*`/provider spec）继续既有 READY 装配路径。`sim-request.ts` 装配器保持纯确定性函数·不改（判断是 router 关注点）。

## 暗发决策：**不加 feature（有意）**
"绝不无 LLM 起推演" 是用户钉死的**绝对红线**。`defaultOff` 闸会让红线默认被违反 → 故改为**直接诚实收紧**（回退 = git revert·非 feature toggle）。理由钉进 commit 正文。

## green→red 齿（test/sandbox-shock-no-floor.test.ts · 2/2 绿）
- 齿①：deterministic 分类的 shock（`queueClassification` 缺 → LLM classify 失败 → `deterministicClassify` 兜底·model `deterministic:example-match`）用种子 shock 例问句 → 断言 `classification.model` 匹 `^deterministic:`·无 `sandbox_render` 块·诚实 DEFERRED 文本。**红牙验证**：临时禁 guard → 齿①红·齿②仍绿。
- 齿②：真 LLM 分类（`queueClassification` → model `claude-haiku-4-5`）的 shock → 仍产 `sandbox_render`（scope/delta/stateVar 正确·无回归）。
- LLM 全 mock·无 feature 闸齿（无键）。

## 门 / 测试
- `pnpm --filter agentcore build`：绿。
- 单文件 2/2；回归 `sim-render-hook`(4)/`sim-request`(9)/`sim-commander-tools`(5) 全绿。
- agentcore 全量：见收口（SHOCK+CONFIG-DERIVE 合并态一次干净跑）。
- `genuine-sim:check` exit 0·`ontology-slices --check` exit 0。

## 诚实边界
- hold/trend/policy 已是 DEFERRED（待接地），本 WO 只收紧 shock 的 deterministic 分支。
- 代价：无 LLM 时 shock 推演也不跑（功能缩减·更诚实·符合红线）。
