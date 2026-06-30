# 审核核发 · WO-PIPE-INCR ②（调度自动增量 + 闭 DL9 断链）闭合

> 提交物 `e48cc81`。承 ① CDC delta-merge 之后，② 收两件根因事：**(a) 闭 DL9 真断链**（`connection.sync_completed` 在本体 §4 声明、被 agentcore 订阅，却因 ConnectorService 无 outbox 从不产出 → 同步数据成孤岛）；**(b) 调度自动续传**（CONNECTOR_SYNC 定时作业每数据集用自身 watermark 作 since·增量非全量重灌）。审核方真起 datacore 真跑 sync + 读 outbox 独立复验。

## 一句话结论

**✅ 闭合。** DL9 真断链**真闭**——真起 datacore、真 sync 连接器 → outbox 的 `connection.sync_completed` 由 **0→1** 真产出（此前声明+订阅却从不发·孤岛），且 `changedRows>0` 触发 `ontology.runDerivations` 重算**无 warn**；钩子解耦不破 R1；调度自动续传 + changedRows=0 跳过 + 全量回退经测试覆盖。这正是"绿测试≠能用"最该抓的接缝——**事件被声明却从不真发**——已真跑坐实闭合。

## FDE 真跑核对

| 判据 | 状态 | 审核方独立证据（真起 datacore memory·真 sync·读 outbox） |
|---|---|---|
| DL9 闭：sync 真产出 connection.sync_completed | ✅ | sync **前** outbox `connection.sync_completed=0` → 创建 mock_erp 连接 + `POST /sync`（SUCCEEDED·12 行）→ sync **后** `=1`（outbox 29→31 = connection.created + connection.sync_completed） |
| 事件 payload 非空洞 | ✅ | `outbox.emit` 真持久化全 payload（OutboxEvent.payload=connId/datasets/rowCounts/watermarks/incremental/changedRows·`put` 落库）；`GET /a/v1/outbox` 仅投影 envelope（D-29 变更馈源·故意省 payload）——payload 为下游订阅者存着、非丢失 |
| changedRows>0 → 派生重算·无 warn | ✅ | datacore 日志「派生重算失败」warn **count=0**（recompute 跑通·FDE 判据达成） |
| 调度自动续传（auto·每数据集自身 watermark 作 since） | ✅ | `connectors-incremental.test` 2/2 绿（auto 续传 3 轮 + changedRows=0 跳过 + mock_erp 全量回退）；app.ts 调度 `sync(...,{auto:true})` |
| 解耦不破 R1 | ✅ | 读源：`ConnectorService.onSyncCompleted` 钩子（不 import Outbox/Ontology），app.ts 侧 `connectors.wire({onSyncCompleted})` 发事件+重算 |

## 读源坐实（机制）

- `service.ts`：`SyncCompletedInfo{connId,datasets,rowCounts,watermarks,incremental,changedRows}`；`sync(...,{since?,auto?})` 每数据集 `dsSince = since ?? (auto ? existing.watermark : undefined)`；末尾 `await this.onSyncCompleted(tenantId, info)`（try/catch 非致命·失败计 `dc_connector_sync_hook_total{outcome:failure}` 不静默吞）。
- `app.ts`：`onSyncCompleted` → `outbox.emit("connection.sync_completed", {...})` + `if(changedRows>0) ontology.runDerivations(systemCtx)`（try/catch warn 非致命）；调度 `sync(systemCtx, refId, {auto:true})`。
- `outbox.ts`：`emit` 构 `OutboxEvent{...payload}` → `put`（payload 真落库·GET 投影出）。

## 门 / 回归

- `pnpm -r build` 全绿；`connectors.test`(10)+`connectors-incremental.test`(2) = **12/12**；commit 称 datacore 789 绿。
- 真跑 outbox 0→1（before/after = 负/正对照·因果明确：唯一动作是 sync）。

## 诚实边界

1. **派生重算是"尽力而为"**：mock_erp 原始行落 RawDataset 后，`runDerivations` 跑但若无消费该原始数据的派生 spec 则为 no-op（本次 demo 无 warn = 跑通·但未必产新对象）。真正"同步数据自动流入对象"需建模(materialize)链路配齐——属上游建模、非本单。本单证的是**钩子真触发 recompute 且不报错**。
2. **auto 续传真 PG 未单独实拍**：经 `connectors-incremental.test`（真路由 inject）覆盖·未真起服务跑定时作业（调度器 cron 触发属时钟·测试已覆盖 auto 语义）。
3. **GET /outbox 不返 payload**（设计）：下游真消费 payload 走 relay/dispatch（agentcore invalidate 钩子）·本单未跨系统实拍下游失效（属 B↔A 缓存失效链·另单）。

## 本体引用与影响

- **§4 DL9**（`connection.sync_completed`·L8）：dev 已回写「**✅闭**」+ 闭合叙事（钩子→emit·payload 字段·changedRows>0→runDerivations）——审核方真跑坐实属实。**数据→本体链自动化**：同步进来的新数据自动触发派生重算（此前孤岛）。
- **§2 RawDataset**：auto 续传语义（每数据集 watermark 作 since）回写。
- **不变量**：R1（contracts-only/解耦·钩子不 import Outbox/Ontology）不破；R6（确定性·watermark 驱动）不破。
- **数据管线成熟化 D0**：① CDC delta-merge + ② 调度自增量 + sync→事件→重算 = 连接器从"手动全量孤岛"升为"自动增量且下游联动"——D0 地基第二、三砖。

---
*审核方独立核发（design+review·真起 datacore 真 sync 读 outbox 为据·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
