# 轨P · 复刻建模族 · 增量3：对象配置详情抽屉 + 逐对象 gauge（复刻竞品 image5）

> SPEC-replica-modeling-family 页3 + 增量3。分层交付 b：①接现成 full 1:1（接 `deriveCertification` scope=LOCAL + `patchModelingDraft`，
> 不新建并行）。**完成判据 = 真浏览器逐对象 gauge 各不相同（溯真后端）+ 改属性真持久化，非测试绿。**

## 1. 落点
`ModelingPage`（`/admin/modeling`）：点**数据流 DAG 实体节点**（增量1 的 `pp-ty-{type}`）或**已发布本体行**（无活动草案态）
→ 开 `ObjectConfigDrawer`（复刻 image5「选中实体」）。中：基础图谱表单 + 本体构建表（属性/派生 真数据）；
右：**局部准备度**（逐对象 `deriveCertification(scope=LOCAL,target=该类型)`，复用 `SimReadinessPanel`，不新建并行）。

## 2. 红线①：逐对象 gauge / 三维 **真·各不相同**（禁全局值冒充逐对象）

后端 curl（`/a/v1/sim/sessions/:id/certification?scope=LOCAL&target=类型`，真实算）：

| 类型 | level | 局部完整度 gauge | 三维(结构/知识/行为/综合) | 状态变量 | 传导规则 | canEnter |
|---|---|---|---|---|---|---|
| **Order** | L1_CONFIGURED | **83%** | 100/100/100/100 | 0/1 | 1/1 | ✗ |
| **Base** | L4_CERTIFIED | **65%** | 100/100/100/100 | 0/3 | 2/2 | ✓ |
| **Line** | L4_CERTIFIED | **100%** | **100/17/0/45** | 0/0 | 1/1 | ✓ |
| （全局 GLOBAL） | L1_CONFIGURED | 35% | 100/28/18/54 | — | — | ✗ |

真浏览器复核（`p3-gauge-fde.mjs`·选择器限定在抽屉 `objcfg-readiness` 容器内）：

```
gauge   Order/Base/Line: 83% / 65% / 100% → ✓ 各不相同
canEnter Order/Base    : ✗ 暂不可进入推演 / ✓ 可进入推演 → ✓ 不同
三维 Line vs Order      : ✓ 不同(Line 100/17/0 ≠ Order 100/100/100，证三维亦逐对象)
```

- 浏览器抽屉数字 == curl 真值（Order 83% / Base 65% / Line 100%），**绝无把全局那组 35%/54 复用到每个对象**。
- 截图：`replica-modeling-p3-drawer-order.png`（83% 蓝半环）· `...-base.png`（65% 橙半环）· `...-line.png`（100%）——肉眼可见 gauge 各异。

## 3. 红线②：改属性走**真 `patchModelingDraft`** 并**真持久化**（非乐观·刷新仍在）

编辑落点 = 可编辑草案（status≠PUBLISHED 且含该 typeKey）。demo 仅 1 个**已发布**草案（锁定），故经真 derive 流程
建一个可编辑草案（`POST /a/v1/modeling/derive`，含 Base）作落点；抽屉对该类型开放归域下拉(setDomain) + 属性改名(renameProperty)。

真浏览器复核（`p3-patch-fde.mjs`·**整页刷新清缓存后重开**判定）：

```
归域下拉(可编辑)存在: true
编辑说明: 编辑落点：可编辑草案 draft_xxx（status DRAFT）——改归域/属性名走真 patchModelingDraft，真持久化（刷新仍在）。
PATCH setDomain: unassigned → factory
name 改名钮存在: true
===== 刷新后（真持久化判定）=====
归域: factory → ✓ setDomain 落库(刷新仍在)
属性 name_fde 存在: true | 旧 name 存在: false → ✓ renameProperty 落库(刷新仍在)
```

- 非乐观更新：`patchMut` 成功后 `invalidateQueries(["a","modeling-drafts"])` 重取后端，整页刷新仍在 = 真落库。
- 截图：`replica-modeling-p3-patch-persist.png`（刷新后归域=factory、属性=name_fde）。
- **无可编辑草案时诚实只读**：已发布本体锁定 → 显「编辑需先新建可编辑草案」，**不提供假编辑**（继承轨M 真推演红线）。

## 4. ③类（不画假壳·§10③·显式 RESERVED）
- 本体构建 tab：`类型 / 函数 / 行动 / 安全` 后端无 → **禁用 + RESERVED 徽**（不画假表）。仅 `属性 / 派生` 接真 ObjectType 数据。
- 基础图谱：`存储模式（静态/本体图谱）` / `对象描述` 后端无对应字段 → 显式 RESERVED，不画假输入。
- 6维健康 / 4维信任雷达：后端未建 → `SimReadinessPanel` 不传 `radar`（不画假雷达）。

## 5. 复用（不新建并行·红线）
`SimReadinessPanel`（增量2 已建·CertStepper/CompletenessGauge/CheckBadge/entering/gaps）原样复用，仅父组件改取
`scope=LOCAL,target=该类型` 的 cert → 同一面板渲染逐对象真值。整页一个共享 `SimSession`（`useCertSession`），全局面板与抽屉共用。

## 6. 门
`pnpm --filter frontend-shell build` ✓ · `typecheck` ✓ · `test` 278/278 ✓ · `lint`(ModelingPage.tsx) ✓。
脚本：`scratchpad/p3-gauge-fde.mjs`（逐对象 gauge 各异）·`scratchpad/p3-patch-fde.mjs`（真 PATCH 刷新仍在）。

## 本体引用与影响
- **对象类型**：ObjectType（properties/derivedProperties/domain·读）；OntologyDraft（patchDraft 落点·写）。
- **链路**：建模链 RawDataset→deriveModeling→Draft→publish→ObjectType（增量3 在 Draft 段加 UI 编辑入口，走既有 `patchDraft`）；
  就绪认证链 SimSession→deriveCertification(LOCAL,target)→SimReadinessPanel（复用，无新端点）。
- **不变量**：R13 数据可溯（gauge/属性溯真后端，非写死）；R6 确定性（同输入同 cert）；R14 配置驱动（域下拉来自 business-domains 注册表）。
- **断点**：无新增；不触 G-3（Agent 指挥台留增量4）。
- **门禁**：未改后端逻辑 / 契约，纯前端接现成端点，无需回写本体新章节（链路/事件/对象类型/不变量/门禁均未变）。
