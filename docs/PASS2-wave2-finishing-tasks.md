# PASS2-WAVE2 · 收尾任务清单（第二波 6 块真跑定级结果）

> **这是什么**：`COMPLETION-LEDGER §3` 后 6 块的真跑摸底结果。**5 块 60-92% 已建（收尾）+ 驾驶舱数据层 25-30%（唯一真半成品，含高回归专项）**。同 wave1 纪律：已建只接不重写；先 FDE 真跑定基线；完成=亲手跑+证据非测试绿；只 push `claude/vigilant-knuth-b1nmxn`、push 前 rebase。
>
> **建设度**：本体治理 92% · 管理平台 88% · 运营态 livedIn **87%(真缺口 0)** · LLM多厂商 75% · 能力路由 60% · 驾驶舱数据层 **25-30%**。

---

## 0. 运营态 livedIn — ✅ 视为完工（无任务）
摸底真缺口 **0**：引擎/历史 bundle API/时序生成/前端运营回顾/水印全在，Y1–Y9 验收全过，仅剩 Y10 人工盲测（场景外，非开发任务）。**别动，已能用。**（`livedin/engine.ts`/`bundle.ts`/`tsgen.ts`/`ReviewView.tsx`）

---

## 1. 收尾任务（5 块 · P0/P1 · 钩子/对称/补页）

| # | 块 | 任务 | 锚点（现状） | 优先级 | 完成判据 |
|---|---|---|---|---|---|
| CR-1 | 能力路由 | **load_tools 工具注册** | `tools/registry.ts` 未注册；`executor.ts:221` 注释"未启用" | **P0** | agent 可 load_tools(names≤6) 动态追加 MCP 工具 schema |
| CR-2 | 能力路由 | **>24 按需加载阈值激活 + discover(mcp_tools) 占位摘要** | `executor.ts:220-222` 返回空目录（桩） | **P0** | 工具总数>24→占位摘要"mcp__erp__* 共 N 个"；≤24 全量 |
| CR-3 | 能力路由 | AgentRunRecord.loadedTools 审计字段 | `qos.ts:581` schema 无该字段 | P1 | 评测套件可断言"发现→加载链" |
| LP-1 | LLM多厂商 | **Workflow/Skill publish impact API**（与规则侧对称） | 规则侧完整 `rules.ts:154`；B 侧 `server.ts` 仅抛 BREAKING 无 impact 响应 | **P0** | 发布 workflow/skill→响应含"影响 n 个 agent/plan"清单（前端 F37 用） |
| LP-2 | LLM多厂商 | resolvedPurposeBindings 任务留痕 | QueryTask 有 resolvedRefs，无 resolvedPurposeBindings | P1 | 任务详情显"当时生效 classifier=llmp_x:qwen3-72b" |
| LP-3 | LLM多厂商 | Agent/Plan references 反查 API | 规则侧有 `/a/v1/rules/:id/references`；B 侧缺 | P1 | `GET /b/v1/agents/:id/references` 返引用方 |
| LP-4 | LLM多厂商 | skill 缓存即时失效（SLO≤60s） | skill.updated 事件已发，AgentCore 未订阅失效（靠 TTL 10min） | P1 | 改 skill→60s 内引用方生效 |
| AP-1 | 管理平台 | 邮件下发一次性链接 | `adminplatform.ts:200,260` reset/建用户仅直返密码（4 处 TODO） | P1 | 生产可用邮件流（或明确占位策略） |
| AP-2 | 管理平台 | /admin/users 参数化角色编辑 UI | `UsersPage.tsx` 仅 chips 不可编辑参数段 | P1 | base_manager:常州 的"常州"参数可视编辑 |
| AP-3 | 管理平台 | scene-entry AGENT_FIRST defaultAgent 未发布校验 | `server.ts:691-769` 仅字段检查 | P1 | AGENT_FIRST+defaultAgent 未发布→发布失败信息明确 |
| AP-4 | 管理平台 | rules DSL 高亮/dry-run 面板 + rule delete API + 部分页空态 CTA | `RulesPage.tsx` position 返回但无视觉；Tenants/UsersPage 缺 CTA | P2 | DSL 内联高亮+dry-run；空态有"下一步" |
| OG-1 | 本体治理 | X-Deprecated-Refs 响应头 + 审计 deprecatedRefs | `ontology-governance.ts:230` 有 deprecationWarnings，路由未 setHeader | P1 | 调弃用元素→响应带头，前端黄条 |
| OG-2 | 本体治理 | 跨域 LinkType 发布通知 owner | publish-request 缺 touchedDomains 扩展 | P1 | 跨域边发布→双方 owner 进 signoff/通知 |
| OG-3 | 本体治理 | 派生公式单位一致性 lint | unit 入库；派生 compile 未校验（仅 properties G10） | P1 | 不同单位相加公式发布告警 |
| OG-4 | 本体治理 | slice 版本 pin 机制 | `Ref.kind` 含 slice，agent/plan 调用未实现版本控制 | P1 | slice 可 latest/pin，反查支持 |

---

## 2. 驾驶舱数据层颗粒 — **唯一真半成品（25-30%）· 分阶段 · 含高回归专项**

> **已建别重写**：`plan_rootcause`/`metric_rollup` 求解器（月季年派生投影，`service.ts:1339`）· 24 单+6 型号+8 客户种子（`battery.ts:41`）· 基地-型号确定性映射 · `affected_orders` 框架（4 类问题已出，`risk.ts:421`）。
>
> **三阶段（按回归风险，先低后高，高回归专项独立 PR+FDE）：**

| 阶段 | 任务 | 回归 | 锚点 |
|---|---|---|---|
| **① 低回归先做** | B 八根因 ROOT_LIB/PROB_META 种子（纯 config 扩展，affected 读新字段）· D 订单台账筛选+汇总（纯 widget） | ✅低 | `battery.ts:137`；`service.ts:955` |
| **② 中回归** | A 八卡 KPI 数据源对齐（除 K2/K7：Segment.p50/supplyV5/util 用 capacity_rollup/齐套 SOP_MAT 种子）· C 逐单&问题级 DAG（求解器 shape 改，**须兼容旧消费方**）· F `order_margin_contrib` **新增求解器**（不改 marginAttribution）· G DailyDotAxis 圆点轴（~400 行 UI 重写） | ⚠️中-高 | `battery.ts:244`；`risk.ts:421`；`planviews.ts:264`；`RiskBoardView.tsx` |
| **③ 高回归专项（独立 PR+FDE，先过基线再上）** | A-K2 收入口径混淆（rev=240 vs confirmed=248，破 presortedAudit 调用）· A-K7 AOP 种子体系重写 · H quarter 6 季绝对值反解（动 30+ 精确值，跨 AOP/SOP/cockpit 勾稽） | 🔴极高 | `battery.ts` 种子；`TODO-prd-pack.md:410` |
| 本体回写 | SYSTEM-ONTOLOGY §2.E 八根因归并链/§4 三 DAG 结构/§5 发育器官（无更新=失效） | 必须 | `SYSTEM-ONTOLOGY.md` |

> ⚠️ **驾驶舱红线**：③ 高回归专项**单独 PR、先 FDE 逐值核对 HTML、过现有钉死基线再合**——别和 ①② 混在一个 commit。求解器输出 shape 改动（C/F）须保旧消费方不破（chain:check/SHAPE 维守）。

---

## 3. 派活 + 评审
- **可拆**：能力路由（CR-1/2/3 一组，~1h）/ LLM多厂商对称补 / 管理平台 / 本体治理 各可独立认领；驾驶舱**单独一个 agent**按 §2 三阶段串行（别跳阶段）。
- **评审**：同各 HANDOFF §5——不重写已建 · 门绿(尤 chain:check/SHAPE) · 本体回写 · **FDE 亲手证据** · 北极星距离。驾驶舱 ③ 额外核**逐值对齐 HTML + 基线未破**。
- **诚实定性**：5 块收尾无架构断裂；驾驶舱是真补数据层 + 谨慎回归。
