# PRD — 开源优化借鉴簇·多行业可优化活租户·收口（last-mile）+ 合并验收基线

> **由来**：审核方对「外部开源优化推演项目（MIT 方法）+ 行业 OR 模型数据集（CDLA-2.0）」借鉴簇做完**逐项对码审计**（非账面），发现 **G-5（去电池多租户）/ G-12（优化融合 what-if）/ 优化模板池** 是**同一簇、同一道"最后一公里"裂缝**：机器建好、单测/门全绿，但**"真打 CP-SAT + 真立非电池行业租户 + 端到端实拍"这一公里从没在活系统发生**——又一个「绿测试≠能用」。本 PRD 把散在 `SPEC-optimization-template-pool.md` / `PRD-de-battery-multitenant-config.md` / 本体 §8 G-5+G-12「待项」的未闭项**收口为一份"真能用"交付 + 一条合并验收基线**。
>
> 🔖 **角色**（铁律0.5）：本 PRD 是**审核方据审计核发的收口设计 + 验收基线**；dev **照它实现 + 自验贴证**，**审核方按 §6 合并验收基线独立真跑复验**后才核发闭合。不动已交付的机器层。
> ⛔ **铁律0**：本 PRD 含《本体引用与影响》（§2）；交付后**必须回写**本体 §8 G-5/G-12 真实达成度 + §2.J provenance 门实例。
> 🔴 **核心红线**：**mock 引擎 / skip-by-default 集成测试 / 门空过 = 不算交付**；只有**活系统真打 CP-SAT + 真立非电池租户 + 实拍**才算（这正是本簇被记成 ◐ 的根）。

---

## 1. 北极星（一句话·用户目标）

用开源派生的**抽象优化模板池**，在**活系统**里撑起 **≥2 个行业租户**（电池 + ≥1 非电池），每个都能 **真 CP-SAT 求最优 + optimize_whatif 出 Δ目标**，真浏览器/curl 实拍——**不是门绿、不是 mock、不是 skip-by-default**。

## 2. 《本体引用与影响》（铁律0）

- **对象类型**：`OptModelTemplate` / `OntologyBinding` / `OptPerturbation` / `OptWhatifResult`（§2.J 优化融合域）· `SyntheticJob` / `IndustryTemplate` / `Tenant`。
- **链路**：`NL→comprehend⊕embedding→OntologyBinding→CP-SAT sidecar 求最优 ⊕ optimize_whatif 扰动重解→Δ目标→R4 采纳`（§3 优化融合链）· `synthetic.runJob→runStory→OntologyBinding→/opt/solve`（§5 行业租户=绑定演示）。
- **不变量**：R14（去行业锁死·两行业验收）· R6（CP-SAT seed+单线程确定性·embedding advisory 不入求解路径 FUS2）· R4（whatif 不落真值）· R13（Δ目标可溯）· R3（entitlement 暗发→404）· LIC1–4（不训练/Gurobi 不碰/MIT 署名/CDLA 取派生）。
- **断点**：**G-5**（去电池多租户）· **G-12**（优化融合 what-if）——**本 PRD 收口此二者的活系统未闭项**。
- **门**：`solver-license:check` · `opt-determinism:check` · `opt-template:check`（provenance 非空）。
- **回写要求**：交付后回写本体 §8 G-5/G-12 状态（◐ → 实际达成度）+ §2.J `OptModelTemplate` provenance 实例登记 + §3 链路「活系统已通」标注。

## 3. 已交付（机器层·不动·审计对码确认）

| 交付物 | 状态 | 锚点 |
|---|---|---|
| OptModelTemplate 契约 + 9 OR 核心模板 | ✅ | `contracts/opt-template.ts` |
| 5 CP-SAT 核心 + optimize_whatif 求解器 | ✅ | `solvers/opt-*.ts`·SOLVER_KEYS 46/46 |
| CP-SAT sidecar（真 OR-Tools） | ✅ 591 行 | `services/optimizer/server.py` |
| 端点 solve/templates/retrieve/whatif | ✅ 4/5 | `app.ts:2358-2402` |
| `opt.*` ×4 entitlement | ✅ 注册（defaultOn:false） | `features.ts:93-96` |
| 3 门 solver-license/opt-determinism/opt-template | ✅ 进 pnpm gates·绿 | `package.json:45` |
| 许可证 THIRD-PARTY-NOTICES + LIC1-4 | ✅ | `THIRD-PARTY-NOTICES.md` |

> **不要重建上面这些。** 本 PRD 只补"活系统真能用"那一公里。

## 4. 未闭项（对码审计·本 PRD 要收的）

| # | 级 | 未闭缺口 | 证据锚点（审核方对码） |
|---|---|---|---|
| **U1** | **P0** | 真 CP-SAT 在活系统从没跑：demo `opt.*` 全 `defaultOn:false` + `OPTIMIZER_BASE_URL` 未配 → 深扫实测只 graceful 400 | `features.ts:93-96`·深扫盲区② |
| **U2** | **P0** | 行业租户一个没立：只 `demo`(电池)；§5「7 行业租户演示」0 个；增量5 `synthetic→runStory` 全链未跑真链路 | `seed.ts` 仅 DEMO_TENANT·§8 G-12「待③」 |
| **U3** | **P0** | 两行业 R14 是 **mock**：`opt-two-industry.test.ts` 自述用 JS MockFive 回放；真 CP-SAT 版 `opt-real-sidecar.integration.test.ts` **`describe.skipIf(!OPTIMIZER_BASE_URL)`·默认 skip** | 两测试文件·§8 G-12「待①」 |
| **U4** | **P1** | provenance 门**空过**：5 核心是 Python 函数+TS 方法，**无已落库 OptModelTemplate 实例** | §8 G-12「待②」·`opt-template:check` |
| **U5** | **P1** | `/a/v1/opt/bindings` REST 端点缺（绑定只在测试里走 repos 直注） | `app.ts` 无该路由 |
| **U6** | **P1** | G-5 跨行业未真演示：`debattery` 基线0 只在电池标杆视图（DashboardView/LedgerView）；非电池租户视图/业务常数未验 | §8 G-5「◐ 大部修·撑不起其他行业」 |
| **U7** | **P2** | 仿真深度/分支树浅：`parentCheckpointId` 单检查点派生式分支；whatif 仅数值字段 happy-path、冲突约束 IIS 近似 | `contracts/sim.ts:69`·§8 G-12「待」 |
| **U8** | **远期** | 增量6 离线模板进化器（R16）未做 | SPEC §7·§8 G-12「待④」 |

## 5. 增量计划（收口·接现成不并行·按序）

- **增量 A（P0·活系统通电）**：① demo seed 开 `opt.solver-pool`+`opt.whatif` entitlement（出厂默认可覆盖）；② 部署/启动链接 `OPTIMIZER_BASE_URL`（起 `services/optimizer` sidecar）；③ `/opt/solve` 真 CP-SAT 出 OPTIMAL（非 graceful 400）。→ 收 U1。
- **增量 B（P0·真立非电池行业租户）**：选 1 个非电池行业（物流仓店 / SY3 vertical-farming），走**全链** `synthetic.runJob(R6)→runStory(倒序发育建本体)→OntologyBinding(facility_location)→/opt/solve→/opt/whatif`，真出最优+Δ目标。→ 收 U2。
- **增量 C（P1·provenance 真）**：落库 ≥1 个 `OptModelTemplate` 实例（带 `provenance:{derivedFrom,license}`），使 `opt-template:check` 非空过。→ 收 U4。
- **增量 D（P0·两行业 R14 真验收）**：电池 + 增量B 非电池租户，**同 `facility_location` 模板经真 CP-SAT 各出不同最优**，代码零改仅 `OntologyBinding` 不同——真 curl/浏览器实拍。→ 收 U3。
- **增量 E（P1·绑定闭环）**：补 `/a/v1/opt/bindings` REST，或确认 CLI `platform opt bind` 端到端闭环。→ 收 U5。
- **增量 F（P1·G-5 非电池视图）**：增量B 租户的业务视图过 `debattery:check`（非电池本体下无业务常数写死）。→ 收 U6。
- **增量 G（P2/远期）**：分支树深度 + whatif 覆盖面（U7）；增量6 进化器（U8）——**不在本期硬性范围**。

## 6. 合并验收基线（DoD · 真闭 = 以下全过 · 实拍 · 非门绿/非 mock/非 skip）

> 审核方将逐条独立真跑复验；dev 自验须贴**真实证据**（curl 响应/真浏览器实拍/截图路径）。任何一条用 mock/skip/门空过冒充 = 打回。

| # | 验收点 | 真值判据（FDE oracle） | 谁验 |
|---|---|---|---|
| 1 | entitlement 暗发 | demo admin 开 `opt.*`→功能可见；关→`/a/v1/opt/solve` 返 404（R3） | dev+审核方 |
| 2 | 真 CP-SAT solve | `POST /a/v1/opt/solve`（facility_location 绑电池本体）→ `status:OPTIMAL` + 真目标值（**非 graceful 400**） | 审核方 curl 实拍 |
| 3 | 非电池行业租户真立 | 贴 `synthetic→runStory→绑定` 全链证据；该租户 `/opt/solve` 出最优 | dev 贴证+审核方复跑 |
| 4 | **两行业 R14 真 CP-SAT** | 电池+非电池同 `facility_location` 经**真 sidecar**各出**不同**最优，代码零改仅 binding 不同（实拍） | 审核方独立复验 |
| 5 | optimize_whatif 真重解 | `POST /a/v1/opt/whatif`（改一系数/约束）→ Δ目标值+冲突约束（**真 sidecar 双解·非 mock**） | 审核方 curl 实拍 |
| 6 | provenance 非空 | `opt-template:check` 绿且**有真 OptModelTemplate 实例**（非空过） | dev+审核方 |
| 7 | 确定性 R6 | 同绑定同参两次 solve 字节一致 | dev |
| 8 | 许可证 | `solver-license:check` 绿 · 无 Gurobi 指纹 · 无训练管线引用 | 门 |
| 9 | 门全绿 | `pnpm gates`（含 3 优化门）绿 | 门 |
| 10 | 本体回写 | §8 G-5/G-12 状态更新为真实达成度 + §2.J provenance 实例登记 | dev 回写·审核方核 |

**真闭定义（一句话）**：在 **demo 活系统**里，**≥1 个非电池行业租户**经全链立起来、`facility_location` **真 CP-SAT 出最优**、`optimize_whatif` 出 Δ目标，**真浏览器/curl 实拍**——`pnpm gates` 绿是必要条件**不是充分条件**。

## 7. 红线（违反即返工）

- **绿测试≠能用**：mock 引擎 / skip-by-default 集成测试 / 门空过 **不算交付**；必须活系统真打 CP-SAT + 实拍。
- **R14**：模板/引擎零业务常数，行业是**绑定进来的内容**（非电池租户**代码零改**仅 binding 不同）。
- **R6**：CP-SAT seed+单线程确定；embedding/LLM 只做 advisory 听懂层，**不进求解路径**。
- **R4**：whatif 扰动重解**不落真值**（复用 `recompute(dryRun)`）。
- **LIC1–4**：绝不训练 / Gurobi 不碰不移植 / MIT 署名 / CDLA 仅取派生（不转发原始数据文件）。
- contracts-only-shared · R5 凭据不回显 · 平台术语（禁外部产品名）· 模型标识不进提交物 · 只推 `claude/vigilant-knuth-b1nmxn`。

## 8. 不在本期范围（诚实边界）

- 增量6 离线模板进化器（R16·远期）——U8。
- 7 个行业租户全立——本期只要 **≥1 非电池**证 R14 真闭，其余按需。
- 深层情景分支树 / whatif 全覆盖（U7）——可另起增量 G。
- CDLA 原始数据文件**不入仓库**（LIC4·只取派生，维持现状正确）。

---

> 证据底本：审核方对码审计（本会话）· `SPEC-optimization-template-pool.md`（机器层规格）· 本体 §8 G-5/G-12「待项」· 深扫 `wp24hdnwq` 盲区②。本 PRD **收口** 上述散状态为一份"活系统真能用"交付；机器层已交付项见 §3，不重建。
