#!/usr/bin/env node
/**
 * WO-AGENT-CONFIG-TO-DSH · 交付物① 逐 agent × 逐配置项 盘点表（可复算）。
 *
 * 判据（单一出处，逐条写死在 CARRIER 表里，脚本只做枚举与对照）：
 *   DSH_NATIVE  = 该配置项由 DSH 的一条**一等概念**承载，且该概念在 DSH 的配置面
 *                 （cordis.yml 插件清单）或 DSH 的原生注册表（MCP server 连接池 / skill
 *                 registry / system-prompt section / llm route）里有名有份。
 *   PLATFORM    = 只经平台自造的**逐 run 字段或带外通道**递入，由平台插件解释；
 *                 DSH 侧没有该资源的任何身份（无 server 名 / 无命名空间 / 无目录）。
 *   N/A         = 不是「需要访问的资源」，是平台身份/生命周期/路由字段。
 *
 * 事实源：apps/agentcore/dist 的**真种子**（seedRegistry / seedMcpConfigs），
 * 不是源码注释。枚举范围 = AgentDefinitionSchema 的全部字段（缺一列不算）。
 */
import { seedRegistry, seedMcpConfigs } from "/Users/apple/deploy/complete/.claude/worktrees/agent-a626159b5dc675e7d/apps/agentcore/dist/mocks/seed.js";

const { agents } = seedRegistry();
const mcpConfigs = seedMcpConfigs();
const byId = new Map(mcpConfigs.map((c) => [c.id, c]));

/** 字段 → 承载判定。`dsh` 列 = 走的是哪个 DSH 机制（plugin / MCP / skill / —）。 */
const CARRIER = {
  id: { who: "N/A", dsh: "—" },
  tenantId: { who: "DSH_NATIVE", dsh: "MCP" },            // setup.tenantId → mcp-client 租户池键
  key: { who: "N/A", dsh: "—" },
  version: { who: "N/A", dsh: "—" },
  name: { who: "N/A", dsh: "—" },
  description: { who: "N/A", dsh: "—" },
  model: { who: "PLATFORM", dsh: "—" },                    // 绑定矩阵解析 → env PLATFORM_LLM_MODEL
  systemPrompt: { who: "DSH_NATIVE", dsh: "plugin" },      // systemPrompt.section(order=1)
  tools: { who: "PER_KIND", dsh: "MCP|—" },                // BUILTIN 支 = PLATFORM；MCP/WORKFLOW 支 = MCP
  ruleBindings: { who: "DSH_NATIVE", dsh: "plugin" },      // platform-governance + tools/pre-execute
  skills: { who: "DSH_NATIVE", dsh: "skill" },             // dsh-skill SkillProvider
  mcpServers: { who: "DSH_NATIVE", dsh: "MCP" },           // dsh-mcp-client per-agent 实例
  scopeDeclaration: { who: "DSH_NATIVE", dsh: "plugin" },  // platform-world pre-execute 白名单/域门
  budget: { who: "PLATFORM", dsh: "—" },                   // 宿主 BudgetTracker（带外）
  status: { who: "N/A", dsh: "—" },
  role: { who: "N/A", dsh: "—" },
  kernel: { who: "PLATFORM", dsh: "—" },                   // 分叉判据，刻意不进 DSH
  createdAt: { who: "N/A", dsh: "—" },
  updatedAt: { who: "N/A", dsh: "—" },
};

const FIELDS = [
  "id", "tenantId", "key", "version", "name", "description", "model", "systemPrompt",
  "tools", "ruleBindings", "skills", "mcpServers", "scopeDeclaration", "budget",
  "status", "role", "kernel",
];

function toolKinds(agent) {
  const k = { BUILTIN: [], MCP: [], WORKFLOW: [] };
  for (const t of agent.tools) {
    if (t.kind === "MCP") k.MCP.push(t.mcpConfigId);
    else if (t.kind === "WORKFLOW") k.WORKFLOW.push(t.workflowId);
    else k.BUILTIN.push(t.name);
  }
  return k;
}

console.log("agent".padEnd(18), "配置项".padEnd(20), "谁承载".padEnd(12), "DSH 机制".padEnd(10), "缺口");
console.log("-".repeat(120));
for (const a of agents) {
  for (const f of FIELDS) {
    const c = CARRIER[f] ?? { who: "?", dsh: "?" };
    let detail = "";
    let gap = "";
    if (f === "tools") {
      const k = toolKinds(a);
      detail = `BUILTIN=${k.BUILTIN.length} MCP=${k.MCP.length} WORKFLOW=${k.WORKFLOW.length}`;
      gap = k.BUILTIN.length > 0 ? `BUILTIN×${k.BUILTIN.length} 走反向通道（无 DSH 身份）` : "";
    } else if (f === "skills") {
      detail = `n=${a.skills.length}`;
    } else if (f === "mcpServers") {
      detail = a.mcpServers.map((m) => byId.get(m.mcpConfigId)?.serverName ?? m.mcpConfigId).join(",");
    } else if (f === "ruleBindings") {
      detail = `${Array.isArray(a.ruleBindings.ruleKeys) ? a.ruleBindings.ruleKeys.length : a.ruleBindings.ruleKeys}/${a.ruleBindings.mode}`;
    } else if (f === "scopeDeclaration") {
      detail = `obj=${a.scopeDeclaration.objectTypes.length}${a.scopeDeclaration.allObjectTypes ? "(ALL)" : ""} tool=${a.scopeDeclaration.toolNames.length}${a.scopeDeclaration.allTools ? "(ALL)" : ""}`;
    } else if (f === "budget") {
      detail = a.budget ? `it=${a.budget.maxIterations ?? "-"} tc=${a.budget.maxToolCalls ?? "-"}` : "(缺省)";
    } else if (f === "systemPrompt") {
      detail = `len=${a.systemPrompt.length}`;
    } else if (f === "model") {
      detail = a.model === "" ? "(空=继承绑定矩阵)" : a.model;
    } else if (f === "kernel") {
      detail = a.kernel ?? "(未配置⇒跟 env)";
    }
    console.log(
      String(a.key).padEnd(18),
      f.padEnd(20),
      c.who.padEnd(12),
      c.dsh.padEnd(10),
      [detail, gap].filter(Boolean).join(" | "),
    );
  }
  console.log("-".repeat(120));
}
console.log("\n=== 汇总：逐 agent 的 BUILTIN 工具面（= 唯一无 DSH 身份的资源类配置）===");
for (const a of agents) {
  const k = toolKinds(a);
  console.log(`${a.key.padEnd(18)} BUILTIN: ${k.BUILTIN.join(", ") || "(无)"}`);
}
console.log("\n=== 平台内置 MCP server 登记行（DSH 侧有身份的）===");
for (const c of mcpConfigs) console.log(`${c.id.padEnd(26)} serverName=${String(c.serverName).padEnd(12)} status=${c.status}`);
