# WO-ACTUATE · 决策出站写回适配器 — FDE 亲手证据

> 自包含设计 `docs/WO-ACTUATE-writeback-adapter.md` §3 验收（FDE 亲手·用户动作证据·非测试绿）。
> 真起内存态 datacore（SEED_DEMO=1）真 curl + 真 Chromium 浏览器实拍。模型标识不入提交物。

## 施工落点（§2 A–F）
- **A** `apps/datacore/src/actions.ts`：`ActionExecutor` 形式化为写回适配器接口（`readonly kind?:"MOCK"|"ERP_REST"` + 返回 `target?:{kind,system?}`·向后兼容可选）。
- **B/C/D** `apps/datacore/src/writeback.ts`（新）：`MockWritebackAdapter`（execute 成功**自动 `repos.writebackEchoes.put`** 落写回值→reconcile 闭环·确定性 R6）· `ErpRestWritebackAdapter` stub（未配 `WRITEBACK_ERP_BASE_URL`→`WRITEBACK_NOT_CONFIGURED` 诚实降级·body 实现留 TODO+REST 契约定义清楚）· `buildWritebackAdapter(config.WRITEBACK_TARGET)`。
- **D** `apps/datacore/src/config.ts`：`WRITEBACK_TARGET=mock|erp_rest`(默认 mock) + `WRITEBACK_ERP_BASE_URL`；`app.ts` 启动按 config `setExecutor`（domainExecutor 包裹 outboundAdapter）。
- **E** `packages/contracts/src/actions.ts`：`WritebackTargetSchema` + ActionDraft `writebackTarget` + `executionResult.target`；前端 `apps/frontend-shell/src/pages/admin/ActionsPage.tsx` Action 详情「写回目标：MOCK（确定性·非真 ERP）」徽标（复用 DataModeBadge 警示范式·R13）+ 执行结果行。
- 新增 `GET /a/v1/writeback-echoes`（列 pending echo·R2 租户隔离）。
- **F** 沙盘采纳→Action(RL4) 不变（domainExecutor 既有领域分支原样保留）。

## ① mock：建 Action→审批→EXECUTED→自动落 echo→reconcile 两路（真 curl 真响应）

起服务：`PORT=4051 SEED_DEMO=1 node apps/datacore/dist/server.js`（WRITEBACK_TARGET 默认 mock）。

建 Action（admin·demo 租户 ALLOW_ADMIN 自审）→ 审批 → EXECUTED：
```json
// POST /a/v1/action-drafts {"actionTypeKey":"WO_ACTUATE_DEMO","payload":{"baseId":"changzhou","newCap":120}}
// → POST /a/v1/action-drafts/{id}/approve {} →
{"id":"act_5dafxh2hdnq7gan0","status":"EXECUTED",
 "writebackTarget":"MOCK",
 "executionResult":{"ok":true,"targetRef":"MO-2026-4404","attempts":1,
   "target":{"kind":"MOCK","system":"mock-writeback"}}}
```

`GET /a/v1/writeback-echoes?actionId=...`（**自动落**·不靠手动 POST）：
```json
{"items":[{"id":"wbe_q9y84xfjhsaz4zzf","tenantId":"demo","ref":"MO-2026-4404",
  "writtenValue":{"baseId":"changzhou","newCap":120},
  "writtenAt":"2026-06-30T16:37:25.777Z","actionId":"act_5dafxh2hdnq7gan0"}]}
```

reconcile **一致** → `ECHO_SUPPRESSED`：
```json
// POST /a/v1/writeback-echoes/reconcile {"ref":"MO-2026-4404","incomingValue":{"baseId":"changzhou","newCap":120}}
{"verdict":"ECHO_SUPPRESSED","ref":"MO-2026-4404",
 "writtenValue":{"baseId":"changzhou","newCap":120},"incomingValue":{"baseId":"changzhou","newCap":120}}
```

reconcile **不一致** → `DIVERGENCE` + 发 `writeback.divergence`（DL4）：
```json
// 另建一条 Action（targetRef MO-2026-4694），reconcile incomingValue 改 newCap:999 →
{"verdict":"DIVERGENCE","ref":"MO-2026-4694",
 "writtenValue":{"baseId":"yancheng","newCap":80},"incomingValue":{"baseId":"yancheng","newCap":999}}
// GET /a/v1/outbox → {"event":"writeback.divergence","status":"PENDING",...}
```

## ② erp_rest 无端点 → EXECUTED 诚实 WRITEBACK_NOT_CONFIGURED（非假成功）

起服务：`PORT=4052 SEED_DEMO=1 WRITEBACK_TARGET=erp_rest node apps/datacore/dist/server.js`（未配 WRITEBACK_ERP_BASE_URL）。

建 Action → 审批 →（3 次重试后）`EXECUTION_FAILED`·诚实错误码（**不假装写成功**）：
```json
{"id":"act_5y61z0y7kryxrz45","status":"EXECUTION_FAILED",
 "writebackTarget":"ERP_REST",
 "executionResult":{"ok":false,"error":"WRITEBACK_NOT_CONFIGURED","attempts":3,
   "target":{"kind":"ERP_REST","system":"erp-rest"}}}
```

## ③ 前端真浏览器：Action 详情「写回目标 MOCK」徽标

`scripts/ui-smoke-writeback-target.mjs`（真 Chromium /opt/pw-browsers + 真后端 4051·dev 模式注入 VITE_DATACORE_URL）：admin 登录 → `/admin/actions` → 状态筛选 EXECUTED → 点首行 → 详情。

```
  EXECUTED Action 行数: 2
  徽标文本: 写回目标：MOCK（确定性·非真 ERP）
✓ writeback-target-smoke：Action 详情「写回目标 MOCK（确定性·非真 ERP）」徽标真浏览器可见（真后端）。
```

实拍截图：`docs/evidence/WO-ACTUATE-writeback-badge.png`（amber 徽标「写回目标：MOCK（确定性·非真 ERP）」+「执行结果：成功 · MO-2026-4694」可见）。

## ④ 回归 + 新适配器测

- `pnpm -r build` 全 4 包绿。
- `apps/datacore/test/writeback-adapter.test.ts`（7 测全绿）：①a mock echo 闭环→ECHO_SUPPRESSED · ①b 不一致→writeback.divergence · ② erp_rest 未配→WRITEBACK_NOT_CONFIGURED · R6 确定性（同 draft.id 同 targetRef）· R2 租户隔离（echo 带 tenantId 跨租户不可见）· erp stub 配 base 仍未实现（诚实）· buildWritebackAdapter config 选择。
- `pnpm --filter datacore test` / `pnpm --filter frontend-shell test` / `pnpm gates` 全绿（见 commit 说明）。

## 距北极星（诚实边界）
- 真 ERP/MES 协议 **body 实现留 stub**（`ErpRestWritebackAdapter.execute` 内 TODO + REST 契约 `POST {baseUrl}/writeback {actionId,tenantId,actionTypeKey,payload}` 定义清楚）。本期系统全离线、无真 ERP 端点可写可验，真实现 = vaporware（违"绿测试≠能用"）；配了 `WRITEBACK_ERP_BASE_URL` 当前返 `WRITEBACK_ERP_STUB_NOT_IMPLEMENTED`（诚实），待真 ERP 接入再填 body（凭据经 credentialRef AES-GCM 解密·no-secrets-echo R5·绝不回显明文）。
- 真实时双向同步（连接器 sync 域）/写回失败复杂补偿 saga 不在本期（现有 retry [50,100,200] 够）。
