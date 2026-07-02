# WO-AUDIT-LOG-UI · FDE 亲手真跑证据（G-VIS-1 首单·合规审计日志前端落地）

> 目标（用户视角）：管理员做过一次管理变更后，能在前端【审计日志页】看到「谁(actorId)何时(at)对什么(targetKind)做了什么(action)、改前改后(before/after)」——而非此前后端 `GET /a/v1/audit-log` 返真条目、前端 audit-log 零命中（无页无路由无 endpoint），产品内根本看不到审计轨迹。
>
> 断点：G-VIS-1「后端产物真存·前端无处可见」的 IPO 断层（路3·决策/推演/写回簇首条）。

## C1 · 后端审计有真值（真 curl · 内存态 datacore :4001）

起服务：`PORT=4001 JWT_SECRET=dev BLOB_DIR=… SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`

baseline：`GET /a/v1/audit-log -H'X-Debug-User: demo:usr-planner:admin'` → `total=1`（seed features.updated 一条·含 before/after）。

真变更（append 语义）：`PATCH /a/v1/tenants/demo/users/usr_demo_base_manager -d '{"displayName":"审计验证-改后"}'` → 200。

变更后 `GET /a/v1/audit-log` → **`total=2`（1→2·append-only 只增）**，顶条：

```json
{
  "at": "2026-07-02T02:49:10.178Z",
  "actorId": "usr-planner",
  "action": "iam.user.updated",
  "targetKind": "user",
  "targetId": "usr_demo_base_manager",
  "before": { "roles": ["base_manager:常州"], "status": "ACTIVE" },
  "after":  { "roles": ["base_manager:常州"], "status": "ACTIVE", "displayName": "审计验证-改后" }
}
```

断言（C1 全绿）：`length>0` ✅；条目含 `{at, actorId, action, targetKind, before, after}` ✅；`actorId`=真操作者(usr-planner) ✅；`before/after` 反映**真实变更**（`after` 多出 `displayName:"审计验证-改后"`·`before` 无）✅。

## C2/C3/C4 · 前端消费（jsdom `renderApp` 集成渲染 · 本仓 admin 页验收范式）

测试 `apps/frontend-shell/test/audit-log.test.tsx`（4 用例·全绿·`renderApp("/admin/audit-log")` 真 router + MSW + 组件树）：

- **C2 页存在+路由+注册**：`App.tsx` lazy `admin("audit-log", <AuditLogPage />)`；`adminRegistry.ts` 注册 `{path:"audit-log",label:"审计日志",roles:["admin","auditor","platform_admin"]}` 且归入 **平台治理组**（`ADMIN_NAV_GROUPS.governance.paths` 含 audit-log → `f61.admin-nav-groups` 门无遗漏/无「其它」兜底断言通过）→ 导航可达。
- **C3 前端显同条 + before→after diff**：`renderApp` 后表格出现 `audit-row-aud_1`（actor `usr_demo_admin`·action `features.updated`·targetKind `feature_config`）·展开 `audit-diff-aud_1` 见 before(`defaultOn:false`)→after(`defaultOn:true`)。前端所见 = 后端真值（R13 可溯源）。
- **C4 筛选真生效**：action 下拉选 `rule.published` → 仅 aud_3 留（aud_1/aud_2 消失·客户端过滤·后端端点不支持 action）；actor 输 `usr_demo_planner` → 后端过滤只回 aud_3。
- **空态诚实**：后端返 `{items:[],total:0}` → 显 `audit-empty` 引导「做一次管理变更后此处记录」·**不伪造记录**（诚实空态·反假红同源纪律）。

**牙齿自证**：把 `rows = action ? items.filter(…) : items` 改成 `rows = items`（筛选装饰化）→ C4 用例转红（`Tests 1 failed | 3 passed`）；还原 → 4 绿。证测试真咬合消费逻辑而非摆设。

## C5 · API 层（gate）

`rg fetchAuditLog apps/frontend-shell/src/api/endpoints.ts` 命中；类型 `AuditLogEntry` import 自 `@platform/contracts`（未重定义·contracts-only-shared）。`App.tsx` 命中 lazy import + 路由。

## C6 · 回归四包全绿

- `pnpm -r build` → exit 0。
- datacore **860 passed** / 15 skipped；agentcore **360 passed** / 1 skipped；frontend **331 passed**（327→331·+4 审计页用例·其余不回退）；contracts build ✅。
- `pnpm gates` → exit 0（含 audit-actor:check / genuine-sim v2 等全套）。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md §8` 新增 **G-VIS-1** 断点（IPO 可见性断层类·同 G-DM-1 可见性版），标 ◐ 逐单闭合，AUDIT-LOG-UI 为首单 ✅。

## 距北极星还差什么（诚实边界）

- **C2/C3/C4 以 jsdom 集成渲染证**（真 router+MSW+组件树·本仓 `admin-closure-*` 全系列同范式），**非真浏览器截图**——headless 环境未起前端+网关全栈拍图；消费逻辑（页渲染/表显真条/diff 展开/筛选收窄/空态诚实）已被 renderApp 门 + 牙齿自证覆盖。
- **G-VIS-1 尚余 4 P0**（CALIB-CONVERGENCE-UI / INTAKE-VISIBILITY / KB-UI / SOLVER-BINDING-UI）+ 7 P1/P2 未落·在 loop 队列逐单推进。
- 审计**外送**（SIEM）另由 G-SIEM-1（已闭·AuditSink）承载·本页只做**产品内可见**（本地 audit-log 前端消费）。
