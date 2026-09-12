# LOOP11 · 建设者 · 运营 · 阶段① 第 1 轮发言（每角色共 2 次，这是第 1 次）

| 报告头 | 值 |
|---|---|
| **base commit** | `ec1e707c`（PIN·全程未 rebase / 未 merge） |
| **取证时刻** | 2026-09-07T03:43Z – 03:53Z（UTC） |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **6618** |
| **取证环境** | 真后端 `SEED_DEMO=1` 内存模式，**命中端口 4831**（被他人 SIGTERM 后重起 **4877**）；禁 `VITE_MOCK`；全部 curl 取证 |

---

## 发言（≈200 字）

**论点：这套推演建得起来，但运营不下去 —— 三个断口全在输入侧。**

① **没人能喂**：demo 8 条连接 **8/8 `config.synthetic:true`**、**0 条带 `schedule.cron`** ⇒ `CONNECTOR_SYNC` 零注册（金丝雀 `conn-erp` 命中）；`sap_erp`/`salesforce_crm`/`generic_jdbc` 在 `createAdapter` 直接抛 "no adapter"。换真客户，**没有一条日更通道**。

② **起点是哈希不是实测**：种子世界 7,295 格 `measuredCells=0`，服务自述「凡拿它当起点算出的差值，量级不可当实测读」—— 营收 601.50 亿的敞口再大，起点非实测就预判不了财务。

③ **长期那一半没有载体**：`AdoptedMitigation` 台账 **0 条**；扰动查询全按 `sessionId`、**无跨会话路由** ⇒「避免再次发生」只能靠人记。卡点面板 `process.runtime` **defaultOn:false** 暗发，流程反推 **9/65** 有规则（正向金丝雀 P41 = 17 实例真可算）。

④ **换客户**：`industry-templates` 只回 **1 条**（battery/BUILTIN）+ `battery.ts` 6,618 行 ⇒ 传导核可原样搬，**模版与系数必须重建**。

---

## 证据索引（不计入 200 字·仅 file:line 与实测回包）

| # | 断言 | 实测出处 |
|---|---|---|
| ① | 8 条连接全合成、零 cron | `GET /a/v1/connections`：`总数=8 · synthetic:true=8 · 非synthetic=[] · 带schedule.cron=0`；金丝雀 `conn-erp` 命中 |
| ① | 5/11 连接器类型无适配器 | `connectors/registry.ts createAdapter` switch 仅 6 分支；`default` 抛 `'…has no adapter implementation yet'` |
| ① | 节奏层接了线没数据 | `synthetic/cadence.ts:18–23`；`opsSchedules.put` 全仓唯一写入方 = `opsteam/schedule.ts:52`（tenant_admin REST），synthetic 下 0 命中 |
| ② | tick0 全派生 | `GET /a/v1/sim/sessions` → `baseSnapshotOrigin.kind="DERIVED"`, `cells:7295, measuredCells:0, derivedCells:7295`, formula `round(hash01(objectId\|stateVar)×100)` |
| ③ | 采纳台账空 | `GET /a/v1/ontology/object-types/stats` → `AdoptedMitigation.count=0`（**接了线没数据**：`actions.ts:57` / `solvers/risk.ts:531` 已接 `risk_timeline`） |
| ③ | 扰动无跨会话入口 | 39 条唯一 `/a/v1/sim/*` 路由，扰动仅 `sessions/:id/perturbations`；`SimRepo.listPerturbations(tenantId, sessionId)`（`repo/repo.ts:470`）无跨会话签名 |
| ③ | 卡点面板暗发 | `features.ts:141` `{key:"process.runtime", defaultOn:false}` + `:274` 在 `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`；实测 `GET /a/v1/process-instances/stuck` → `FEATURE_NOT_FOUND` |
| ③ | 反推覆盖 9/65 | `process-definitions` 实测 **65** 条（金丝雀 P14 命中，65/65 有 carrierTypeKey）；`process/flow-rules.ts` 唯一 `processKey` 集 = {P25,P33,P34,P35,P41,P42,P43,P47,P51} = **9** |
| ③ | 正/反双金丝雀 | 正：`P41` → `available:true, instanceCount:17`（真从 `InterBaseTransfer` 反推）。反：`P14` → `available:false, kind:"NO_RECONSTRUCTION_RULE"`，服务自述「承载物 WinLossRecord 有 2 条实例，但没有任何一条反推规则…是『有单据、没规则』不是『没数据』」 |
| ④ | 唯一行业模版 | `GET /a/v1/industry-templates` → `[{"industryKey":"battery-manufacturing","source":"BUILTIN"}]`；`synthetic/builtin-templates.ts` = `[BATTERY_TEMPLATE]`；`synthetic/service.ts` 8 处 `industry === "battery-manufacturing"` 硬分支 |
| — | 业务量级（校准用） | aggregate 实测：Order **500** · Customer **20** · OrderLine **873** · Base 13 · Model 6 · **Material 仅 8** · 100 类型 / 12,849 对象 / **11 类型 0 对象** |

**该扔一档（挂不到有金额场景）**：11 个零对象类型中 `ProductionSchedule`/`ShiftPlan`/`WIPMove`/`WIPQualityCheckpoint`/`SparePartConsumption`/`OperatorAttendance`/`OperatorSkillCert` 追不到任何带金额的经营场景。
**追法金丝雀**：`Order`(500 单) → 营收 601.50 亿，追得到 ⇒ 我的追法成立，上面这一档是真追不到，不是我不会追。

**取证纪律留痕**：`object-types/stats` 首次解析用 `items/types` 取键，金丝雀 `Order` 报 0 ⇒ 判「我的取证坏了」而非「零类型」，改用真键 `stats` 后 `Order=500` 复活。另：`ProcessDefinition` 在 objects 表计数为 0，**不等于**流程层没播 —— 它落 `repos.processDefinitions` 专用表，实测 65 条（差点据此下反向结论）。
