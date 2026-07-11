# FDE 证据 · WO-SANDBOX-TRUST-BADGE-BE（S2 后端半 · Dev-1）

沙盘每数字 `dataMode` 后端透传：把**已存在的诚信信号**（`obj.origin` 血缘 + C09 关键源新鲜度）
透传成 view-config `nodeObjectMode` 与 tick 响应 `dataMode` 汇总位。**纯派生·不发明新档·不伪造 LIVE**
（KILL-MOCK-RED 同源）。暗发 `sim.trust_badge`（datacore `features.ts`·defaultOff·requires `sim.sandbox`）。

## 铁律 0 · 本体引用与影响
- 对象类型：`ObjectInstance.origin`（既有·SYNTHETIC/MATERIALIZED/MANUAL…）、`DataSourceHealth`（C09 新鲜度源）。
- 链路：`GET /a/v1/sim/view-config`（+`nodeObjectMode`）、`POST /a/v1/sim/sessions/:id/tick`（+`dataMode`）。
- 不变量：R6（纯派生·同输入双跑字节一致·按需派生不落库→pg/memory 一致）、R13（溯源·血缘透传）、KILL-MOCK-RED（无真值不发→前端 UNKNOWN 兜底·绝不假标 LIVE）。
- 门禁：`sim:check` / `genuine-sim:check` / `sim-readiness:check` / `feature-parity:check`（sim.trust_badge datacore-only·不入 enforced 消费键·与 sim.sandbox/propagation 同型）。

## 判据（复用既有信号·零新造）
- **origin 血缘**：`obj.origin.type === "SYNTHETIC"` → SYNTHETIC（合成血缘·不冒充 LIVE）。
- **关键源新鲜度**：C09 同判据（`solvers/service.ts`）——任一 `DataSourceHealth.critical` 源 `lagHours > staleHours` → 真对象值降 STALE。
- **真对象 + 源新鲜** → LIVE。
- **汇总位（tick.dataMode）**：worst-mode（RANK `LIVE<UNCALIBRATED<SYNTHETIC<STALE`）——恒诚实·绝不高于最弱输入档。

## teeth（test/sim-trust-badge.test.ts · 5/5 绿）
| 齿 | 断言 | green→red |
|----|------|-----------|
| ① | 合成租户全数字 → `nodeObjectMode` 逐位 SYNTHETIC·零 LIVE | 若透传丢失/假标 LIVE 即红 |
| ② | 某对象翻真接入 origin(MATERIALIZED) → 其格 SYNTHETIC→LIVE·其余不污染 | 若写死/不真派生即红 |
| ③ | 真对象 + 关键源 `DataSourceHealth.critical` 滞后(C09) → 其格 STALE | 若不接 C09 判据即红 |
| 关闸 | `sim.trust_badge` OFF → view-config 无 `nodeObjectMode`·`stateVars`/`nodeObjectState` 字节一致 | 若非 additive 即红 |
| R6 | 同 session view-config 双跑逐位一致 + tick 汇总位=SYNTHETIC | 若非确定性即红 |

## 门 / 构建
- `pnpm --filter @platform/contracts build` · `pnpm --filter datacore build`：绿。
- `sim:check` / `genuine-sim:check`(exit 0) / `sim-readiness:check` / `propagation:check` / `feature-parity:check`(exit 0·sim.trust_badge datacore-only 正确不入 enforced) / `no-fake-data:check` / `no-silent-mock:check` / `ontology-writeback:check` / `ontology-slices --check`：全绿。
- datacore 全量测试：见 §收口（TRUST-BADGE + S3 合并态一次干净跑 EXIT=0）。

## 真起服务 FDE（铁律 0.4·真跑真数据真看结果·2026-07-11）
真起 `apps/datacore/dist/server.js`（PORT=4071·SEED_DEMO=1·内存仓储）→ curl demo/admin：
- `GET /a/v1/sim/view-config` → `nodeObjectMode` **102 对象 / 102 格·tally={"LIVE":102}**；demo 走真建模链（轨L）→ origin=MATERIALIZED·无关键源滞后 → 诚实 **LIVE**；逐格对应 `nodeObjectState` 真数值（`每个mode格有真数值? true`·透传非凭空造位）。
- `POST /a/v1/sim/sessions/:id/tick` → 响应 `dataMode: "LIVE"`（worst-mode 汇总·恒诚实）。
- STALE 路径由齿③（关键源 critical 滞后 → STALE）+ SYNTHETIC 路径由齿①（合成租户 → SYNTHETIC）在测试层真跑覆盖。

## 诚实边界
- `UNCALIBRATED` 由前端从 `propRule.coefficientRef` 空自派生（Dev-3 域·非本端职责）；本端只发 origin/dataHealth 真判据能确定的三档。
- 无真值的格**不发位** → 前端 UNKNOWN「来源待披露」兜底（绝不假标 LIVE）。
