# PRD · 低能力开发代理实施手册（Implementation Handbook）

| 项 | 值 |
|---|---|
| 版本 | v1.0（交接配套：本手册 + 17 份 PRD + platform/ 参考骨架 = 完整交接包） |
| 目标读者 | 负责实施的开发 Agent（按本手册执行，**禁止自行设计与猜测**） |
| 控制结构 | ① 工单流水（§3，按序执行不需全局理解）② 样板代码（§2，照抄结构）③ 默认裁决表（§4，PRD 未写明先查表）④ 升级通道（表里也没有 → **停下输出问题清单等人裁决**，禁止发明） |

## 0. 开发代理必须遵守的五条铁律

1. 实现顺序 = §3 工单顺序，禁止跳单、并单（标注 ∥ 的除外）；
2. 每个工单"完成"的唯一定义 = 其验收用例通过（test-first：先抄用例为测试，再实现到绿）；
3. 任何 PRD 与《需求追踪矩阵与文档基线》冲突 → 以基线 Part B 裁决为准；
4. 遇到 PRD 未定义的实现选择 → 先查 §4 默认裁决表 → 仍无 → **停止该工单**，把问题追加到 `docs/OPEN_QUESTIONS.md`（格式：工单号/问题/候选方案 A/B），换下一个无依赖工单继续；
5. 对外契约（字段名/路由/事件名/错误码）逐字符照抄 PRD，**禁止"优化"命名**。

## 1. 工程基线（固定，不可变更）

- **仓库结构**：在 `platform/` 骨架上扩展，不另起仓库。新增模块目录：`apps/datacore/src/{auth,workspace,connectors,ruledocs,modeling,ontology,rules,actions,scheduler,forge,history}/`、`apps/agentcore/src/{catalog,agents,workflows,skills,mcp,scenes,qos,solvers,llm}/`；每模块固定四件套 `routes.ts / service.ts / repo.ts / types.ts`（types 只 re-export contracts，禁止重复定义）。
- **依赖白名单**（版本锁定写入根 package.json，新增依赖须走 OPEN_QUESTIONS）：fastify@4 / @fastify/cors / @fastify/static / @anthropic-ai/sdk / zod@3 / pg@8 / pino@9 / cron-parser@4 / @modelcontextprotocol/sdk / pdf-parse / mammoth / vitest / tsx / typescript@5。
- **ID**：`{前缀}_{ULID}`，前缀按各 PRD；ULID 实现抄骨架 `randomUUID().slice` 改为 ulid 包？→ 否：统一用 `crypto.randomUUID()` 去横线取 26 位即可（裁决 D-01）。
- **时间**：一律 ISO 8601 UTC 字符串存取；展示时区是前端职责。
- **错误响应壳**（所有 4xx/5xx）：`{ error: { code, message, requestId } }`；**错误码全集**（新增须走 OPEN_QUESTIONS）：`VALIDATION_ERROR / UNAUTHORIZED / FORBIDDEN / FEATURE_NOT_FOUND / NOT_FOUND / INVALID_STATE / IMMUTABLE_VERSION / PLAN_VALIDATION_ERROR / CYCLIC_DERIVATION / CYCLIC_INVOCATION / NESTING_DEPTH_EXCEEDED / TEMPLATE_RESOLUTION_ERROR / AGENT_SCOPE_VIOLATION / BUDGET_EXCEEDED / PLAN_LOCKED / LAST_ADMIN / NO_ELIGIBLE_APPROVER / ROLE_CANNOT_EXCEED_TENANT / BREAKING_CHANGE_WITH_LATEST_REFS / SOLVER_TIMEOUT / SOLVER_NOT_FOUND / DATACORE_UNAVAILABLE / RATE_LIMITED / INTERRUPTED_BY_RESTART / IRR_DIVERGED / INTERNAL`。
- **日志**：pino，每条必含 `{ requestId, tenantId, userId?, taskId? }`；禁止 console.log。
- **校验**：所有路由入参出参 zod（schema 放 contracts 包，按 PRD interface 逐字段翻译，问号=optional，枚举=z.enum）。
- **DB**：PostgreSQL 15，DDL 以 本体核心增量 §1 + 各 PRD §持久化 为准；迁移用 node-pg-migrate，每工单一个迁移文件，禁止改已合并迁移。

## 2. 三层样板（照抄此结构，以"规则库手工 CRUD"为完整范例）

```ts
// rules/routes.ts —— 只做：鉴权→zod 校验→调 service→映射错误码
app.post("/a/v1/rules", async (req, reply) => {
  const ctx = auth(req, reply); if (!ctx) return;
  if (!ctx.roles.includes("catalog_admin")) return err(reply, 403, "FORBIDDEN", "需要 catalog_admin");
  const body = RuleCreateSchema.safeParse(req.body);
  if (!body.success) return err(reply, 400, "VALIDATION_ERROR", zMsg(body.error));
  try { return await ruleService.create(ctx, body.data); }
  catch (e) { return mapErr(reply, e); }            // mapErr：按 e.code 查 §1 错误码表
});
// rules/service.ts —— 业务规则与状态机；抛 {code,message} 异常，不碰 HTTP
// rules/repo.ts    —— 纯 SQL（参数化），不含业务判断；所有查询带 tenant_id
```

通用辅助（`shared/http.ts`）：`auth/err/mapErr/zMsg/paginate(默认 page=1,size=50,max=200)`——一次实现处处复用，禁止每模块重写。

## 3. 实施工单（WBS，按序执行；∥=可与前一单并行）

| 单号 | 内容 | 依据文档 | 完成判据 |
|---|---|---|---|
| W01 | DB 接入 + 迁移框架 + shared/http | §1 | 迁移可升降 |
| W02 | A0：Bootstrap/租户/用户/角色 CRUD | 管理平台增量 §1–2 | M1–M3 |
| W03 | 本体元模型 DDL + 对象/关系 CRUD + epoch | 本体核心 §1 | O1/O6/O7 |
| W04 | 派生公式 DSL（解析/依赖/拓扑/重算） | 本体核心 §2 | O2–O5 |
| W05 | resolveSlice 执行器 | 本体核心 §3 | O8–O10 |
| W06 | 规则库（DSL 解释器+SUSTAIN+CRUD+dry-run） | 平台 §4.2、A8 §5、管理平台 §5 | M7、T4 |
| W07 ∥ | 权限策略表 + authz explain + 行级注入 | 平台 §6.2 | AU1–AU2 |
| W08 | 连接器框架 + file_upload/rest/mock 适配器 + RawDataset | 平台 §2 | CN1–CN2 |
| W09 | A8 时序通道 + 聚合规约 + 调度器(S3 全 kind) | A8 §1–2、求解器 §S3 | T1–T3、V10 |
| W10 | A3 建模（画像/LLM建议/Draft PATCH/发布/对象化） | 平台 §5 | OM1–OM3 |
| W11 ∥ | A2 规则文档解析管线 | 平台 §3 | RD1–RD2 |
| W12 | Action 审批流（状态机/审批链/outbox） | 求解器 §S2 | V9 |
| W13 | LLM Provider 注册 + 适配器层 + 用途矩阵 | LLM增量 Part1 | L1–L4 |
| W14 | 求解器全集真实现（含 capex_scenario） | 求解器 §S1、基线 Part C | V1–V8、C1 验收 |
| W15 | QOS 完整版（澄清交互/引用解析/feature 过滤） | QOS-PRD 全文 + 裁决 1/2 | QOS §12 全表 |
| W16 | Agent 运行时强化（上下文三刀/并行/多轮摘要） | Agent 运行时 §1/§5 | R1–R4 |
| W17 | Workflow 引擎完整版（invoke_agent/嵌套防护） | 平台 §8.2、Agent 运行时 §2 | WF1–WF2、R5 |
| W18 ∥ | Skill + MCP 运行时（命名空间/stdio 红线） | 平台 §8.3–8.4、Agent 运行时 §3–4 | SK1/MC1、R6–R9 |
| W19 | AgentCore 资源 CRUD 全集 + 场景入口 | 管理平台 §4 | M4–M5 |
| W20 | 功能开通（注册表/解析/中台页/联动） | 功能开通增量 | E1–E7 |
| W21 | M11 校准引擎 | M11 增量 | C1–C9 |
| W22 | A9 数据工坊（DEMO 剖面优先） | A9 §9→§1–3 | D1–D5、F1–F2 |
| W23 | 回放编排器 + OpsSchedule | 回放增量 | R1–R13 |
| W24 | 知识库连接器 + search_knowledge | 求解器 §S4 | V11–V12 |
| W25–W30 | 前端：Shell/Dock → 业务视图 → 四推演视图 → 剩余视图 → 管理台 → Mock 模式 | 前端 PRD + 两增量 | F1–F29 |
| W31 | 运营态出厂（lived-in 回放联调） | 运营态增量 | Y1–Y10 |
| W32 | 端到端回归 + 双系统部署演练 | 平台 §1.3 | P1 + smoke 全绿 |

## 4. 默认裁决表（PRD 未写明时按此执行，禁止另行发明）

| # | 事项 | 裁决 |
|---|---|---|
| D-01 | ID 生成 | `crypto.randomUUID()` 去横线截 26 位，加前缀 |
| D-02 | 分页 | page/size 查询参数，size 默认 50 上限 200，响应 `{items,total,page,size}` |
| D-03 | 列表排序 | 默认 `updated_at DESC`，无 updated_at 用 created_at |
| D-04 | 字符串长度上限 | 名称类 256；描述类 2000；未注明的 TEXT 入参 10000 |
| D-05 | HTTP 超时 | B→A 调用 10s；LLM 调用 120s；其余外呼 20s |
| D-06 | 重试 | 仅幂等 GET 自动重试 2 次（指数退避）；写操作不自动重试 |
| D-07 | 并发控制 | 乐观锁：版本化资源 PUT 带 `expectedVersion`，冲突 409 INVALID_STATE |
| D-08 | 软删除 | 不做软删除；版本化资源用 RETIRED 态，非版本化直接 DELETE |
| D-09 | 枚举存储 | DB 存 TEXT，校验在 zod 层 |
| D-10 | JSONB 大小 | 单字段 >256KB 拒绝（VALIDATION_ERROR） |
| D-11 | 密文 | AES-256-GCM，密钥 env `CRYPTO_KEY`（32B base64），iv 随机前置存储 |
| D-12 | 文件上传 | ≤100MB，mime 白名单（csv/xlsx/json/pdf/docx/md/txt） |
| D-13 | SSE 心跳 | 15s 注释帧；连接上限每用户 5 条 |
| D-14 | 任务保留 | query_tasks/events 保留 90 天（清理 job，调度器 kind=RETENTION） |
| D-15 | 前端构建 | 保持骨架免构建形态直至 W25；W25 起 Vite+React 按前端 PRD §2 |
| D-16 | 测试组织 | 每模块 `__tests__/`，验收用例编号写入测试名（`test("M1 ...")`)，CI 跑 vitest |
| D-17 | LLM 测试 | 一律注入 Mock LlmClient（录制 fixtures），真连仅 smoke 脚本 |
| D-18 | i18n | 全部中文硬编码于 `locales/zh.ts`，不做翻译 |
| D-19 | 数值 | 金额/产能用 decimal 字符串过线，计算用定点 4 位（本体核心 §2.4） |
| D-20 | 未列事项 | → OPEN_QUESTIONS.md，停该工单换下一单 |

## 5. 交给开发代理的启动提示词（用户可直接粘贴）

> 你是实施工程师，不是设计师。工作物料：`docs/` 下 18 份 PRD（先读 `PRD-traceability-and-baseline.md`，其 Part B 是冲突裁决权威）+ `platform/` 参考骨架 + 本手册。
> 执行规则：严格按本手册 §3 工单顺序实施；每单先把"完成判据"列的验收用例抄成失败测试，再实现到绿，提交信息格式 `W{单号}: {内容} ({用例编号} 通过)`；对外契约逐字符照抄 PRD；任何 PRD 未写明的实现选择先查手册 §4，查不到就写入 `docs/OPEN_QUESTIONS.md` 并跳到下一个无依赖工单——**禁止自行设计、禁止猜测、禁止"顺手优化"**。每完成 5 个工单输出一次进度表（工单/用例通过数/OPEN_QUESTIONS 数）。
