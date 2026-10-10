# 轨M 增量0 · 三板块基线（真浏览器实拍 · 只看不改）

> HANDOFF-three-boards §2 增量0：起真 datacore+agentcore+前端（非 mock），真浏览器走三板块，实拍基线 +
> 复现"洛阳红色越线却受影响订单暂无数据" + 逐推演标 真/半真/假。这是"补完没把真改假/没新建并行"的标尺。

## 0. 环境（真跑·非 mock）
- datacore `:4001`（`SEED_DEMO=1` seed 42，demo 本体已是轨L chainMode 真链产出）· agentcore `:4002`（`DATACORE_BASE_URL=:4001`）· 前端 vite dev `:5173`（`VITE_DATACORE_URL=:4001`/`VITE_AGENTCORE_URL=:4002`）。
- 真登录 demo/admin/demo1234（LOGIN 200）。路由：驾驶舱 `/v/dash` · 规划体检 `/v/plan-audit` · 方案生成 `/v/plan-generate` · 项目沙盘 `/v/project-sim` · 预判看板 `/v/risk` · 订单全链 `/v/order-chain`。
- 实拍 7 张：`docs/evidence/three-boards-baseline/{dash,plan-audit,plan-generate,project-sim,risk,order-chain,luoyang-modal}.png`。

## 1. 逐板块基线（真浏览器所见）

### 1.A 经营驾驶舱 `/v/dash`
- **KPI 卡（真算·多为真）**：总产能 286.50GWh · 平均利用率 0.78 · 计划达成率 0.91 · 在手订单 24 · 需求 P50 132 万 · **毛利总额 40.27 万** · 物料现货缺口 876 吨 · 收入达成率 102% · 现金垫 C18 58 亿。
- **经营指标（目标 vs 实际·单一出处）**：需求达成率 95.3%/100% · 毛利率 16.4%/16% · 物料保障率 94.6%/100%（越线）。
- **根因归因 DAG**：RED 物料保障率（实际 94.6%/目标 100%/缺口 5.4%）→ KSF 物料齐套 → 长协与现货缺口（贡献 876：三元正极 654/电解液 222…）。**仅此 1 条根因链显性**（HANDOFF §1.A：现根因种子 **4 条**，母版要 **8 根源**）。
- **订单经营台账·逐单根因下钻**：**综合毛利率 16.1% · 24 单**（细分 全部/乘用车/储能/商用车）。
- **AI 对话栏**：❌ **驾驶舱无**（HANDOFF §1.A：母版有板块级 AI 栏；现 AgentCore QOS 已具，未接进驾驶舱·G-3）。
- **provenance**：KPI 卡有 ⓘ 悬浮，但是否每卡每数字接全 `Provenance`/`RuleRef`（公式/输入/来源/新鲜度/规则号）待增量2 逐卡核。

### 1.B 规划体检 `/v/plan-audit`（plan_audit·AUDIT 标真）
- 三段输出：**0 硬矛盾 / 5 软风险 / 2 建议**（评分 65/100）。软风险逐条带规则号 + 一键应用：X03 毛利结构 C15、X04 物料齐套 C06/C16、R01 结构偏离 C21、E01 外部·原料成本 C24、E03 外部·客户信用 C13。建议 S-X03/S-物料齐套。
- 母版差距（HANDOFF §1.B）：命名校验 **X01–X05** 仅见 X03/X04（缺 X01/X02/X05 全序）；"反事实排除层"未见；"项目级聚合勾稽表（Σ=−0.4 闭合）"未见。

### 1.C 方案生成 `/v/plan-generate`（plan_generate·AUDIT 标半真）
- **3 案**：壹稳健（路径A·72分·收入增12%/毛利17.4%/份额24%/CAPEX0/现金64）· 贰均衡（路径D·75分·★推荐·收入增16%/毛利15.5%/份额30%）· 叁进取（未展开）。
- 每案：**五维雷达**（盈利/规模/现金/增长/稳健）+ **取舍矩阵**（得/舍）+ **外部信号敏感性**（竞争/舆情/碳酸锂+9.8%）+ KSF 图 + 目标达成清单（✓/✗ vs 硬约束）。**渲染已较完整**（HANDOFF 说"偏简"，实测三案+雷达+矩阵+敏感性都在）。
- 母版差距：收入增/份额"魔法基线"（AUDIT 假7：PlanGenerateView (rev−100)%/(share−17)pct 写死基线）待核；风险传播链待补。

### 1.D 项目沙盘 `/v/project-sim`（ProjectSim·六步）
- 订单列表 + 六步 stepper（①场景解析→②可产基地收敛→③驱动因子装载→④逐级聚合P50→⑤瓶颈定位→⑥结论）。①场景解析显字段/值/来源校验（型号/需求量/交付窗口·规则 C10）。P50/P90 真算（AUDIT 标半真：P50/P90 真、**紧张度色块假**）。
- 母版差距 + AUDIT 假2：⑤瓶颈定位的"聚合产能紧张度/主瓶颈"裸 import `mockTightness`（绕开 risk.ts LIVE 判别），色块红/橙为 mock，无 dataMode。

### 1.E 预判看板 `/v/risk`（RiskBoardView·洛阳活体反例）— 见 §2
### 1.F 订单全链 `/v/order-chain`（三关联判 + 经营数据看板）
- **三关联判**：选单 → ①交期判（可达 P90 1890 vs 需求 8·C02/C03）②齐套判（缺三元正极 654 吨·C06/C16）③财务判（信用阻断·毛利18% vs 底线12%·C15/C13/C18）→ 统一结论"不建议接·信用占用超限"。判定真（接现有 capacity/MRP/credit + 规则）。
- **经营数据看板（AUDIT 假3·前端现编）**：按细分/基地表 — 乘用车 成品库存 69.4 亿/在制 93.2 亿/原料 56.9 亿/毛利率 18.0%；储能 41.4/55.3/34.0/13.0%。**这些库存/毛利率是前端 `OrderChainView` 写死系数 + `hashN(so)` 现编**（库存=营收×(系数+哈希×系数)），非后端真算、无 dataMode。
- 规则号渲染：三判表规则列（C02/C06/C15…）—— AUDIT/SPEC 指出 `ruleRefs.join("/")` 部分裸文本（C02 悬浮无反应），待接 `RuleRef`。

## 2. 🔴 洛阳活体反例复现（真浏览器 + API 双证）
**现象**：`/v/risk` 上**洛阳多卡红色越线**——洛阳·物料齐套 峰值 90 越线日 D+14、洛阳·物流时长 90 D+14、洛阳·人力工时 92 D+19（⚠首要风险）、洛阳·瓶颈工序 91 D+21（实拍 `risk.png`）。

**根因（API 取证）**：
- `POST /a/v1/solvers/risk_timeline/invoke` 输出顶层键 = `{data, snapshotVersion}`，**无 `dataMode`**——洛阳 peak 90/crossDay 14 渲染成红**零披露**。series 峰值 90 = `mockTightness` charCode 哈希（risk.ts:28-38：`88+seed%9`∈[88,96]，洛阳恒红），**与真实 OEE/利用率/良率/订单无关**。
- `POST /a/v1/solvers/bottleneck_matrix/invoke`（前端不传 LIVE）→ `dataMode: undefined`（**永远 MOCK 路径**，AUDIT 半真#3 坐实）：洛阳 tightness {瓶颈工序:67,设备OEE:67,人力工时:68,物料齐套:68,物流时长:68,换型损失:67,良率波动:90}。
- 点洛阳卡 → 逐日张力详情（`luoyang-modal.png`）：事件含 SO-3470（电网公司F·交付高峰），但 `AffectedOrdersModal`（RiskBoardView.tsx:381）按 `searchObjects("Order",{base:洛阳,day})` 查**精确基地+日**的受影响订单 → 洛阳窗口内真订单≈0 → **受影响订单表暂无数据**。

**坐实**：红是 charCode 哈希恒红（mock），受影响订单是真查（空）——**"红了却无数据"= 假推演冒充真**，正是用户报的活体反例。

## 3. 逐推演标 真/半真/假（对 `AUDIT-fake-simulation-inventory.md` 7 项·LIVE 复核）
| # | 视图/控件 | AUDIT 判 | 本次 LIVE 复核 | 标 |
|---|---|---|---|---|
| 假1 | 风险看板红卡/峰值/越线日（`/v/risk`） | 假 | risk_timeline **无 dataMode**，洛阳 peak 90 恒红（charCode） | **假**✓坐实 |
| 假2 | 项目推演紧张度/主瓶颈（`/v/project-sim` ⑤） | 假(色块)/半真(P50/P90) | capacity 裸 import mockTightness，色块无 dataMode（待逐步点开复拍） | **假**（色块） |
| 假3 | 订单全链 库存/毛利率（`/v/order-chain`） | 假 | 经营数据看板 成品库存/在制/原料/毛利率 = 前端 hashN+写死系数现编，无 dataMode | **假**✓坐实 |
| 假4 | 传导链"财务击穿"敞口（PropagationTimeline） | 假 | 组件孤儿未挂载；写死 0.6万/套（待挂载点复核） | **假**（孤儿） |
| 假5 | 驾驶舱综合毛利率兜底（`/v/dash`） | 假/半真 | 台账综合毛利率 16.1%；未知细分兜底 {price:0.6,margin:13}（DashboardView:180） | **半真**（兜底分支假） |
| 假6 | 空对象 deriveExtendedArgs 现编输入 | 假 | `extended.ts:472/477` 写死 series（后端·非本次浏览器面） | **假**（后端） |
| 假7 | 方案生成 收入增/份额魔法基线（`/v/plan-generate`） | 假/半真 | 三案收入增 12/16% 等显示；(rev−100)/(share−17) 写死基线待逐值核 | **半真** |

> 诚实披露通道现状（AUDIT §3）：仅 `bottleneck_matrix.dataMode`（且前端不传 LIVE→永 MOCK）、QOS `unverifiedNumerics`（只在对话坞）、租户"合成数据"水印（顶栏级）——**没有一个覆盖 8 个推演视图的红/黄状态与财务数字**。

## 4. 增量1 起点（真推演红线·可信地基）
按 HANDOFF §2 增量1 优先修 §1.E/§2/假1：**`risk_timeline`/`capacity_forecast` 输出 schema += `dataMode`** + 前端红/黄消费 dataMode 显"估算/无数据"诚实标 + 洛阳红越线须真数据支撑或诚实降级（抄 `capex_scenario` 缺数抛错 + `LedgerView` 逐格 Provenance）。**本增量0 只看不改，无代码改动。**
