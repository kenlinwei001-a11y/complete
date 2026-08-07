# PRD 实现状态对账 · 第 2/5 批（22 份）

| 项 | 值 |
|---|---|
| 范围 | `ls docs/PRD-*.md \| sed -n '23,44p'` 得到的 22 份 |
| 方法 | 只读代码 + 只写本文件。每条判断带 `file:line`；查不出的写「未查清 + 卡在哪」 |
| 基线 commit | `8e3e91a677c6c860daeff4d0826af263e5852972`（branch `wave4`） |

## 0. 审计纪律（本次遵守的判据，及踩到的坑）

1. **必读 PRD 自己的 AS-IS 节**（「现状与缺口」/「已有资产」/「今天做不到的」）。本批 22 份中带显式 AS-IS 表的有
   `admin-self-approval §2`、`agent-data-generation-tools §2`、`capacity-inference-completion §2`、
   `data-gap-self-healing-loop §2`、`cli-full-coverage §2` 等；其余多为「本体引用与影响」节（非 AS-IS）。
2. **禁用 mtime / 待办状态判断实现与否**（范畴错误）——本文一次都没用。
3. **区分三种「不工作」**：❶没接线（调用方只有 test）❷接了线没数据（输入恒空/配置恒缺，分支 never 进）
   ❸接了线接错地方（挂错路径）。本批实测到的**绝大多数缺口是 ❷/❸，不是 ❶** —— 这正是"grep 到符号就说没做"会错的原因。

### ⚠ 本次审计工具两次骗我（自证记录）

- `git grep -- 'apps/*/src'` 对**确定存在**的符号 `probeMissingRefs` 报 **0 命中**（pathspec 的 `*` 不跨 `/`），
  而 `git grep -- 'apps/**/src/**'` 报 4 处（`apps/agentcore/src/resources.ts:11` 等）。**全程改用 `rg`。**
- `rg -rn "<pattern>"` 中的 `-r` 是 ripgrep 的 **`--replace`**，不是 "recursive"。
  结果：`apps/agentcore/src/server.ts:1252` 的真实文本 `c.skillKey === skill.key` 被打印成 `c.n === skill.key`，
  差点据此判「skillKey 字段不存在」。**报 0 命中或读到反常文本前，先拿已知符号自证工具。**

---

## 1. 逐份对账

### docs/PRD-addendum-replay-orchestrator.md
- **它要做什么**：用 6 个虚拟人员（persona）经**真实 API**（QOS 提问/S2 审批/S&OP 五步/求解/孵化）把运营态历史"跑"出来，
  使任务史/审批史/S&OP 史有真实事件流可下钻；并给真实租户一套 `OpsSchedule`（定时预测/S&OP 半自动/审批催办）。
- **PRD 自称的 AS-IS**：无独立现状节；§4「与既有 PRD 的修订关系」声明它**取代**运营态 PRD §1.2 的"预置记录"方案。
- **实测现状**：
  - 契约 `packages/contracts/src/replay-ops.ts`（139 行）+ 迁移 `apps/datacore/migrations/010_replay_ops.sql`。
  - 编排器 `apps/datacore/src/opsteam/replay.ts`（253 行）实现全部 6 类 OpsAction（ask/run_forecast/review_actions/
    sop_cycle/adopt_mitigation/promote_intent），R1 红线在文件头声明且**代码确实零 Store/Repo import**。
  - §3-① 挂载点真实存在：`apps/datacore/src/simclock.ts:132`（tick 第⑦步）→ `apps/datacore/src/app.ts:742`
    `simclock.setOpsPlaybookRunner(...)`，内含隔离守卫 `app.ts:743` 与幂等检查点 `app.ts:747-749`。
  - 6 人编制与默认剧本 `apps/datacore/src/opsteam/defaults.ts:10 / :61`，随 lived-in 合成自动播种：
    `apps/datacore/src/livedin/engine.ts:244` → `apps/datacore/src/app.ts:616-619`（**非只 test 调用**）。
  - §6 OpsSchedule 三类作业全接 S3 调度器：`apps/datacore/src/app.ts:768-775`
    （`SCHEDULED_FORECAST` / `SOP_AUTO_OPEN` / `APPROVAL_REMINDER`）；实现 `apps/datacore/src/opsteam/schedule.ts`（229 行），
    `autoApprove` 默认关 + 白名单 + 全审计（`schedule.ts:60-61, :168-169`）。
  - 端点齐：`/a/v1/ops/{personas,playbook,pools,tick-reports,schedule,auto-ask}`（`app.ts:4382-4411`）；
    前端管理页 `apps/frontend-shell/src/pages/admin/OpsSchedulePage.tsx` + 测试 `apps/frontend-shell/test/f40.ops-schedule.test.tsx`。
  - 验收 R1–R13 **逐条有测试**：`apps/datacore/test/replay-ops.test.ts:53,60,81,112,152,173,211,235,250,268,305,318`。
- **结论**：◐ 部分（**主干全通，两处「接了线没数据/没配置」使两类动作在出货形态下恒不触发**）
- **缺的那半（两条，都是 ❷ 型，不是没接线）**：
  1. **`promote_intent` 恒不触发**：数据源函数在生产接线处被写死为空数组 ——
     `apps/datacore/src/app.ts:697` `listFallbackClusters: async () => []`。
     `replay.ts:241-243` 拿到空数组必然 `return { skipReason: "no fallback cluster at threshold" }`。
     对照：测试里传的是 `["fbt_demo_1"]`（`apps/datacore/test/replay-ops.test.ts:41`）——
     **生产实参与测试实参交集为空**，测试三周来验的是生产没走的那条路（CLAUDE.md 铁律 0.5 第 6 条同型）。
     ⇒ §2 的 `promote_intent`、§4「意图孵化记录」这一行在真实运行中**从未产生过记录**。
  2. **`ask` / `promote_intent` 在出货容器里恒跳过**：两者都以 `config.AGENTCORE_BASE_URL` 为开关
     （`apps/datacore/src/app.ts:668, :698`，未配则注入 `null`，`replay.ts:142` / `:240` 直接 skip）。
     而 `docker-compose.yml` 的 datacore 环境段（第 70–90 行）**没有 `AGENTCORE_BASE_URL`**
     （只有 agentcore 侧有反向的 `DATACORE_BASE_URL: http://datacore:4001`，`docker-compose.yml:113`）。
     ⇒ 验收 R2「任务史可下钻」与 §3-4「运营态 PRD §1.2 的任务/对话史由本机制取代」在
     `docker compose up` 的部署形态下**产出为零**。这是 ❸ 型的近亲：能力接了，部署没接。
- **另记（非阻断，诚实差异）**：§3-3 要求"每个动作以对应 persona 的**真实 JWT** 执行"，
  实测走的是 `x-debug-user` 头（`app.ts:673, :703`），依赖 `ALLOW_DEBUG_USER=1`（`docker-compose.yml:80` 默认开）。
  OBO 语义等价但**生产关掉调试后门即失效**。
- **最小 WO 建议**：
  - `WO-RO-1`（轻）：把 `app.ts:697` 的 `listFallbackClusters` 接到 AgentCore 的兜底簇聚类
    （`apps/agentcore/src/ops/fallback.ts` 已有 `MERGE_COSINE` 聚类，见 `:21`），或经 `/b/v1/ops/fallback-stats` 拉取。
    🚦范围边界：`apps/datacore/src/app.ts`（仅该 lambda）+ 一条 seam 测试。
  - `WO-RO-2`（轻）：`docker-compose.yml` datacore 环境段补 `AGENTCORE_BASE_URL: http://agentcore:4002`；
    并把 persona 调用从 `x-debug-user` 换成服务签发的短期 JWT。
    🚦范围边界：`docker-compose.yml` + `apps/datacore/src/app.ts:668-712`。

---

### docs/PRD-addendum-skill-authoring.md
- **它要做什么**：把"优秀技能"定义成**可 lint、可评测的客观属性**——summary 强制模板、body 七段骨架、
  发布必过「结构 lint」+「评测门禁（≥3 条 skill_quality 用例，含行为增益）」两道门。
- **PRD 自称的 AS-IS**：无现状节；§0 本体节自陈诚实边界——"mock LLM 下评测分数仅证管线与断言框架正确，
  接 REAL 模型后才是真质量分"（`docs/PRD-addendum-skill-authoring.md:40`）。
- **实测现状**：
  - **门禁一（结构 lint）已实现且已接生产发布路**：`apps/agentcore/src/skill-lint.ts`（13,987 字节）导出 `lintSkill`（`:234`），
    生产调用点 `apps/agentcore/src/server.ts:1246`（`POST /b/v1/skills/:id/publish`）与编辑器干跑 `:1308`。
    规则逐条对上 §2/§3：`summary.maxLength(200)` `:245`、`summary.triggerTemplate`（正则 `/当[\s\S]+时使用/`）`:247`、
    `summary.exclusion`（`/不适用[:：]/`）`:250`、`summary.forbiddenWord` `:255`、`body.maxLength(3000)` `:261`、
    `body.section`（七段骨架）`:266`、`body.positiveExample` `:271`、`body.negativeExample` `:274`、
    `body.resourceRef` `:282`、`body.unknownTool`（注册表反查，SA4）`:294`、`metadata.dependencyCycle` `:310`。
  - **门禁二（评测门禁）已实现且已接生产**：`server.ts:1252`（≥3 条 skill_quality 用例）、
    `:1259-1266`（三类各 ≥1 的**覆盖率判别**，非只数数）、`:1269-1272`（`runSkillProbe` 真跑，passRate<1 即 422）。
    `SkillProbeRunner` 生产化路径 `apps/agentcore/src/evals.ts:41,55` → `apps/agentcore/src/skill-probe.ts:85`。
  - 代码里留了一条**自我纠错注释**（`server.ts:1243-1245`）：曾漏传 `ctx.allSkills` 导致跨资源规则"接了没通"、
    lint 恒过而单测仍绿——与本次审计的判据同源，已修。
  - 测试：`apps/agentcore/test/skill-lint.test.ts` / `skill-probe.test.ts` / `skill-eval-gate.test.ts`。
- **结论**：◐ 部分（**两道门本体全通，§2 一条 lint 子规则与 §5 出厂配套缺失**）
- **缺的那半**：
  1. **§2 末条「多技能互斥：同一 agent 的技能 summary 两两做触发场景重叠检查（编辑器警告）」= ❶ 没接线（根本没实现）**。
     跨中英双名搜过：`overlap|重叠|mutex|互斥|triggerOverlap|summaryOverlap|conflictingSkills` 在
     `apps/agentcore/src` + `apps/frontend-shell/src` 的命中全部属于**无关模块**
     （`dril/search-engine.ts:207`「词法重叠比」、`agent/skill-router.ts:36`「词法重叠计数」、
     `agent/mcp-router.ts:20`），无一处做 skill 两两 summary 重叠告警。
  2. **§5 出厂范例名不对版（⚠ 但实质在）**：PRD 点名的 `production-capacity-interpretation` 全仓只出现在 PRD 自己身上
     （`docs/PRD-addendum-skill-authoring.md:94`），零代码命中。
     **但别据此说"没做"**——电池场景包实际内置的是同一件事、不同 key：
     `apps/agentcore/src/mocks/seed.ts:1018` `key: "capacity_analysis"`（"产能分析方法论"），
     summary/body 七段完全按 §2/§3 模板写，连 §5 点名的反例"直接平均 P50 和 P90"都逐字在
     `seed.ts:1040`。**这是"同一个东西前后不同名"，判为实质已交付、命名与 PRD 不符。**
  3. **门有、料没有（❷ 型）**：`apps/agentcore/src/mocks/seed.ts` 里 `suite:` 与 `skillKey` **零命中**——
     出厂 5 个 skill（`seed.ts:1016` 起）**一条 skill_quality 用例都没配**，它们是直接以
     `status: "PUBLISHED"` 播种、绕过发布门的。⇒ §4 "每技能发布必附 ≥3 条 EvalCase" 对**出厂技能未生效**；
     谁在 demo 租户改一版再发布，就会撞 422 `SKILL_EVAL_INSUFFICIENT`。
- **最小 WO 建议**：
  - `WO-SA-1`（轻）：给 5 个出厂 skill 各补 3 条 skill_quality EvalCase（应触发/不应触发/行为增益）。
    🚦范围边界：`apps/agentcore/src/mocks/seed.ts` + 一条"出厂技能能过自己的发布门"回归测试。
  - `WO-SA-2`（轻）：实现 summary 触发场景两两重叠检查（lint warning 级，不阻断发布）。
    🚦范围边界：`apps/agentcore/src/skill-lint.ts` + `apps/agentcore/test/skill-lint.test.ts`。
  - `WO-SA-3`（极轻）：把 PRD §5 的 key 改为 `capacity_analysis`，或把种子 key 改名对齐——二选一，别两边都留着。

---

### docs/PRD-addendum-solvers-and-gaps.md
- **它要做什么**：把 Mock 求解器替换为**真实算法规格**（S1.1–S1.8 八个求解器逐条给公式），
  并补四项缺口：S2 Action 审批流、S3 调度器、S4 VectorIndex 消费方（知识库检索 + 两个次级消费方）。
- **PRD 自称的 AS-IS**：无现状节；§0 声明触及断点 G-1/G-2/G-8。
- **实测现状**（逐节核，全部有 file:line）：
  - **S1 八求解器全部注册**：`apps/datacore/src/solvers/service.ts:4187-4217` 可见
    `capacity_rollup` `capacity_forecast` `bottleneck_matrix` `risk_timeline` `affected_orders` `plan_audit`
    `plan_generate`（+ `counterfactual_timeline` / `audit_timeline` / `capex_scenario` 等 PRD 之后新增的）。
    实现分布在 `solvers/capacity.ts` `risk.ts` `plan.ts` `aggregates.ts` `extended.ts` 等 26 个文件。
  - S1.2 常数对得上：`certFactors` 参数化（`solvers/capacity.ts:263,489`，非写死，符合§9"常数进 solverParams"）、
    `curveMult` 爬坡 0.88+0.03(w−1)/w≥4、检修 ×0.72（`capacity.ts:346-347`）、
    `p90 = p50 × healthFactor` 且健康度降级二选一（`capacity.ts:443,526`）。
  - S1.6 `plan_audit` 规则表 X01–X05/R01/R02 逐条在 `apps/datacore/src/solvers/plan.ts:53,70,93,111,130,161,170`，
    评分 `score = clamp(100 − scoreH×|H| − scoreM×|M|, 0, 100)`（`plan.ts:223`，阈值参数化）。
  - S1.7 `plan_generate` 五路径 + hardViol + 五维评分：`plan.ts:237,290-311`。
  - **S2 Action 审批流**：状态机 + 九个端点全在 `apps/datacore/src/app.ts:3048-3134`
    （create/submit/list/get/approve/reject/decision/cancel/audit），与 §S2.3 逐条对齐（多一个 `/decision`）。
  - **S3 调度器**：`apps/datacore/src/scheduler.ts:33`（30s tick）、多副本安全 `FOR UPDATE SKIP LOCKED`
    （`apps/datacore/src/repo/pg.ts:386`）、`MISSED` 不补跑（`scheduler.ts:16,103`）、
    API `/a/v1/scheduler/jobs[/:id/pause|resume|runs]`（`app.ts:4009-4021`）。
  - **S4.1 知识库语义检索**：`apps/datacore/src/kb.ts` + `appsls/embeddings.ts`（`apps/datacore/src/embeddings.ts`）
    + 迁移 `apps/datacore/migrations/002_addendum.sql`；工具 `search_knowledge` 在
    `apps/agentcore/src/tools/registry.ts` 与 `tools/executor.ts` 均有；测试 `apps/datacore/test/kb.test.ts`。
  - **S4.2 两个次级消费方都真做了**（这类"顺带实现"最常被砍，实测在）：
    ① 规则候选去重 `apps/datacore/src/ruledocs.ts:107`（阈值默认 0.92）→ `:110,:135` 打 `suspectedDuplicateOf`，
       契约字段 `apps/datacore/src/domain.ts:183`，前端消费 `apps/datacore/src/app.ts:3338` `duplicateOf`。
    ② QOS 兜底语义聚类 `apps/agentcore/src/ops/fallback.ts:21` `MERGE_COSINE = 0.9` + `:34-50` 两级聚类
       （精确 normalizedQuery → 向量近邻合并），embedding 落库字段 `apps/agentcore/src/persistence/repos.ts:28`。
- **结论**：✅ 已实现（S1–S4 主体全部落地并接线；下列为**规格与实现的诚实偏离**，非缺口）
- **⚠ PRD 自身陈述与现状不符（3 处，均为"实现比 PRD 更新/更细"）**：
  1. **S1.2 的 P50 公式已不止 PRD 写的三项**。PRD §S1.2-3 写
     `P50 = Σ 周产能 × certFactor × curveMult`；实测公式多两个因子：
     `apps/datacore/src/solvers/capacity.ts:278,304`
     `p50 = 工序产能 × 认证系数 × **良率基线再基(yieldRebase)** × **物料齐套(matFactor)**`。
     PRD 未回写。
  2. **S1.2 未覆盖"非整数周窗口"**，实现里加了 `windowScale` 线性折算并**在代码里自陈这是近似**：
     `capacity.ts:458`「诚实披露（本体 §5 已回写）：非整数窗口按线性比例折算；跨周时爬坡曲线 curveMult 做混合近似」。
     ⇒ 本体已回写、PRD 没有。
  3. **S1.7 的三方案映射规则与 PRD 相反**。PRD §S1.7 写"稳健（路径 A）/ 均衡（路径 E）/ 进取（路径 C 或 B）**固定映射**"；
     实测是**动态择优**：`apps/datacore/src/solvers/plan.ts:315`
     「先锁 稳健(盈利+现金+稳健 max，可行优先) 与 进取(规模+增长 max，全集)，再从剩余可行取 total max 为 均衡」，
     且注释标明依据是原型 HTML `gen3Plans`（`plan.ts:369`）而非本 PRD。⇒ 读 PRD 的人会以为路径固定，实际不是。
- **最小 WO 建议**：`WO-SG-1`（极轻·纯文档）：回写 PRD §S1.2 公式（补 yieldRebase/matFactor/windowScale）
  与 §S1.7 三方案选取规则（改"固定映射"为"动态择优 + 依据"）。
  🚦范围边界：`docs/PRD-addendum-solvers-and-gaps.md` 单文件，不动代码。

---

### docs/PRD-addendum-validation-loop.md
- **它要做什么**：闭环验证引擎 VLE ——用已知真值的模拟数据跑七段全链路，
  用**独立预言机**（构造真值/参照实现/不变量）逐段比对，把"工程验证度"从主观评分变成可量化报告；
  并把 SMOKE 接成合并门禁。
- **PRD 自称的 AS-IS**：无现状节；§6 有明确"不验证什么"的边界声明（业务参数真实性/agent 回答质量/校准统计表现）。
- **实测现状**：
  - **主体真在**：`apps/datacore/src/vle.ts`（429 行）+ 独立参照预言机 `apps/datacore/src/vle-oracle.ts`。
    七段规范段名硬编码为清单 `vle.ts:22`，**三覆盖率与工程验证度公式逐字实现**：
    `vle.ts:411-415` `score = 0.5×moduleCov + 0.3×assertionCov + 0.2×loopCov`（与 PRD §5 一致），
    且 `assertionCov = 已覆盖规范段/7`（`vle.ts:412-413`，代码注释明说"不再硬编码 1，诚实反映"）。
  - **§2「参照实现禁止 import 被测模块」真守住了**：`vle.ts:9-13` 声明并注入 `SolverInvoke` 而非 import
    `solvers/service`；静态门 `scripts/check-validation.mjs:34-58` 真扫这条红线（V9）。
  - 端点 `POST/GET /a/v1/validation/runs[/:id]`：`apps/datacore/src/app.ts:1328,1339,1346`；
    仓储三处齐（`repo/repo.ts` `repo/memory.ts` `repo/pg.ts`）；迁移 `migrations/012_operational_completeness.sql`。
  - 前端页真在：`apps/frontend-shell/src/pages/admin/ValidationPage.tsx` +
    `apps/frontend-shell/test/vle-segment-matrix.test.tsx`；API `apps/frontend-shell/src/api/endpoints.ts:918-921`。
  - 测试：`apps/datacore/test/vle.test.ts` / `vle-acceptance.test.ts` / `vle-reference-dualcompute.test.ts`。
- **结论**：◐ 部分（**引擎与度量全通，CI 门未接线 + profile 三档是装饰**）
- **缺的那半（两条）**：
  1. **CI 门 = ❶ 没接线（脚本已建，零生产调用方）**。`scripts/check-validation.mjs` 存在且实现完整（V10+V9），
     但它**不在 `pnpm gates` 的 23 条门里**（`package.json:32` 逐条数过，无 `check-validation`），
     也不在 `scripts/gate.sh`（`:42-59` 只跑 build + `check-genuine-sim` + `pnpm gates` + `check-ontology-writeback`），
     `.github/workflows/gates.yml:53-58` 同理。⇒ PRD §4-4「SMOKE 红 → 合并阻断」**今天拦不住任何东西**。
     **本体自己是诚实的**：`docs/SYSTEM-ONTOLOGY.md:829` 明写「**已建但当前未接线**（门账 `disposition=WIRE` · 待接线 WO）」。
  2. **profile SMOKE/FULL/SOAK 只是标签（❷ 型）**。`vle.ts:68` 收下 profile 后，
     整个 `run()` 体内对它**只有两处使用**：传给 `buildReport`（`vle.ts:237`）和写进记录（`:241`）——
     **零分支**。⇒ PRD §4 规定的三档差异（S/M/L 规模、30/365 tick 全回放、混沌注入、三角色权限全息）
     全部未实现：`run()` 恒定跑 `scale: "S"`（`vle.ts:80`），无 tick 推进、无混沌、无权限横切段。
     §3 断言矩阵里的「横切 A6 三角色」「横切 执行语义 混沌注入」两行**没有对应断言**。
  3. 因此 §7 的 VL4（闭环收敛）/VL5（混沌 kill）/VL8（同 seed 两次 FULL 逐字段一致）**未查到实现**，
     VL2/VL3 有（经 `VleRunOptions.injectFault`，`vle.ts:44-47`）。
- **最小 WO 建议**：
  - `WO-VLE-1`（轻·产出最高）：把 `check-validation.mjs` 并入 `pnpm gates`（`package.json:32`）与本体 §7 门账
    `disposition` 改 `WIRED`。这是"一条线"而非"一道门"——门已经造好了。
    🚦范围边界：`package.json` + `docs/SYSTEM-ONTOLOGY.md` §7 + `scripts/gate-ledger.json`。
  - `WO-VLE-2`（重）：实现 profile 分档（FULL 走 M 规模 + 365 tick 回放 + 混沌注入 + 三角色横切）。
    🚦范围边界：`apps/datacore/src/vle.ts` + `apps/datacore/test/vle*.test.ts`。

---

### docs/PRD-admin-self-approval.md
- **它要做什么**：把"发起人不得自批"的**硬阻断**改为**可配置、留痕**的例外（`selfApproveAllowed` / `selfApprovePolicy`），
  让单管理员/演示租户下的 R4 收尾闭环（provisional→governed / SOP 定稿 / gap-fill / 数据生成转正）能真正跑完。
- **PRD 自称的 AS-IS**（§2 现状与缺口，**带 file:line 的真 AS-IS 表**）：
  submit 守卫 `actions.ts:135-146` 排除发起人 → 无他人即 422 `NO_ELIGIBLE_APPROVER`；
  approve `actions.ts:205` 硬抛"发起人不得自批"；list "mine" `actions.ts:191` 排除发起人；
  无 `selfApproveAllowed` 配置位；`ApprovalStep` 无 `selfApproved` 字段。
- **实测现状**（PRD 描述的缺口**已全部补上**）：
  - 策略枚举与解析：`apps/datacore/src/actions.ts:360` `type SelfApprovePolicy = "STRICT"|"ALLOW_ADMIN"|"ALLOW_ALL"`，
    `:369-371` env `SELF_APPROVE_POLICY` 优先、`tenantId === "demo"` → `ALLOW_ADMIN`、其余 `STRICT`（向后兼容）。
  - 生效判定 `actions.ts:375-379`（类型显式 ∨ 租户策略，`ALLOW_ADMIN` 校验 `baseRole(r)==="admin"`）。
  - §3.2 submit 放行：`actions.ts:575`；§3.3 approve 放行 + 留痕：`actions.ts:662-663`
    （`if (!selfApproveAllowedFor(...)) throw invalidStep("发起人不得自批")` / `pending.selfApproved = true`）。
  - §3.4 list "mine" 兼容：`actions.ts:632,636`。
  - 契约落地：`packages/contracts/src/actions.ts:27` `selfApproved`、`:147` `selfApproveAllowed`。
  - 消费方证据（不是孤岛）：`apps/datacore/src/app.ts:4147` 定稿失败时的 hint 直接引用本策略
    「定稿失败：单 admin 需 SA 自审（demo 默认 ALLOW_ADMIN，生产配 SELF_APPROVE_POLICY/类型 selfApproveAllowed）」。
  - 测试：`apps/datacore/test/admin-self-approval.test.ts`。
- **结论**：✅ 已实现（含 §7 DoD 的双路回归）
- **⚠ PRD 自身陈述与现状不符（1 处，轻）**：§4 契约节写"迁移：`action_types.self_approve_allowed` / **租户配置列**（双仓储四处同改 R9）"，
  实测**租户级策略没有落库列**，是 env + 硬编码 `demo` 判定（`actions.ts:365` 注释自陈"确定性、**零迁移**"）。
  ⇒ 想给 demo 之外的租户单独开自审，今天只能改全局 env（`SELF_APPROVE_POLICY`），无法按租户配。
  这是有意的简化，但 PRD 没回写，读者会去找那张表。
- **最小 WO 建议**：`WO-ASA-1`（轻，且**优先改 PRD 而非改码**）：把 §4 的"租户配置列"改成
  "env `SELF_APPROVE_POLICY` + demo 默认，零迁移；如需按租户配置再补列"。
  🚦范围边界：`docs/PRD-admin-self-approval.md` 单文件。

---

### docs/PRD-agent-data-generation-tools.md
- **它要做什么**：给 agent 三把**合规产数据工具** `fill_data`/`run_synthetic`/`build_domain`——
  触发确定性合成（≠ 伪造），数据落 PROVISIONAL 未审核态，agent 再用 `query_*` 读回真实物化值推演。
- **PRD 自称的 AS-IS**（§2，**带 file:line 的真 AS-IS 表**）：
  `BUILTIN_TOOLS`（registry.ts:4）只有读/查 + `create_action_draft` + 工单，**无三工具**；
  `fillData` 客户端已在（clients.ts:31 → datacore-http.ts:93）但未注册成工具；
  `/a/v1/synthetic/jobs` 与 `/a/v1/databuilder/runs` 端点已在但 agent 无客户端。
- **实测现状**（PRD 断言的缺口**已补**）：
  - 三工具已进注册表：`apps/agentcore/src/tools/registry.ts:295 fill_data` / `:312 run_synthetic` / `:329 build_domain`
    （成组注释在 `:290`）。
  - executor case 三处齐：`apps/agentcore/src/tools/executor.ts:413 / :422 / :431`。
  - §3.1「回执只含元信息」+ §3.2「PROVISIONAL 标注」**逐条兑现**：三个 case 的返回值均为
    `{ ...r, provisional: true, _note: "未审核合成数据（PROVISIONAL）：业务数字请用 query_* 读回真实物化值…" }`
    （`executor.ts:420, :429, :437`）——回执确实不含业务数字。
  - 空租户引导提示也接上了：`executor.ts:382` 对象类型存在但 0 实例时提示
    「请先 run_synthetic/bootstrap 合成计划域，而非判定"无数据"」。
- **结论**：◐ 部分（**三工具全通，§7 DoD 的 CLI 同源只做了 2/3**）
- **缺的那半**：
  **`fill_data` 未登记 `OPERATION_CATALOG`（❶ 型缺口，另两个在）**。
  `packages/contracts/src/operation-intent.ts` 的 OPERATION_CATALOG 里
  `synth`（`:59`，endpoint `/a/v1/synthetic/jobs`）与 `build`（`:60`，endpoint `/a/v1/databuilder/runs`）都在，
  但全表 40 个 op 中**没有对应 `/a/v1/growth/fill-data` 的条目**（`fill` 在该文件零命中；
  最接近的 `growth`（`:90`）指向 `/api/v1/growth` 的工单闭环，不是 fill-data）。
  ⇒ §7 DoD"三工具登记 OPERATION_CATALOG（cli-parity:check 过）"实际是 2/3；GUI=对话=CLI 同源（R15）在这一把上断了。
- **未查清**：§7 DoD 的"空租户'6 月达成率未达成原因' → agent 自助触发合成 → 读回 → 推演"**端到端是否真跑通**
  我没有实跑（只读代码），无法只凭 file:line 断言。卡在：需要起双服务 + 真 LLM 或录制 mock 才能验。
- **最小 WO 建议**：`WO-ADT-1`（极轻）：`operation-intent.ts` 补一条
  `{ op: "fill-data", endpoint: "/a/v1/growth/fill-data", cliCommand: "fill-data", … }` 并跑 `check-cli-parity.mjs`。
  🚦范围边界：`packages/contracts/src/operation-intent.ts` + `scripts/check-cli-parity.mjs` 回归。
