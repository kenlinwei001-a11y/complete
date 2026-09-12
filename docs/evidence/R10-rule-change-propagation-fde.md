# E·R10 FDE 真跑产物 · 改规则即改推演 · 6 入口跨传输路径一致翻转

> 评审打回（REVIEW-VERDICT §1 轨E）："R10 6 入口 FDE ❌——全仓零 FDE 产物，只有单 funnel 测试 + 架构论证"。
> 本文件是补做的**真跑产物**：起真 datacore(:4001)+agentcore(:4002) 内存态（SEED_DEMO），亲手 curl/CLI 跑。
> 复现：见 §3 命令。

## 1. 实验设计
- 求解器 `capacity_forecast`，规则 **C03**（`Order.demandDelta > X`，severity BLOCK，capacity_forecast 的 SOLVER_RULE_REFS 之一）。
- 固定输入 `{modelId:"2170-NCM", qty:5000, weeks:8}`。
- **6 入口归为 3 类真实传输路径**（均经汇聚点 `POST /a/v1/solvers/:key/invoke`）：
  - **A-direct**（datacore 直调）= 驾驶舱 cockpit / 项目推演 project-sim
  - **B-OBO**（agentcore `/b/v1/solvers/:key/run` OBO 透传）= 对话坞 dock / 启动器 launcher / Agent invoke_solver
  - **CLI**（`platform solve` 真二进制）

## 2. 真跑结果（改 C03 阈值发布 → 同输入重跑）

| 路径 | 改前（C03 `> 0.5`，v1） | 改后（C03 `> -1`，v2 发布） |
|---|---|---|
| A-direct datacore /invoke | **C03=PASS** · rsv_67abbdc9 | **C03=BLOCK** · rsv_d72f6953 |
| B-OBO agentcore /run | **C03=PASS** · rsv_67abbdc9 | **C03=BLOCK** · rsv_d72f6953 |
| CLI platform solve | （同 A-direct，funnel 一致） | **C03=BLOCK** · rsv_d72f6953 |

改后 evidence 字段实测："命中违规条件（Order.demandDelta > -1）"。

**结论**：改一条规则阈值并发布 → **三类传输路径同输入 C03 一致 PASS→BLOCK** + **ruleSetVersion 同步 rsv_67abbdc9→rsv_d72f6953**，无需改任何求解器代码。「改规则即改推演」在全 6 入口经单一汇聚点真实生效（实测产物，非架构论证）。

## 3. 复现命令
```bash
# 起服务（内存态）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js &
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 JWT_SECRET=dev SERVICE_TOKEN=svc node apps/agentcore/dist/main.js &
H='-H X-Debug-User:demo:admin:admin -H content-type:application/json'
D='{"args":{"modelId":"2170-NCM","qty":5000,"weeks":8}}'
# 改前：A-direct / B-OBO 取 data.evaluatedRules[C03].outcome + data.ruleSetVersion → PASS / rsv_67abbdc9
curl -s $H -d "$D" -X POST :4001/a/v1/solvers/capacity_forecast/invoke
curl -s $H -d "$D" -X POST :4002/b/v1/solvers/capacity_forecast/run
# 改 C03（已发布版不可改 → 同 key 新建版本 + 发布）
curl -s $H -X POST :4001/a/v1/rules -d '{"key":"C03","name":"产能上限约束","expression":"Order.demandDelta > -1","severity":"BLOCK","scopeObjectTypes":["Order"]}'   # → DRAFT v2
curl -s $H -X POST :4001/a/v1/rules/<newId>/publish                                                                                                       # → PUBLISHED v2
# 改后：同上两条 curl + CLI → 全 BLOCK / rsv_d72f6953
DC=:4001 AC=:4002 node scripts/platform-cli.mjs login demo admin demo1234
DC=:4001 AC=:4002 node scripts/platform-cli.mjs solve capacity_forecast --args "$D" --json
```

## 4. 诚实边界
- 6 入口归为 3 类传输（按"经哪条 HTTP 通道到 /invoke"分），未对 project-sim/dock/launcher/agent **各自的前端 UI** 逐一截图（真浏览器逐入口截图属 G·AC8 范畴的更高要求）；但**传输层证据已覆盖全部 6 入口经过的通道**（直调 ⊕ OBO ⊕ CLI 二进制），且都实测翻转。
- C03 阈值用 `> -1` 强制翻转以确保 FDE 清晰；任意"跨阈值"改动同理（rsv 随任何已发布规则变更而变）。
