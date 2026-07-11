# WO · SANDBOX-RADAR-COLLAPSE（三雷达合一 + 认证折人话·砍竞品形式膨胀）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：把沙盘现在的**三套雷达**（结构/知识/行为 3 维 + 健康 6 维 + 信任 4 维）合并为**1 张主雷达（维度名换人话）**，其余收"详情"折叠；把 L0-L4 黑话台阶折成**一句人话结论**——**执行 REVIEW"拒绝照搬竞品形式"的标志性一刀**（纯前端·零后端·零新色）。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md #9/#10`（三雷达=竞品形式膨胀·L0-L4 黑话）。所有锚点已核对真实存在。
> 纪律：`DESIGN-refit-rollback-plan.md` 七原则。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`SimCertification`（§2.I·L0-L4 + dims·`contracts/sim.ts`）——**仅前端展示改造·契约不动**。
**触及链路（母体 §3）**：无（纯前端渲染层）。
**不变量（母体 §5）**：**R17 决策单页（本 WO 直击·降信息过载·一句话结论）** · R14 零业务常数（维度 label 走 config/i18n） · R-QUANT（视觉给精确值） · R13（认证结论派生自 cert·不新造真值）。
**断点（母体 §8）**：无新断点。
**回写母体**：无接线变更（纯前端）；不改母体。

---

## §1 背景·目标·依赖

### 1.1 问题（REVIEW #10·"拒绝 copy 形式"标志）
沙盘对标竞品三栏屏,竞品是 **2 雷达**（Health Radar + Trust Radar），我方却做成 **3 套**（`SandboxView.tsx:949` 结构/知识/行为 + `:952 deriveHealthDims` 健康6维 + `:953 deriveTrustDims` 信任4维，渲染 `:1129/:1147/:1148`）——**形式膨胀**，维度名（structure/knowledge/behavior）对业务人零意义，三雷达信息过载。L0-L4 stepper（`SimReadinessPanel.tsx`）是黑话台阶,无一句人话。

### 1.2 目标
1 张主雷达（人话维度）+ 认证一句话结论 → 降过载、可读、真服务"这结论能不能拿来决策"。

### 1.3 依赖
- **无前置·纯前端·可先落**（不依赖 S1）。
- **复用**：`RadarChart.tsx`（换 dims 即换维·`:22 radarPoint`）· `SimReadinessPanel.tsx`（cert 数据）· cert 已有 dims/level（不改后端）。

---

## §2 范围与非范围

**In scope（纯前端）**：
1. 三雷达 → 1 张主雷达：维度收敛为**人话**（如"数据齐不齐 / 规则覆盖 / 可信度 / 行为验证"），值仍全 DERIVE 自 cert（R14/R13）。
2. 其余维度收进"详情"折叠（DOM 保留·功能不删·点开可见）。
3. L0-L4 stepper 折成**一句人话**（"当前 L2 可运行·结论可参考但不可直接落 Action·因缺 X"），台阶/三元组黑话收"详情"。

**Out of scope**：
- ❌ 改后端 cert 计算（`deriveCertification` 不动）。
- ❌ 删任何维度数据（只重组展示·DOM 保留）。
- ❌ 新组件/新色（复用 RadarChart + 既有 token）。

---

## §3 详细设计

### 3.1 主雷达（`SandboxView.tsx` 渲染层）
- 现 `radarValues{structure,knowledge,behavior}` + `healthDims`(6) + `trustDims`(4) → 合成**一张主雷达的 4-6 维**，维度 label 从 config/i18n 取人话名（映射表：`structure→"数据/结构齐备"`、`knowledge→"规则/知识覆盖"`、`behavior→"行为已验证"`、trust 关键维→"可信度"）。**映射走配置·R14 不内联业务词**。
- 值：直接复用现有派生（`deriveHealthDims`/`deriveTrustDims`/cert.dims）——**零后端改**。
- 健康6/信任4 完整维 → "详情"折叠卡（`CollapsibleCard` 复用·默认折叠）。

### 3.2 认证一句话（`SimReadinessPanel.tsx`）
```
level → 人话结论（映射·R14 i18n）：
  L0/L1 → "尚不可推演（缺配置）"
  L2    → "可运行·结论仅供参考·不可直接落 Action（缺 {gaps}）"
  L3    → "已验证·结论可支持决策·落 Action 前复核 {残项}"
  L4    → "已认证·可直接据此落 Action"
```
- 一句话 + "查看认证详情"折叠（内含现 L0-L4 stepper + 三元组 + Trial Tick + 完整度 gauge·**DOM 全保留**）。
- 结论文案从 cert 派生（R13·不新造）；gaps 取 cert.worldCompleteness/entering。

### 3.3 视觉（R-QUANT·复用 token）
- 主雷达尺寸/描边用既有 `RadarChart` 参数；折叠卡复用 `CollapsibleCard`；一句话结论色按 cert level 走既有语义色（L2 `--warn #e8b54a` / L3 `--ok #62be77` / L0 `--danger #e0626c` / L4 `--accent #5B7CFA`）——**零新色**（CSS 门 `check-css-vars`）。

---

## §4 触点清单
| 文件 | 改动 | 面 |
|---|---|---|
| `apps/frontend-shell/src/views/sim/SandboxView.tsx` | 三雷达→1 主雷达 + 详情折叠 | 前端 |
| `apps/frontend-shell/src/views/sim/SimReadinessPanel.tsx` | L0-L4 折人话一句话 + 详情折叠 | 前端 |
| `apps/frontend-shell/src/views/sim/RadarChart.tsx` | 复用（换 dims·可能补 label 映射入参） | 前端 |
| `apps/frontend-shell/src/locales/zh.ts` | 维度/结论人话文案（R14 i18n） | 前端 |
| （母体不改） | — | — |

---

## §5 验收（真跑·含回退演练）
1. **一屏一雷达**：真起→主视觉区只 1 张雷达、维度显人话名（非 structure/knowledge/behavior）；健康6/信任4 在折叠里点开可见（功能不删）。
2. **认证一句话正确**：构造 L2/L3 会话→显对应人话结论 + gaps；点"详情"见原 L0-L4 stepper。
3. **值一致**：主雷达每维值 === 原派生值（`getComputedStyle`/DOM 逐值对·证只重组不改数）。
4. **零新色**：`check-css-vars` 绿；结论色 === 既有 token。
5. **回退演练**：feature `sim.radar_collapse` 关→回三雷达原样（旧 DOM 未删）。
6. **gates 全绿**（css-vars / prd:check）。

## §6 失败判据
- F1 合并后丢了某维数据（不是折叠是删除）→ 违"不删功能"·revert。
- F2 人话映射内联业务词（违 R14）→ debattery 门红。
- F3 新色→css-vars 门红。
- F4 门红→不进下一期。

## §7 排序
- **纯前端·独立·可先落**（不依赖 S1）；与 S2 并行（S2 后端+徽标·S4 纯前端布局，不相交）。
- 是最低风险、最直接兑现"拒绝 copy 竞品形式"的一单。

## 附录 · 证据锚点
`SandboxView.tsx:949`（三雷达 radarValues）`:952/953`（deriveHealthDims/deriveTrustDims）`:1129/1147/1148`（三雷达渲染）·`SimReadinessPanel.tsx`（L0-L4 stepper）·`RadarChart.tsx:22`（复用点）·`CollapsibleCard`（折叠复用）·`tokens.css`（既有语义色）·母体 §5 R17/R14/R13/R-QUANT。
