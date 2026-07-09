# PRD：统一 GapAnalysis 引擎与补齐闭环治理（canonical · 代码落地对齐）

> 状态：草案待审 · 版本 v4（合并 v4 接线级 + 前端融合 + 隐藏需求不造假三稿为单一真相源）
> 作者：Claude（基于对本仓库逐文件核对重写）· 日期：2026-07-09
> **本文件是本需求的单一真相源**：其他 agent / dev 一律以本文同步，不再分散多稿。冲突时以平台总纲 `docs/PRD-platform-foundry-aip.md` 为准。
> 所有引用的符号 / 端点 / 不变量 / 断点均已核对真实存在，附 `file:line`。

---

## §0 本体引用与影响（铁律 0 强制 · 门 `prd:check` 机器解析本节）

> 依 `docs/ontology/INDEX.md`「写/改 PRD → 05-invariants(全铁律)·必含《本体引用与影响》」。`scripts/check-prd-ontology.mjs` 解析本节的 `Rxx`/`G-x`，悬空即红。

**触及对象类型（母体 §2）**：`GapAnalysis`/`GapAnalysisEntry`/`GapItem`（§2 · `packages/contracts/src/databuilder.ts:418`）· `GapReport`/`GapFinding`/`GapCode`（§2.H · `growth.ts:10`）· `ClassificationResult`（§2.H · `qos.ts:224`，复用）· `GrowthLedgerEntry`/`WorklistItem`/`GrowthTicket`（§2.H · `growth.ts`，复用）· `DataDependency`/`SOLVER_DATADEP`（§2 · `datadep.ts:86`，复用）· **新增** `PreAnalysisReport`/`CapabilitySnapshot`（§2.H）。

**触及链路（母体 §3）**：正序编排链 Query→classify→Intent→ExecutionPlan→{Solver|Slice|Rule|render}→SSE（§3 编排链）· 倒序 `GapReport`＝生长信号→倒序长出（R16）· **新增** 隐藏需求依赖闭包（Solver `SOLVER_DATADEP` requires role → 本体图一跳）。

**新增/改变事件（母体 §4 · 受 R10/D-29 约束）**：`growth.pre_analysis_started` / `growth.pre_analysis_done` / `growth.pre_analysis_failed`——经既有 `emitDomainEvent(tenantId,event,payload)`（`agentcore/src/server.ts:198`）落 outbox，并在 `agentcore/src/event-subscriptions.ts` 登记订阅。

**不变量**：R1 contracts-only-shared · R2 tenant_id · R6 确定性（纯函数·无时钟随机·LLM mock） · R7 错误信封 · R9 仓储双实现（migrations+pg+memory+repo 四处） · R10 D-29 数据流闭环 · R11/R12 闭包（复用 ClosureReport/verifyBuild 验证） · R13 溯源（explanation.evidence 指真实依据） · R14 零业务常数（roleType 抽象角色） · R16 发育闭环（本 PRD 核心）。前端另守 R-QUANT/R-PRD（§7）；发布守 RL2 暗发（`defaultOn:false`）、RL9 additive（migration 带 down）。

**断点（母体 §8）**：G-1（全链闭合·query 目标预诊断补强） · G-3（presetContext/QOS 注入·复用 SessionContext） · G-4（意图执行计划入口·收口既有 worklist/ticket） · G-8（数据接入/就绪·隐藏需求走 checkReadiness）。

**回写母体（改完必做，见 §12）**：§2.H 登记 `PreAnalysisReport`/`CapabilitySnapshot`；§3 补隐藏需求闭包边；§4 补 3 事件；§7 登记未来门 `hidden-req-keys:check`（其落地时）；改完跑 `pnpm ontology:slices` 重生成切片（否则 `ontology-slices:check` 红）。

---

## §1 背景与目标

### 1.1 真实痛点
1. **无缺口全景**：`classifyGap`（`probe.ts:126`）设计上一次只报一个阻塞点（撞哪堵墙报哪堵墙，是 reactive 基石），缺一个「提前给全景」的旁路。
2. **补齐顺序＝发现顺序**：Growth Loop 每轮只补 `findings[0]`，发现顺序 ≠ 依赖顺序。
3. **两套 Gap 不互通**：DataBuilder 的 `GapAnalysis`（script 目标 `databuilder.ts:435`）与 Growth 的 `GapReport`（query 目标 `growth.ts:42`）从不交叉引用。
4. **补齐后验证不统一**：DataBuilder 看 `ClosureReport`，Growth 看 `verdict`，其他入口无验证。

### 1.2 目标
| 目标 | 描述 | 优先级 |
|---|---|---|
| G1 统一缺口契约 | script 与 query 目标输出同一 `GapAnalysis` | P0 |
| G2 依赖排序 | 复用 provisioner `side` 做四层拓扑序 | P0 |
| G3 异步全景预分析 | 后台给「本查询涉及 N 项缺口」，不阻塞 SSE | P1 |
| G4 补齐后统一验证 | 复用 `ClosureReport`/`verifyBuild` | P1 |
| G5 补齐入口归集 | 收口既有 worklist/ticket，不另造 | P2 |

**非目标**：不建 7 层图验证器、不建常驻 Redis Registry、不建 Graph Rewrite 引擎、不在 DataCore 侧聚合 AgentCore 注册表（架构不成立，见 §3）。

> **精度边界与关联单（诚实声明·防过读）**：系统"倒推"两段串联——`①classify(听懂→意图)` → `②依赖闭包(意图→求解器→类型→数据)`。本 PRD 只解决 **②下游**（§8 不造假 key 闭包），**不动 ①上游 classify**（§6 复用既有 `ClassificationResult`）。因 ①②串联，**②精度上限被 ① 锁死**（garbage in → precise closure of garbage）；且本 PRD §10 已自设限：预分析是**咨询信号非判决**，权威判决仍归 reactive `classifyGap`。因此本单是"引擎去重 + 下游依赖精度"升级，**不是**倒推精度的根治，也**不减用户可见入口**（反而 +1 全景条）。这两块的根治另立兄弟单，各一命题（利于多 agent 按文档同步）：
> - **兄弟单 A** `docs/PRD-upstream-classify-precision.md`：上游分类精度（确定性⊕LLM 融合，减 LLM 依赖）+ 求解器覆盖补齐——倒推精度的真杠杆。
> - **兄弟单 B** `docs/PRD-gapfill-surface-consolidation.md`：把 GapCard/工单中心/DataBuilder 的缺口-补齐面并成一个 Console（R17 决策单页）——真正"减面"。

---

## §2 As-Is 精确现状（逐条核对）

| 机制 | 真实状态（file:line） |
|---|---|
| `MODULE_PROVISIONERS` | 13 类，`side`/`autoCreatable` 齐全（`provisioners.ts:35`）。**6 个 A 栈类有 `existing()`；7 个 cross_system 类无 `existing()`，注释明写「不在 DataCore 直查，由 scaffold 回执判定」（`provisioners.ts:72-78`）** |
| `analyzeGap` | 签名 `analyzeGap(deps,ctx,plan,scaffoldReceipt?)`，**全仓仅 1 处调用**（`service.ts:406`）。cross_system 靠 `scaffoldReceipt.recByKind` 判定 |
| `SOLVER_KEYS` | 静态编译常量 `= REGISTRY_SOLVER_KEYS`（`solvers/service.ts:68`） |
| `classifyGap` | 永远返回 ≤1 finding（`probe.ts:126`），`GapReport{verdict,path,findings,generatedAt}` |
| 意图分类 | **已存在** LLM 分类器（`prompts.ts:101`）输出 `ClassificationResult{candidates,outOfCatalog,extractedSlots}`（`qos.ts:224`），挂 `QueryTask.classification`；另有确定性词法 `lexTokens/selectSkills`（`skill-router.ts:20`） |
| 领域事件 | `emitDomainEvent(tenantId,event,payload)`（`server.ts:198`）→ `domainEvents.append` → outbox → 前端 F1 轮询（D-29） |
| `growthLedger` | 仅 `insert/listByTenant`，按 `id(glr_)` 存（`repos.ts:295`）；`GrowthLedgerEntry{id,tenantId,report,createdAt}` |
| 补齐工单 | **已存在** `growthWorklist.upsert(WorklistItem)` + `growthTickets.upsert`；`WorklistItem{fromQuestion,gapCode,kind,status,evidence,deeplink,...}`（`growth.ts:224`） |
| 验证层 | `ClosureReport{gatePassed,objectsBound,dataOrphans,forwardMissing}` + `selfcheck.ts` + `verifyBuild`（`service.ts:707`） |
| 求解器依赖 | **已存在** `SOLVER_DATADEP`（`datadep.ts:86`）solver→抽象 roleType+viaLinks；`checkReadiness`（`service.ts:1695`）就绪探测 |
| 本体关系图 | `GET /a/v1/ontology/graph`（`app.ts:2331`）→ `{nodes,edges}`；link `{fromTypeKey,toTypeKey,linkKey,cardinality}` |
| 事件订阅（前端） | `useDomainEventStream` 轮询双 outbox（20s）→ `invalidateForEvent`；`EVENT_INVALIDATES`+`LABEL_TO_KEYS`（`store/eventInvalidation.ts`） |
| GapCard | 已含 `GAP_DISPOSITION` 配置映射 + 三闸（CLARIFY/PREVIEW/HARD_BLOCK）+ 徽章 `badge amber/green`（`components/Answer/GapCard.tsx`） |

---

## §3 架构决策：跨系统能力聚合在 AgentCore

两系统松耦合：**DataCore 从不反向调用 AgentCore**；只有 AgentCore 经 OBO 调 DataCore。7 类 cross_system 注册表只存在于 AgentCore。因此：

- ❌ 「DataCore 返回全 13 类 registry snapshot」架构不成立（它看不见 B 栈，只返回 6 类）。
- ✅ **query 目标缺口聚合在 AgentCore**（两侧都够得着：A 栈经 OBO、B 栈查自己 repos）。

**一个 diff 纯核，两处调用**：把 diff 抽成纯函数 `diffGap(required, existing, meta)` 放 `@platform/contracts`（R1/R6），两服务共用：
- DataCore `analyzeGap` 内部改为「收集 existing → 调 `diffGap`」，对外签名与行为不变（唯一调用点 `service.ts:406` 零改）。
- AgentCore `preAnalyzeQuery` 自组装两侧 existing → 调同一 `diffGap`。
- DataCore 只暴露它真拥有的：`GET /a/v1/databuilder/registry-snapshot`（**仅 6 类 A 栈**·复用 `provisioner.existing()`·约 0.5 天）。

---

## §4 统一契约（全部新增字段 optional）

`packages/contracts/src/databuilder.ts` 扩展 `GapAnalysis`（现有 `GapAnalysisSchema` 无 `z.strict()`，消费方仅读 `entries/totals` → 追加 optional 字段零破坏）：

```typescript
export const GapTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("script"), script: z.string(), seed: z.number().int().optional() }),
  z.object({ kind: z.literal("query"), query: z.string(),
    context: z.object({ base: z.string().optional(), segment: z.string().optional() }).optional() }),
]);
export const GapSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "BLOCKER"]);
export const GapRemediationSchema = z.object({
  strategy: z.enum(["AUTO", "AUTO_WITH_APPROVAL", "MANUAL", "DEVELOP"]),
  estimatedEffort: z.enum(["SECONDS", "MINUTES", "HOURS", "DAYS"]), canBeParallel: z.boolean(),
});
export const GapExplanationSchema = z.object({ why: z.string(), evidence: z.string(), alternative: z.string().optional() });
export const GapItemSchema = z.object({
  key: z.string(), status: GapStatusSchema,           // 现有 EXISTS/TO_CREATE/MISSING
  severity: GapSeveritySchema.optional(), explanation: GapExplanationSchema.optional(), remediation: GapRemediationSchema.optional(),
});
export const ExecutionStepSchema = z.object({ step: z.number().int(), side: z.enum(["content","structure","code","cross_system"]), keys: z.array(z.string()), rationale: z.string() });
export const GapAnalysisSchema = z.object({
  entries: z.array(GapAnalysisEntrySchema),
  totals: z.object({ needed: z.number().int(), existing: z.number().int(), toCreate: z.number().int(), missing: z.number().int(),
    coverageScore: z.number().min(0).max(1).optional() }),   // 咨询信号·非门禁（§10）
  target: GapTargetSchema.optional(),                        // optional：现有调用不传
  executionPlan: z.array(ExecutionStepSchema).optional(), generatedAt: z.string(),
});
```

`packages/contracts/src/growth.ts` 新增：
```typescript
export const CapabilitySnapshotSchema = z.object({ byKind: z.record(z.string(), z.array(z.string())), takenAt: z.string() });
export const PreAnalysisReportSchema = z.object({
  taskId: z.string(), tenantId: z.string(), query: z.string(),   // R2
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  gapAnalysis: GapAnalysisSchema.optional(),
  summary: z.object({ totalGaps: z.number().int(), autoFixable: z.number().int(), manualRequired: z.number().int(),
    developRequired: z.number().int(), coverageScore: z.number().min(0).max(1), executionSteps: z.number().int() }).optional(),
  error: z.string().optional(), createdAt: z.string(),
});
```

---

## §5 diff 纯核（`@platform/contracts` · R1/R6）

纯函数：无 IO/时钟/随机，`generatedAt` 由调用方注入。
```typescript
export function diffGap(required, existing, meta): GapAnalysis {
  const entries = [];
  for (const kind of MODULE_KINDS) {
    const need = uniq(required[kind] ?? []); if (!need.length) continue;
    const have = existing[kind] ?? new Set();
    const items = need.map((key) => ({ key, status: have.has(key) ? "EXISTS" : meta.autoCreatable[kind] ? "TO_CREATE" : "MISSING" }));
    entries.push({ kind, side: meta.side[kind], ...counts(items), items });
  }
  const a = { entries, totals: computeTotals(entries), target: meta.target, generatedAt: meta.generatedAt };
  a.executionPlan = buildExecutionPlan(entries);        // side 四层拓扑序（content→structure→code→cross_system）
  a.totals.coverageScore = computeCoverageScore(entries); return a;
}
```
DataCore `analyzeGap` 改为「求 6 类 A 栈 existing + 7 类 scaffoldReceipt 判定 → 组 existing map → 调 diffGap」，行为等价（`provisioners.test` 保持绿，另加改造前后 byte 一致等价性测试）。执行计划对 query 目标诚实：某层无缺口即跳过，不虚构空步。

---

## §6 AgentCore 集成（复用既有能力）

**需求树推导（复用分类器，不造轮子）**：
```typescript
const c: ClassificationResult = await classify(query, ctx);   // {candidates,outOfCatalog,extractedSlots}
const intents = c.candidates.map(x => x.intentKey);
const { plans, solvers, objectTypes } = await resolveBindingsFor(intents, repos);  // 意图→计划→求解器既有绑定（非关键词猜测）
```

**组装快照 + 调 diff（聚合在 AgentCore）**：A 栈调 `GET /a/v1/databuilder/registry-snapshot`（6 类）；B 栈查自己 repos（intents/workflows/skills/agents/scenes/mcps/plans）；合并 → `diffGap` → `enrichForQuery`（叠 severity/explanation/remediation）。AgentCore 侧 snapshot 内存缓存 TTL 60s，收 `{kind}.updated` 事件即失效（复用 event-subscriptions，请求级失效非新总线）。

**后台异步、不阻塞 SSE（emitDomainEvent 3 参）**：
```typescript
void preAnalyzeQuery(deps, a.tenantId, taskId, body.question, ctx)
  .then(async (r) => { await deps.repos.preAnalyses.upsert(r);
    await emitDomainEvent(a.tenantId, "growth.pre_analysis_done", { taskId, totalGaps: r.summary?.totalGaps ?? 0 }); })
  .catch(async (err) => {                                             // 铁律 0.4 不静默
    await deps.repos.preAnalyses.upsert({ taskId, tenantId: a.tenantId, query: body.question, status: "FAILED", error: String(err?.message ?? err), createdAt: nowIso() });
    await emitDomainEvent(a.tenantId, "growth.pre_analysis_failed", { taskId, error: String(err?.message ?? err) });
    deps.logger.error({ taskId, err }, "preAnalyzeQuery failed"); });
```

**补齐收口既有 worklist**（不造 `createUnifiedWorkOrder`）：MANUAL/DEVELOP 缺口 → `growthWorklist.upsert(WorklistItem{..., deeplink: /admin/tickets?taskId=})`。

**新端点**：`GET /a/v1/databuilder/registry-snapshot`（6 类·DataCore） · `GET /b/v1/growth/pre-analysis/:taskId`（R2 租户校验·AgentCore）。均走 R7 错误信封 + R3 entitlement（`defaultOn:false`·RL2 暗发）。

---

## §7 前端「融合式」（R-QUANT + R-PRD + R14 + CSS 门 `check-css-vars`）

> **融合＝在既有组件加一条只读全景条，复用既有样式/徽章/事件通道/i18n，零新页、零新色、零改造现有交互。**

### 7.1 数据接线（复用既有事件环，3 处 additive）
`store/eventInvalidation.ts`：`EVENT_INVALIDATES` +`"growth.pre_analysis_done":["growth-preanalysis"]`、`"growth.pre_analysis_failed":["growth-preanalysis"]`；`LABEL_TO_KEYS` +`"growth-preanalysis":[["b","growth","pre-analysis"]]`。交付延迟 ≤ `DEFAULT_POLL_MS`=20s（`useDomainEventStream.ts:24`，诚实：20s 轮询非推送，符 D-29 ≤60s）。GapCard 挂载先主动 `useQuery(["b","growth","pre-analysis",report.taskId])` 拉一次。

### 7.2 GapCard 全景条 · 逐元素（R-PRD）
插入点：`GapCard.tsx` 的 `<div className={styles.gapCard}>` 内最顶部；渲染条件 `pre.data?.status==="DONE" && totalGaps>0`。新容器 `.gapPanorama`（加进 `AnswerBlocks.module.css`，复用 token）：`background var(--panel2)#212B3D · border 1px var(--line2)#2C3648 · radius 8px · padding 8px 10px · font-size 12px`。内部（左→右）：
| 元素 | 尺寸/值（R-QUANT） | 数据源 |
|---|---|---|
| 覆盖率环 `<CoverageRing>` | 直径 28px·环宽 4px·中心数字 10px·`var(--font-mono)` | `summary.coverageScore` |
| 摘要文本 | 12px·`var(--muted)`#AEB8C9·单行省略 | `zh.dock.panoramaSummary(total,auto)` |
| Severity 徽章组 | 复用 `.badge`（radius 999px·padding 4px 10px·12px·mono） | 按 severity 计数 |
| 「查看工单」 | `.btn.sm` | `zh.dock.panoramaTickets` → `/admin/tickets?taskId=` |

覆盖率环三档（**仅用既有 token·零新色**）：`>0.8`→`var(--ok)`#62be77 · `0.5~0.8`→`var(--warn)`#e8b54a · `<0.5`→`var(--danger)`#e0626c；底槽 `var(--line2)`#2C3648。
Severity→既有徽章：BLOCKER/ERROR→`badge red`(#e0626c，BLOCKER 文案前缀「⛔ 阻断」区分) · WARNING→`badge amber`(#e8b54a) · INFO→`badge blue`(#5B7CFA)。计数 0 的档不渲染。
**诚实（R13/铁律0.4）**：全景条是咨询信号，文案用「系统诊断」非「不可执行」；即便 `score<0.5` 也不渲染阻断态——权威判决仍由下方既有 GapCard 主体（`classifyGap` 真跑）呈现。四状态：RUNNING 灰条「诊断中…」不阻塞 · DONE 无缺口 `badge green`「诊断通过」 · FAILED「暂时不可用+重试(refetch)」QOS 继续 · 无 taskId/404 不渲染。

新组件 `components/Answer/CoverageRing.tsx`（纯展示·SVG viewBox 0 0 28 28·stroke 引 CSS 变量过 css-vars 门）。新 i18n 键入 `locales/zh.ts` 的 `dock` 段（`panoramaSummary/panoramaTickets/panoramaRunning/panoramaClear/panoramaFailed/panoramaRetry/sevBlocker/sevError/sevWarning/sevInfo`）。

### 7.3 TicketCenterPage 融合（不改现有列表逻辑）
仅当 `?taskId=` 时顶部出全景卡（`CoverageRing` 直径 40px·环宽 5px + ExecutionPlan 步骤 chip：当前步 `badge blue`/已完成 `badge green`/未开始默认灰）。工单行 additive：行首 severity 徽章 + 「本查询 N 项·第 X 项」小字（`var(--muted2)`#8A94A6·11px，前端按 `fromQuestion` 分组计数，无新端点）+ 点击展开 `explanation{why,evidence,alternative}`。

### 7.4 改动文件（融合·均 additive）
`eventInvalidation.ts`(3行)·`api/endpoints.ts`(+fetchPreAnalysis)·`CoverageRing.tsx`(新~30行)·`GapCard.tsx`(顶部+全景条~40行,主体不动)·`AnswerBlocks.module.css`(+.gapPanorama~14行)·`locales/zh.ts`(~10键)·`TicketCenterPage.tsx`(~60行)。回退：删全景条分支即复原（entitlement 关时后端不返 pre-analysis，前端自然不渲染·RL2/RL9）。

---

## §8 隐藏需求发现「不造假 key」（基于真实本体图 + 求解器依赖闭包）

> **不手写规则**（弃「Order→BOM 硬编码 + `capacity_loss` 幽灵 key」）；改为**读系统已有的 `SOLVER_DATADEP` + 沿租户真实本体图闭包**。每个 key 过三张真实白名单，by-construction 零造假。

**复用真实底座**：`SOLVER_DATADEP`（`datadep.ts:86`·冻结·solver→抽象 roleType+viaLinks+minRows） · 角色→真类型解析 `ROLE_CANONICAL`/`SolverBinding`/`resolveSolverType`（`service.ts:1620/1636`） · 本体图 `GET /a/v1/ontology/graph`（nodes=真实类型·edges={from,to,linkKey,cardinality}） · 就绪探测 `checkReadiness`（`service.ts:1695`·真实计数·无 LLM）。

**算法（纯函数·R6·R14）**：
```typescript
export function expandHiddenRequirements(explicit, graph, datadep, bindings) {
  const typeKeys = new Set(graph.nodes.map(n => n.key));    // 白名单①（存在的对象类型）
  const linkKeys = new Set(graph.edges.map(e => e.label));  // 白名单②（存在的链路）
  const solverKeys = new Set(Object.keys(datadep));         // 白名单③（存在的求解器）
  const outTypes = new Set(explicit.objectTypes.filter(t => typeKeys.has(t)));
  const outSolvers = new Set(explicit.solvers.filter(s => solverKeys.has(s)));
  const outLinks = new Set(); const trace = [];
  // ① 求解器依赖闭包：显式 solver → SOLVER_DATADEP 声明的角色 → 解析成租户真实类型
  for (const s of outSolvers) for (const it of datadep[s].requires) {
    const rt = bindings.resolve(it.roleType);
    if (rt && typeKeys.has(rt)) { if (!outTypes.has(rt)) trace.push({added:rt, via:`solver:${s} role ${it.roleType}`}); outTypes.add(rt); }
    for (const lk of it.viaLinks ?? []) if (linkKeys.has(lk)) outLinks.add(lk);
  }
  // ② 本体图一跳（深度可配=1）：类型沿真实边走一跳
  for (const t of [...outTypes]) for (const e of graph.edges)
    if (e.from===`n-${t}` && typeKeys.has(strip(e.to))) { const nb=strip(e.to);
      if (!outTypes.has(nb)) { trace.push({added:nb, via:`link:${e.label}`}); outTypes.add(nb); outLinks.add(e.label); } }
  // ③ 反查：覆盖 ≥60% 依赖已在需求集的真实 solver 才建议（防过度扩展）
  for (const s of solverKeys) { const roles = datadep[s].requires.map(x=>bindings.resolve(x.roleType)).filter(Boolean);
    if (roles.length && roles.filter(rt=>outTypes.has(rt)).length/roles.length>=0.6 && !outSolvers.has(s)) { trace.push({added:s, via:`covers types`}); outSolvers.add(s); } }
  return { requiredObjectTypes:[...outTypes], requiredSolvers:[...outSolvers], requiredLinks:[...outLinks], trace };
}
```
**保证**：存在性 by construction（三白名单，`filter(has)` 外的 key 进不来→不可能产 `capacity_loss`/`production_line` 幽灵）·确定性 R6·零业务常数 R14（只认抽象 roleType+图结构，业务名经 `bindings.resolve`/租户图，换行业 0 码改挂 R-PACK）·可解释 R13（`trace` 喂 `GapExplanation.evidence`）。

**闭合就绪校验**：扩展结果喂 `diffGap` 后，solver 类进一步走既有 `checkReadiness(tenantId,"solver:<key>",SOLVER_DATADEP[key])`——缺口只会是「真实数据不足」（`actualRows<minRows`，指名缺哪个真实角色），最高 `WARNING`（对齐 §10，不误红）。

**防回潮门**：`scripts/check-hidden-req-keys.mjs`（落地时并入 `pnpm gates` + 登记母体 §7）：静态断言输出只从三注册表取 key、源码无硬编码 key 数组、green→red 自证。分阶段：B-Phase1 只做 ①（最稳）；B-Phase2 加 ②③（深度可配）。entitlement `hidden_req` `defaultOn:false`（关时只诊断显式需求·与不做一致·RL9 可回退）。

---

## §9 数据存储与 R9

新增 `pre_analyses` 存储，R9 四处同改：`agentcore/migrations/013_pre_analyses.sql`（带 down·`{task_id PK, tenant_id, doc jsonb, created_at}`·`tenant_id` 索引 R2）+ `persistence/pg.ts`（`preAnalyses{upsert,getByTaskId}`）+ `persistence/memory.ts`（同接口）+ `persistence/repos.ts`（接口声明）。属「随查询增长」表 → 登记 `RETENTION_DEFAULTS`+`sweepTable` 分支（否则 `retention-coverage:check` 红）。

---

## §10 覆盖率与严重度：咨询信号，不制造假 BLOCKER

- **权威判决只来自 `classifyGap`**（真跑 QOS 终态）。预分析（启发式）**永不**把查询标「不可执行」硬红。
- query 目标下 solver/意图缺失 → 最高 `WARNING`；只有 Path A 工作流**真的**以 `SOLVER_NOT_FOUND` 失败（classifyGap 已识别）才是权威 BLOCKER。
- `coverageScore` 加权求和 `weights{content:.2,structure:.3,code:.4,cross_system:.1}`·定位咨询信号·显示进度环·**不作门禁**·权重经验值待 Phase 3 用真实成功率相关性校准（诚实标注）。

---

## §11 后端接口汇总
```
GET  /a/v1/databuilder/registry-snapshot   → { [6类A栈kind]: string[] }        （DataCore·有界·SERVICE_TOKEN/OBO）
GET  /b/v1/growth/pre-analysis/:taskId       → PreAnalysisReport                  （AgentCore·R2）
（内部）diffGap / expandHiddenRequirements / preAnalyzeQuery / registry snapshot 组装
```

---

## §12 治理合规与门禁（回写母体是硬约束）

改动过 CI `pnpm gates`（`.github/workflows/gates.yml`·~45 检查 + 四包 build/test）。相关硬门：
| 门 | 要求 |
|---|---|
| `prd:check` | 本 PRD 已含 §0《本体引用与影响》，R/G 均真实（本文件已验证无悬空） |
| `ontology-writeback:check` | 若新增 `check-hidden-req-keys.mjs` 并入 gates → 登记母体 §7 |
| `ontology-slices:check` | 改母体 §2/§3/§4/§7 后跑 `pnpm ontology:slices` 重生成切片 |
| `no-fake-done:check` | §8 扩展 key 存在性校验对齐 |
| `retention-coverage:check` | §9 新表登记留存策略 |
| 四包 test | 复用为主、只增 optional 字段 → 现有 datacore 69/agentcore 66/frontend 25+ 保持绿；新增见 §16 |

**母体回写清单（本 PRD 已同步写入 `docs/SYSTEM-ONTOLOGY.md`）**：
- §2.H 新增对象类型 `PreAnalysisReport`、`CapabilitySnapshot`。
- §3 新增关系「隐藏需求依赖闭包」+「预分析旁路」。
- §4 新增事件 `growth.pre_analysis_started/done/failed`（L13 环）。
- §7 预告门 `hidden-req-keys:check`（落地时正式登记）。
- 回写后跑 `pnpm ontology:slices` 同步 `docs/ontology/*`。

---

## §13 实施计划（务实约 12 周·4 Phase）

- **Phase 0 · 契约冻结（1.5 周）**：冻结 §4 契约（全 optional）+ §5 `diffGap` 纯核签名 + contracts 单测；跑 `prd:check` 绿。
- **Phase 1 · diff 核 + DataCore 无损改造 + 有界 snapshot（3 周）**：`diffGap` 落 contracts；`analyzeGap` 改调（行为等价）；`GET /a/v1/databuilder/registry-snapshot`（6 类）；前端 GapCard/TicketCenter 展示 severity/explanation（读现有 GapReport 先上）。
- **Phase 2 · AgentCore 预分析闭环（4 周）**：`deriveRequirements`（复用分类器）+ `preAnalyzeQuery` + `pre_analyses` R9 四处 + migration 013；`buildGrowthLoopWiring` 起后台预分析（3 参 emit）+ 失败诚实；3 事件登记 event-subscriptions；`GET /b/v1/growth/pre-analysis/:taskId`；收口 worklist；前端全景条（§7）+ 事件接线。
- **Phase 3 · 统一验证 + 隐藏需求 + 校准（2.5 周）**：补齐后走 `verifyBuild`/`ClosureReport`；§8 隐藏需求（B-Phase1 依赖闭包→B-Phase2 图一跳）+ `hidden-req-keys:check`；收集 coverageScore 与真实成功率相关性校准权重。

---

## §14 风险与回滚
| 风险 | 缓解 |
|---|---|
| diff 核抽取改 `analyzeGap` 内部 | 仅 1 调用点；改造前后 byte 一致等价性测试 + `provisioners.test` |
| 预分析准确度不足 | 咨询信号（§10）永不误红；用户可覆盖回 reactive loop |
| 分类器漏 solver | §10 降级 WARNING，不 BLOCKER |
| 新事件未被前端反映 | event-subscriptions 登记 + D-29 ≤60s SLO |
| 契约扩展破坏旧序列化 | 全 optional，zod 忽略缺省 |
| 隐藏需求造假 key | §8 三白名单 by-construction + `hidden-req-keys:check` |

**回滚**：预分析/隐藏需求 entitlement `defaultOn:false`（关=404·RL2）；migration 带 down（RL9）；`classifyGap`/reactive loop 原逻辑未改仅新增旁路；契约扩展全 optional。

---

## §15 验收（真实测试·铁律 0.4·前端逐值对照后端）
> 不做 jsdom-only 冒烟；真起前后端、浏览器逐值对照。
- V1 全景条 ≤20s 出现，环 stroke===token 色、徽章数===`GET /b/v1/growth/pre-analysis/:taskId` severity 计数。
- V2 覆盖率环三档 `getComputedStyle` 逐值===`#e0626c/#e8b54a/#62be77`。
- V3 score<0.5 时下方既有触发/三闸仍可用（不阻断 reactive）。
- V4 FAILED 显「暂时不可用+重试」，QOS 答案照常。
- V5 RUNNING→DONE ≤20s 自动刷新（证 useDomainEventStream 接线）。
- V6 深链落 `/admin/tickets?taskId=`，全景卡 taskId 一致。
- V7 无缺口/无 taskId：GapCard 主体行为 100% 同改造前（回归）。
- V8 §8 隐藏需求：喂含 order 的显式需求 + 真实电池本体图 → 断言扩展每个 key ∈ 真实注册表（`test/hidden-req.test.ts`）。

---

## 附录 A · 关键文件索引（均已核对存在）
`contracts/src/databuilder.ts:418`（扩 GapAnalysis+diffGap 纯核）·`contracts/src/growth.ts`（PreAnalysisReport/CapabilitySnapshot·复用 WorklistItem/GapReport）·`contracts/src/qos.ts:224`（复用 ClassificationResult）·`contracts/src/datadep.ts:86`（复用 SOLVER_DATADEP）·`datacore/src/databuilder/provisioners.ts:106`（analyzeGap 改调 diffGap）·`datacore/src/databuilder/service.ts:406`（唯一调用点·零改）·`datacore/src/app.ts:2331`（ontology/graph）·`agentcore/src/growth/pre-analyze.ts`（新增）·`agentcore/src/growth/scenario-grow.ts`（起后台预分析+收口）·`agentcore/src/server.ts:198`（复用 emitDomainEvent）·`agentcore/src/event-subscriptions.ts`（登记 3 事件）·`agentcore/src/persistence/{repos,memory,pg}.ts`+`migrations/013_*.sql`（pre_analyses R9）·`agentcore/src/growth/probe.ts:126`（不改·classifyGap 权威判决）·`frontend-shell/src/components/Answer/GapCard.tsx`+`CoverageRing.tsx`·`frontend-shell/src/pages/admin/TicketCenterPage.tsx`·`frontend-shell/src/store/eventInvalidation.ts`·`docs/SYSTEM-ONTOLOGY.md` §2/§3/§4/§7（回写）。

## 附录 B · 关键修正对照（相对最初 v3 草案）
DataCore 全 13 类 snapshot→AgentCore 聚合+6 类有界（cross_system 无 existing）· 杜撰 `savePreAnalysis`→新 `pre_analyses`R9 四处 · 杜撰 `createUnifiedWorkOrder`→复用 worklist · `emitDomainEvent` 2 参→3 参 · `target` 必填→optional · 六维空壳 IntentAnalyzer→复用 ClassificationResult · 幽灵 key 隐藏规则→SOLVER_DATADEP+本体图闭包三白名单 · solver 缺失误红→咨询信号最高 WARNING · 幽灵「RG Engine」引用→删/改真实 R·G · 缺《本体引用与影响》→补 §0 + 回写母体 · 8 周→12 周 4 Phase。
