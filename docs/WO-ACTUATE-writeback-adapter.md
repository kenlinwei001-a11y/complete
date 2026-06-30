# WO-ACTUATE · 决策出站写回适配器（mock 适配器 seam + 真 ERP 协议 stub）

> 用户决策点：writeBack 目标 = **mock 适配器** 还是 **真 ERP 协议**？
> **审核方定：mock 可插拔适配器（现期）+ 真 ERP 协议 stub（config 选择·`NOT_CONFIGURED` 诚实报错）。**
> 理由钉死：系统**全离线、无真 ERP/MES 端点可写可验** → 真协议适配器**跑不起来 = vaporware**（违"绿测试≠能用"）。mock 现在就能真跑验证闭环；真协议留成一等 seam，待真 ERP 接入再实现。铁律0.5 自包含设计。

## §0 目标 + DoD-as-experience
**目标**：决策（求解器/沙盘出的行动建议）经 R4 审批 `EXECUTED` 后，**经一个可插拔"写回适配器"出站**——现期 mock（确定性 echo + 回声对账 + 诚实标"写到 MOCK 非真 ERP"），真 ERP 协议留 config 选择的一等 stub。

**完成定义（亲手走一遍）**：
1. 起服务 → 建一个 Action → 审批 → `EXECUTED` → 适配器被调 → **自动落一条 writeback-echo（写回值）** → `reconcile` 端点比对：一致 `ECHO_SUPPRESSED` / 不一致发 `writeback.divergence`。
2. 配 `WRITEBACK_TARGET=erp_rest` 但没配 ERP 端点 → `EXECUTED` 时适配器**诚实 `WRITEBACK_NOT_CONFIGURED`**（不假装写成功）。
3. 前端 Action 详情显示「写回目标：MOCK（确定性·非真 ERP）」徽标——用户看得出没真写 ERP。

## §1 现状盘点（钉 file:line·✅已在/🔴缺）
| 维度 | 现状 | 证据 | 判定 |
|---|---|---|---|
| 写回适配器**接口** | `ActionExecutor.execute(draft)→{ok,targetRef?,error?}` | `actions.ts:9-12`（注释原文 "Write-back adapter interface (S2): this period ships the Mock implementation"） | ✅ 接口在 |
| Mock 实现 | 返 `{ok,targetRef:"MO-2026-…"}`（hashString 确定性） | `actions.ts:14-18` | ✅ 在·但不落 echo |
| 可换适配器 seam | `setExecutor(executor,retryDelaysMs)` | `actions.ts:83/94` | ✅ seam 在 |
| 回声对账 | `POST /a/v1/writeback-echoes` + `/reconcile`→`ECHO_SUPPRESSED` / 发 `writeback.divergence` | `app.ts:1018-1031` | ✅ 在·但**手动**·未接 execute |
| Action 生命周期 | DRAFT→PENDING→APPROVED→EXECUTING→EXECUTED + `action.executed` 事件 | `actions.ts:78-83/349-353` | ✅ |
| 真 ERP 出站适配器 | 无 | — | 🔴 缺（本单留 stub） |
| execute **自动落 echo** | execute 只 return·不写 echo | `actions.ts:14-18` | 🔴 缺（本单接） |
| 诚实标"写到 MOCK" | 无前端徽标 | — | 🔴 缺 |

## §2 施工范围（dev 可直接照做）
- **A. 形式化写回适配器**：保留 `ActionExecutor` 名但文档化它即 S2 写回适配器；接口加 `readonly kind: "MOCK"|"ERP_REST"` + 返回值加 `target?:{kind,system?}` 元信息（向后兼容·可选字段）。
- **B. MockWritebackAdapter（增强现 MockActionExecutor）**：`execute` 成功后**自动 `repos.writebackEchoes.put`** 落写回值（ref=对象/Action ref，writtenValue=patch 快照）→ 使 `reconcile` 闭环不靠手动 POST。确定性 R6（targetRef/echo 由 draft.id hash 定）。
- **C. 真 ERP 适配器 stub `ErpRestWritebackAdapter`**：未配 `WRITEBACK_ERP_BASE_URL` → `execute` 返 `{ok:false,error:"WRITEBACK_NOT_CONFIGURED"}`（诚实·仿 `optimizer-client.ts` 的 `OPTIMIZER_BASE_URL` 未配范式）；配了则按 REST 契约 `POST {baseUrl}/writeback`（**接口契约定义清楚·body 实现可留 TODO** 直到真 ERP 接入）。
- **D. config 选择**：`WRITEBACK_TARGET=mock|erp_rest`（默认 `mock`）→ `server.ts` 启动按 config `actionService.setExecutor(...)`。
- **E. 诚实标（R13）**：Action 记 `writebackTarget:"MOCK"|"ERP_REST"` + `targetRef` → 前端 Action 详情显示「写回目标：MOCK（确定性·非真 ERP）」徽标（复用 `DataModeBadge` 范式）。**不冒充真写 ERP**。
- **F. 沙盘采纳→Action（既有 RL4 红线）不变**：模拟态不直写，采纳 → ActionDraft 走 R4 → 经本适配器出站。

## §3 验收（FDE 亲手）
1. **curl**：建 Action→审批→`EXECUTED`→`GET /a/v1/writeback-echoes` 见**自动落**的 echo→`reconcile` 一致(`ECHO_SUPPRESSED`)/不一致(`writeback.divergence`)两路。
2. **config erp_rest 无端点** → `EXECUTED` 出 `WRITEBACK_NOT_CONFIGURED`（诚实降级·非假成功）。
3. **前端**：Action 详情见「写回目标 MOCK」徽标（真浏览器截图）。
4. **回归**：四包 `build && test` 绿 + 新适配器测（mock echo 闭环 / erp stub NOT_CONFIGURED / R6 确定 / R2 隔离）。

## §4 不在本次范围（诚实边界）
- 真 ERP/MES 协议实现（**留 stub·接口契约定义·待真 ERP 接入再填 body**）——本单不假装能写真 ERP。
- 真实时双向同步（属连接器 sync 域·非 actuate 出站）。
- 写回失败的复杂补偿/saga（现有 retry [50,100,200] 够·复杂编排留后续）。

## 本体引用与影响
- **链路**：`决策/沙盘建议→ActionDraft→R4 审批→EXECUTED→WritebackAdapter(mock echo / erp stub)→writeback-echo→reconcile→ECHO_SUPPRESSED / writeback.divergence`（本体§3 `Action(EXECUTED)--writeback-->ObjectInstance` + §4 DL4 `writeback.divergence`）。
- **对象类型**：ActionDraft/ActionTypeRecord/WritebackEcho/ObjectInstance。
- **不变量**：R4（写回经审批·模拟态不直写 RL4）·R13（诚实标 MOCK 不冒充真 ERP）·R6（mock echo 确定）·R2（租户隔离）·no-secrets-echo（ERP 凭据 AES-GCM·不回显）。
- **断点**：补"出站适配器抽象 + 自动 echo + 真 ERP stub"·闭 writeback 半手动残口·建议登记 **G-14「出站执行器/真 ERP 接入臂」**。
- **回写**：dev 落地后回写 §3（适配器边）+ §5（R4 writeback 口径）+ §8（G-14）。

---
*审核方自包含施工单（design+review·铁律0.5·钉真实 file:line·决策=mock 适配器已定）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
