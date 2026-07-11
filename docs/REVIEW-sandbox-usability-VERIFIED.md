# 审核方一手复验 · 推演沙盘可用性（修正 REVIEW-sandbox-usability-rootcause.md）

> **这是什么**：审核方**独立真起服务、真登录 demo、真开 `/v/sim-sandbox`、真推 tick、真看 UI 逐值对照后端**（非采信 Dev-3 doc）后的一手裁定。证据：`docs/evidence/usability-realrun-{00..05}.png`（commit 58855835）。
> **一句话**：**标准页 out-of-box 机械上可用（四步 4/4 可过·引擎真跑·DAG 真变）；Dev-3 doc「四步全断/不可用」夸大了**——RC-1 精确属实，RC-2/RC-3 被一手证据部分证伪。真缺陷是 **UX/感知层**（KPI 磁贴恒 0 + 门文案劝退 + 系数未校准饱和），不是「引擎坏/静止零/被锁死」。
> **登记日**：2026-07-11 · 审核方（钉死：一手真跑·不采信二手·不作假）。

---

## 1. 四步可用性判据（admin 开→不配置→试跑→tick见变→拿结论）

| 步 | 结果 | 一手证据 |
|---|---|---|
| ① 开沙盘 | ✅ | 正常渲染；顶部即出 capacity_forecast（2170-NCM P50 7.0/P90 6.6/缺口 33.4 万套/主瓶颈 设备OEE）+ 逐基地紧张度（武汉51/厦门75/自贡59 实测） |
| ② 不配置试跑 | ✅ | 「推进 tick」按钮 `disabled={!sessionId\|\|ticking}`，**不**门控 canEnterSimulation；点击 DORMANT→ACTIVE·推进 3 tick |
| ③ tick 见基地态真变 | ✅（有坑） | Base DAG 节点 **Σ0 → Σ358620**、变红；Model 节点同步亮。**但 KPI 磁贴「负载指数 0.0」→「0.0」不变**（=Dev-3 判「死的」的根源） |
| ④ 拿决策结论 | ✅ 部分 | capacity_forecast 缺口 33.4 万套 + 逐基地紧张度即决策结论（免 tick）；tick 传导真跑但系数未校准、loadIndex 多顶 clamp 2M，诚实标「量级仅供参考」 |

**结论**：标准页机械 4/4 可过。真缺陷 = UX/感知，非引擎。

## 2. RC-1 地面真值（精确·施工单照此·Dev-3 此条完全准确）

cert(GLOBAL)：`L1_CONFIGURED · canEnterSimulation=false · worldCompleteness=100% · trialTick{passed,rulesFired=3} · l4Checks{fanoutSafe✓ writebackComplete✓ observabilityMet✗} · dims{structure100 knowledge25 behavior14 composite52}`。

gaps 恰 4 条：
- `closure:FORWARD` C24→**Quote** scope 类型缺失（HARD）
- `closure:FORWARD` C45→**Action** scope 类型缺失（HARD）
- `closure:FORWARD` C50→**Action** scope 类型缺失（HARD）
- `GLOBAL` 图查询覆盖 40/43·切片 48<minQueries 1（observabilityMet=false）

**缺的类型（核过 43 类本体 + BATTERY_RULE_SCOPES）**：只需补 **2 个对象类型 `Quote` / `Action`**（C24 scope=[Quote,DemandSegment]·DemandSegment 已在；C45=[ScenarioTrigger,Action]·C50=[DataSourceHealth,Action]·其余都在），或把 C24/C45/C50 重归到已有类型。
**observability 40/43 未覆盖的 3 类**：`ErpOrder` / `MesOrder` / `SrmOrder`（无切片以其为 root）。
**因果**：forwardMissing=3 → closure.gatePassed=false 且卡 L1；observabilityMet=false 独立挡 L4。`canEnterSimulation=L4∧trial∧gate` 要真 = true，**两件都得修**：补 Quote/Action + 给 ErpOrder/MesOrder/SrmOrder 建切片。

## 3. RC-2 部分证伪（引擎真跑·非静止零）

按 `deriveBaseSnapshot(view-config)` 建 session（575 对象·102 非零·3 条 PUBLISHED 传导规则）推 3 tick：`Base.loadIndex` 0→梯度（多顶 clamp 2M·luoyang/xinyang 842481·wuhan/xiamen/zigong 1.94M）；`Model.demandLoad` 0→区分（方形-LFP 6.216/4680-NCM 4.776/2170-NCM 2.16/…）。UI Base DAG「Σ0→Σ358620」。**「静止零·推了等于没推」证伪。** Dev-3「基地态{}空全0」来源：(a) 用空 baseSnapshot 建 session→确实零；(b) **KPI 磁贴 carrierMean 只认原始快照载体，传导目标变量无载体 → 磁贴恒 0.0**（主视觉 DAG 真变）。真缺的是**一个已校准、有冲击的默认场景**（现跑 baseline 冷启动系数·偏饱和）——Dev-3 深层担忧有部分道理。

## 4. RC-3 半对（劝退真实·硬挡机制层不成立于标准页）

DOM：「✗ 暂不可进入推演」「尚不可推演——已配置但就绪认证未达标（缺：前向闭合、图查询覆盖不足）」`L1_CONFIGURED`·雷达综合 52。文案确实劝退。**但标准页 tick 未被挡**；真正 `disabled={!canEnterSimulation}` 的「进入推演」按钮在 **SimInitWizard（左栏另一入口）**，不是 `/v/sim-sandbox`。

## 5. 入口区分（关键）

- **标准页 `/v/sim-sandbox`**：无需 LLM·确定性·开箱即用（带 UX 坑）✅
- **聊天内联沙盘（S1 sandbox_render）**：shock 问句 out-of-box **FAILED `LLM_PURPOSE_UNBOUND`**——free-text 走 Path B agent 需 LLM，未绑 provider 就产不出内联沙盘 ❌。两条路可用性截然不同。

## 6. 修复排序（据一手真值·派 RC WO）

| WO | 域 | 优先 | 判据 green→red |
|---|---|---|---|
| **WO-RC1-CLOSURE-SCOPE** 补 Quote/Action 类型(或重归 C24/45/50 scope)+给 ErpOrder/MesOrder/SrmOrder 建切片 | 数据/本体·Dev-1 | **P1 硬前置** | closure.gatePassed=true + observabilityMet=true → cert 亮「✓ 可进入推演」 |
| **WO-RC-UX-KPI-CARRIER** KPI 磁贴反映传导目标 post-tick 态（现 carrierMean 只认原始载体→loadIndex/demandLoad 恒 0=「死的」错觉根源） | 前端(+后端 carrierMean) | **P1 感知** | tick 后磁贴数字随 DAG 真变（现恒 0） |
| **WO-RC-UX-DOOR-TEXT** 门文案「暂不可进入推演」→「未校准·可试跑·结论仅供参考」（标准页本可推） | 前端 | P2 感知 | 未认证态显「可试跑」非「不可进入」 |
| RC-2 已校准默认冲击场景（现 baseline 冷启动饱和） | 数据/S6 | 待 S6 复验定 | 与 WO-IMPORT-SCENARIO-LAUNCHER-WIRE + S6 ExogenousFeed 协同 |

> **另记**：新克隆环境 `datacore` 缺 `jszip` 依赖→首次 build 失败，`pnpm install` 后 4 包全绿——真实 out-of-box 卡点（DEPLOY/CI 应显式 `pnpm install`）。

## 7. 对「作假」质疑的一手回答

我经手的 S 系列复验是**真跑真绿·非假**（页面机制确实工作）。漏的是**没有一单、也没有我，去复验「用户体感这页能不能用」这层 UX**——KPI 磁贴看着死、门文案劝退、系数未校准。这仍是「真的当用户用一遍」我该更早做的失职，**但问题比 Dev-3 画的轻**（机制真能用·非引擎坏）。既不否认覆盖缺口，也不接受被夸大的「不可用」叙事——以上四步逐值为凭。
