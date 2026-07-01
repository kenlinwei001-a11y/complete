# ACCEPTANCE-CONTRACT · 每工单「目标/测试标准/测试方法」反偷懒契约

> 用户令：防 dev/reviewer **偷懒走捷径**（"绿测试≠能用"）。每个 WO 必须有**可证伪**的验收契约，`DONE` 必须**逐条出证据**，否则 `BLOCK`。本文是标准；每 WO 的契约落在其施工单 `## 验收契约` 块 + `work-queue.json` 的 `acceptance` 字段（机器可读·loop 消费）。

## §1 契约三件（每 WO 必备）
1. **目标 GOAL**：**用户视角一句话**——"用户做 A → 得到/看到 B"。**禁**"实现 X 模块"这种开发视角（那不可证伪）。
2. **测试标准 CRITERIA**：3–7 条**客观可证伪**断言。每条 = `{id, assert(具体·能判真假·带期望值), type: curl|browser|gate|unit}`。**禁**"测试通过/功能正常"这种非断言（无期望值=偷懒温床）。
3. **测试方法 METHOD**：每条 criterion 对应的**精确可复现步骤**（curl 命令 / 浏览器点击序 / 门命令），其**产出即证据**（HTTP 响应 / 截图 / 门 exit code）。

## §2 反偷懒执行规则（两侧都有牙）
- **dev 不得 `built`**：除非**自查每条 CRITERIA 满足**并留方法产出。半截/空壳/mock 冒充 = 不得 built。
- **reviewer(我) 不得 `done`**：除非**亲手跑每条 METHOD** + 确认每条 CRITERIA + **逐条引用证据**（响应/截图/门 exit）。只"看着对""dev 说做了""测试绿" = **不足 → 不 done**。
- **`BLOCK` 必须指名**：哪条 CRITERIA #n 未过 + 证据（实际输出 vs 期望值 + file:line）。
- **证据留档**：curl 响应 / 门输出 → 写进 `docs/REVIEW-<id>-closure.md`；browser 截图 → `docs/evidence/`。
- **客观优先**：能 `curl+jq` 断言 / `gate exit` 判的 CRITERIA 一律给**可跑命令**（消灭主观空间）；只有真 UI 才用 browser+截图。
- **反"改测试凑绿"**：CRITERIA 是**用户可观察的外部行为**（端点响应/页面所见），不是内部实现细节；改实现不改行为则契约不变。

## §3 与协同 loop 的接线（强制点）
- **work-queue.json** 每项加 `acceptance:{goal, criteria:[{id,assert,type}], method:[{for,run}]}`。
- **dev 侧**（SPEC §2）：`built` 前跑一遍自己 WO 的 method + 自查 criteria；built commit 附自查证据。
- **reviewer cron**（SPEC §3）：`done` 前**逐条跑 method**、逐条判 criteria、逐条引证据入 closure；任一条不过 → `block <id> "CRITERIA #n 未过：期望X 实际Y @file:line"`。
- **DONE 定义收紧**：`work-queue` 的 `DONE` = 每条 CRITERIA 有证据。REQ-LEDGER 的 🟢真闭 = 契约全过 + 用户动作证据。

## §4 契约格式（每 WO 施工单里的 `## 验收契约` 块·样例）
```
## 验收契约（反偷懒·目标/测试标准/测试方法）
GOAL: 用户上传真实 orders.xlsx 后，问"交期风险"能得到基于该数据的真答案（非"需先合成 Order"）。
| # | 测试标准(可证伪断言·带期望) | 类型 | 测试方法(精确可复现·产出即证据) |
|---|---|---|---|
| C1 | POST /a/v1/uploads(orders.xlsx) → 返回 connectorTypeKey="file_upload" 的 connection | curl | `curl -s -XPOST :4001/a/v1/uploads -H'X-Debug-User:realco:ceo:admin' -F file=@orders.xlsx | jq .connection.connectorTypeKey` → 期望 "file_upload" |
| C2 | 配 SolverBinding 后 invoke order_fullchain 返回**非空**答案含裁决字段 | curl | `curl ... /solvers/order_fullchain/invoke ... | jq '.verdict!=null'` → 期望 true(非 "需先合成 Order") |
| C3 | demo 租户零绑定 → order_fullchain 仍工作(向后兼容) | gate | `pnpm --filter datacore test`(既有 order_fullchain 测)→ 期望全绿 |
```

## 本体引用与影响
- 强化平台第一性原则**"绿测试≠能用"** + FDE 交付纪律 + REQ-LEDGER(真闭只凭用户动作证据) + SPEC-collab-automation(loop 强制点)。
- 新治理制品·不改代码/本体接线；`DONE`/`🟢真闭` 语义收紧为"契约逐条有证据"。

---
*审核方反偷懒验收契约标准（design+review·两侧有牙·客观可证伪）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
