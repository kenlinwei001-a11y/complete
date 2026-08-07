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
  - **S4.1 知识库语义检索**：`apps/datacore/src/kb.ts` + `apps/datacore/src/embeddings.ts`
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

---

### docs/PRD-agent-execution-governance-loop-control.md
- **它要做什么**：给 path-B `runAgentLoop` 装一层确定性执行治理（Loop Control）——
  有界轮次×有界时长×有界工具预算内必停、停得诚实（唯一降级出口 `degrade()`）；
  并把用户提的 9 个机制逐条对照代码，标清已建/路线图。
- **PRD 自称的 AS-IS**（§2，**最完整的一张 AS-IS 表**：9 机制 × file:line × ✅/◐ 判读）：
  自陈 `loop.ts`（937 行）"已是一副成熟的治理骨架，不是绿地"；3 个 ✅（State Monitor / Budget Controller /
  Reflection Checkpoint）、6 个 ◐；并在 §8 明确分期 P0 ✅已落 / P1 待派 / P2 待派 / P3 排后。
  **这份 PRD 的 AS-IS 自陈经我复核，逐条属实。**
- **实测现状**（对着 §8 分期表逐期核）：
  - **P0 ✅（PRD 自称已落 → 属实）**：守卫序列与唯一出口在 `apps/agentcore/src/agent/loop.ts`；
    静态门 `scripts/check-loop-control.mjs` 真守宪法——`:26` 断言"`degraded:{reason}` 产出点恰为 1"、
    `:38-40` 断言 reason ∈ {TIMEOUT,BUDGET_EXHAUSTED,STALL_LOOP}、`:45` 断言"环检测触顶必经 degrade"。
    **该门已并入 `pnpm gates`**（`package.json:32` 含 `check-loop-control.mjs`）——与 VLE 的门形成鲜明对比。
  - **P1 ✅（PRD 标"待派 1 dev" → 实际已落）**：`callSignature` 环检测在
    `apps/agentcore/src/agent/loop.ts:126-130`（`loopRepeatCap`，opt-in），
    新降级理由 `STALL_LOOP` 进枚举 `loop.ts:164`，生产注入 `apps/agentcore/src/engine.ts:360`
    ← config `apps/agentcore/src/config.ts:46 QOS_AGENT_LOOP_REPEAT_CAP`。
  - **P2 ✅（PRD 标"待派" → 实际已落）**：
    per-tool cap `apps/agentcore/src/tools/budget.ts:26,94-102`（`markExhausted("perToolCallCap:"+name)`）；
    RetryPolicy 的 `retryable` 回执 `apps/agentcore/src/tools/executor.ts:27,603,622`；
    Escalation Ladder + 暗发 feature `apps/agentcore/src/features/registry.ts:108`
    （`agent.escalation`，`defaultOn:false`），生产判定 `apps/agentcore/src/router/orchestrator.ts:223,2048,2113`；
    metric `apps/agentcore/src/metrics.ts:118`。
  - **出货态是真开着的**（这一点很关键，避免"opt-in 等于没开"的误判）：
    `docker-compose.yml:125-128` 显式给了 `QOS_AGENT_MAX_ROUND_TRIPS/MAX_DISCOVER_CALLS/LOOP_REPEAT_CAP/PER_TOOL_CALL_CAP`
    默认值，且注释自陈"这五个开关在代码里是 opt-in（缺省不设=不限）……由
    `scripts/check-deploy-governance.mjs` 守门防回潮"——该门也在 `pnpm gates`（`package.json:32`）。
- **结论**：◐ 部分（**P0/P1/P2 全落且真接线真配置，只剩 P3；PRD 分期表自身已过期**）
- **缺的那半（P3，三项，均为 ❶ 没接线/未实现）**：
  mid-loop Goal Monitor / 周期性 reflect checkpoint / 跨 agent Deadlock（Coordinator 扇出层）/
  State Monitor per-iteration 可观测 trace —— 关键词
  `goalCheck|midLoop|mid-loop|goal-check|deadlock|Deadlock|dispatchId` 在 `apps/agentcore/src` 全域**零命中**。
  PRD 自己把 P3 标为"排后·低优先"，与实测一致。
- **⚠ PRD 自身陈述与现状不符（1 处，方向是"PRD 落后于代码"）**：
  §8 分期表把 **P1 标为"待派 1 dev"、P2 标为"待派"**，实测两期**都已在 canonical**（证据见上）。
  照这张表排期会重复派单。这正是「拿待办状态判断实现与否」会踩的坑的镜像——PRD 里的状态栏同样会过期。
- **另记**：`agent.escalation` 是 `defaultOn:false` 的暗发门（`features/registry.ts:108`），
  出货容器未显式开启 ⇒ §3.4 的"升级阶梯"今天在部署态**不触发**（关=直接 degrade，PRD §3.4 明说这是设计意图，
  属"接了线按设计没开"，不是缺陷；但读 PRD 的人若以为升级已在生效，会误判）。
- **最小 WO 建议**：`WO-LC-0`（极轻·纯文档）：把 §8 分期表的 P1/P2 状态改为「✅ 已在 canonical」并补 commit/file:line。
  🚦范围边界：`docs/PRD-agent-execution-governance-loop-control.md` 单文件。
  P3 三项建议**继续排后**（PRD 自己的优先级判断正确）。

---

### docs/PRD-agent-navigation-slice-latency.md
- **它要做什么**：治 path-B agent「99% 时延在 LLM 盲目 ReAct 选型」的病——
  A 确定性优先门（高置信题拉回 path-A）、B 导航切片注入、C 规划式执行、D 模型分层。
- **PRD 自称的 AS-IS**：§1 是**活系统真跑的定量观测**（Q5 137.7s / 17 步 / LLM 占 99.1%），
  §2 是带 file:line 的根因表（R1–R4）；**§7「实现状态与审核精炼」是 PRD 自己写的落地自述**，
  §7.4 明确留了唯一未闭环项。
- **实测现状**（逐条核 §7.2 的落地自述）：
  - **WO-QOS-1 确定性优先门 ✅ 属实**：`apps/agentcore/src/router/domain-resolver.ts` 存在；
    生产接线 `apps/agentcore/src/router/orchestrator.ts:72`（import `preferDeterministicSolver`、
    `DETERMINISTIC_PREFERENCE_THRESHOLD`）→ `:703-708` 真判定并拉回 path-A；
    金标 fixture `apps/agentcore/test/fixtures/qos-20q-goldset.ts` + SEAM `apps/agentcore/test/qos-det-gate-seam.test.ts`。
  - **WO-QOS-2 导航切片 + 规划式 ✅ 属实**：`apps/agentcore/src/agent/navigation-slice.ts` 存在且
    **生产接线在 `apps/agentcore/src/engine.ts:325-326`**（`projectNavigationSlice` → `renderNavigationSlice` 进首轮 prompt）；
    下游还长出了三个复用方（非孤岛）：`router/compile-plan.ts:61,181`、`agent/sim-planner.ts:84,184`、
    `router/l2-decompose.ts:32`；SEAM `apps/agentcore/test/qos-agent-slice-seam.test.ts`。
- **结论**：✅ 已实现（A/B/C 三杠杆落地并接线；**PRD 自己声明的唯一未闭环项经我复核仍未闭环**）
- **未闭环项（PRD §7.4 自陈，我复核后确认仍在）**：
  「真 Kimi 20 题 live 重测（137s → path-A <5s / path-B <10s）」——**只读代码无法验证墙钟**，
  我没有实跑，诚实记为**未查清**：卡在需要真 LLM provider 凭据 + 起双服务做 live 计时。
- **⚠ 一条可核实的连带欠账（我实测，PRD 未标为已还）**：
  §7.2 的"过渡创可贴：free-LLM 预算 90s→600s（`0a054641`），**QOS-1/2 提速经 live 测确认后应回调此预算**
  （勿长期以 600s 掩盖'agent 慢'）"——实测**创可贴仍在**：
  `packages/contracts/src/qos.ts:676 maxDurationMs: 600_000`。
  这与 §7.4 未闭环是一致的（live 未测所以没回调），但它意味着**今天出货的默认 agent 预算是 10 分钟**。
- **最小 WO 建议**：`WO-NSL-1`（中）：起真 provider 跑 20 题金标 live 计时，据结果回调
  `packages/contracts/src/qos.ts:676` 至 90–120s，并把结果写回 §7.4。
  🚦范围边界：live 测脚本 + `packages/contracts/src/qos.ts` 一个常量 + PRD §7.4。

---

### docs/PRD-agent-react-harness.md
- **它要做什么**：把 agent loop 从「计划→执行→收尾」升级为「理解→计划→分解→执行→**反思**」，
  补显式 Reflect/重规划步；系统提示词补齐七要素（③推理循环/⑥错误恢复/⑦结果规范）；
  Solver-first 硬纪律（排产/优化题禁 LLM 自算）。
- **PRD 自称的 AS-IS**（§0.2，**一张七要素诚实体检表**）：
  ①角色 ✅ / ②目标 ◑ / ③推理循环 ❌ / ④工具协议 ✅ / ⑤状态管理 ✅ / ⑥错误恢复 ❌ / ⑦结果规范 ◑；
  自陈"③⑥⑦三项欠账，合起来就是缺一个反思/重规划闭环"。
- **实测现状**（对着 §9 的三张 WO 逐张核）：
  - **WO-REFLECT-LOOP ✅**：`apps/agentcore/src/agent/reflect.ts` 存在（PRD 标为"(新)"）；
    loop 侧 `apps/agentcore/src/agent/loop.ts:21`（import `reflectAnswer`）、
    `:304-312 reflectWithCritic`（确定性主判 + 可选 LLM critic）、`:882` 收尾前挂钩、
    `:372 replanBudget`（默认 1，硬有界）、`:886` 重规划条件、
    `:906` 预算耗尽时诚实标「反思发现的残余缺口（已尽重规划预算 N）」。
    观测字段 `AgentRunRecord.reflected/replanReason` 落在 `loop.ts:182,928-929`。
    **生产接线**：`apps/agentcore/src/router/orchestrator.ts:2024 reflect: true`（不是只在 test 里开）。
  - **WO-SOLVER-FIRST-GATE ✅**（PRD 要求与 REFLECT-LOOP 同 dev 整单，实测确实同文件）：
    `apps/agentcore/src/agent/reflect.ts:31` 排产/优化类问句正则、
    `:41` "至少一次成功 invoke_solver" 判据、`:92-94` 打回理由
    「排产/优化/可行性类问题未调用对口 solver（求解纪律：禁自算·须走 invoke_solver）」。
  - **WO-HARNESS-PROMPT ✅**：`apps/agentcore/test/harness-elements.test.ts` 存在（PRD §11-1 点名的断言文件）。
  - SEAM 测试齐：`apps/agentcore/test/reflect-loop-seam.test.ts` / `reflect-wiring-seam.test.ts` /
    `seed-agent-harness.test.ts`。
- **结论**：◐ 部分（**三张 WO 全落且真接线，两处"回写承诺"未兑现**）
- **缺的那半（两条，都在 §10 回写承诺里，都是 ❶）**：
  1. **§10.3 声明"新增 `agent.reflected` 事件" —— 事件名不存在**。
     `rg "agent.reflected"` 在 `apps/agentcore/src` 零命中；实测只有 `AgentLoopResult.reflected` 这个**布尔字段**
     （`loop.ts:182,928`），不是 §4 事件表里的事件。⇒ 观测/审计侧拿不到"何时触发了重规划"的事件流。
  2. **§10.6 声明"§7 新增门 `harness-elements:check`" —— 门不存在**。
     `scripts/check-harness*.mjs` 无此文件；`package.json` 的 `gates` 串（`:32`）里也没有。
     实测只有**测试** `apps/agentcore/test/harness-elements.test.ts`。
     ⚠ 这是 CLAUDE.md「只有 test 引用 = 已排练，不是已实现」的**温和版**：断言是真的、也跑在 gate.sh 的 TEST 阶段，
     只是它不是 PRD 承诺的那种"静态门"，防回潮强度低一档（改坏 prompts.ts 若同时改了测试就过）。
- **最小 WO 建议**：
  - `WO-RH-1`（极轻）：二选一——要么补 `agent.reflected` 事件 + `harness-elements:check` 门，
    要么把 §10.3/§10.6 的回写承诺改成"以 `AgentLoopResult.reflected` 字段 + `harness-elements.test.ts` 承担"。
    **建议后者**（成本低、实质已覆盖）。🚦范围边界：`docs/PRD-agent-react-harness.md` 单文件（若选前者则加两个文件）。

---

### docs/PRD-aop-annual-scenario-1to1.md
- **它要做什么**：年度情景规划台与参考原型 HTML 的 1:1 复刻——补 note 行/三情景对比 chip/分解 header 数字/
  行内规则链接/缺口窗口曲线，修 2027-vs-2026 年份接线 bug，同时**保留系统超集**（活求解器/真规则/Action 拍板）。
- **PRD 自称的 AS-IS**（§2，**15 行 HTML-vs-系统逐项差异表**，含 ✅/◐/❌/➕/🔴 五档）：
  自陈"系统已实现且多处强于 HTML"，只 3 项 ❌（三情景对比 chip / note 字段 / —）、1 项 🔴（年份接线）。
  **这份 AS-IS 是本批最诚实的一份**——它主动列出 ➕（系统独有超集）两项，避免读者把超集当欠账。
- **实测现状**：
  - **§3.1 契约 `note` ✅**：`packages/contracts/src/planviews.ts:14`
    `note: z.string().optional(), // 情景前提注解（乘用车放缓/储能放量/海外大单——电池域种子文案，非前端写死）`，
    生成器填值 `apps/datacore/src/synthetic/battery.ts:4495-4497`（三情景各一句）。
  - **§3.2 前端五项补齐 ✅**（逐项在 `apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx`）：
    三情景对比 chip `:47`（`data-testid="aop-compare-chip"`，文案 `apps/frontend-shell/src/locales/zh.ts:224`）；
    note 行 `:162-164`（用既有 `.scenNote`）；分解 header 取真实数据 `:35`（注释明写"非写死"）；
    行内规则链接 `:8,:44`（`<RuleRef code="C23"/>` / `C18`）；
    **缺口/过剩窗口曲线 `:65-103`**（消费 `capexScenario.demand/supply/gap/windows`，含 `markAreas`）。
  - **§3.3 年份接线 ✅ 已修**：`AnnualScenarioView.tsx:15-17` 注释
    「合成生成器与端点默认均种 2026（battery generatePlanDomain / PlanService.aop 默认年）」+ `const YEAR = 2026`。
- **结论**：◐ 部分（**§3 设计三节全部落地；§9 自己加码的"100% 1:1 精确值"未执行**）
- **⚠ PRD 自身陈述与现状不符（本批最典型的一例 · §9 断言了可核实的事、事实相反）**：
  §9「1:1 尺度（已定·全局标准）」逐项点名要还原的精确值，**实测三项全部没还原**：
  | §9 点名要 1:1 的项 | PRD 说 | 实测 | 证据 |
  |---|---|---|---|
  | 三情景需求 | dem **1420/1580/1760** | 由 `annualBase × 0.88 / 1.0 / 1.18` 算出 | `apps/datacore/src/synthetic/battery.ts:4475,4495-4497` + 因子 `:499-500`。HTML 的真实比值是 **0.8987 / 1.1139**，与 0.88/1.18 不等 ⇒ 数值必不相同 |
  | 产能决策文案 | **枣庄/江门** | 仍是 **合肥四期 / 盐城二期** | `battery.ts:4496`「合肥四期 8GWh 扩产，2027-Q2 投产」`:4497`「合肥四期 + 盐城二期合计 20GWh 扩产」 |
  | 触发条件 | **海外大单≥80万套**（HTML 2 条） | 系统 **4 条完全不同的条件** | `battery.ts:4531-4561`：季度产销缺口>4万套 / 储能增速>25% / 长协偏差>12% / 锂价涨幅>20%；无"海外大单" |
  注意这**不是 §2 没说**——§2 的差异表第 5/6/11 行把这三项如实标为 ◐ 并写明"值不必等于演示值"。
  **是 §9 后来加码到"100% 1:1（用户裁决）"，而 §9 的加码从未执行，§2 的旧口径反而是现状。**
  同一份 PRD 内两节自相矛盾，且 §9 那节是后写的、更权威的那节 —— 这会让读者以为 1:1 已完成。
  （旁证：`battery.ts:461` 有一处**确实**按 HTML 改过名的记录「命名以 HTML 参考原型为准（用户裁决 2026-06-23）：枣庄储能线」，
  但那是 **capex 项目名**，不是 §9 点名的 `AnnualScenario.capacityDecision` 文案——**同名不同物，别混判**。）
- **最小 WO 建议**：
  - `WO-AOP-1`（轻·先做）：**先定夺 §2 与 §9 哪个口径算数**再动手。若维持系统口径 → 改 §9 为"结构 1:1、
    数值由生成器种子产出（不追演示值）"；若真要 100% → 改
    `apps/datacore/src/synthetic/battery.ts:4495-4497`（三情景 dem/产能决策）与 `:4531-4561`（触发条件）为 HTML 种子值。
    🚦范围边界：二选一，别同时改（这是真互斥的架构决策，须人裁）。

---

### docs/PRD-attainment-base-daily-timeseries.md
- **它要做什么**：补一条**基地级日达成率时序** `attainment:base`（现状只有产线级日序 + 周聚合），
  使"本月逐日为何未达成"的时间维度归因成立；并把日达成率口径接到 Metric（spine）。
- **PRD 自称的 AS-IS**（§2，带 file:line 的 5 行表）：
  `attainment:line`（battery.ts:780，日）✅ / `schedule_attainment`（battery.ts:802，**周**）✅ /
  基地级日序 ❌ / 与 Metric 对齐 ◐ / seed 产出 ✅（产 line 时序）。**经复核属实**
  （现行号：`apps/datacore/src/synthetic/battery.ts:2605` `attainment:line`、`:2631` `schedule_attainment` 周聚合）。
- **实测现状**：
  - **TS.1 序列本体 ✅，但走的是 §1-(a) 而非 PRD 建议的 (b)**：
    `apps/datacore/src/synthetic/battery.ts:2610`
    `{ seriesKey: "attainment:base", entityType: "Base", grain: "day", base: { mean: 0.918, noise: 0.018 },
       effects: ["maint_window_dip","weekend_dip","ramp_curve"], measureField: "attainment" }`
    —— 这是 §1-(a)「新剧本」的逐字实现（含三个 effects），**不是** §3.1 建议的 (b)「日上卷 TsAgg」。
    上一行 `:2607` 的注释直接引用本 PRD（"CL.5（PRD-attainment-base-daily-timeseries）"）。
  - 可查性 ✅：经通用 `POST /a/v1/timeseries/agg-query` 按 seriesKey 取，测试实证
    `apps/datacore/test/attainment-base-daily.test.ts:32`（6 月逐日 day grain）+ R6 同 seed 字节一致 `:42-49`。
  - 原 `attainment:line` / `schedule_attainment` 未破（`:2605`/`:2631` 均在）——§1 非目标守住。
- **结论**：◐ 部分（**TS.1 落地，TS.2 整期未做；且序列今天零生产消费方**）
- **缺的那半（三条）**：
  1. **`Base.attainment_daily` 属性不存在（❶）**：§4 契约节点名要给 `Base` 加此属性。
     `rg "attainment_daily"` 在 `apps/**/src` + `packages/**/src` **零命中**（只在测试文件名/注释里出现）；
     `battery.ts` 的属性表里只有 `Line.schedule_attainment`（`:903`、中文名 `:1725`）。
  2. **接 Metric（TS.2 核心）= ❶ 完全未做**：§4「接 spine：`Metric(achievement, day)` actual ← attainment:base」。
     `apps/datacore/src/metrics.ts` 里 `attainment|achievement|达成` **零命中**。
  3. **零生产消费方（这条最值得记）**：`rg "attainment:base"` 在全仓非 test 代码里**只有 1 处**——
     就是 `battery.ts:2610` 的**生产端**本身。`apps/agentcore/src` 与 `apps/frontend-shell/src` 全域零命中
     （AgentCore 的种子提示词 `apps/agentcore/src/mocks/seed.ts:1673` 与 mock `mocks/clients.ts:950`
     仍写的是 `attainment:line`）。
     ⇒ **数据产出来了，没有任何一条链路会去问它。** 这不是"死代码"（通用 agg-query 端点能读，
     agent 若显式给出 seriesKey 也能读回），而是**「有数据没消费方」**——
     PRD §5 关键流程的后半段（`→ Metric.actual(day) → plan_audit/逐日时间维度归因`）**整段没接**。
- **最小 WO 建议**：
  - `WO-TSB-1`（轻）：把 `attainment:base` 接进 `Metric(achievement, level=day)` 的 actual 来源，
    并给 `Base` 补 `attainment_daily` 属性 + TsAgg 物化。
    🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（属性表 + TsAgg spec）+ `apps/datacore/src/metrics.ts`
    + 一条 seam 测试（断言 Metric.actual 与 attainment:base 日序同值）。
  - `WO-TSB-2`（轻）：把 AgentCore 侧的达成率提示词/mock 从 `attainment:line` 改指 `attainment:base`
    （`apps/agentcore/src/mocks/seed.ts:1673`、`mocks/clients.ts:950`），让 agent 真会去问这条序列。

---

### docs/PRD-attribution-routing-plan-audit.md
- **它要做什么**：修「归因能力存在却路由不到」的接缝——把"未达成原因/达成率归因"问句**路由到 `plan_audit`**、
  `discover` 暴露它、并给 `plan_audit` 补入参三级兜底（`plan_version_id ?? currentPlanVersion ?? PlanTarget 基线`）。
- **PRD 自称的 AS-IS**（§2，带 file:line 的 6 行表）：
  归因能力 ✅ 在 `plan_audit`（plan.ts:5）但**路由不到**；关键词路由 ❌ 无 plan_audit 归因词；
  discover ❌ 未暴露；入参兜底"solvers.ts:170 已支持但调用/agent 路径没用上"。
- **实测现状**（三条设计分别是三种结果，必须分开说）：
  - **§3.3 入参三级兜底 ✅ 已实现，且注释直接引用本 PRD**：
    `apps/datacore/src/app.ts:2799-2807`
    「CL.6（PRD-attribution-routing-plan-audit）：plan_audit 入参三级兜底——缺数值入参时自动取
    currentPlanVersion（其本身再 ?? PlanTarget/场景包基线确定性派生，sop.ts:419）」，
    真实逻辑：10 个必填数值字段任一缺 → `args = { ...cur.input, ...args }`（基线兜底 + 显式覆盖）。
  - **§3.1 关键词路由到 plan_audit ❌ 未实现（❶）**：
    PRD 说改 `apps/agentcore/src/databuilder/comprehend.ts` —— **该文件不在 agentcore，在 datacore**
    （`apps/datacore/src/databuilder/comprehend.ts`；PRD 的路径写错了，别据此判"文件不存在=没做"）。
    真文件里：`SOLVER_TARGET_VIEW`（`:524-532`）只有 6 个键（affected_orders / capacity_forecast /
    shared_bottleneck / concentration_risk / supplier_disruption_radius / margin_attribution / selection_optimize），
    **无 `plan_audit`**；`SOLVERS` 表里 solverKey 只有 4 条（`:512-516`），也无 `plan_audit`。
    PRD 点名的符号 `KEYWORD_SOLVER` 全仓零命中。
  - **§3.2 discover 暴露 plan_audit 为"归因"入口 ❌ 未实现（❶）**：
    `apps/datacore/src/catalog.ts:53` 的 `plan_audit` 条目
    `answersQuestions: ["这个计划版本达成率多少","计划体检评分是多少","计划的风险敞口多大"]`、
    `tags: ["计划体检","达成率","audit"]` —— **没有**"未达成原因/偏差根因/为何没达标"。
- **⚠ 但用户诉求实际上被另一条链满足了（跨命名复核·差点误判为❌）**：
  「为什么没达标 / 未达成原因」这类问句今天由**另外两个求解器**接住：
  - `apps/datacore/src/catalog.ts:87` `gap_attribution`，`answersQuestions` 含
    「为什么这个指标没达标」「储能份额为什么下降逐层拆根因」「总缺口一路归到哪些最终根因、各占多少」；
  - `apps/datacore/src/catalog.ts:78` `plan_rootcause`，`answersQuestions` 含「KPI 为什么没达标」「根因在哪个因子」；
  - 意图侧：`apps/agentcore/src/mocks/seed.ts:678`
    `{ key: "ceo_root_cause", solver: "gap_attribution", examples: ["为什么没达标","根因是什么","缺口拆解到最终根因"] }`。
  ⇒ **"路由不到归因能力"这个病已经好了，只是治法与 PRD 开的方子不同**（走 `gap_attribution` 而非 `plan_audit`）。
  如果只 grep `plan_audit` 就下"未实现"的结论，会把一条已通的链报成断的 —— 这正是「同一件事不同名」的坑。
- **结论**：◐ 部分（**§3.3 已实现；§3.1/§3.2 未按 PRD 实现，但等价能力经 `gap_attribution` 已通**）
- **§3.4 时间维度归因**：未接（见上一条 `attainment:base` 零消费方）。
- **最小 WO 建议**：`WO-AR-1`（极轻·**先改 PRD**）：把 §2/§3 的"路由到 plan_audit"改为
  "已由 `gap_attribution`/`plan_rootcause` 承担（catalog.ts:87/:78）"，只保留仍真缺的
  §3.2（给 `plan_audit` 的 `answersQuestions` 补"计划偏差/未达成"若确需）与 §3.4。
  🚦范围边界：`docs/PRD-attribution-routing-plan-audit.md` +（可选）`apps/datacore/src/catalog.ts:53` 一行。

---

### docs/PRD-build-workflow-runtime.md
- **它要做什么**：把数据构建发动机的"故事→建域"从**一段内存 try-块**升级为**持久化 6 步工作流状态机**
  （落库检查点 / 崩溃可 resume / 有界退避重试 / 逐步可观测 / gap_analysis 一等步 / 异步 submit-and-detach）。
- **PRD 自称的 AS-IS**：**版本行直接写 `状态 LANDED`**，§3 的 AC1–AC11 **每条都打了 ✓**。
  这是本批唯一一份自称"已落地并逐条自验"的 PRD —— 所以我把它当**待复核的断言**逐条核，而不是照抄。
- **实测现状**（§2「实现锚点」7 个锚点逐个核，全部存在）：
  - `apps/datacore/src/databuilder/workflow-engine.ts` ✅
  - `apps/datacore/src/databuilder/provisioners.ts` ✅（AC10 的 13 provisioner 覆盖门）
  - `apps/datacore/migrations/023_build_workflow_runs.sql` ✅（R9 四处之一）
  - `apps/datacore/test/build-workflow-engine.test.ts` ✅ / `apps/datacore/test/provisioners.test.ts` ✅
  - `apps/frontend-shell/test/f55.workflow-timeline.test.tsx` ✅
  - 端点**比 PRD 写的还多**：`apps/datacore/src/app.ts:3797`（POST）`:3808`（**recover**，AC11）
    `:3901`（GET 列表）`:3906`（GET 单条）`:3912`（**fde-graph**，PRD 未提）`:3917`（resume）。
- **结论**：✅ 已实现（自称 LANDED 属实；且端点集是 PRD 的超集）
- **未查清**：AC8「datacore 全套（449）绿」与 AC3/AC5 的**运行时行为**（重试计数/自愈）我**没有实跑测试套件**
  （只读审计，且 CLAUDE.md 铁律 2 禁并发 datacore vitest）。诚实记为未查清；
  卡在：需独占跑 `pnpm --filter datacore test` 才能断言。锚点与断言文件的**存在性**已逐条核实。

---

### docs/PRD-capacity-feasibility-demanddelta-fix.md
- **它要做什么**：修 S01「订单可承接性评审」的四个缺陷——`demandDelta` 是死参数（"+20%"从不参与计算，
  `gapPct` 结构性恒 0）、无 p50===0 全零诚实门、P50/P90 单位错标 GWh（真口径万套）、compute 步溯源弹窗"薄"。
- **PRD 自称的 AS-IS**：§1.2 **A–G 七条根因，每条带 file:line + 可复现的 curl 对照**
  （`{modelId,demandDelta:0.2,weeks:6}` → `gapPct=0,qty=0` vs `{modelId,qty:40,weeks:6}` → `gapPct=0.714`）。
  **且版本行自称「状态：草案（待「待定决策」§5 签署后进入实现）」「本 PRD 仅文档；不改源码」。**
- **实测现状**（G1–G4 逐条核）：
  - **G1 `demandDelta` 真驱动缺口 ✅**：`apps/datacore/src/solvers/capacity.ts:396-397`
    注释已从"legacy alias"改为「PRD-CAP-DEMANDDELTA：相对增量，驱动 effectiveDemand = 基线 × (1 + demandDelta)」；
    `:528-532` `const effectiveDemand = round((qty > 0 ? qty : baselineDemand) * (1 + demandDelta), 4);`
    —— 即 §5 推荐的 **(b) 订单簿基线**口径被采纳。输出回显 `:708`，公式溯源 `:714`
    `effectiveDemand: { formula: "(qty > 0 ? qty : baselineDemand) × (1 + demandDelta)", valueLabel: "有效需求（万套/窗口）" }`。
    契约同步 `packages/contracts/src/solvers.ts:132-135`；AgentCore mock 同步
    `apps/agentcore/src/mocks/clients.ts:493-520`（**两侧口径一致，不是只改一半**）。
  - **G2 全零诚实门 ✅**：`apps/datacore/src/solvers/capacity.ts:657 if (p50 === 0)` →
    `:674 dataMode: "EMPTY"` + `:675 feasibilityNote: "该型号认证基地当前产能数据为零，无法评估可承接性
    （数据缺口，见断点 G-CAPACITY-BASE-DATA）"`（与 §4.2 设计逐字一致）。
  - **G3 单位口径 ✅**：`apps/agentcore/src/mocks/seed.ts:305-308` 注释
    「PRD-CAP-DEMANDDELTA：capacity_forecast 输出单位统一为「万套/窗口」，不再沿用 GWh」，
    三个 KPI（P50/P90/**有效需求**）`unit: "万套"`。
  - **G4 溯源带公式/口径 ✅**（部分证据）：`capacity.ts:711-714` 给 p50/p90/effectiveDemand 各挂
    `{ formula, valueLabel }`；`:564` 另有 p90 的口径说明。
  - 回归测试：`apps/datacore/test/capacity-demanddelta.test.ts` 存在。
- **结论**：✅ 已实现（G1–G4 全落，且实现遵循了 §5 推荐的 (b) 口径）
- **⚠ PRD 自身陈述与现状不符（1 处，且是最容易误导人的一种）**：
  文首版本行仍写 **「状态：草案（待「待定决策」§5 签署后进入实现）」** 与 **「本 PRD 仅文档；不改源码」**，
  §5 更明确写「**在签署前，实现方不得默认落地任一口径**」。
  **实测口径 (b) 早已落地在生产代码里**（`capacity.ts:532`）。
  ⇒ 任何按文首状态行判断的人都会得出"这个 bug 还没修"的错误结论，
  而这正是本次审计要防的那类错误的**文档侧变体**：不是待办状态骗人，是 PRD 自己的状态行骗人。
- **最小 WO 建议**：`WO-CDD-1`（极轻·纯文档）：把状态行改为 `LANDED`，
  在 §5 下补一行「已签署口径 = (b) 订单簿，落点 `apps/datacore/src/solvers/capacity.ts:528-532`」。
  🚦范围边界：`docs/PRD-capacity-feasibility-demanddelta-fix.md` 单文件。

---

### docs/PRD-capacity-inference-completion.md
- **它要做什么**：补产能推演域四类缺口——D1 Equipment/EquipmentOEE 只给常州生成（12 基地全 0）、
  D2 基地键 id/中文无归一、E1 `gap_attribution` 无 base×factor 作用域、F1 每基地 +30/60/90 天前瞻、P1 逐日行动过程。
- **PRD 自称的 AS-IS**（§1，**活系统真跑的纠偏表**——本批质量最高的一份 AS-IS）：
  它**推翻了前端自诊断**（"合肥无结构节点/订单不在"两条判为 ❌ 前端错），
  并指出真根因是"Equipment 50 + EquipmentOEE 50 = 100% changzhou，其余 12 基地全 0"。
  **这份 AS-IS 本身就是"别信间接证据、去真跑"的正面教材。**
- **实测现状**（D1/D2/E1/F1/P1 逐条核）：
  - **D1 ✅ Equipment 已全基地生成**：`apps/datacore/src/synthetic/battery.ts:3533 for (const b of bases)`
    → 基地 → 产线 → `SERIAL_STEPS` 工序 → `:3587 for (let e = 1; e <= 2; e++)` → `:3595 equipment.push({... baseId: b.baseId ...})`。
    EquipmentOEE 随之全覆盖：`:4188-4189 for (const eq of equipment)`（按设备逐台产 7 天快照）。
    ⇒ PRD 描述的"只对常州产 50 台"已不成立。
  - **E1 ✅ `gap_attribution` 已接 `scope`**：`apps/datacore/src/solvers/service.ts:1418 gapAttribution`、
    `:1424 const scope = (args.scope ?? {}) as { baseId?: unknown; factorId?: unknown };`、
    `:1493` 回填 `res.scope = { baseId, displayName, factorId, factorApplied }`。
    代码里还留了一条**自我纠错注释**（`:1482-1485`）：曾把已解析的 `scope.baseId` 整个丢掉 →
    前端匹配不到基地节点 → 整棵树消失成"诚实灰"，已修。
  - **D2 ✅ 基地键归一**：`:1493` 与 `:1672,:1710,:1744` 的 `displayNameOf(scopedBaseId)` / `dName`。
  - **F1 ✅ 新求解器 `base_capacity_outlook` 已落且已注册**：
    实现 `apps/datacore/src/solvers/base-outlook.ts`、注册 `apps/datacore/src/solvers/service.ts:153`、
    目录 `apps/datacore/src/catalog.ts:95`（四线口径、crossDay、dayPlan 逐日行动全在 description 里）。
  - **P1 ✅ 逐日 rationale**：`apps/datacore/src/solvers/base-outlook.ts:17,:62`
    （dayPlan 每条日行动带 `day/date/action/rationale/triggerValue/closesGap/provenance`），
    并与 `apps/datacore/src/solvers/risk.ts:811-812` 的处置表**同一份实现**（单一出处，不分叉）。
- **结论**：✅ 已实现（D1/D2/E1/F1/P1 五项全落，且 F1 是新增求解器而非 `horizonDays` 扩展——
  PRD §3-F1 给的正是这两个选项之一）
- **未查清**：§4 SEAM-1 要求的「**活系统 curl 亲验** `gap_attribution({scope:{baseId:"hefei"}})` 出合肥非空设备叶」
  我没有实跑（只读审计）。诚实记为未查清；卡在：需起 datacore + SEED_DEMO=1 才能验墙钟结果。
  静态证据（全基地 equipment 循环 + scope 解析 + displayName 归一）三条链都在。
- **另记**：§3-D1 的对象预算护栏（"每基地 8–15 台、13 基地 ≈ 130–180 台"）与实测生成规则
  （每产线每工序 2 台）口径不同，实际台数取决于 `WORKSHOP_DEFS.length × SERIAL_STEPS.length × 2`；
  **金值断言在 `apps/datacore/test/` 的 demo-chain 测里**（PRD 提到基线 11082→+~250），我未实跑核对具体数。

---

### docs/PRD-capacity-live-cockpit.md
- **它要做什么**：把产能推演页（view key **`risk`**）从"死 BI"升级为"活台"——
  ①拨动原子因子就地 `generic_inference` 真重算 ②真 NL 人机对话（替正则假 NL）③方案存/分支/横比。
- **PRD 自称的 AS-IS**（§2，**6 行 C1–C6 表 + 一行范式对照，每行带 file:line**）：
  C1 八个块全只读；C2 前端调 `gap_attribution` 不传作用域（**引擎已支持、前端未接**）；
  C3 派生与 modelId 无关、用代表工序均值；C4 20 因素无 object.property 绑定；
  C5 `QaPanel` 是正则假 NL；C6 无方案存/分支/比对。
  **这份 AS-IS 特别注明了"引擎全已建（57 solver 全在），本 PRD 主要是接线 + 一处原子因子深化，非绿地重造"**
  —— 与我实测一致，是防"重造轮子"的好范例。
- **实测现状**（三个"活能力"逐条核）：
  - **§4.1 冻结契约 ✅**：`packages/contracts/src/capacity-factors.ts` 存在（`CAPACITY_FACTOR_BINDINGS`），
    消费方三处非 test：`apps/datacore/src/solvers/capacity.ts`、`apps/datacore/src/solvers/service.ts`、
    `apps/frontend-shell/src/views/sim/inspectorModel.ts`。
  - **§4 `byProcessModel` + `granularity` ✅（治 C3/C4）**：
    `apps/datacore/src/solvers/capacity.ts:185`（`computeByProcessModel`）、`:398-399`（`granularity?: "base"|"process-model"`）、
    `:683`（`granularity==="process-model"` 才算，缺省不输出 → 向后兼容）、`:695`（additive 挂输出）；
    契约冻结 `packages/contracts/src/solvers.ts:61-62`（注明"字段名冻结"）。
  - **活能力① ✅（治 C1）**：`DynamicLeverPanel` 已参数化并挂进产能页 ——
    `apps/frontend-shell/src/views/RiskBoardView.tsx:21`（import）、`:868-880`（挂载，
    注释写明 `targetType/targetProp` 传 `Base.weeklyCap`、`scopeObjectIds` 传本基地×型号真对象、
    并提醒"杠杆发现按 `scope.includes(o.id)` 逐对象过滤 → 必须是真 objectId"）。
    原先只有 `apps/frontend-shell/src/views/sim/ProjectSimView.tsx:20` 用它，现两页共用（单一出处）。
  - **活能力②（治 C2/C5）◐**：
    · C2 **已接** —— `RiskBoardView.tsx:718-728` 真传作用域：`const scope = { baseId: baseIdForScope }`，
      有因子时再 `scope.factorId = rcFactor`，然后 `invokeSolver("gap_attribution", { scope })`。
    · C5 **真 NL 已加，但假 NL 仍在** —— `:902` 有"活能力② · 人机对话（真 NL·经 orchestrator·替 QaPanel 正则假 NL）"，
      **而 `:899` 仍在渲染 `<QaPanel .../>`，`:1421` 的 `QaPanel` 函数体也还在**。
      两者并存（PRD §3.2 原文允许"替 QaPanel 假 NL **或并存**"，所以这是**按设计并存**、不算缺口，
      但页面上同时有两个问答入口，用户会困惑走哪个）。
  - **活能力③ ✅（治 C6）**：前端 `RiskBoardView.tsx:1063-1170`（存/分支/横比/采纳走 `plan_change` Action）；
    **后端真端点存在**：`apps/datacore/src/app.ts:1772`（POST 存，发 `sim.scenario_saved` 事件）、
    `:1784`（GET 按 baseId 列）、`:1791`（POST compare 横比矩阵）；分支经 POST 的 `parentId` 字段（`:1774`）。
    MSW 桩同步在 `apps/frontend-shell/src/mocks/handlers.ts:2537,2557,2566`。
- **结论**：✅ 已实现（三个活能力 + 原子因子深化全落地，前后端都真接）
- **⚠ 一条会误导人的过期注释（不是 PRD 的问题，是代码里的）**：
  `apps/frontend-shell/src/views/RiskBoardView.tsx:1066` 仍写
  「方案存/横比**依赖 WO-LIVE-SCENARIO（未合并则 MSW 桩**·集成接真点见 endpoints）」——
  实测 `WO-LIVE-SCENARIO` 的后端**已合并**（`app.ts:1772/1784/1791`），这行注释已过期。
  同页 `:933-936` 另有一条**正面记录**：前端曾内联"引擎不接受 base×factor"的结论并渲染成诚实灰，
  而"该结论早已过期（本体 §8 `G-GAP-SCOPE` 已闭）"——已改为按错误码分支给下一步。
  ⇒ 这两条一反一正，说明本页历史上被"过期结论"坑过一次，值得把 `:1066` 一并清掉。
- **最小 WO 建议**：`WO-CLC-1`（极轻）：删/改 `RiskBoardView.tsx:1066` 的过期注释；
  并决定 `QaPanel`（`:899/:1421`）是下线还是明确标注为"快捷问答"以区别于真 NL 框。
  🚦范围边界：`apps/frontend-shell/src/views/RiskBoardView.tsx` 单文件。

---

### docs/PRD-catalog-battery-20-scenarios.md
- **它要做什么**：电池场景包的**完整内容目录**——20 个场景（§1 总表是所有派生物的单一来源），
  新增 13 个求解器（§2 公式级）、新增 C26–C33 共 8 条规则（§3），每场景按 §0 五步流水
  （求解器→规则→workflow→skill→agent）上架。
- **PRD 自称的 AS-IS**：无独立现状节；有**复用声明**——"8 个求解器已有公式级规格…本文新增 13 个；
  规则在 C01–C25 基础上新增 8 条"。
- **实测现状**：
  - **§1 20 场景卡 ✅ 全在**：`apps/agentcore/src/scenarios-catalog.ts` 内 `card("S01")…card("S20")`
    共 **20 条**（`:61`–`:121`，逐条核过编号连续无缺）。
  - **§2 新增 13 求解器 ✅ 全部注册**（在 `apps/datacore/src/solvers/service.ts` 逐个命中）：
    `mitigation_select` `cert_schedule` `kit_readiness` `lta_gap` `inventory_optimize`
    `changeover_sequence` `yield_diagnosis` `maintenance_stagger` `outsourcing_split`
    `quote_margin` `credit_exposure` `quarterly_gap` `carbon_footprint` —— **13/13**。
  - **§3 C26–C33 ✅ 8/8 全在**（分布在 `apps/datacore/src/synthetic/battery.ts` 与
    `packages/contracts/src/datacore.ts`）。
  - 场景卡本身带 `rules[]`/`solver`/`intentKey`/`presetContext.slotPresets`，
    与 §1 总表的列一一对应（如 S07 `["C04","C26"]` + `cert_schedule`，`scenarios-catalog.ts:67`）。
- **结论**：◐ 部分（**§1/§2/§3 三张表 100% 落地；§0 五步流水的第 ④⑤ 步（每场景一 skill + 一 agent）未按 20 个做**）
- **缺的那半**：
  **skill / agent / workflow 的数量远少于 20，不是"每场景一套"**：
  `apps/agentcore/src/mocks/seed.ts` 实测 **7 个 Skill**（`skl_seed_capacity` / `sop_meeting` / `risk_analysis` /
  `supply_chain` / `quality_control` / `mcp_guide` / `capacity_action`，`:1018–:1289`）、
  **11 个 Agent**（`agt_seed_analyst` … `agt_coordinator`，`:1339–:1567`）、**6 个 Workflow**。
  ⇒ §0「每场景固定五步，禁止跳步」的 ④⑤ 两步实际是**按域收敛**（一个 skill/agent 覆盖多场景）而非逐场景。
  另：§0 的完成判据「§8 自动生成的 3 条评测用例 + 1 条端到端用例全绿」——
  **`seed.ts` 里 EvalCase 零条**（`suite:` / `skillKey` 均零命中，与前述 skill-authoring 条同一发现），
  ⇒ 这条完成判据对 20 场景**没有一条真跑过**。
- **最小 WO 建议**：`WO-CAT-1`（中）：为 20 场景各补 3 条评测用例（§8 规则可自动派生，不必手写）。
  🚦范围边界：`apps/agentcore/src/mocks/seed.ts`（EvalCase 数组）+ 一条"20 场景评测全绿"回归。
  skill/agent 数量建议**维持收敛**并改 §0 措辞（一 skill 覆盖多场景比 20 个碎 skill 更符合本 PRD 自己的
  skill-authoring 规范：summary 是触发器、不适用句要互相让渡）。

---

### docs/PRD-cli-full-coverage.md
- **它要做什么**：把 `OPERATION_CATALOG` 从**手维护数组**改为**从能力注册表自动派生**（`deriveOperationCatalog`），
  并加一道 `cli-coverage:check`（注册表↔目录）与既有 `cli-parity:check`（目录↔CLI）合成"每个功能 CLI 可达"闭环。
- **PRD 自称的 AS-IS**（§0，grounded audit 带 file:line）：
  CLI 18 命令已在；`OPERATION_CATALOG`（`contracts/operation-intent.ts:44`）**≈18 op、手维护**；
  `cli-parity:check` 现绿；**缺口 = ~10 能力区无 op（时序/聚合 A8·模拟时钟 tick·LLM provider/binding·
  config-bundle·evals·meta-ontology·slices·lineage·OC 平台配置·replay/ops-schedule）+ 目录手维护会 rot**。
- **实测现状**：
  - **§1.1 `deriveOperationCatalog` ❌ 不存在**：`packages/contracts/src/operation-intent.ts` 内
    `deriveOperationCatalog` / `OPERATION_REGISTRY` / `source: "DERIVED"` **全部零命中**，
    目录仍是**显式手写数组**。
  - **§2 新契约文件 `packages/contracts/src/operation-registry.ts` ❌ 不存在**。
  - **§1.2 新门 `scripts/check-cli-coverage.mjs` + `scripts/cli-coverage-baseline.json` ❌ 均不存在**。
  - **⚠ 连 PRD 引以为基础的既有门也没接线**：`scripts/check-cli-parity.mjs` 文件在（3,658 字节），
    但**零生产调用方** —— `package.json:32` 的 23 条 gates 里没有它、`scripts/gate.sh` 没有它、
    `.github/workflows/gates.yml` 没有它、任何 test 也没跑它（`packages/*/test` + `apps/*/test` 零命中）。
    全仓只有 **docs/** 里 10 篇 PRD 提到 `cli-parity`。
    ⇒ §0 写的"`cli-parity:check` 现绿"—— **它不是"绿"，它是"没跑"**。这正是本次审计要防的形态：
    **文件存在 ≠ 门在守**（同 VLE 的 `check-validation.mjs`，本批第二例）。
  - **缺口本身被"手动补目录"部分填上了（❸ 型：目标达成、机制没建）**：
    `operation-intent.ts` 现有 **39 条 op**（PRD 写的是 ~18），
    §0 点名的 10 个缺区里 **8 个已有条目**：`llm`(`:70`) `config-bundle`(`:83`) `eval`(`:69`)
    `meta`(`:75`) `slice`(`:76`) `platform-config`(`:79`) `ops`(replay/scheduler/tick，`:71`) `validate`(`:80`)。
    **仍缺 2 个**：**时序/聚合（A8 timeseries）** 与 **lineage 溯源** —— 两者在该文件零命中。
- **结论**：❌ 未实现（PRD 的**机制**——自动派生 + 覆盖门——一件没建；
  目录条数虽从 ~18 涨到 39，是**手工补**的，正是 PRD 要消灭的那种做法，rot 风险原样存在）
- **最小 WO 建议**（按投入产出排，第一条极便宜且价值最高）：
  - `WO-CLI-0`（**极轻·最高性价比**）：把已存在的 `scripts/check-cli-parity.mjs` 并入 `package.json:32` 的 `gates`。
    这是一条线不是一道门，且能立刻让"目录↔CLI"真守起来。
    🚦范围边界：`package.json` + `scripts/gate-ledger.json` + 本体 §7 登记。
  - `WO-CLI-1`（轻）：补 `timeseries` 与 `lineage` 两条 op（含 `cliCommand`）。
    🚦范围边界：`packages/contracts/src/operation-intent.ts`。
  - `WO-CLI-2`（中）：实现 `deriveOperationCatalog` + `check-cli-coverage.mjs` 棘轮门（治 rot 的根）。
    🚦范围边界：`packages/contracts/src/operation-{intent,registry}.ts` + `scripts/check-cli-coverage.mjs` + `package.json`。

---

### docs/PRD-cockpit-capacity-1to1-parity.md
- **它要做什么**：把参考原型的「经营驾驶舱」与「产能推演」两模块 1:1 复刻进真系统，
  数字全部经数据管线产生（合成→物化→派生→求解→声明式 widget），前后端零写死；
  另含 §A「原型 intake → 数据构建发动机正门」通用前置能力。
- **PRD 自称的 AS-IS**（§2，**三张分表 + 一节"唯一非真闭环接缝"**）：
  2.1 驾驶舱缺 8 富 KPI / 问题卡 / 根因 DAG / V5-V7 版本态；
  2.2 产能推演引擎已高度对齐、缺 UI 层若干；
  2.3 **自陈唯一非真闭环 = `riskCases` 来自 `livedin/engine.ts:62 CASE_SPECS` 种子骨架、非求解器实时算**。
  版本行标 **状态 APPROVED（已评审通过 2026-06-21）**。
- **实测现状**（§0 承诺的新对象/新求解器/新事件逐个核）：
  - **新增 3 求解器 ✅ 全部注册**：`order_fullchain` / `plan_rootcause` / `counterfactual_timeline`
    均在 `apps/datacore/src/solvers/service.ts` 命中。
  - **新增 6 对象类型 ◐ 5 个在、1 个改名**：
    `DemandSegment` ✅ / `SopVersionRow` ✅ / `MaterialBalance` ✅ / `FinancePlan` ✅ / `RootCauseChain` ✅
    （均在 `apps/datacore/src/synthetic/battery.ts` 的生成器返回值 `:4450` 里）；
    **`PlanKpi` 在代码里不叫 PlanKpi** —— 已归一为 **`Metric`（SPINE）**：
    `packages/contracts/src/spine.ts:34`「cockpit PlanKpi = Metric 的 plan 域投影」、
    `apps/datacore/src/synthetic/battery.ts:1044`「Metric = 指标库一等对象…= cockpit PlanKpi 归一」、
    `:3942`「SPINE：指标库 Metric（= cockpit PlanKpi 归一）」。
    ⚠ **只 grep `PlanKpi` 会报"未实现"，实际是同物异名且做得更好（归一到跨视图单一出处 R-一致）。**
  - **§A 原型 intake 正门 ✅ 落地**：契约 `packages/contracts/src/prototype-intake.ts`
    （含 `SchemaReconcileCandidateSchema:46`）+ 实现 `apps/datacore/src/databuilder/prototype-intake.ts`
    + 端点三段 `apps/datacore/src/app.ts:3838`（解析预览）`:3857`（经连接器落 RawDataset）`:3870`（物化）
    + 事件 `prototype.intake_recorded` / `prototype.materialized` / `prototype.objectified` / `schema_reconcile.resolved`（真在 outbox 事件名集里）。
  - **§0 承诺的新事件 `forecast.snapshot_recorded` ❌ 不存在**：
    跨命名搜过（`snapshot_recorded` / `forecast_snapshot` / `forecastSnapshot`），
    datacore 的 outbox 事件名全集里有 `metric.snapshot_recorded`（`app.ts:2743`，SPINE 的）
    但**没有 forecast 版**；`forecastSnapshots` 仓储在（`repo/repo.ts:284`）、
    `capacity_forecast` invoke 确实会落快照（`opsteam/replay.ts:152` 注释可证），**但落完不发事件**
    ⇒ §0 声明的"失效 risk/dashboard 预测 widget"这条失效通道**没建**。
  - **§2.3 自陈的唯一非真闭环（P4）◐ 半修**：`apps/datacore/src/livedin/engine.ts:67 CASE_SPECS` **仍在**，
    `:277 return CASE_SPECS.map(...)` 仍是骨架驱动；**但 severity 已改为真数据派生** ——
    `:283-284`「P4 真闭环：severity 由基地真实利用率 + 是否主瓶颈因子 + 危机派生（替代写死，R13 可溯源 R6 确定）」
    → `caseSeverityFromData(baseUtil, isPrimary, crisis)`。
    ⇒ 「由 `risk_timeline` 在历史快照上回算」这个 P4 目标**没做到**，做到的是"严重度不再写死"。
- **结论**：◐ 部分（三求解器 + 六对象（一个改名）+ §A intake 全落；**缺一个事件通道 + P4 只半修**）
- **最小 WO 建议**：
  - `WO-CKP-1`（轻）：`capacity_forecast` invoke 落 ForecastSnapshot 后 `outbox.emit("forecast.snapshot_recorded", …)`，
    前端 risk/dashboard 预测 widget 订阅失效。🚦范围边界：`apps/datacore/src/solvers/service.ts` + 订阅侧一处。
  - `WO-CKP-2`（中）：P4 收尾——`riskCases` 改由 `risk_timeline` 在历史快照上回算，删 `CASE_SPECS` 骨架。
    🚦范围边界：`apps/datacore/src/livedin/engine.ts` + 金值同步。
  - `WO-CKP-3`（极轻·文档）：把 §0 的 `PlanKpi` 改标为「已归一为 `Metric`（SPINE），见 contracts/spine.ts:34」，
    免得下一个读者去找一个不存在的类型。

---

### docs/PRD-data-backfill.md
- **它要做什么**：沙盘 20 例反查出的数据地基缺口——补 4 个真缺字段 + 修 1 个既有缺陷 + 1 个时序粒度空档。
- **PRD 自称的 AS-IS**：**它自己就把交付形态写成「本文只是 PRD。零代码改动」**，
  并在 §0 断点节里**新登记** `G-LEVER-PROP-PHANTOM`，状态标 **🔴 未修（本单治）**。
  §3.1 另有一条**仓主裁决记录**（2026-08-04 选方案 A · 补数据）。
- **实测现状**（D1–D6 逐条核，**PRD 的自陈全部属实**）：
  - **D1 `MaterialBalance.coverage` ❌ 仍是幻影属性**（`G-LEVER-PROP-PHANTOM` 未修，实测复现）：
    声明侧三处齐全 —— `apps/datacore/src/solvers/service.ts:359`
    `物料齐套: ["MaterialBalance.coverage", ...]`、`:381` `"MaterialBalance.coverage": { label: "物料齐套·覆盖率", unit: "%", kind: "ratio" }`；
    **产出侧零** —— `apps/datacore/src/synthetic/battery.ts:1033-1041` 的 `materialBalanceProps` 只有
    `matBalId/material/unit/netDemandTon/ltaPct/gapTon/etaDate`，**无 `coverage`**；
    `apps/datacore/src/synthetic/battery-extended.ts` 内全部下钻/规则/聚合一律用 `gapTon`（`:320,:357,:360,:841,:858`）。
    ⇒ 教科书级形态②「接了线没数据」：`service.ts:368` 注释「缺项 → 下游诚实兜底不臆造」使它**静默降级**，
    于是「物料齐套」这个杠杆候选**永不出现且不报错**。
  - **D2 `Customer.tier` ❌** / **D3 `MaintPlan.start`+`end` ❌**：
    `maintPlanProps`（`battery.ts:975-980`）只有 `planId/baseId/week/lastMaintStart` —— **无窗口起止**，
    所以「交付高峰撞检修窗」今天确实算不出（PRD §3.3 说法属实）。
  - **D4 `Base.capexWan` ❌**：全仓 `capexWan` 零命中。
  - **D6 shift 档时序 ❌**：`grain: "shift"` 作为**类型**是支持的
    （`apps/datacore/src/synthetic/tsgen.ts:7`、`battery.ts:2623`），
    但**没有任何一条 series 声明为 shift 粒度**（`grain: "shift"` 在生成器/契约里零实例）。
- **结论**：❌ 未实现（**与 PRD 自称一致**——它本来就声明"零代码改动"，是一份待施工的规格）
- **注**：这一条**不应算作"PRD 与现状不符"**。相反，本批里它是**自陈最准确的一份**：
  声明的每一个缺口我都独立复现了，连 `G-LEVER-PROP-PHANTOM` 的三处声明锚点都逐字对上。
- **最小 WO 建议**（按投入产出，D1 第一）：
  - `WO-DB-1`（轻·价值最高）：`MaterialBalance` 加 `coverage`（派生自 `1 - gapTon/netDemandTon`，
    按 §3.1 裁决与硬约束：不得独立随机、须带 displayName+description、须配同向断言）。
    🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（props + 生成）+ 金值同批更新 + R6 双跑证明。
  - `WO-DB-2`（轻）：`MaintPlan` 加 `start`/`end`（两个一起加，只加 start 表达不了窗口）。
  - `WO-DB-3`（中·风险最高）：shift 档时序 —— **必须同批声明班次剧本与聚合算子**
    （`output:line`→`sum`；`util/yield/attainment`→`weighted_avg`+`weightField`），
    否则按 PRD §3.5 的警告会出「产能凭空少 3×」或「利用率 276%」且不报错。

---

### docs/PRD-data-closure-spec.md
- **它要做什么**：横切**宪法级**规范——把"接入→模版→生成→物化→派生→切片→求解→渲染→溯源→闭包→审批→指标→责任→CLI"
  定为 21 维强制基线（§2），给逐模块 checklist（§6）+ 门禁补强（§7）。
- **PRD 自称的 AS-IS**（§3，**18 阶段逐维审计表**，自评"系统数据闭环约 60–70% 落地"）：
  点名最严重五缺口：①模版↔种子解耦（battery 写死、无上传建模版入口）②新对象类型无自动 onboarding
  ③渲染非声明式 ④CLI 缺位 ⑤PRD 普遍漏 C/D/R/B/N/O/Q 维。
  §3 表首行即自标 `T2 模版生命周期 ❌`，锚点 `battery.ts:716 BATTERY_TEMPLATE 代码常数`、
  `service.ts:116 resolveTemplate 从不读库`、"无上传建/改模版入口（仅 GET，无 POST）"。
- **实测现状**：
  - **T2 ❌ 自陈属实**：`apps/datacore/src/app.ts:3493` 只有 `app.get("/a/v1/industry-templates", ...)`，
    **全仓没有对应的 POST/PUT** ⇒ 模版仍不可上传/编辑/fork。
  - **V1 声明式渲染 `ViewDef` 契约 ❌**：`packages/contracts/src` 内 `ViewDefSchema` 零命中
    （唯一 `ViewDef` 字样在 `packages/contracts/src/qos.ts:530` 的一句注释里，不是契约）。
  - **§7 提出的四道新门 ❌ 一道都不存在**：
    `scripts/check-template-lifecycle.mjs` / `check-auto-onboard.mjs` / `check-shape.mjs` / `check-closure.mjs` 均无此文件。
  - **§7 提到的既有门里，两道真在 `pnpm gates`**（`package.json:32`）：
    `chain:check` = `check-chain-closure.mjs` ✅、`prd:check` = `check-prd-ontology.mjs` + `check-prd-coverage.mjs` ✅。
    `cli-parity:check` **文件在但未接线**（见上条 cli-full-coverage）。
- **结论**：◐ 部分（**规范文本与 21 维清单本身即交付物、已完成**；
  它提出的**执行装置**——四道新门 + ViewDef 契约 + 模版库化——一件未落）
- **诚实说明**：本文是"规范 + 审计"型 PRD，它的 §3 AS-IS 自评（60–70%）与我的实测方向一致，
  我没有独立重算那个百分比（21 维 × 逐维核证超出本批预算），**未查清：60–70% 这个数字本身**。
- **最小 WO 建议**：`WO-DCS-1`（轻）：先把 `closure`/`shape` 两道**已有实现散在代码里**的检查抽成脚本门
  （`validateClosure` 已在 `apps/datacore/src/databuilder/closure.ts:20`；
  SHAPE 校验散在 `SOLVER_OUTPUT_SHAPES` 消费处），并入 `pnpm gates`。
  🚦范围边界：`scripts/check-closure.mjs`（新）+ `package.json` + 本体 §7 登记。
  T2（模版库化）与 V1（ViewDef）建议各自独立成单，不与门禁混做。

---

### docs/PRD-data-gap-self-healing-loop.md
- **它要做什么**：把"发现缺数据 → 分析 → 生成 → 验证 → 发布"做成通用自愈闭环（R16 通用化），
  核心护栏是 **HARD/SOFT 分流**（涉真实业务实体的缺口**绝不静默合成**，出工单走真人正门）。
- **PRD 自称的 AS-IS**（§0，**一张"你要的闭环 80% 已存在"对照表**）：
  发现 `probe.ts classifyGap` ✅（但只被 QOS 问句触发）· 分析 `data-boundary.ts` ✅ ·
  生成 `scaffold.ts`+A7 ✅ · 验证 ✅（散落）· 发布 ◐ · 闭环 `loop.ts runGrowthLoop` ✅；
  **真正缺的三条**：①发现相位只被动、②UI 缺口没接进 runGrowthLoop、③闭环不可观测。
  §6 分三级交付：Level-1（进行中）/ Level-2 / Level-3。
- **实测现状**：
  - **§0 表里的六个"已有" ✅ 属实**：`apps/agentcore/src/growth/` 下 `probe.ts` / `data-boundary.ts` /
    `scaffold.ts` / `loop.ts` 均在（`data-boundary.ts:25,:37,:40,:66` 可见 DF.9 时序维度接地与措辞词表）。
  - **Level-1 ✅ 已落**：per-factor 真序列在 `apps/datacore/src/solvers/risk.ts`——
    `:383 tensionSeries`、`:613` 逐 base×factor 跑、`:614-616` 注释
    「治 #1/#3『时序推演全灰/无梯度』· 逐因素真逐日序列…现在**每个**因素都走与瓶颈**同一** tensionSeries 机制」，
    诚实标 `provenanceSynthetic`（`:220,:257`）而非谎称实测。
  - **Level-2 ❌ 未做**：`DataGapDetector` / `GapSignal` / `SelfHealing` 在
    `apps/**/src` + `packages/**/src` **全部零命中**（跨命名也搜了 `datagap.detected` / `datagap.healed`）。
  - **Level-3 ❌ 未做**：无主动 sweep；§4 承诺的两个新事件
    `datagap.detected` / `datagap.healed` **不在 datacore 的 outbox 事件名集里**
    （该集实测为：connection.created / derivation.completed / materialize.completed / metric.breached /
    metric.snapshot_recorded / prototype.* / schema_reconcile.resolved / sim.* / slice.planned / writeback.divergence）。
  - **§5 SEAM-GATE 头号判据的那条组合测 ❌ 不存在**（依赖 Level-2 的 Detector）。
- **结论**：◐ 部分（**Level-1 已落、护栏（HARD/SOFT）真在，Level-2/3 未开工** —— 与 §6 分级交付的自陈一致）
- **最小 WO 建议**：`WO-DGS-1`（中）：实现 Level-2 `DataGapDetector`——
  只聚合**已存在**的四个信号源（`dataMode==="EMPTY"` / `provenanceSynthetic===true` /
  因子无 series / `unverifiedNumerics===true`），复用 `growth/probe.ts classifyGap` +
  `growth/data-boundary.ts` 分流，产 `growth-ledger` 一条台账。**不新造探针/分流逻辑**（§2 单源纪律）。
  🚦范围边界：新 `apps/agentcore/src/growth/detector.ts` + `growth/loop.ts` 一个接入点 +
  两个事件名注册 + §5 那条 SEAM 组合测。

---

## 2. 汇总表（22 份）

| # | PRD | 结论 | ⚠ 自身陈述与现状不符 | 缺口形态 |
|---|---|---|---|---|
| 1 | addendum-replay-orchestrator | ◐ | — | ❷×2（`listFallbackClusters` 恒空 / 部署未配 `AGENTCORE_BASE_URL`） |
| 2 | addendum-skill-authoring | ◐ | 出厂范例同物异名 | ❶×1（summary 重叠检查）+ ❷×1（出厂技能零 EvalCase） |
| 3 | addendum-solvers-and-gaps | ✅ | **⚠×3**（P50 公式 / 非整数窗口 / 三方案映射） | — |
| 4 | addendum-validation-loop | ◐ | — | ❶×1（`check-validation.mjs` 未接线）+ ❷×1（profile 三档零分支） |
| 5 | admin-self-approval | ✅ | **⚠×1**（PRD 说建租户配置列，实为 env+demo 零迁移） | — |
| 6 | agent-data-generation-tools | ◐ | — | ❶×1（`fill_data` 未登记 OPERATION_CATALOG） |
| 7 | agent-execution-governance-loop-control | ◐ | **⚠×1**（§8 把已落的 P1/P2 标"待派"） | ❶×3（P3 三项，PRD 自己也排后） |
| 8 | agent-navigation-slice-latency | ✅ | — | 未查清×1（live 20 题墙钟）+ 连带欠账（600s 创可贴仍在） |
| 9 | agent-react-harness | ◐ | — | ❶×2（`agent.reflected` 事件 / `harness-elements:check` 门） |
| 10 | aop-annual-scenario-1to1 | ◐ | **⚠×1（本批最典型）**：§9「100% 1:1」点名三项全未还原，且与 §2 自相矛盾 | ❶×3（dem 值 / 产能决策文案 / 触发条件） |
| 11 | attainment-base-daily-timeseries | ◐ | — | ❶×2（`Base.attainment_daily` / 接 Metric）+ **有数据零消费方** |
| 12 | attribution-routing-plan-audit | ◐ | — | ❶×2（关键词路由 / discover 暴露）**但等价能力经 `gap_attribution` 已通** |
| 13 | build-workflow-runtime | ✅ | — | 未查清×1（AC 的运行时行为未实跑） |
| 14 | capacity-feasibility-demanddelta-fix | ✅ | **⚠×1**（文首仍写「草案·仅文档不改源码」，实际早已落地） | — |
| 15 | capacity-inference-completion | ✅ | — | 未查清×1（SEAM 活系统 curl） |
| 16 | capacity-live-cockpit | ✅ | 代码注释过期（`RiskBoardView.tsx:1066`） | — |
| 17 | catalog-battery-20-scenarios | ◐ | — | ❷×1（20 场景零 EvalCase，§0 完成判据从未真跑） |
| 18 | cli-full-coverage | ❌ | **⚠×1**（§0 称 `cli-parity:check` 现绿，实测**零调用方=没跑**） | ❶×3（派生器 / 新契约 / 覆盖门）+ 仍缺 2 个 op |
| 19 | cockpit-capacity-1to1-parity | ◐ | `PlanKpi` 同物异名（已归一为 `Metric`） | ❶×1（`forecast.snapshot_recorded` 事件）+ P4 半修 |
| 20 | data-backfill | ❌ | — **（自陈"零代码改动"，属实，本批自陈最准的一份）** | ❶×4 + ❷×1（`MaterialBalance.coverage` 幻影属性） |
| 21 | data-closure-spec | ◐ | — | ❶×6（四道新门 + ViewDef + 模版库化）；未查清×1（60–70% 自评） |
| 22 | data-gap-self-healing-loop | ◐ | — | ❶（Level-2/3 全部）—— 与 §6 分级自陈一致 |

**计数**：✅ **7** · ◐ **13** · ❌ **2** · ⚠（自身陈述与现状不符）**9 处**，分布在 8 份 PRD。
**未查清 5 处**（均因只读审计无法验墙钟/实跑，逐条已在正文写明卡在哪）。

### 缺口形态分布（22 份合计）
| 形态 | 条数 | 说明 |
|---|---|---|
| ❶ 没接线（调用方只有 test / 符号根本不存在） | ~28 | 多为"承诺的事件名/门/字段没建" |
| ❷ 接了线没数据（输入恒空、配置恒缺、分支 never 进） | 6 | **最难发现、最容易误判**，见下 |
| ❸ 接了线接错地方 | 2 | 部署未配 env；目录手工补而非自动派生 |

**❷ 型六条全表（这类只 grep 符号一定看不出来）**：
1. `apps/datacore/src/app.ts:697` `listFallbackClusters: async () => []` → `promote_intent` 恒跳过
2. `docker-compose.yml` datacore 段无 `AGENTCORE_BASE_URL` → `ask`/`promote_intent` 出货态恒跳过
3. `apps/agentcore/src/mocks/seed.ts` 零 EvalCase → skill 发布门 + 20 场景完成判据对出厂内容均未生效
4. `apps/datacore/src/vle.ts:68` profile 收下不分支 → SMOKE/FULL/SOAK 是同一段代码
5. `apps/datacore/src/solvers/service.ts:359` `MaterialBalance.coverage` 幻影属性（产出侧零，静默降级）
6. `attainment:base` 有生产端无消费端（`battery.ts:2610` 是全仓唯一非 test 命中）

---

## 3. 按投入产出排序的补做建议

> 排序依据：**（消除的误导 / 关掉的假绿）÷ 改动面**。前 4 条都是"接一条线"而非"造一道门"。

| 序 | WO | 类型 | 改动面 | 为什么排这里 |
|---|---|---|---|---|
| **1** | `WO-CLI-0` 把 `scripts/check-cli-parity.mjs` 并入 `package.json:32` gates | 接线 | 1 行 | 门已造好、零调用方；PRD §0 还在称它"现绿"。**一行消掉一个假绿断言** |
| **2** | `WO-VLE-1` 把 `scripts/check-validation.mjs` 并入 gates（本体 §7 已记 `disposition=WIRE`） | 接线 | 1 行 + 门账 | 同上。VLE 全套引擎已建，只差 CI 拦截；本体自己都写了"待接线 WO" |
| **3** | `WO-RO-2` `docker-compose.yml` datacore 段补 `AGENTCORE_BASE_URL` | 接线 | 1 行 | 让回放编排器的任务史/孵化在**出货形态**真产出（R2 验收当前恒为零） |
| **4** | `WO-RO-1` `app.ts:697` `listFallbackClusters` 接真兜底簇（`ops/fallback.ts:21` 已有聚类） | 接线 | 1 个 lambda | 消掉一条"测试验的路生产不走"的假绿 |
| **5** | 四份 PRD 的**状态/口径回写**（纯文档，合并成一单跑） | 文档 | 4 文件 | `capacity-feasibility-demanddelta`（草案→LANDED）· `loop-control §8`（P1/P2 待派→已落）· `aop §9`（1:1 尺度二选一，**需人裁**）· `attribution-routing`（改指 `gap_attribution`）。**这四处正在实时误导读者** |
| **6** | `WO-DB-1` `MaterialBalance.coverage` 补数据（仓主已裁决方案 A） | 数据 | 生成器 + 金值 | 关掉 `G-LEVER-PROP-PHANTOM`；「物料齐套」杠杆从此真能出现 |
| **7** | `WO-SA-1` / `WO-CAT-1` 补 EvalCase（出厂 7 技能 + 20 场景） | 数据 | seed.ts | 让**已建好的两道发布门**对出厂内容真生效（现在门在、料没有） |
| **8** | `WO-TSB-1` `attainment:base` 接 Metric + 补 `Base.attainment_daily` | 接线 | 生成器 + metrics.ts | 让已产出的日序真有人问（现零消费方） |
| **9** | `WO-CKP-1` `forecast.snapshot_recorded` 事件 + 订阅 | 接线 | 2 处 | 补一条 §0 承诺但没建的失效通道 |
| **10** | `WO-CLI-2` `deriveOperationCatalog` + `cli-coverage:check` | 造门 | 契约 + 新脚本 | 治目录 rot 的**根**；但成本高于前九条，且第 1 条先把眼前的洞堵上 |
| **11** | `WO-DGS-1` Level-2 `DataGapDetector` | 新建 | growth/ + SEAM | 价值高但工作量大；PRD 自己也排在 Level-2 |
| **12** | `WO-VLE-2` VLE profile 真分档（FULL 走 365 tick + 混沌 + 三角色） | 重 | vle.ts | 重活；在第 2 条接线之后做才有意义（先让门拦得住，再让门更严） |
| — | **建议继续排后**：loop-control P3 三项、data-closure-spec 的 T2/V1、react-harness 的两个回写承诺（建议改文档而非补代码） | — | — | PRD 自己的优先级判断经复核是对的 |

---

## 4. 给下一位审计者的三条经验（本批实测踩出来的）

1. **PRD 的状态行会骗人，和待办状态一样不可信。**
   本批有 3 份 PRD 的状态与代码相反：`capacity-feasibility-demanddelta` 写"草案·仅文档"实际早已落地；
   `loop-control §8` 把已落的 P1/P2 标"待派"；`build-workflow-runtime` 写 LANDED（这份是真的）。
   **三种情况都存在 ⇒ 状态行只能当线索，必须去代码里核。**
2. **"同物异名"在本批出现 3 次，每次都足以让人误报 ❌。**
   `production-capacity-interpretation` → 实为 `capacity_analysis`；
   `PlanKpi` → 已归一为 `Metric`（SPINE）；
   PRD 要求路由到 `plan_audit` → 实际由 `gap_attribution`/`plan_rootcause` 承担。
   **判 ❌ 之前先问：这件事会不会已经在系统里换了个名字做了？**
3. **"脚本存在"和"门在守"是两回事，本批抓到 2 例。**
   `scripts/check-validation.mjs` 与 `scripts/check-cli-parity.mjs` 都实现完整、都零生产调用方。
   判据：**去 `package.json` 的 `gates` 串、`scripts/gate.sh`、`.github/workflows/*.yml` 里逐个数**，
   三处都没有 = 这道门今天拦不住任何东西，无论它写得多好。
