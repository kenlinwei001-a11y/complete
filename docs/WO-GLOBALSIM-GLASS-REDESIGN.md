# WO-GLOBALSIM-GLASS-REDESIGN · 全局推演「磨砂玻璃重设计 + 全局在先 + 去重」施工单

> 两件一起做（一个 dev 整单·靠文件边界）：
> ① **视觉重设计** —— 背景像素级复刻参考图（深空蓝）+ 右侧磨砂玻璃卡；
> ② **功能重定位** —— 全局在先工作流 + 从项目推演去重（挪 `MultiObjWhatifPanel`）+ 与项目推演双向下钻。
>
> 像素目标（视觉验收基准图）：https://claude.ai/code/artifact/66d88f0c-9982-4078-be53-64b7a711a45e

---

## 🚦 范围边界（只碰这些·这是本单的身份）

- `apps/frontend-shell/src/views/sim/GlobalSimView.tsx` —— **重设计**（磨砂玻璃 + 全局在先结构）。
- `apps/frontend-shell/src/views/sim/ProjectSimView.tsx` —— **去重**：移除 `MultiObjWhatifPanel` 内嵌；顶部加「⚠ 当前排程受全局主计划约束」常驻条 + 「把这批一起求全局最优 →」跳转口。
- `apps/frontend-shell/src/views/sim/MultiObjWhatifPanel.tsx` —— **迁移**到全局推演内（多目标联合本就是全局能力·放错在局部页了）。
- `apps/frontend-shell/src/views/sim/GlobalSimView.module.css`（新增或追加）—— 磨砂玻璃样式。
- **禁止**：改 `ProjectSimView` 的单项目 what-if（`generic_inference` 杠杆）逻辑/口径；改 portfolio 求解器算法/答案口径。本单只改"壳与位置"，不改"算什么"。

---

## 一、视觉铁约束（像素级·验收头号判据之一）

**主题**：深色 committed（参考图是深色，本页锁定深空蓝，不做浅色）。

**背景（像素级复刻参考图）** —— 直接用这套 token（已按参考图调校）：
```css
background:
  radial-gradient(900px 520px at 40% 32%, rgba(52,68,98,.55), transparent 62%),
  radial-gradient(700px 500px at 85% 60%, rgba(60,74,110,.30), transparent 60%),
  linear-gradient(168deg, #1a2333 0%, #121a27 46%, #0c1119 100%);
```
- 左导航栏：`#0a0e15` 深空近黑 + 右边 1px `rgba(255,255,255,.05)`。

**右侧磨砂玻璃卡（复刻参考图 VALUATION CALCULATOR / SIMILAR PROPERTIES 质感）**：
```css
.glass{
  background: rgba(255,255,255,.045);
  backdrop-filter: blur(24px) saturate(1.25);
  -webkit-backdrop-filter: blur(24px) saturate(1.25);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 16px;
  box-shadow: 0 24px 48px -26px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.09); /* 内顶高光 */
}
```
**文字层级**：主 `#eff2f7` / 次 `#a7b1c2` / 弱 `#717c91`；分组标签用**括号大写 + letter-spacing**（`[ 联合求解配置 ]` 复刻参考图 `[ VALUATION CALCULATOR ]`）。
**强调色**：periwinkle 主按钮 `linear-gradient(180deg,#6c7bf6,#5460e8)` + 阴影；次按钮磨砂描边。
**数字**：`font-variant-numeric: tabular-nums`。

> 审核方会把成品与基准图 66d88f0c **并排像素级比对**背景渐变、卡片磨砂通透度、文字层级、强调色。不达 = 退。

---

## 二、功能重定位（从故事脚本结论·全局在先）

**定位**：全局推演 = 运营规划员的**规划起点**（全局最优在先），项目推演 = 其后的框架内细排。

**页面结构（映射参考图两卡 → 本域）**：
- **Hero（左·参考图 3D 位）** = **产能占用矩阵**（基地×周热力 + 被挤单落点 pin）——多单联合求解的实体。顶部工具条：目标 segmented（最多按期/最低代价/最少换型）+ 冻结/排除订单 toggle；右上 mini：产能台账守恒 ✓。
- **磨砂卡①（≈ VALUATION CALCULATOR）** = **联合求解配置**：目标/时间窗/冻结集 → 求解结果（按期率/总代价/换型次数/被挤·冻结）+「发起联合求解」(periwinkle) +「采纳方案」(磨砂描边)。**目标切换 = 多方案对比**（吸收 decision-play 的"方案对比"职能）。
- **磨砂卡②（≈ SIMILAR PROPERTIES）** = **被挤单 / 冻结单卡列表**：每张订单卡（缺口/延期·客户·基地·影响额）。
- **迁入**：`MultiObjWhatifPanel`（从 project-sim 挪来）作为联合 what-if 落在此页。

**双向下钻（同一人·不站错层）**：
- 全局 → 每张项目/被挤单卡「进项目推演细排 →」跳 `/v/project-sim?order=...`。
- 项目 → 顶部「⚠ 受全局主计划约束」+「接不住 → 回全局重排」跳回 `/v/global-sim`。

---

## 《本体引用与影响》（铁律0）

> 开工前读 `docs/SYSTEM-ONTOLOGY.md §3（QOS/求解链）/§8（断点）`。

- **对象类型**：Order / Base / Line / CapacityForecast / PortfolioAllocation（只读消费 portfolio 求解器输出，不新增对象类型）。
- **链路**：`portfolio` 求解器（全订单×基地×时间联合最优 + 冻结子集）→ 前端渲染。本单**只改前端壳 + 面板归位**，不改求解器。
- **闭断点**：**G-PORTFOLIO-LOCAL-ONLY**（"逐个项目/订单单独求解→只到局部最优·无全局联合"）—— 本单让全局推演成为"全局最优在先"的一等入口，正面闭它。
- **不变量**：R13（被挤单/结果每值溯 portfolio provenance）、R6（同输入同解·确定性）、Entitlement 先于 authz（feature 关→404 不变）。
- **回写**：若迁移导致 project-sim/global-sim 的视图能力边界变化 → 回写本体对应视图/链路章节。

## SEAM-GATE 组合测（接缝驱动·非各半绿）

驱动"portfolio 求解器（数据/引擎） × 前端渲染（壳）"接缝：
1. **目标切换真变解**：`最多按期` vs `最低代价` → portfolio 返回**不同分配**（按期率/被挤单集不同），前端两卡随之变——非写死示意。
2. **被挤单真来自求解器**：冻结某订单子集 → portfolio 输出的 displaced 集真变 → 卡②列表随之变。
3. **去重不回归**：`MultiObjWhatifPanel` 迁到 global-sim 后，project-sim 现有单项目 what-if 测试全绿（`generic_inference` 杠杆行为不变）；global-sim 现有测试 + 新壳测试通过。

## DoD

1. **像素级**：成品背景/磨砂卡/文字/强调色与基准图 66d88f0c 并排比对一致（视觉头号判据）。
2. **功能**：全局求解真跑（目标切换真变解、被挤单真来自 portfolio）；双向下钻跳转生效；project-sim「受全局约束」标注 + 跳转口在。
3. **不回归**：project-sim / global-sim 现有测试一条不改、全绿（去重不伤既有）。
4. **四包 gate 全绿** + 亲手真跑（起 datacore+frontend，走一遍全局求解→采纳→下钻项目→回全局）。
5. SEAM 三条通过。

## 交付（LOOP 纪律）

- handoff 分支 **`claude/handoff-globalsim-glass`**，不碰正线。
- 审核方隔离复验：worktree checkout → 四包 gate + SEAM 驱动通 + 像素级色板并排比对 66d88f0c + 亲手真跑 → cherry-pick 上 canonical。
- 退回给精确 `file:line` + 最小修路径。

---

**优先级**：P1（用户点名·丑到不会用 → 重设计；闭 G-PORTFOLIO-LOCAL-ONLY）。
**依赖**：无（portfolio 求解器已在库·本单只做前端壳 + 面板归位）。
**关联**：decision-play「多方案对比」职能被本页目标切换吸收 → decision-play 单独入口去留另起小 WO（不在本单文件边界内）。
