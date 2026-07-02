# 审核核发 · WO-ACTUATE + WO-OBSERVABILITY（dev 照设计单实现·代码级核发）

> dispatch→build→verify 闭环：审核方出设计单（`WO-ACTUATE-writeback-adapter.md`/`WO-OBSERVABILITY-otel-span-tree.md`）→ dev（并行会话）主动实现 `e5c41cc`/`22443b2` → 本文审核方**独立核实**核发。
> **诚实边界**：审核方独立验了①代码符设计②datacore 829 回归绿(亲跑)③诚实/不变量(读码)④本体回写；**用户动作走查(curl 写回/起 OTel collector 看 trace)取 dev FDE 证据·审核方未独立起服务实拍**（代码级核发·非真起服务）。

## §1 WO-ACTUATE（`e5c41cc`）— PASS
| 维度 | 独立核实 | 结论 |
|---|---|---|
| 符设计 | `writeback.ts`:`ActionExecutor`形式化为写回适配器(+kind MOCK/ERP_REST)·`MockWritebackAdapter`·`ErpRestWritebackAdapter`·`buildWritebackAdapter(config.WRITEBACK_TARGET)`·前端 ActionsPage badge——与 WO-ACTUATE §2 A-F 逐条对应 | ✅ |
| R6 确定性 | `MockWritebackAdapter.targetRefFor = hashString(draft.id)%9000`·无 Date.now/Math.random·与历史字节一致 | ✅ |
| 回声闭环 | execute 成功**自动 `writebackEchoes.put`**(ref=targetRef·writtenValue=payload)→ reconcile 不再手动 | ✅ |
| 真 ERP 诚实 | 未配 `WRITEBACK_ERP_BASE_URL`→`WRITEBACK_NOT_CONFIGURED`(不冒充成功)·REST 契约定义·body TODO | ✅ |
| 诚实标 MOCK | 返回 `target:{kind:"MOCK",system:"mock-writeback"}`·前端 badge"写到 MOCK 非真 ERP" | ✅ R13 |
| no-secrets / R2 | ERP 凭据经 credentialRef AES-GCM 不回显·echo 带 draft.tenantId | ✅ |
| 测试 | `writeback-adapter.test` 7/7(在 datacore 829 内·审核方亲跑)·evidence + 截图 | ✅ |

## §2 WO-OBSERVABILITY（`22443b2`）— PASS
| 维度 | 独立核实 | 结论 |
|---|---|---|
| 符设计 | OTel SDK deps + `tracing.ts`(先于 app require)+ solver span + docker collector + `check-tracing` 门——与 WO-OBSERVABILITY §2 A-G 对应 | ✅ |
| 诚实降级 | 未配 `OTEL_EXPORTER_OTLP_ENDPOINT`→**no-op 不导出**(`exporting=false`)·不假装 | ✅ |
| 传播桥 | x-request-id(人读·AUDIT-OBS 不破)+ traceparent(机器读分布式) 双轨 | ✅ |
| no-secrets | span attr 约定:tenantId/solverKey/dataMode OK·**禁带 token/apiKey/password/credential 明文** | ✅ |
| 采样 | dev AlwaysOn / 生产 ratio 可配 | ✅ |
| 测试 | `tracing.test`(no-op 分支 + span smoke·在 datacore 829 内·亲跑)·evidence | ✅ |

## §3 一句话
**两单代码级核发。** dev 照审核方设计单忠实实现，审核方独立核实代码符设计 + datacore 829 回归绿(亲跑) + 诚实/不变量(R6/R2/R13/no-secrets) + 本体 G-14 回写。**dispatch→build→verify 闭环真转起来了。** 诚实边界:用户动作走查取 dev FDE(截图/collector trace)·审核方未独立起服务实拍——若需 🟢真闭(审核方亲手 curl 写回 + 起 OTel collector 看 trace)可再做一轮。REQ-LEDGER R31 → ✅已核发(代码级)。

## 本体引用与影响
- 链路:ACTUATE `决策→ActionDraft→R4→EXECUTED→WritebackAdapter(mock echo/erp stub)→writeback-echo→reconcile`;OBS 横切 `HTTP→OBO(traceparent)→solver span→...`。
- 不变量:R4/R6/R13/R2/no-secrets(两单均守)。断点:G-14(出站执行器·ACTUATE 回写)·可观测 span 树(OBS)。

---
*审核方核发（design+review·独立核实代码+829回归+诚实·用户动作走查取dev FDE·代码级非真起服务实拍）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*

---

## 追加轮（审核方历史审计·2.3）：ACTUATE 真服务 curl 闭环（原代码级 → 🟢）

上文诚实边界「审核方未独立起服务实拍」本轮补齐（真 datacore:4001）：
- create `采纳经营方案`（payload schema **真校验**·缺 schemeNo/scheme/targets 逐个 400 VALIDATION_ERROR）→ `PENDING_APPROVAL`。
- approver persona `approve` → **status=EXECUTED**。
- **MockWritebackAdapter 自动落 writeback-echo**：`GET /a/v1/writeback-echoes` count 0→1·ref=`MO-2026-3925`（确定性 hashString(draft.id)%9000）·writtenValue=payload。
链路 `决策→ActionDraft→approve→EXECUTED→MockWritebackAdapter→writeback-echo→reconcile`（G-14）真服务级转起。ACTUATE 达 🟢。
OBS：无 OTEL 端点→服务正常（no-op 不假导出=honest 降级活态）+ tracing.test no-op 绿·真 span 树需起 collector（低风险边界·观测非决策面）。详见 `docs/REVIEW-HISTORICAL-AUDIT-unverified.md §2.3`。
