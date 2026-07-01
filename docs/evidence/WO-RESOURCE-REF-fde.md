# WO-RESOURCE-REF · FDE 验收证据（统一资源引用模型收口 · G-10 前端收口）

> 真起前端(vite 5201) + 真双服务（datacore 4011 / agentcore 4012 内存态 SEED_DEMO=1）+ Playwright(Chromium /opt/pw-browsers)。
> 登录 `demo/admin/demo1234`。**非测试绿——五步真浏览器亲手走通 + curl 闭环证真进后端引用图。**

## 结论

- **修真 bug（P0）**：AgentsPage 规则绑定从自由文本 `<input>` → **规则库 picker**（`RuleRefSelect`），后端 `ruleBindings.ruleKeys` = 真规则码。
- **Skill 引用（P1）**：契约 additive 加 `ruleBindings`/`mcpServers`；SkillsPage 加「规则引用」+「MCP 引用」两区，落库、刷新保留、进被引用图。
- **MCP 内置求解器（P1）**：McpPage 用户自建之下增「求解器（平台内置）·内置·READ」分区，点开列 `mcp__solvers__*`（真后端 46 工具）。
- **共享控件（§2.1）**：`components/resource-refs/ResourceRefSelect.tsx`（`RuleRefSelect`+`McpRefSelect`），WorkflowsPage 改 import 共享（行为不变，回归 `admin-r6-policy-ruleids` 测试绿）。
- **闭环真实性（§0.5·关键）**：agent/skill 勾的 K01 经发布→上报 A→ `/a/v1/rules/{K01}/references` 把二者列为**引用方**（`via:"reported(latest)"`）。

## 真浏览器逐步（脚本 `scripts/fde-resource-ref.mjs`）

```
✓ ① 规则库含「约束条件」tab（K01 constraint 已发布）           截图 wo-ref-1-rules.png
✓ ② Agent 规则绑定为库 picker 控件（agent-rulebindings-select，非自由文本 input）
✓ ② 刷新后 K01 勾选态保留（后端 ruleKeys=真规则码 K01）        截图 wo-ref-2-agent.png
✓ ③ Skill 编辑器含「规则引用」区 + 「MCP 引用」区
✓ ③ MCP 引用区含内置求解器 server 选项（solvers）             截图 wo-ref-3-skill.png
✓ ④ MCP 页含「求解器（平台内置）」内置服务条目
✓ ④ 点开列出 mcp__solvers__* 工具（只读，真后端 46 工具）      截图 wo-ref-4-mcp.png
```

`wo-ref-2-agent.png` 实拍：规则绑定区为多选 picker——ALL_APPLICABLE 单选 + 「指定规则码」勾选列（C01–C33 评估规则 **与** 库容约束(FDE)(K01) 约束条件同列，本体 §86 发布即列），K01 已勾选 + 右侧 POST_CHECK mode select。自由文本框已消失。

`wo-ref-4-mcp.png` 实拍：左栏「内置服务 · 求解器（平台内置）· 内置·READ · 46」，右栏列全部 `mcp__solvers__*` 工具（真后端注册表派生，非 mock）。

## curl 闭环（证真进后端引用图·非装饰）

前置：`demo:u_admin:admin`，DC=:4011 AC=:4012（SERVICE_TOKEN 两服务同值，本地临时 dev 值）。

```bash
# ① 建约束条件 K01 + 发布
POST $DC/a/v1/rules  {"key":"K01","ruleType":"constraint","expression":"payload.load <= 100","severity":"BLOCK",...}
POST $DC/a/v1/rules/$RID/publish {}
#   → K01 status: PUBLISHED type: constraint

# ② agent 勾 K01 + 发布（触发出向引用上报 A）
POST $AC/b/v1/agents {"ruleBindings":{"ruleKeys":["K01"],"mode":"POST_CHECK"},...}
#   stored ruleKeys: ["K01"]   ← 真规则码，非自由文本
POST $AC/b/v1/agents/$AID/publish {}

# ③ skill 勾 K01 + solvers MCP + 发布
POST $AC/b/v1/skills {"ruleBindings":{"ruleKeys":["K01"],"mode":"PRE_CHECK"},"mcpServers":[{"mcpConfigId":"solvers"}],...}
#   stored ruleBindings: {"ruleKeys":["K01"],"mode":"PRE_CHECK"} mcpServers: [{"mcpConfigId":"solvers"}]
POST $AC/b/v1/skills/$SID/publish?force=true {}   # force 跳评测门（FDE 验引用图，非评测）

# ④ 规则被引用图（闭环证明）
GET $DC/a/v1/rules/$RID/references
#   {"references":[
#     {"kind":"agent","key":"agent_fde_ref","name":"FDE 引用测试 Agent","via":"reported(latest)"},
#     {"kind":"skill","key":"skill_fde_ref","name":"FDE 技能引用","via":"reported(latest)"}],
#    "count":2}
```

**闭环成立**：前端勾的 K01 经发布真进后端 `reportedRefs` 引用图，规则 references 把 agent **与** skill 都列为引用方——正是 G-10「规则被引用但非一等可编辑引用」的前端收口，断在接缝（前端控件↔规则库）而非后端（evaluate/reference 早已在）。

## 内置求解器 MCP server（curl 佐证）

```bash
GET $AC/b/v1/mcp/servers/solvers
#   {"server":{"name":"solvers","displayName":"求解器（平台内置）","builtin":true,"sideEffect":"READ"},
#    "tools":[{"name":"mcp__solvers__affected_orders",...}, ...], "count":46}
```

## 诚实边界（WO §4）

- Skill 引用本单只**声明+落库+进被引用图**，不扩执行语义（skill 被 agent 加载时是否二次评估其规则属上游，未改）。
- Agent PRE_CHECK 运行时评估仍为既有边界（`engine.ts` 仅 POST_CHECK/BOTH），本单只修引用控件。
- 求解器-as-MCP 经 `SOLVERS_MCP_SERVER_INFO.builtin` 区分，未新增并行 type 枚举。

## 门

- `pnpm -r build`（4 包）绿 · `pnpm --filter frontend-shell test` 绿 · `pnpm --filter agentcore test` 绿 · `pnpm gates` 全绿。
- 契约 additive（`RuleBindingsSchema`/`McpServerRefSchema` 抽为共享子契约，agent/skill 同形），Agent/Workflow 现有引用回归不破。
