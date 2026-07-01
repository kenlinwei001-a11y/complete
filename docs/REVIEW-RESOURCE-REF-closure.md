# REVIEW · RESOURCE-REF 复验闭环（统一资源引用模型·G-10 前端收口·eee4cd6）

> 审核方按 ACCEPTANCE-CONTRACT **逐条亲手跑 + 前后端闭环 + C5/C6 真浏览器像素级**（用户令）。直击用户原话 bug：**"前端看着有实际没关联"**（R15）——前端勾的规则/MCP 码必须真进后端引用图，非 UI 装饰。独立复验非 rubber-stamp。
> 环境：真 datacore(4001)+真 agentcore(4002·同 SERVICE_TOKEN·跨系统引用上报)+真 vite(127.0.0.1:5177·非mock)·dist@66f2e25(含 eee4cd6)。

## 判决：✅ DONE（前端勾的码真进后端引用图·闭环非装饰·自由文本 bug 修为库 picker·MCP 内置求解器透出）

## 契约 7 条逐条真跑证据

| # | 断言 | 类型 | 实测证据 | 判 |
|---|---|---|---|---|
| C1 | 内置求解器 MCP server 存在·builtin=true·count≥1·tools 均 mcp__solvers__ 前缀 | curl | GET /b/v1/mcp/servers/solvers → **200**·`server.builtin=true`·**count=46**·全 tools `mcp__solvers__*`(all startsWith=true) | ✅ |
| C2 | Agent 规则绑定落库为真规则码(非自由文本壳) | curl | 建 agent(ruleBindings.ruleKeys=["K01"])→GET /b/v1/agents 该 agent `.ruleBindings.ruleKeys=["K01"]`(真码·非空/占位) | ✅ |
| C3 | Skill 契约新增引用字段落库(.ruleBindings.ruleKeys + .mcpServers 非空) | curl | 建 skill→GET /b/v1/skills 该 skill `.ruleBindings.ruleKeys=["K01"]` **且** `.mcpServers=[{mcpConfigId:"solvers"}]`(additive 字段透传落库) | ✅ |
| C4 | 闭环引用图真接线：rules/{K01}/references 把 agent 与 skill 都列为引用方 | curl | agent+skill 各绑 K01+发布(触发出向上报 A)→GET /a/v1/rules/{K01_id}/references → **count=2**：`skill:skill_rr_verify(via reported(latest))` + `agent:agent_rr_v2(via reported(latest))` → **前端勾的码真进后端引用图·非装饰** | ✅ |
| C5 | Agent 规则绑定 UI 由自由文本框升级为规则库勾选控件 | browser | **Playwright 真 Chromium**(demo/admin/demo1234)/admin/agents 选 agent → 「规则绑定」区=**picker**(`agent-rulebindings-select`·ALL_APPLICABLE 单选 + 指定规则码 单选)·**旧自由文本 `<input aria-label="规则 keys">` 已消失**(present=false)。截图 `docs/evidence/rr-c5-agent-picker.png`(像素级：规则绑定=○ALL_APPLICABLE ○指定规则码 radio + POST_CHECK mode·非手敲逗号码) | ✅ |
| C6 | MCP 页显内置求解器(标签含内置·点开列 mcp__solvers__*)；Skill 出现规则引用+MCP 引用两区 | browser | /admin/mcp：`mcp-builtin-section`+`mcp-builtin-solvers`可见·点开 `mcp__solvers__*` 工具可见(截图 `rr-c6-mcp-builtin.png`：「内置服务·内置·READ 求解器（平台内置）·46」+ 全 46 工具列 affected_orders/cockpit_kpi/finance_pnl…)。/admin/skills 选 skill：`skill-rule-refs`(规则引用)+`skill-mcp-refs`(MCP 引用)两区均在(截图 `rr-c6-skill-refs.png`) | ✅ |
| C7 | 四包门全绿·契约不重定义(contracts-only-shared)·typecheck 过 | gate | `pnpm -r build`(BUILD_OK) `&& pnpm -r typecheck`(**TYPECHECK_OK·0 error TS**) `&& pnpm -r test` → **exit 0**·datacore 844\|15skip·agentcore 356·frontend **299**(ResourceRefSelect/AgentsPage/McpPage/SkillsPage/WorkflowsPage 改未破前端测)·contracts 3·llm-adapters 15 → **全绿零回归**·契约 additive 仅在 packages/contracts | ✅ |

## 前后端闭环·数据前后端可见（前端勾 = 后端库 = 引用图·三处贯通·R15 bug 闭）
- **前端**(C5/C6 像素级)：AgentsPage 规则绑定 picker 勾 → SkillsPage 规则引用+MCP 引用两区勾 → MCP 页内置求解器可引用。
- **后端库**(C2/C3 curl)：agent.ruleBindings.ruleKeys / skill.ruleBindings.ruleKeys+mcpServers 真落库。
- **引用图**(C4 curl)：发布触发出向上报 A → rules/{K01}/references 列 agent+skill 为引用方(via reported(latest))。
→ **"看着有实际没关联" bug 闭**：前端勾的码真进后端引用图(非装饰)·断在接缝(前端控件↔规则库)已修·后端 evaluate/reference 早在。

## 代码评审 + 本体回写（铁律0）
- **共享控件**：`components/resource-refs/ResourceRefSelect.tsx`(`RuleRefSelect`+`McpRefSelect`)·AgentsPage/SkillsPage/WorkflowsPage 复用(WorkflowsPage 改 import 共享·行为不变)。
- **契约 additive(contracts-only-shared)**：`RuleBindingsSchema`/`McpServerRefSchema` 抽为共享子契约·agent/skill 同形·前端不重定义(仅 packages/contracts)。
- **出向引用上报**：`refs/report.ts` agent/skill 发布 → `POST /a/v1/references/report`(SERVICE_TOKEN 服务间)·A 反查影响面。内置求解器 `SOLVERS_MCP_SERVER_INFO.builtin` 区分(未新增并行 type 枚举)。
- **本体回写**：SYSTEM-ONTOLOGY.md §(资源引用模型/G-10 收口)。
- **诚实边界(dev 标·认同)**：Skill 引用本单只**声明+落库+进被引用图**·不扩执行语义(skill 被 agent 加载时二次评估属上游·未改)；Agent PRE_CHECK 运行时评估仍既有边界(engine.ts 仅 POST_CHECK/BOTH)·本单只修引用控件。

## 距北极星（诚实）
- ✅ **R15"看着有实际没关联" bug 闭**：前端资源引用控件(规则/MCP 库勾选)↔后端引用图真贯通(C4 闭环 count=2)·自由文本 bug 修为 picker。
- ⚠️ 声明 ≠ 执行：本单收口"引用声明+落库+被引用图"(G-10 前端接缝)·**非**改 skill/agent 的运行时二次评估语义(那是上游·诚实标注)。

---
*审核方 RESOURCE-REF 复验闭环（前后端闭环 + C4 引用图闭环 curl + C5/C6 真浏览器像素级 + 7 契约逐条）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
