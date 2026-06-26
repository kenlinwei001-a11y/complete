# 轨P 增量2 · L0-L4 认证面板（复刻竞品 image6「全局仿真准备度」·接 deriveCertification 真级·禁写死）

## 实现（复用 SimReadinessPanel·不新建并行）
- `ModelingPage.GlobalReadinessPanel`：建极简 SimSession（空 baseSnapshot·仅为算全局本体就绪·实测与真 base 同结果）
  → `fetchSimCertification(GLOBAL)` → 复用既有 `SimReadinessPanel`（CertStepper/CompletenessGauge/CheckBadge 砌齐）。
- **禁写死 100**：级别/三维/绿环全来自真后端 `deriveCertification`。entitlement 关时诚实降级"未开"（不画假认证）。
- ③类不接：6维健康雷达/4维信任雷达后端未建（§10③）→ 不传 `radar`（不画假壳）。

## FDE（真浏览器·`replica-modeling-p2-readiness.png`）真级·非写死
`/admin/modeling` 全局仿真准备度面板：
- L0-L4 台阶：L0未定义 L1**已配置** L2可运行 L3已验证 L4已认证 · **✗ 暂不可进入推演**（canEnter=false 真）。
- 三维：综合 **54** · 结构 **100** / 知识 **28** / 行为 **18**（真 dims·非全 100）。
- L4 三元组：✓扇出安全 ✓写回完整 ✓可观测达标 + Trial Tick ✓通过（规则触发 0 条）。
- **世界完整度 35%**（真 worldCompleteness.pct·**非 100/100 写死**）· 状态变量 0/11 · 派生规则 0/11 · 写回行动 9/9 · 传导规则 3/3。
- entering 清单 12 项（adopt_mitigation[行动]…真对象）。

## 审核方复核判据
绿环/级别/三维全溯真后端 cert（35% 非 100）✓；L4 子项 Schema lint/已持久化（§10③后端无）未画（RESERVED）✓；雷达③类未画假壳 ✓。
CLI/测试：pnpm -r build 绿；f10.modeling 测绿；复用 SimReadinessPanel 未改其本身。
