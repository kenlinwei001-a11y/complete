# HANDOFF · WO-STATEVAR-DISPLAYNAME（状态变量展示名单源链路）

> 原工单交付清单点名的交接文档。2026-08-19 由复验修单 dev 补写（原 WO 已并集成线，
> 内容提炼自 `docs/SYSTEM-ONTOLOGY.md` §3「展示名链路」与 §7 门登记段，二者为正本，本文不另立口径）。

## 1. 单源架构（三段，断点在接缝）

```
STATE_VAR_DISPLAY_NAMES（apps/datacore/src/synthetic/battery.ts · 36 条 · 单一真值）
  ↓ stateVarDisplayNames()（全平台唯一投影函数，两条路由共用，不许各抄一份）
GET /a/v1/sim/view-config        → SandboxViewConfig.stateVarNames      （读时 join，不入库）
GET /a/v1/sim/propagation-rules  → PropagationRulesResponse.stateVarNames（口径逐字节相同）
  ↓ stateVarLabel.ts（apps/frontend-shell/src/views/sim/ · 前端唯一消费路径 · 前端零中文名映射表）
沙盘 KPI 逐变量读数 · 扰动落点下拉 · 导出表 · 传导边开关面板第一级 · 对照差异表 · 金额压力行（修单①补）
```

病灶定性 = 三分法「**没接线**」（本体零命中 + 契约零字段 + 前端诚实缺席），不是「接了线没数据」。
⛔ 刻意不做：不把状态变量登记成 `PropertyDef`（对象上没有这一格，登记 = 用本体断言假事；
`ObjectTypeDef.stateVariables` 同名但语义是 OntoFlow 建模声明，且实测 94 类全空——
「接了线没数据」，upsertType 早已 `{...input}` 摊开、落得了库，见 c4e2df8d8 与 §8 G-UPSERTTYPE-DROPS-FIELDS 已闭）。

## 2. 四条口径（契约层纪律）

1. **读时投影，不入库**——入库会在改名后留下查无对证的旧名字；
2. **只收登记过的键**——查不到的变量不进字典（不填 null/空串/回填裸键），缺席 = 明确的「没有名字」；
3. **`.optional()` 不是 `.default({})`**——必填会逼改全仓 17 个构造 `SandboxViewConfig` 的无关测试；
4. **接线名一律不动**——`stateVars` / `sourceStateVar` / `targetStateVar` / testid 全部照旧裸键；补的是展示层，不是改名。

前端侧对称纪律：`stateVarLabel()` 回落必须**看得出是回落**（`named=false` + 屏上显裸键 +
`data-statevar-named` 可断言）；接线名走 `aria-label`/`value`，⛔ 不挂原生 `title`（规范 §2 R-UI-3，
初稿被 sandbox-ui-integrate 原生 title 棘轮 84→85 当场抖出，见 325f7bcd6）。

## 3. 接缝测试清单（任一半漏即红）

**数据+服务半** `apps/datacore/test/statevar-display-name.seam.test.ts`（6 用例 · 真 HTTP · 真种子）：
① 名字出现在两条真接口响应里；② 两条路口径 `toEqual` 逐字节对拍；③ 诚实缺席（未登记键根本不在字典里）；
④ 覆盖金丝雀（种子每声明一个新变量就必须配名，断 `declared.length > 10` 防装饰品）；⑤ 响应值逐条 === 单源表；
⑥ 单源不并存（状态变量键不得同时是本体属性）。

**展示半** `apps/frontend-shell/test/statevar-display-name.seam.test.tsx`（7 用例）：
① 头号判据——换一版下发的词，沙盘 KPI 屏上那个词跟着变（断可见文本）；
② 回落态可断言（`data-statevar-named=false` + 显裸键）；③ 字典整个缺席 ⇒ 全部回落照常可用；
④ 扰动下拉显中文而 `option.value` 仍是接线名。

**修单①新增** `apps/frontend-shell/test/sandbox-finance-worldstate.seam.test.tsx` 压力行断言：
换下发名 ⇒ 金额压力行第一级 textContent 跟着变，期望名从 CFG 现取（同形态，不写死）。

## 4. 变异记录

- 原 WO（2026-08-17 现跑）：拆掉 `SandboxView.tsx` 读名字那一步 ⇒ RC=1，红在「屏上还是裸键」
  （`expected 'loadIndex 40.5' to contain '负载指数'`），其余 5 条不依赖该步的用例保持绿 ⇒ 定向；还原 7/7 绿。
- 复验修单（2026-08-19 现跑）：掐断 `SandboxView` 挂载点的 `stateVarNames` 传递 ⇒
  新压力行断言当场红（**RC=1**，`expected 'Order.costPressure' to contain 'Order.成本压力'` ——
  红在「屏上回裸键」这一处，定向）；还原后该 seam **8/8 RC=0**。

## 5. 2026-08-19 复验修单四条（本分支 `claude/handoff-wo-statevar-displayname-fix`，基线 7c52b9b42）

复验裁决：架构与门禁为真，但有一处漏网裸键 + 两处小修 + 流程补文档。逐条：

**① 漏网裸键（头号）**
- `apps/frontend-shell/src/views/sim/SandboxImpactBand.tsx` 金额压力行第一级 `{p.objectType}.{p.stateVar}`
  直接渲裸键，组件从不消费 `stateVarNames`。修：`SandboxViewConfig.stateVarNames` 经
  `SandboxView` → `SandboxImpactBand` → `FinanceProjectionPanel` 透传，用既有 `stateVarLabel()` 解析；
  testid 仍认裸键，接线名走 `aria-label`，回落置 `data-statevar-named=false`。接缝断言见 §3 末条。
- `apps/frontend-shell/src/views/sim/PerturbationTimeline.tsx:281` 泳道标签 `.{lane.stateVar}`：
  **选「显式注释声明系统键坐标位」**（二选一，未走翻译）。依据（读上下文实证，非推断）：
  a. 泳道名是**坐标**——分组键（`U+0000` 连接）、testid、屏上文本三者同一份裸键对，改名即分叉；
  b. `objectId` 那一半全仓没有任何展示名真值源（类型有 `sourceTypeName`、对象实例 id 没有），
     只译另一半会得到 `obj_a1.负载指数` 式半中半键混排；
  c. 人话名在入口侧已有——施加扰动下拉的落点选项已走 `stateVarText`（单源同在 battery.ts）。
  声明注释写在泳道名渲染处，与 `EdgeActivePanel` 第二级系统键行同一形态。

**② 本体 §3 与 §8 自相矛盾**：§3「⛔ 刻意没做」段仍写「upsertType 重建 def 时根本不抄它」，
与 battery.ts 注释（c4e2df8d8：`{...input}` 摊开、落得了库）及 §8 G-UPSERTTYPE-DROPS-FIELDS
「2026-08-18 复核：已闭」直接矛盾。按 c4e2df8d8 措辞订正 §3 那一句（句级最小改动，§8 一字未碰）。

**③ stale-claims 棘轮净增 +1**：`stateVarLabel.ts` 头注「实测零命中」自称实测无日期（STALE-1）。
改为带日期（2026-08-17 接线前排查）+ 复验锚点（`82d505700^`）的史料句式，并写明保质期
（本单落地后 battery.ts 自己必然命中同一条 grep）。门复跑：新增 28 → 27，本文件出列，净增回 0
（其余 27 + 回弹 2 为基线既有红，不归本单消）。

**④ 本文档**：原工单交付清单点名、全仓缺失，本次补写。
