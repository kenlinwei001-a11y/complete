# 复验 DATAMODE-SWEEP（1572b8c）→ 窄 BLOCK（主扫齐达标·2 残余点补齐即 DONE）

审核方真跑复验（clean vite serving 1572b8c + curl 后端 + 真浏览器 6 面 getComputedStyle 对抗查假 + 截图）。

## ✅ 已达标（credit·别返工）
- **C1 后端**：affected_orders/plan_rootcause/plan_audit/plan_generate/order_fullchain 顶层 dataMode=SYNTHETIC（capacity_forecast 经 ProjectSimView 真参亦 SYNTHETIC）。
- **披露横幅全 present**（自定义 testid oc-/ofc-/gen-datamode-banner）：每决策页顶「⚠此结论基于合成/估算数据（非真实接入）——不作真实决策依据」。
- **主决策面全 muted**（真浏览器 getComputedStyle 证非 rgb(224,98,108)）：dash metric-strip 物料保障率/需求达成率/毛利率（green+「估算·不作越线裁决」）· 根因DAG RED 徽标已 muted · project-sim ✗缺口（0 danger红）· order-chain 不建议接 verdict · plan-generate 方案综合分 72/75。
- **C3 genuine-sim:check 绿** · **C6 gates 绿**（dev 34 门 + 我复跑 genuine-sim exit0）· frontend 346 含 datamode-sweep 8 用例。
- 真 FDE（dev 独立 4087/4088/4090 截图 + 审核方独立 clean vite 6 面截图 dm2-*.png）。

## ✗ 2 类残余（违 WO 自身「全站扫齐/凡 danger 决策组件必守 dataMode」）
1. **毛利率勾稽「对缺口贡献(pp)」负值 cell** 仍裸 `var(--danger)` 无 notLive 守卫：`DashboardView.tsx:234 gapContributionPp<0?"var(--danger)":...`；同款聚合勾稽表现于 plan-generate/plan-audit（真浏览器见 -0.97/-0.09 红 cell）。合成页显红=合成充真残口。
2. **order-chain 问题归并卡** `.probCard`(oc-problem-credit/lta/ramp/push/crm/cost/frame/maint ×8) danger 红无 dataMode 守卫：真浏览器 getComputedStyle 全 rgb(224,98,108)。8 张「N单受影响·财务贡献X亿」红卡在合成数据上=强烈暗示真问题（合成充真）。

## 修法（窄·复用现成 notLive/decisionVerdictColor）
- ①：对缺口贡献 cell 包 notLive 守卫（合成→muted2·同 metric-strip 范式）。
- ②：probCard 危险色改由 dataMode 驱动（notLive→中性），或页级 ocNotLive 已算(OrderChainView:105) 直接接到 probCard 样式。
- 排除（非缺陷·勿动）：plan-generate hard-chip=硬约束/软偏好配置切换（非裁决输出）· 根因DAG「RED」徽标已 muted · 规则号 C13/C15 等=RuleRef 链接色。

补齐这 2 类 → 真「扫齐」→ DONE。
