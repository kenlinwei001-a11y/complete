# 轨Q · 复刻沙盘族 · 增量0 基线 + 增量1 初始化向导（复刻竞品 image7）

> SPEC-replica-sandbox-family。分层交付 b：①接现成 full 1:1（`/a/v1/sim/*` 真数据）；③类（6/4维雷达·业务动作+RL4·
> 分层目标·GEO·子图精细范围）后端未建 → 登记 TO-DO，不画假壳。完成=真浏览器像素对竞品 + 数字溯真后端。

## 增量0 · 基线（管线核查·零代码）
**① 端点全通（demo 真跑 curl）**：`sim/view-config 200` · `POST sim/sessions` · `scope-precheck 200` · `certification 200` · `tick 200` · `checkpoint 201`。view-config 真值：nodeTypes 34 · linkTypes 27 · stateVars 4(demandLoad/demandPressure/loadIndex/utilPressure) · propagationCount 3。

**现态（实拍 `replica-sandbox-q0-baseline-{sandbox,siminit}.png`）**：轨A P0+P1 已让沙盘族相当完整——
- `/v/sim-sandbox`：状态卡条 + AI 指挥台 + tick/检查点/分支/采纳 + 完整 L0-L4 就绪认证(三维54·世界完整度35%·进入清单12·缺件) + 本体拓扑 + **双雷达**(健康6维 + 信任4维)。
- `/v/sim-init`：3 步向导(① 世界基准 / ② 推演范围 / ③ 范围预检)。

**结论**：轨Q 大体是**精修到竞品像素级 + 补竞品专属密集布局**，非从零；后端管线已就绪。

**双雷达决议（用户拍板「保留+精修到像素级」）**：SPEC §5 把 6/4 维雷达列 ③类，但页1 line15 说雷达接 deriveCertification 现成五维→扩6维；现雷达**每维真派生自 cert**（`deriveHealthDims`/`deriveTrustDims`·每维带 `src` 溯源字段 + `hasData` 缺数据灰轴诚实标），符合 line15。→ 轨Q 保留并在 Phase2 精修到 image1 像素级（§5「后端不存在」口径偏保守、已被轨A P1 真派生实现取代）。

## 增量1 · 初始化向导 step3 范围预检（复刻竞品 image7 右统计）
**改 `SimInitWizard.tsx`**（接现成 `scope-precheck`·零新端点）：
- **世界完整度蓝环**（替原 % 文本 + heat 条）：`pct` 真派生自 `worldCompleteness.pct`。
- **4 类完整度进度条**：状态变量 / 派生规则 / 写回行动 / 传导规则 = 真 `present/needed`（按比例红/黄/绿）。
- **已选范围**：全图基线（34 类对象）/ 局部·类型。
- 进入清单(entering·kind 徽+source) + canEnter + 缺件清单 不变（已真）。

**真浏览器复核（`q1-wizard-fde.mjs`·截图 `replica-sandbox-q1-wizard-precheck.png`）**：
```
世界完整度蓝环: true | 环内 pct: 35%   ← 后端 wc.pct=35 → ✓ 溯真
4 进度条: 状态变量 0/11 · 派生规则 0/11 · 写回行动 9/9 · 传导规则 3/3   ← 全 == 后端 worldCompleteness
已选范围：全图基线（34 类对象）
进入清单条目: 12
```
环 pct / 4 条 / 进入清单逐项对上 scope-precheck 真值，零写死。

**③类诚实 RESERVED（step2·截图 `...-range-reserved.png`）**：竞品 image7 step2 的子图精细范围控件——多选主体对象 / 关系类型过滤 / 属性过滤 / 关系扩展深度 / 每类最多实体数——**后端 scope-precheck 仅 `{kind,target}`（全图/单一类型），不支持子图过滤 → 显式 RESERVED，不画假控件**（继承轨M 真推演红线）。

## 门
`typecheck` ✓ · `lint`(SimInitWizard.tsx) ✓ · `test` 278/278 ✓。测试兼容：保留 `siminit-completeness`(环内%) + `siminit-wc-statevars`(首条) testid，HeatStrip 仍供 SandboxView/SimComparePanel。

## 本体引用与影响
- **对象类型**：SimSession / SimCertification(worldCompleteness)（读·投影）。
- **链路**：就绪认证链 SimSession→scope-precheck→向导（复用·无新端点）。
- **不变量**：R13（环/条/清单溯真 scope-precheck）；R14（无业务常数·全派生 view-config）；RL5（域色 theme-invariant）。
- **断点/门禁**：无新增；纯前端接现成端点，无契约/后端改动；子图精细范围 ③类登记 TO-DO（§10.1）。无需回写本体新章节。
