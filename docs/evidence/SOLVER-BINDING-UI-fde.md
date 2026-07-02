# WO-SOLVER-BINDING-UI · FDE 真实交付证据（G-17 命门前端 · G-VIS-1）

**WO**：SolversPage 每行展开显该求解器 `SolverBinding` 绑定层（role→租户真实类型/字段·DRAFT/ACTIVE 徽章）+
「激活草案」按钮（DRAFT→ACTIVE·`POST /a/v1/solvers/:key/bindings/:id/activate`）+「建议绑定」（`POST /a/v1/solvers/bindings/suggest`）。
此前 SolverBinding 绑定层（后端 DONE·B3 命门）**前端无处可见**——验收全 curl/gate 无 browser → 前端漏（G-VIS-1）。

**关联断点**：G-17（SolverBinding 命门·此处补前端 activate/可见 UI）· G-VIS-1（后端产物真存·前端无处可见→本 WO 主治）
**红线守法**：RL4（DRAFT 须人工 activate 才生效·单向）· DF.8（绑定引用类型须在本租户已发布本体·后端接地）· R2（仅本租户）

---

## 1. 改了什么（前端·additive·零回归）

- `apps/frontend-shell/src/api/endpoints.ts`：补 `fetchSolverBindings(solverKey)` / `activateSolverBinding(solverKey,id)` / `suggestSolverBindings()`
  （接后端既有 `/a/v1/solvers/:key/bindings`·`/bindings/:id/activate`·`/bindings/suggest`）+ import `SolverBinding` 契约（不重定义）。
- `apps/frontend-shell/src/pages/admin/SolversPage.tsx`：
  - 求解器行改可点展开 → 内嵌 `SolverBindingPanel`（fetch 该 solver 的 bindings）。
  - 绑定层逐条显 status 徽章（ACTIVE 绿 / DRAFT 琥珀）+ origin（自动草案/人工）+ roleBindings 表（role→真实类型·fieldMap canonical→真实）。
  - DRAFT 绑定行有「激活草案」按钮 → activate → refetch → 徽章翻 ACTIVE、按钮消失（RL4 单向）。
  - 顶部「建议绑定（生成草案）」按钮 → suggest → 显生成草案数（demo 有 canonical 类型 → 0·zero-noise 设计正确·诚实显示）。
  - 无绑定 → 诚实空态「回退 canonical 默认（向后兼容·demo 零绑定零回归）」。
  - 保留「不可自助创建但可见」边界文案（addendum §4·非死路）。
- 牙齿 `apps/frontend-shell/test/solver-binding-ui.test.tsx`（4 用例·全绿）：绑定层可见（role/typeKey/fieldMap）·
  DRAFT→activate→ACTIVE（前端所见==后端返回·按钮消失）· 无绑定诚实空态 · suggest 真调。

## 2. 真起服务真跑（无 mock·真三层）

- datacore `:4101`（SEED_DEMO=1）· agentcore `:4102`（DATACORE_BASE_URL=4101）· 前端真构建 vite preview `:4105`。
- 真浏览器 Playwright（chromium）真表单登录 `demo / admin / demo1234`（admin 域·solvers 页 admin-scoped）。
- FDE 前置：经真 `POST /a/v1/solvers/order_fullchain/bindings` 建一条 **DF.8 接地** 的 DRAFT 绑定
  `order→Order [so→so]`（Order 为 demo 已发布真实类型·非合成·后端 assertSolverBindingGrounded 通过）。

## 3. 前后端逐值对照（①curl 后端真值 ②真浏览器 screenshot ③逐值对上）

深链：`/admin/solvers` → 展开 `order_fullchain`。

| 值 | 后端真值（curl /bindings） | 前端真浏览器所见 | 结论 |
|---|---|---|---|
| 绑定可见 | items[0] solverKey=order_fullchain | 展开行出现绑定层 `solver-binding-*` | ✓ G-VIS-1 可见 |
| role→类型 | order→Order | 绑定行「order Order」 | ✓ |
| fieldMap | so→so | 绑定行「so → so」 | ✓ |
| status（激活前） | DRAFT | 徽章 DRAFT（琥珀） | ✓ |
| **激活动作** | — | 点「激活草案」 | 触发 `POST .../activate` |
| **status（激活后）** | **ACTIVE**（curl 复核） | 徽章 **ACTIVE**（绿）· 激活按钮消失 | ✓ **前端所见==后端** |
| RL4 单向 | ACTIVE 无回退按钮 | 激活按钮消失 | ✓ |
| 绑定生效 | invoke order_fullchain → verdict「不建议接」· so SO-3391 · dataMode SYNTHETIC | — | ✓ ACTIVE 绑定被 resolveSolverType 采纳·出真答案 |

**证据截图**：`docs/evidence/screens/SOLVER-BINDING-UI-draft.png`（DRAFT 绑定层可见）、
`SOLVER-BINDING-UI-active.png`（激活后 ACTIVE·按钮消失）。

浏览器实测输出（逐行）：
```
solvers-page present: 1 · order_fullchain row: 1 · binding element present: 1
status badge BEFORE: DRAFT
role row: order  Order   so → so
activate button present: 1
status badge AFTER activate: ACTIVE
activate button gone (RL4 单向): true
```
curl 复核：`order_fullchain ACTIVE order→Order [so→so]`（==前端）· invoke `verdict: 不建议接 | so: SO-3391 | dataMode: SYNTHETIC`。

## 4. 边界 / 距北极星（诚实）

- ✅ **真做到**：SolverBinding 绑定层前端**可见**（role→租户真实类型/字段·DRAFT/ACTIVE）+ 人工 **activate 闭环**
  （DRAFT→ACTIVE·RL4 单向·前端所见逐值==后端 curl）+ 激活后绑定被求解器采纳出真答案。补 G-17 前端侧、闭 G-VIS-1 一处。
- ⚠ **FDE 绑定说明**：为在 demo（已含全部 canonical 类型）演示 DRAFT→activate 可见流，经真 POST 建了一条 **DF.8 接地的真实绑定**
  `order→Order`（Order 是 demo 真实已发布类型·非合成·非伪造）。`origin=manual`。**「建议绑定」对 demo 正确返回 0**
  （canonical 类型齐全 → 零噪声·设计如此·前端诚实显示 suggested=0）。
- 🔭 **下一环**：更贴 WO 叙事的「自有类型上传→自动 auto-suggest DRAFT」需一个缺 canonical 类型、含相似自有类型的租户
  （realco/物流域）——`suggestSolverBindings` 词表相似度逻辑已在后端就绪、前端「建议绑定」按钮已接线，
  换 custom-type 租户即出 auto-suggest 草案（本 WO 前端 UI 已具备该能力·仅 demo 数据形态使 suggest=0）。

## 5. 门（本轮）

`pnpm -r build` 4 包绿 · `pnpm -r test` 全绿（新增 solver-binding-ui 4 用例）· `pnpm gates` 绿（含 ontology-slices:check）。
