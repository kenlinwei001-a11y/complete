# WO-GLOBAL-BACK · FDE 交付证据（R17 全局下钻页统一回退）

> 施工单：`docs/WO-GLOBAL-BACK-NAV.md`（WO-DrillBackAffordance）。分支：`claude/vigilant-knuth-b1nmxn`。
> 根因解：解决「整页下钻进死路、回不来」一整类——抽统一 `DrillBack` 组件替代各页手搓 inline 面包屑，逐页补齐死路页。

## 1. 改动清单（file:line）

### 新建统一组件
- `apps/frontend-shell/src/components/DrillBack.tsx:18` — `DrillBack({ trail, fallbackTo, testId })`：
  - back = `navigate(-1)`（真历史回退，与浏览器物理后退一致）；
  - `window.history.state.idx`（react-router 维护）==0（直链/刷新落地=历史栈首）→ 走 `fallbackTo`，避免 `navigate(-1)` 退出站点；
  - `trail` 面包屑：有 `to` 的节点可点跳转，末项纯文本；文案复用 `zh.common.back`（=「返回」，无需新增 key）。

### 逐页在渲染树顶插 `<DrillBack/>`（§2.2）
| 页 | file:line | 形态 |
|---|---|---|
| 对象 360 | `pages/Object360Page.tsx:70` | `fallbackTo="/scenarios"` testId=`o360-back` trail=[{display}]（溯源链终点·最该有） |
| 任务详情 | `pages/TaskDetailPage.tsx:42` | `fallbackTo="/"` testId=`task-back` trail=[{任务详情}] |
| 风险看板 | `views/RiskBoardView.tsx:47` | **仅 `?focus=` 下钻态**显 testId=`risk-back`（无 focus=左导航顶层入口不显） |
| 地理地图 | `views/plan/GeoMapView.tsx:123` | **仅 `?focus=` 态**显 testId=`geo-back` |
| 季度滚动 | `views/plan/QuarterlyRollingView.tsx:51` | **仅 `?focus=` 态**显 testId=`quarterly-back` |
| 本体图谱 | `views/OntologyGraphView.tsx:112` | **仅 `focusId`（?focus=）态**显 testId=`graph-back` |
| 来源系统总览 | `pages/admin/SourceSystemOverviewPage.tsx:38` | `fallbackTo="/admin/catalog"` testId=`source-overview-back` |
| 发育驾驶舱 | `pages/admin/GrowthCockpitPage.tsx:51` | `fallbackTo="/admin/catalog"` testId=`growth-back` |
| 字段核对 | `pages/admin/FieldProfilePage.tsx:173` | **换掉硬编码 `<Link to="/admin/connections">`** → `fallbackTo="/admin/connections"` testId=`fieldprofile-back`（真历史回退，兜底保留原父级）；同时删除不再用的 `Link` import |
| 订单全链（可选迁移） | `views/plan/OrderChainView.tsx:143` | 手搓 inline 面包屑迁到 `DrillBack`（testId 沿用 `order-chain-back`，trail=[经营驾驶舱→订单全链聚合]，行为不变 + idx 兜底更稳）；删除不再用的 `useNavigate` |

- fallback 目标路由均已核实存在（`App.tsx`：`scenarios:121`、`admin/connections/:connId/schema:132`、`admin("catalog"):145`、`admin()` 前缀 `admin/`:87-88）——无死兜底。

### 测试
- `apps/frontend-shell/test/wo-global-back.test.tsx`（新增，6 用例）。

### 台账
- `docs/REQ-LEDGER.md:43` R17 从 ◐ → 🟡（普查已做·统一组件·死路页已补清单·门+测试绿·待用户亲手走一遍真闭）。

## 2. 门 / 测试结果

```
pnpm --filter @platform/contracts build   → 绿（先 build 契约避免前端见旧类型）
pnpm --filter frontend-shell typecheck     → 绿
pnpm --filter frontend-shell build         → 绿（✓ built in 10.50s）
pnpm --filter frontend-shell exec vitest run test/wo-global-back.test.tsx
    → Test Files 1 passed / Tests 6 passed
不回归（相关既有 test）：
  f23.order-chain / f24.geo-map / f22.quarterly-rolling / f26.task-dag /
  wo-graph-3-4-fusion / f25.graph-viewpoints / f47.validation-policy / f45.growth-cockpit
    → Test Files 8 passed / Tests 26 passed
```

- **lint**：`pnpm --filter frontend-shell lint` 全仓 12 error，**全部为既有基线噪声**（f41/f56/gap-card/setup.ts/OntologyGraphEngine:80/RiskBoardView:506 的 `AffectedOrdersModal` `day` 参数——均非本 WO 触及行）。基线（stash 本 WO 改动后）=13 error，本 WO 净 **−1**（删 FieldProfilePage 未用 `Link` import），未引入任何新 lint error。

## 3. green→red→green 自证（用例真在测行为，非断言 state）

1. green：`test/wo-global-back.test.tsx` 6/6 通过。
2. red：把 `DrillBack.tsx` 的 `if (idx > 0) navigate(-1)` 改错为 `if (idx < 0) navigate(-1)`：
   → 「有历史（idx>0）→ 点返回真走 navigate(-1)」用例转 **× FAIL**（1 failed | 5 passed）——证明该用例真断言点击后 `navigate(-1)` 被调用，而非断言变量。
3. green：改回 `idx > 0` → 6/6 恢复绿。

真渲染断言（非 state 变量）：
- DrillBack 单测 mock `useNavigate` 为 spy，点击 `data-testid` 真触发 `navigate(-1)`（idx>0）/ `navigate(fallbackTo)`（idx=0）/ `navigate("/")`（idx 缺省）；trail 有 to 节点点击真触发 `navigate("/v/dash")`。
- 死路页真渲染：`renderApp("/o/Base/常州")` → DOM 真出现 `[data-testid="o360-back"]` 且含「返回」；`renderApp("/tasks/:taskId")` → 真出现 `[data-testid="task-back"]`。

## 4. DoD 逐条对照（施工单 §0）

| DoD | 落地 | 状态 |
|---|---|---|
| 1. 驾驶舱→订单全链→返回（已有·回归基线） | OrderChain 迁 DrillBack，testid 不变，f23 绿 | ✅ 代码+回归绿·待亲走 |
| 2. 搜索→对象360→左上返回→回搜索前 | `o360-back` 真渲染（测试断言）+ navigate(-1)/fallback 逻辑单测覆盖 | ✅ 代码+测试绿·待亲走 |
| 3. 历史→任务详情→返回 | `task-back` 真渲染（测试断言） | ✅ 代码+测试绿·待亲走 |
| 4. 地图/季度→风险看板(?focus)→返回 | `risk-back` 仅 focus 态显；`geo-back`/`quarterly-back`/`graph-back` 同策略 | ✅ 代码·待亲走 |
| 5. 字段核对硬编码父链→改真历史回退 | `fieldprofile-back`（fallback 保留 connections） | ✅ 代码 |
| 6. 浏览器物理后退不被破坏 | back=navigate(-1)（与后退同语义）；idx 兜底仅在栈首直链落地时改走 fallback | ✅ 语义一致 |

## 5. 诚实边界（施工单 §4 · 本次未做，明写）

- **未铺顶层 CRUD 管理页**回退（从左导航直达的非下钻页，如 Rules/Users/Features）——非「下钻落地」，R17「非决策 CRUD 页从宽」。
- **未做多级完整面包屑路径重建**——仅「当前页 + 返回」（+ 可选一级父链 trail）；深多级留后续。
- **未改路由表/后端/nav 结构**（纯前端 chrome）。
- **未亲手走真浏览器**（本 dev worktree 无浏览器；用真渲染 DOM 断言 + 门代之）——DoD 的「用户亲手走一遍」仍待人工真闭，故 R17 标 🟡 而非 🟢。
- **lint 基线红未清**（既有噪声，超本 WO 范围，未擅动无关文件）。

## 6. 距北极星（真闭）还差什么

- 需 demo/admin 登录，在真浏览器（`VITE_MOCK=1` 或 docker 全套）按 DoD 1–6 亲手走一遍：确认每页返回按钮**可见**、点击**真改 URL 回到来源页**、`?focus=` 顶层入口**不误显**、直链粘贴 `/o/<t>/<k>` 刷新后点返回**不退出站点**（走 fallback）——通过后 R17 才可标 🟢。
- 组件已抽出且各下钻页接入，行为由单测 + 全应用渲染断言双重覆盖；「绿测试 ≠ 能用」的最后一公里 = 上述人工亲走。

## 本体引用与影响

- **不变量**：R17 决策单页（`SYSTEM-ONTOLOGY.md:391`）「就地下钻不跳页；跳页则须可回」——本 WO 是 R17 在「已跳页场景」的回程兜底补全。不违 R14（组件零业务常量）、不触 R1–R16。
- **链路/对象类型/事件**：纯前端导航 chrome，不新增/不改任何链路、对象类型、`sim.*`/`*.updated` 事件、契约、门禁。
- **断点**：不涉 G-1…G-11。
- **回写**：本 WO 不改链路/事件/对象/不变量/门 → **不回写 `SYSTEM-ONTOLOGY.md`**（施工单已确认）；仅回写 `REQ-LEDGER.md:43` R17。
