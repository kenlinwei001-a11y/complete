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
