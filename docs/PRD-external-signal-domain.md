# PRD · 外部域：环境信号一等对象化（EXT_SIG）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-16 |
| 取代/扩展 | 新建；接通本体 §8 断点意图外的"外部环境信号"缺口（规划体检/建议的敏感性输入无来源） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2 对象类型 / §3 数据链 / §10 域） · `docs/PRD-platform-foundry-aip.md` |

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：新增 `ExternalSignal`（环境信号：锂价/镍价/汇率/需求指数/政策/电价等，signalKey 为键）。
- **触及链路**（§3 数据→本体→推演链）：`Connector(EXTERNAL,mock_external) --produces--> RawDataset(external_signals) --materialize--> ExternalSignal`；`ExternalSignal --敏感性输入--> {plan_audit | plan_generate}`（P2 把信号接入规划体检/建议的敏感性，本期先一等对象化 + 可查）。
- **触及域**（§10）：新增 `external` 域（环境/市场信号，区别于内部经营对象）。
- **触及不变量**（§5）：**R2 tenant_id**（信号带 tenantId）；**R6 确定性**（mock_external 静态确定性，同步字节级一致）；**R5 no-secrets-echo**（外部源凭据 feedUrl/apiKey 加密落库）；**R13 结论可溯源**（信号带 source/asOf 新鲜度，供推演溯源引用）。
- **触及事件**（§4）：复用 `connection.sync_completed`（信号同步即触发下游失效）。
- **需走门禁**（§7）：`ontology:check`（ExternalSignal/external 域登记不漂）· `debattery:check`（信号值不内联进前端，走对象/连接器）· `prd:check`（本 PRD 入图）。
- **回写承诺**：落地回写本体 §2（ExternalSignal）· §3（外部信号链）· §10（external 域）。

## 1. 目标 / 非目标
**目标**：① 环境信号成为一等可查对象（domain=external，带 source/unit/asOf/trend）；② 新 EXTERNAL 连接器（mock_external 出厂样例 + external_feed/rest_api 真接入路径）把外部信号同步为 RawDataset→ExternalSignal；③ `GET /a/v1/external-signals` 可查。
**非目标（本期）**：信号→规划体检/建议的敏感性重算（P2）；信号时序（接 A8 时序，P2）。

## 2. 设计
- **连接器**：`mock_external`（category EXTERNAL，无配置，StaticAdapter）出厂样例信号；生产走 `external_feed`(feedUrl)/`rest_api`(url+apiKey)。
- **对象**：合成出厂期 `putAll("ExternalSignal", …, "signalKey")` 落 RawDataset(external_signals)+对象（domain external），origin 可溯。
- **端点**：`GET /a/v1/external-signals`（行级过滤 + tenantId）。
- **P2 敏感性**：plan_audit 读 ExternalSignal（如锂价→毛利、需求指数→需求）做 what-if 输入；generic-inference 通用 what-if 已具备克隆重算能力，可承接。

## 3. 验收
- 创建 mock_external 连接 → sync → raw-datasets 含 external_signals；合成租户 `GET /a/v1/external-signals` 返回信号（带 source/unit/asOf）。
- `pnpm gates` 四门绿；本体 §2/§3/§10 回写。
