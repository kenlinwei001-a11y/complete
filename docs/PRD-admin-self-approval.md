# PRD · Admin 自审批（可配置 · 留痕的职责分离例外）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端（审批服务）+ 轻契约 |
| 取代/扩展 | 新建 · 放宽 `actions.ts` 的硬职责分离为**可配置例外** · 解锁 R4 收尾的所有闭环（provisional→governed / 计划定稿 / in-dialog gap-fill / 数据生成转正）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R4/R13/R2 · §6 行动）· `apps/datacore/src/actions.ts:21`（`noEligibleApprover`）`:132-149`（submit 自审守卫）`:197-205`（approve 自批硬阻断）`:185-191`（list "mine" 排除发起人）· `packages/contracts/src/actions.ts:19-52`（`ApprovalStep`/`ActionDraft`）· 演示账号：admin = admin+planner+catalog_admin（CLAUDE.md）|

> 一句话：系统**硬性禁止发起人自批**——submit 时若审批角色只有发起人本人 → `NO_ELIGIBLE_APPROVER` 直接失败（actions.ts:146）；approve 时 `ctx.userId === origin.userId` → 抛"发起人不得自批"（actions.ts:205）。在**单管理员/演示租户**下,admin 既是发起人又是唯一审批人,于是**任何 Action 草稿都卡死**,导致我们设计的所有"走 R4 转正"闭环(未审核态→GOVERNED、SOP V7 定稿、对话坞 gap-fill 收尾、数据生成转正)**永远完不成**。本 PRD 把"职责分离"从**硬阻断**改为**可配置例外**:`selfApproveAllowed`(按租户/ActionType,默认仍分离)。开启时 admin 可自批,但**显式留痕 `selfApproved:true`**(R13)——不是悄悄绕过,是透明的、可审计的例外。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2 / §6 行动）：`ActionType(approvalChain, selfApproveAllowed)`·`ActionDraft(origin, approvalSteps)`·`ApprovalStep(approverId, selfApproved)`·`Tenant(selfApprovePolicy)`。
- **触及链路**（§3 / §10.3 `sys.action.writeback`）：`ActionType → ActionDraft(submit) → approval(step) → EXECUTED → ObjectInstance/真值`——在 submit 自审守卫与 approve 自批阻断处**按配置放行 + 留痕**,使单管理员也能闭合写回链。
- **触及事件/数据流**（§4）：`action.executed` 不变;自批步骤附 `selfApproved:true` 进审计。
- **触及不变量**（§5）：
  - **R4（本 PRD 放宽,核心）**:真值仍**经 Action 审批**才落——只是允许"发起人=审批人"的**可配置、留痕**例外;默认仍职责分离。**这是对 R4 的有意放宽,须回写本体 §5 注记**(R4 = 真值经审批;职责分离为默认策略、可按租户/类型配置自审,自审必留痕)。
  - **R13(留痕)**:自批**显式标 `selfApproved:true`** + 审计记录,不隐藏;答案/台账可见"该项为自审通过"。
  - **R2**:策略带 tenantId;跨租户不泄漏。
  - **R8/R3**:仍需 admin 角色 + entitlement;非授权角色不可自批。
- **关闭/影响断点**（§8）:解锁所有 R4 收尾闭环(与 `PRD-agent-data-generation-tools`/`PRD-in-dialog-gap-fill-loop`/`PRD-A18` 的"转正"步骤,以及 SOP 定稿、AOP 拍板的实际可用性)。
- **门禁**（§7）:`pnpm -r build && test`(自审/非自审双路回归)· `ontology:check`(R4 注记回写)· 不破跨服务冒烟。
- **数据闭环合规**:`// 不涉数据闭环`(审批策略,不新增/改数据/对象/字段;但**是数据闭环 M1/C2"物化走 R4"在单用户下能真正闭合的前提**)。
- **回写承诺**:R4 注记(默认职责分离 + 可配置留痕自审)+ `ActionType.selfApproveAllowed`/`ApprovalStep.selfApproved` → 回写本体 §5/§6。

## 1. 目标 / 非目标
### 目标
1. **可配置自审**:`selfApproveAllowed`——按**租户**(如 demo 默认开)与/或**ActionType**(细粒度)配置;默认 **false**(保持现职责分离)。
2. **submit 不再误失败**:开启时,自审守卫(actions.ts:135-146)把发起人计入 eligible → 不抛 `NO_ELIGIBLE_APPROVER`。
3. **approve 放行 + 留痕**:开启时,跳过"发起人不得自批"(actions.ts:205),但 `step.selfApproved = true` + 审计记录(谁、何时、自审)。
4. **list "mine" 兼容**:开启时,"待我审批"可含自己发起的(actions.ts:191 放宽);标"自审"提示。
5. **解锁闭环**:admin 在 demo 下能完成 provisional→governed / SOP V7 定稿 / gap-fill 收尾 / 数据生成转正 全流程。

### 非目标
- 不默认废除职责分离(合规场景仍 false → 现行为)。
- 不允许**非授权角色**自批(仍过角色/entitlement)。
- 不隐藏自审(必留痕,杜绝"悄悄绕过")。

## 2. 现状与缺口（带 file:line）
| 点 | 现状 | 缺口 |
|---|---|---|
| submit 自审守卫 | actions.ts:135-146 eligible 排除发起人 → 无他人即 `NO_ELIGIBLE_APPROVER`(422) | **单管理员 submit 直接失败** |
| approve 自批 | actions.ts:205 `发起人不得自批` 硬抛 | **admin 无法批自己的草稿** |
| list "mine" | actions.ts:191 排除发起人 | 自审开启后需可见自己的待批 |
| 配置位 | 无 `selfApproveAllowed` | **新增租户/类型级配置** |
| 留痕 | `ApprovalStep` 无 `selfApproved` | **新增标记 + 审计** |
| 现象 | demo 单 admin → Action 全卡 → 所有 R4 收尾闭环跑不完 | 本 PRD 解锁 |

## 3. 设计
### 3.1 配置
- `ActionType.selfApproveAllowed?: boolean`(细粒度)+ `Tenant.selfApprovePolicy: "STRICT" | "ALLOW_ADMIN" | "ALLOW_ALL"`(粗粒度兜底);**生效 = 类型显式 ∨ 租户策略允许**;默认 STRICT(现行为)。
- demo 租户默认 `ALLOW_ADMIN`(admin 自审解锁演示闭环)。
### 3.2 submit（actions.ts:135-146）
- `selfApproveAllowed` → eligible 计入发起人;`eligible.length>0` 通过,不抛 `NO_ELIGIBLE_APPROVER`。
### 3.3 approve（actions.ts:197-205）
- `selfApproveAllowed` 且 `ctx.userId === origin.userId` → **放行**,`step.approverId = ctx.userId`,`step.selfApproved = true`;审计写"自审通过(留痕)"。
- 否则维持现阻断。
### 3.4 留痕与可见（R13）
- `ApprovalStep.selfApproved` 入契约;台账/审计/答案对该项标"自审";`list "mine"` 自审开启时含自己发起项(标注)。
### 3.5 通知
- 自审无需通知他人(actions.ts:160 通知逻辑跳过或自通知"待你自审")。

## 4. 契约 / 端点
- `contracts/actions.ts`:`ApprovalStepSchema` 加 `selfApproved?:boolean`;`ActionTypeSchema` 加 `selfApproveAllowed?:boolean`;租户配置加 `selfApprovePolicy`。
- 端点:复用 `POST /a/v1/action-drafts/:id/approve`(行为按配置)· `submit`(同)。无新端点。
- 迁移:`action_types.self_approve_allowed` / 租户配置列(双仓储四处同改 R9)。

## 5. 关键流程
admin submit(自审开启→不失败)→ approve(自身→放行+selfApproved 留痕)→ EXECUTED→真值;台账显"自审通过"。STRICT 租户维持职责分离不变。

## 6. 非功能（§5）
R4(可配置留痕自审)· R13(自审必留痕)· R2(策略隔离)· R8/R3(仍过角色/门控)· 默认向后兼容(STRICT=现行为)。

## 7. 验收（DoD）
- `selfApproveAllowed` 关(STRICT):行为与现状**字节一致**(submit 无他人审批人即失败、approve 自批仍阻断)——回归锁。
- 开(demo/ALLOW_ADMIN):admin 可 submit+self-approve 同一草稿;`step.selfApproved=true` 入库 + 审计可见。
- **解锁闭环**:admin 在 demo 完成 一条 provisional→governed / SOP V7 定稿 全程(FDE 亲手跑)。
- 非授权角色自批仍 403;list "mine" 自审态含自己发起项并标注。
- `pnpm -r build && test` 全绿(双路回归)· `ontology:check`(R4 注记回写)过。
- 回写本体 §5/§6。

## 8. 分期
- **SA.1** 契约 + 配置(`selfApproveAllowed`/`selfApprovePolicy`)+ submit/approve 放行 + `selfApproved` 留痕 + demo 默认 ALLOW_ADMIN。
- **SA.2** list "mine" 兼容 + 台账/审计自审标注 + 通知调整 + 双路回归 + 本体回写。

> 立场:这不是"取消审批",是"在单用户/演示场景下,把硬职责分离改成**可配置、留痕、可审计**的例外",让 R4 收尾闭环真正可用。合规场景保持 STRICT 不变(向后兼容)。它是 `数据闭环 M1/C2`、`未审核态转正`、`SOP 定稿`、`gap-fill 收尾` 在单管理员下能闭合的**前提条件**。
