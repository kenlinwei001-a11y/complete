# AUDIT · 假推演全清单（前端展示的推演结果哪些是 mock/写死/哈希冒充真算）

> **缘起**：用户发现"风险预演看板洛阳红色越线,点进受影响订单却暂无数据——没数据怎么推成红的?是写死吗?还有哪些假推演?"。对抗式审计(默认每个推演结果"假",沿 求解器→契约 schema→前端像素 取证,确定性脚本复算)结论如下。
>
> **一句话**：平台只有 **3 个诚实披露通道**(`bottleneck_matrix.dataMode`、QOS 答案 `unverifiedNumerics`、租户级"合成数据"水印),**没有一个覆盖 8 个推演视图的红/黄状态与财务数字**。多数推演输出 schema **根本没有 dataMode/mock 字段**(`RiskTimelineOutputSchema`/`PlanAuditOutputSchema`/`CapacityForecastOutputSchema`),前端即便想标也无从标。**更严重:3 个视图在前端用写死系数+字符串哈希现编财务数字,配红色当真值渲染。**
>
> **但平台也有诚实典范**(capex 抛错不造假 / LedgerView 逐格 Provenance)——修复有现成范式可抄,不是推倒重来。

---

## 1. 决定性证据：红状态可在"零真实数据"下产生

`solvers/risk.ts:28-38` `mockTightness` 主因子分支：
```
seed = (基地名首字 charCode + 因子名首字 charCode × 7) % 9
return min(97, 88 + seed%9)   // 恒落 [88,96]，永远 ≥ 阈值 85（红）
```
**主因子紧张度只取决于基地名汉字编码,与 OEE/util/良率/订单/设备完全无关。** 确定性复算证实 **全 12 基地主因子在 `bottleneck_matrix` 网格上都红**(常州90/江门96/…/洛阳90)。

**洛阳坐实**：洛阳窗口内真订单可为 0(SO-3470→luoyang 仅 1 单且压价、SO-3529→xinyang),但洛阳的红 **完全独立于订单**——`mockTightness` 哈希恒红;点红卡→`AffectedOrdersModal`(`RiskBoardView.tsx:381`)`searchObjects("Order",{base,day})` 查真订单→空→`:410` 暂无数据。`RiskBoardView.tsx:24` `invokeSolver("risk_timeline",{})` 不带 dataMode,`RiskTimelineOutputSchema`(`contracts/solvers.ts:107`)无 mock 字段→**用户看到的红峰值/越线日/heat 100% 来自 charCode 哈希,零披露**。

---

## 2. 假推演清单（假类排前 · 按用户最可能误信排序）

| # | 视图/控件 | 假在哪(锚点) | 类别 | 前端披露 |
|---|---|---|---|---|
| **🔴假1** | **风险看板 红卡/峰值/越线日** | 基线=`mockTightness` charCode 哈希(`risk.ts:28-38,185,230-238`);前端 `RiskBoardView.tsx:67,79,110,124` 红/黄当真值 | **假** | **无**。schema 无 dataMode,调用不请求 LIVE |
| **🔴假2** | **项目推演 聚合产能 紧张度/主瓶颈** | `capacity.ts:4,235-236` 裸 import `mockTightness` 作 tightness/mainBn,**绕开 risk.ts 的 LIVE 判别**(有真 OEE 也不看);前端 `ProjectSimView.tsx:758,762,485,545` 红/橙 | **假**(紧张度色块)/**半真**(P50/P90 真算) | **无**(仅 degradeNote 讲 IoT 新鲜度,非"合成") |
| **🔴假3** | **订单全链 在制/成品/原料库存 + 毛利率** | **前端现编**:`OrderChainView.tsx:30` 写死系数+`:35` `hashN(so)`+`:111-119` `库存=营收×(系数+哈希×系数)`;展示 `:261-279` | **假** | **无**(`debattery-allow` 是内部豁免标,用户看不到) |
| **🔴假4** | **传导链"财务击穿"敞口** | **前端写死** `PropagationTimeline.tsx:60` `0.6万/套`;`:95` "延误敞口约X亿"`:96` `≥1亿`触发红;`PlanGenerateView.tsx:382` 复用 | **假** | **无**("估算"只在注释,不渲染) |
| **🔴假5** | **驾驶舱 订单台账 综合毛利率** | 前端 `DashboardView.tsx:180` 未知细分兜底 `{price:0.6,margin:13}`;`:183-185` 客户端算 gmRate;`:193,149` 显 | **假/半真** | **无**(无"估算"限定词) |
| **🟠假6** | **空对象时 deriveExtendedArgs 现编输入→下游出红结论** | `extended.ts:413-492`:`:472` maintenance_stagger **全写死** loadByWeek/peakWeeks;`:477` yield_diagnosis **全写死** series(保证"找到"day33 断点);`:434/461` lta_gap/credit 从 `{}` 编数 | **假** | **无**(经 mitigation_select 等进各控件,与真算无法区分) |
| **🟠假7** | **方案生成 收入增/份额 魔法基线** | 前端 `PlanGenerateView.tsx:234` `(rev−100)%`、`:236` `(share−17)pct` 写死基线当头条增长 | **假/半真** | **无** |

**根**：`solvers/types.ts:243-249` `num`/`str` 静默 fallback(缺数→默认值)是所有"缺数变默认值"的总源。

---

## 3. 半真（后端有标但埋/不覆盖）

| 项 | 标在哪 | 问题 |
|---|---|---|
| 多维瓶颈矩阵 `dataMode` | `risk.ts:70,84-90` 返 LIVE/MOCK,前端 `ProjectSimView.tsx:464` 显 | **唯一**诚实字段,但埋弹窗脚注+裸字段名;且前端只传 `{baseIds}` 不传 LIVE→**网格永远 MOCK** |
| 产能 C09 降级 `degradeNote` | `capacity.ts` | 讲 IoT 新鲜度,非"这是合成" |
| QOS 答案 `unverifiedNumerics` | `AnswerCard.tsx:51-53` "部分数字未溯源,仅供参考" | **只在对话坞,不在 8 个推演视图** |
| 租户"合成数据"水印 | `ShellLayout.tsx:295,308` | 顶栏租户级,**不绑任何推演结果** |

---

## 4. 真算典范（对照组 · 修复抄它们）

- **`capex_scenario`(`capex.ts:152-278`)典范**:空 demand **抛错不兜底**;IRR 发散 **抛 `IRR_DIVERGED` 而非编个像样的数**;全中间量回显可审计。
- **`LedgerView.tsx` 典范**:不算不上色,**逐格 `<Provenance>` 可溯到源表/行/连接器**——其他视图本该学的范式。
- `plan_audit`(规则引擎跑入参,`why` 透明)/ `plan_generate`(config 驱动回显 base/targets)/ `computeRollup`/`deriveS0`(真读对象,缺数退 **0** 不是假高值)/ `plan_rootcause`/`metric_rollup`/`cockpit_kpi`(读一等对象,空则**抛错要求先合成**,不静默编)。**真**。

---

## 5. 修复模式（融合优先 · 抄典范）

1. **schema 加诚实字段**:每个推演输出 schema += `dataMode:"LIVE"|"MOCK"|"PARTIAL"` 或逐数 `provenance`(来源/是否估算)。`RiskTimelineOutputSchema`/`CapacityForecastOutputSchema`/… 现在全缺。
2. **前端必显**:红/黄状态、财务数字**凡 mock/估算必带可见标**("估算"badge/灰显/"无真实数据")——不再裸渲染成与真算无差别。抄 `LedgerView` 逐格 Provenance、QOS `unverifiedNumerics` 条。
3. **杀前端现编财务**(假3/4/5/7):`OrderChainView` 库存、`PropagationTimeline` 0.6万/套、`Dashboard` 兜底毛利率、`PlanGenerate` 100/17 基线——**移到后端求解器真算或诚实标估算**,前端不得用 `hashN`/写死系数现编财务。
4. **缺数抛错而非编**(假1/2/6):抄 `capex_scenario`——无真数据时**抛错或返回 dataMode:MOCK**,不让 `mockTightness`/`deriveExtendedArgs` 写死值无声进红结论。`capacity.ts` 改用 risk.ts 的 LIVE/MOCK 判别(别裸 import `mockTightness`)。
5. **根**:`types.ts num/str` 静默 fallback 评估是否该在推演路径上"缺数→抛"而非"→默认值"。
6. **门**:加 `genuine-sim:check`——静态扫"推演输出 schema 无 dataMode"+"前端红/黄渲染未消费 dataMode"+"推演组件内 hashN/写死系数算财务",防回潮。

---

## 6. 红线 + 真值判据

- **红线**:推演结果(红/黄/财务数字)**要么真算可溯、要么诚实标估算/无数据**;**禁 mock/哈希/写死无声冒充真算**;禁前端 `hashN`/写死系数现编财务。
- **真值判据(FDE)**:① 点任意红越线日→**要么有真受影响订单、要么卡上诚实标"估算/无真实数据"**(洛阳不再裸红空数据) ② 抽查任一推演红/黄/财务数字→能对到后端真值或带可见估算标 ③ `bottleneck_matrix` 不再"永远 MOCK"(前端请求 LIVE,有真数据走真算) ④ 杀掉假3/4/5/7 前端现编财务。

> 这份是 `HANDOFF-three-boards-html-alignment §3 R1` 真推演红线的**权威清单**;dev 照本表 7 项逐条修+抄 §4 典范。
