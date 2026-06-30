# 审核复验 · WO-DM keystone 收尾（全 46 求解器 dataMode + no-silent-mock 门）· 闭合带 1 发现

> 提交物 `13ad9fe`「dataMode 推广全 46 求解器 + no-silent-mock 门」。在 A0（`3f0d30c`·audit_timeline+14 extended，审核方已核发 `70a502a`）之上收尾全求解器契约层诚实位 + 专门门。审核方真起 datacore 逐 invoke + 对抗式撤回独立复验。

## 一句话结论

**✅ 结构机制闭合（全 46 带 dataMode·门真咬·hollow 不被洗白），带 1 个诚实精度发现（P2·非阻断）**：`invoke` wrapper **缺 dataMode 默认 LIVE** 的策略，对「真对象+魔数混合」求解器（实例：`order_fullchain` 交期判 `bases.length*700`）发 LIVE，标准弱于 A0 的逐例分类（同类混合在 A0 被标 PARTIAL）。建议并入 WO-DM-tail：default-LIVE 审计 → 混合求解器改判 PARTIAL。

## 已坐实（结构机制·真跑）

| 项 | 状态 | 证据 |
|---|---|---|
| 全 46 求解器输出带 dataMode | ✅ | `no-silent-mock:check` 导入 dist 校验 46 形状均含 dataMode·绿；append loop 运行期为每形状追加 |
| 门真咬（非门面） | ✅ | **对抗撤回**：抽掉 append loop → 重建 datacore → 门红（capacity_rollup/affected_orders/… 缺 dataMode）；还原+重建 → 复绿 |
| hollow 求解器不被 wrapper 洗白 | ✅ | 真跑 `audit_timeline=PARTIAL`·`yield_diagnosis=MOCK`·`quote_margin=PARTIAL`（invokeRaw 已自置 → wrapper `=== undefined` 跳过，未覆成 LIVE） |
| PROVISIONAL 沙箱 = PARTIAL | ✅ | `invokeArtifact` 前置 `dataMode:"PARTIAL"`（未审核不冒充 LIVE）·读源坐实 |
| 默认 LIVE 求解器真 emit | ✅ | 真跑 capacity_rollup/plan_generate/mrp_netting/finance_pnl/metric_rollup/order_fullchain 全 `LIVE` |
| 默认 LIVE 抽检诚实性 | ◐ | `finance_pnl` **诚实 LIVE**（读 FinancePlan/DemandSegment 真对象·零魔数）；`order_fullchain` **LIVE 但含魔数**（见发现） |
| 回归不破 | ✅ | `pnpm -r build` 4 包绿；本会话 datacore 786 / frontend 289 绿（A0 同基线·本单 additive） |

## 🔎 发现（F-DM-KS-1·P2·诚实精度·非阻断）

**默认 LIVE 策略对「真+魔数混合」求解器发 LIVE，与 A0 逐例分类口径不一致，造成 LIVE 轻微过度宣称。**

- **机制**：`SolverService.invoke`（service.ts:1580）`if (out.dataMode === undefined) out.dataMode = "LIVE"`。hollow（audit/extended）+ PROVISIONAL 已自置 → 跳过；其余 ~25 求解器无 dataMode → **一律 LIVE**。
- **坐实实例**：`order_fullchain`（service.ts:938）三关联判中——②齐套判（MaterialBalance 真 gapTon）③财务判（DemandSegment marginPct/floorPct + Order creditUsedRatio 真对象）确为真；**但 ①交期判 `const weeklyBase = Math.max(1, bases.length) * 700; p90 = weeklyBase * 0.9`（service.ts:958-960）是写死魔数**（注释自承"确定性代理"）。该求解器整体被 wrapper 标 **LIVE**。
- **为何是发现**：A0 的 `extendedDataMode` 对**同类「真输入+魔数兜底」**（如 `quote_margin`：bom 真、price/logistics 魔数）严格标 **PARTIAL**。keystone 的 default-LIVE 对 `order_fullchain`（真 margin/credit/kit + 魔数 delivery baseline）却标 LIVE——**两层用了不同诚实标准**。WO-DM 的命门正是"魔数不得冒充真算"，而交期"可达/紧张"结论由 700/周魔数得出却标"实测"，恰是该 WO 要防的轻度复现。
- **门为何抓不到**：`no-silent-mock` 是**结构门**（校验形状含 dataMode 字符串），无法判 dataMode **值**是否诚实——值精度靠人工/真跑。
- **建议（非阻断·并入 WO-DM-tail #8）**：
  1. default 由 LIVE 改 **PARTIAL**（fail-safe 方向：未显式判定 = 不敢保证全实测），或
  2. 保留 default-LIVE 但**逐一审计 ~25 默认 LIVE 求解器**，对含魔数/启发内核者（已知 `order_fullchain` delivery baseline）显式置 PARTIAL；rollup/聚合类（metric_rollup/mrp_netting/finance_pnl·注释"活数据聚合·非写死"）经抽检可留 LIVE。
- **诚实边界**：审核方抽检 2/~25（finance_pnl 净 LIVE·order_fullchain 混合），未穷举全 25；该精度审计本属 dev 已声明延后的 "WO-DM-tail 底层值接真源"，本发现是把它**从"换真源"细化为"先把 LIVE 标到名副其实"**。

## 评价（不否定本单价值）

dev 的「append loop 自动补形状 + wrapper 兜底」是**务实的 46 全覆盖工程**（避免手改 46 行漂移），且谨慎处理了两类需降级的（hollow 自置、PROVISIONAL=PARTIAL）。结构性"每求解器都有诚实位"目标**已达成**。本发现仅指出 default 方向选了 trust-by-default（LIVE）而非 fail-safe（PARTIAL），在少数混合求解器上轻微过度宣称——P2 精度问题，不动结构。

## 本体引用与影响

- **不变量**：R13（溯源/诚实位）——结构层全族收口；**值层诚实精度**留 F-DM-KS-1。R6 确定性不破。
- **断点**：hollow-data 冰山 §A0 结构根因**闭**；值层精度（default-LIVE 过宣称）= 新登记 F-DM-KS-1 → WO-DM-tail。
- **门禁 §7**：`no-silent-mock:check` 纳入 `pnpm gates`（结构门·已验真咬）；值精度门（判 dataMode 值是否名副其实）非静态可得，靠真跑抽检。

---
*审核方独立复验（design+review·真跑+对抗撤回为据·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
