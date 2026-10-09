import { seedRegistry, seedMcpConfigs } from "/Users/apple/deploy/complete/.claude/worktrees/agent-a626159b5dc675e7d/apps/agentcore/dist/mocks/seed.js";
const { agents } = seedRegistry();
const cfg = new Map(seedMcpConfigs().map((c) => [c.id, c]));
// 码：P=平台侧组装 / N=DSH 原生 / -=N-A（身份·生命周期·路由，不是「要访问的资源」）
//     工具列：M=全 MCP / B=含 BUILTIN 反向通道（缺口）
const F = ["tenantId","model","systemPrompt","tools","ruleBindings","skills","mcpServers","scopeDeclaration","budget","kernel","role","status","id/key/version/name/description"];
const hdr = ["agent", ...F];
console.log(hdr.join(" | "));
console.log(hdr.map((h) => "-".repeat(h.length)).join("-|-"));
for (const a of agents) {
  const kinds = a.tools.map((t) => t.kind);
  const cell = {
    tenantId: "N(MCP池键)", model: "P(env→plugin)", systemPrompt: "N(plugin)",
    tools: kinds.includes("BUILTIN") ? `M+B×${kinds.filter(k=>k==="BUILTIN").length}` : "M",
    ruleBindings: `N(plugin ${Array.isArray(a.ruleBindings.ruleKeys) ? a.ruleBindings.ruleKeys.length : a.ruleBindings.ruleKeys}/${a.ruleBindings.mode})`,
    skills: `N(skill n=${a.skills.length})`,
    mcpServers: `N(MCP ${a.mcpServers.map((m) => cfg.get(m.mcpConfigId)?.serverName ?? "?").join("+")})`,
    scopeDeclaration: `N(plugin obj=${a.scopeDeclaration.objectTypes.length}${a.scopeDeclaration.allObjectTypes?"ALL":""} tool=${a.scopeDeclaration.toolNames.length}${a.scopeDeclaration.allTools?"ALL":""})`,
    budget: "P(宿主计数)", kernel: a.kernel ? `P(${a.kernel})` : "P(跟env)", role: a.role ? `-(${a.role})` : "-", status: `-(${a.status})`,
    "id/key/version/name/description": "-",
  };
  console.log([a.key, ...F.map((f) => cell[f])].join(" | "));
}
