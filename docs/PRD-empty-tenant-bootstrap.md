# PRD · 空租户冷启动引导（计划域 seed → SopVersion 定稿 · 可执行清单）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端流程 + 引导（GUI/CLI/agent 三面）|
| 取代/扩展 | 新建 · 把"空租户 → 可用计划域"理成**幂等可执行清单** · 依赖 `PRD-agent-data-generation-tools`（run_synthetic 工具）+ `PRD-admin-self-approval`（SopVersion 定稿 R4）+ `PRD-data-closure-spec`（单一上传口/确定性）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R4/R6 · §6 行动 · §8 G-3）· `apps/datacore/src/seed.ts`（`seedDemo`/`seedDemoSynthetic`）· `apps/datacore/src/synthetic/battery.ts:1174`（`generatePlanDomain`）· `app.ts` 端点：`/a/v1/synthetic/jobs`(2292)·`/a/v1/sop/versions`(2515)·`/a/v1/objects`(1534)·`/a/v1/sop/versions/:id`(2532)· `apps/datacore/src/sop.ts:419`（`currentPlanVersion`）· `apps/datacore/src/livedin/engine.ts:582`（`seedSopVersions`）|

> 一句话：新/空租户没跑过合成 → `PlanTarget/AnnualScenario/SopVersion` 全空 → `currentPlanVersion` 空 → **计划审计/驾驶舱推演无料**（正是 agent 报"PlanVersion 为空"的真相）。本 PRD 把"从空到可用"理成一份**幂等、确定、可一键跑**的冷启动清单：**①合成 seed 计划域 → ②核对物化 → ③建 SopVersion → ④五步法 → ⑤定稿 FINAL（走 R4，单 admin 经自审）→ ⑥核对 currentPlanVersion → ⑦plan_audit 有料**。三面同源暴露：**GUI 引导向导 / CLI `platform bootstrap` / agent `run_synthetic`+`create_action_draft`**，全走真实端点、确定性（R6）、可重入。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2/§6）：`SyntheticJob`·`PlanTarget`·`AnnualScenario`·`SopVersion(currentPlanVersion)`·`ActionDraft(定稿月度计划版本)`·`Solver(plan_audit/plan_generate)`。
- **触及链路**（§3 / §10.3 `sys.ingest.data_to_object` + `sys.action.writeback`）：`run_synthetic → generatePlanDomain → 物化(PlanTarget/AnnualScenario/SopVersion) → createSopVersion → advance×5 → 定稿 Action(R4) → currentPlanVersion=FINAL → plan_audit/驾驶舱可用`。
- **触及事件/数据流**（§4）：`syntheticJob`/`raw_dataset.uploaded`/`action.executed`（定稿）。
- **触及不变量**（§5）：R6（合成确定性,同 seed 字节一致,清单可重入）· R4（定稿走 Action;单 admin 经 `PRD-admin-self-approval` 自审）· R2（租户隔离,每步带 tenantId）· R13（每步产出可溯）· R3（步骤受 entitlement）。
- **关闭/影响断点**（§8）：**G-3**（空租户/对话无料 → 无法推演）——本清单是"让租户从空到可推演"的引导,补 agent/CLI/GUI 三面冷启动入口。
- **门禁**（§7）：`pnpm -r build && test`（清单 e2e 回归）· 跨服务冒烟 · `cli-parity:check`（`bootstrap` 登记 OPERATION_CATALOG）· FDE 亲手跑（空租户→7 步→plan_audit 出料）。
- **数据闭环合规**：合成走 **I1 单一上传口 + M1 物化 + R6 确定** + C2 定稿 R4;`// 其余维随被触发模块`。
- **回写承诺**：`bootstrap` 编排 + OPERATION_CATALOG op → 回写本体 §3（冷启动链）+ §7（cli-parity）+ §8（G-3 冷启动入口）。

## 1. 目标 / 非目标
### 目标
1. **一份可执行清单**（§3）：空租户 → 可用计划域,每步带**端点/CLI + 预期 + 核对**。
2. **三面同源**：GUI 引导向导（空态检测→一键引导）· CLI `platform bootstrap`（一条命令跑全清单）· agent（`run_synthetic`+建 SopVersion+`create_action_draft` 工具组合）。
3. **幂等可重入**（R6）：重跑不重复污染（同 seed 字节一致;已存在则跳过/复用）。
4. **空态自检**：进驾驶舱/计划审计若 `currentPlanVersion` 空 → **提示"租户未引导,点此一键引导"**（接 in-dialog gap-fill / GUI 向导）。
### 非目标
- 不改合成/SOP/审计算法（编排既有端点）。
- 不绕过 R4（定稿仍审批;单 admin 经自审 PRD）。
- 不替代演示 `SEED_DEMO=1`（那是启动自动播种;本清单是**运行时按需引导任意租户**）。

## 2. 现状与缺口
| 元素 | 现状 | 缺口 |
|---|---|---|
| 演示播种 | `SEED_DEMO=1` 启动跑 `seedDemo`+`seedDemoSynthetic`（server.ts:42）| 仅启动期 demo 租户;**运行时空租户无引导入口** |
| 合成 | `POST /a/v1/synthetic/jobs`（2292）| 有,但用户不知"先跑这个" |
| SopVersion | `POST /a/v1/sop/versions`(2515)+ advance + 定稿 Action | 步骤散,无编排清单 |
| 空态提示 | 无 | 驾驶舱/审计空时**不提示如何引导** |
| 一键引导 | 无 | **缺 bootstrap 编排（GUI/CLI/agent）** |

## 3. 可执行清单（核心交付 · 幂等 · 确定）
> 凭证：开发态 `X-Debug-User: <tenant>:admin:admin|planner|catalog_admin`；生产态 Bearer JWT。每步"核对"未达 → 停并报缺口（诚实,不空转）。

| # | 动作 | 端点 / CLI / agent 工具 | 入参 | 预期产出 | 核对 |
|---|---|---|---|---|---|
| 1 | **合成 seed 计划域** | `POST /a/v1/synthetic/jobs` · CLI `platform synth --industry battery --scale M --seed 42` · agent `run_synthetic` | `{industry:"battery-manufacturing",scale:"M",seed:42,livedIn:true}` | SyntheticJob 完成,物化 PlanTarget/AnnualScenario/SopVersion(+lived-in 时序) | `GET /a/v1/synthetic/jobs/:id` 状态 DONE |
| 2 | **核对计划目标物化** | `GET /a/v1/objects?type=PlanTarget` · `POST /a/v1/objects/aggregate` | type=PlanTarget | 年/季/月 PlanTarget>0 | count>0;否则回 1 |
| 3 | **核对年度情景** | `GET /a/v1/objects?type=AnnualScenario` | — | 3 情景(基准/激进/保守) | count≥1 |
| 4 | **建月度计划版本** | `POST /a/v1/sop/versions` · CLI `platform sop new --month 2026-07` | `{month:"2026-07",inputs:{demTotal:132}}` | SopVersion(DRAFT) | 返回 id |
| 5 | **五步法推进** | `POST /a/v1/sop/versions/:id/advance`（step 1..5）×5 · CLI `platform sop advance --step n` | 各步 payload（产品/需求/供应/财务/决议）| s1..s5 落库,status→EXEC_MEETING | step5 通过(s4.pass) |
| 6 | **定稿 → FINAL（R4）** | `create_action_draft`（actionType=`定稿月度计划版本`）→ `POST /a/v1/action-drafts/:id/approve` · CLI `platform sop finalize`+`approve` | 版本快照 | ActionDraft EXECUTED → SopVersion FINAL（C22 锁定）| **单 admin 经 `PRD-admin-self-approval` 自审**;status=FINAL |
| 7 | **核对 currentPlanVersion + 跑 plan_audit** | `GET /a/v1/sop/versions`（找 FINAL）· `solver plan_audit` / 进规划体检视图 | — | `currentPlanVersion`=FINAL;plan_audit 出诊断(X01–X05) | currentPlanVersion≠空;审计有料 |

> 可选：步 1 用 `build_domain`（`POST /a/v1/databuilder/runs`,故事=业务问句）替代合成,产域更贴问句;步 7 后即可在驾驶舱推演。

## 4. 三面编排
- **GUI 向导**：驾驶舱/计划审计空态 → "一键引导" → 顺序跑步 1–7（进度条 + 每步核对 + 失败停在缺口）。复用 in-dialog gap-fill 的触发+反馈。
- **CLI**：`platform bootstrap --industry battery --scale M --seed 42 --month 2026-07`（一条命令串 1–7,`--json` 输出每步回执）。登记 OPERATION_CATALOG（cli-parity）。
- **Agent**：工具组合 `run_synthetic` → 读回核对 → 建 SopVersion（经 `create_action_draft` 或 SOP 工具）→ 定稿 → 核对;答案标"已引导计划域(确定性 seed)"。

## 5. 契约 / 端点
- 复用全部既有端点（§3 表）。可加一个**编排端点** `POST /a/v1/bootstrap`（串 1–7,幂等,返回逐步回执 + 终态）+ OPERATION_CATALOG `bootstrap` op。
- 契约：`BootstrapRequest{industry,scale,seed,month}` / `BootstrapReport{steps[{step,status,produced,verify}], finalVersionId, gap?}`。

## 6. 非功能（§5）
R6（幂等确定,重跑字节一致）· R4（定稿审批）· R2 · R13（逐步回执可溯）· 诚实（步骤核对未达即停报缺口,不空转）。

## 7. 验收（DoD）
- 空租户跑清单 1–7 → `currentPlanVersion`=FINAL,plan_audit/驾驶舱有料（FDE 亲手跑）。
- **幂等**：重跑不重复污染（同 seed 字节一致;已存在跳过）。
- 三面（GUI 向导 / CLI bootstrap / agent 组合）均能完成且产出一致。
- 定稿走 R4（单 admin 经自审）；任一步核对未达 → 停并报缺口码,不假装成功。
- `pnpm -r build && test` 全绿（bootstrap e2e）· 冒烟 · `cli-parity:check` 过。
- 回写本体 §3/§7/§8。

## 8. 分期
- **BS.1** `POST /a/v1/bootstrap` 编排端点（串 1–7,幂等,BootstrapReport）+ CLI `platform bootstrap`。
- **BS.2** GUI 空态向导（驾驶舱/审计检测 currentPlanVersion 空 → 一键引导）+ in-dialog 触发对接。
- **BS.3** agent 工具组合（接 `PRD-agent-data-generation-tools`）+ 定稿自审（接 `PRD-admin-self-approval`）+ 全链回归。

> 依赖闭环：本清单的步 6（定稿）依赖 `PRD-admin-self-approval`（单 admin 自审），步 1（合成）依赖 `PRD-agent-data-generation-tools`（agent 触发）。三者合起来 = 空租户在对话/CLI/GUI 任一面**一键从空到可推演**。基线分支：编排端点 + CLI + 前端向导,复用既有端点,冲突小。
