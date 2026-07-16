const DC = 'http://127.0.0.1:4001', AC = 'http://127.0.0.1:4002';
const H = { 'X-Debug-User': 'demo:u_admin:admin', 'Content-Type': 'application/json' };
const call = async (base, m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
};
const L = (...a) => console.log(...a);

// ---- C1: built-in solver MCP server ----
const mcp = await call(AC, 'GET', '/b/v1/mcp/servers/solvers');
const tools = mcp.body?.tools || [];
const allPrefixed = tools.length > 0 && tools.every((t) => (t.name || '').startsWith('mcp__solvers__'));
L('C1 solvers MCP:', mcp.status, '| builtin=' + (mcp.body?.server?.builtin), '| count=' + mcp.body?.count, '| all mcp__solvers__=' + allPrefixed);
L('  C1', mcp.status === 200 && mcp.body?.server?.builtin === true && (mcp.body?.count ?? 0) >= 1 && allPrefixed ? 'PASS ✅' : 'CHECK');

// ---- setup: create + publish rule K01 on datacore ----
const rule = await call(DC, 'POST', '/a/v1/rules', { key: 'K01', name: 'RESOURCE-REF 复验约束', ruleType: 'constraint', expression: 'payload.load <= 100', severity: 'BLOCK', description: 'reviewer verify' });
const RID = rule.body?.id || rule.body?.rule?.id;
L('\nrule K01 create:', rule.status, 'id=' + RID);
const rpub = await call(DC, 'POST', `/a/v1/rules/${RID}/publish`, {});
L('rule K01 publish:', rpub.status, 'status=' + (rpub.body?.status || rpub.body?.rule?.status));

// ---- C2: agent binds K01 (real rule code) ----
const agent = await call(AC, 'POST', '/b/v1/agents', { key: 'agent_rr_verify', name: 'RR 复验 Agent', description: 'reviewer verify', systemPrompt: 'x', tools: [], skills: [], mcpServers: [], scopeDeclaration: { objectTypes: [], toolNames: [] }, ruleBindings: { ruleKeys: ['K01'], mode: 'POST_CHECK' } });
const AID = agent.body?.id || agent.body?.agent?.id;
L('\nC2 agent create:', agent.status, 'id=' + AID, 'ruleKeys=' + JSON.stringify(agent.body?.ruleBindings?.ruleKeys || agent.body?.agent?.ruleBindings?.ruleKeys));
await call(AC, 'POST', `/b/v1/agents/${AID}/publish`, {});
const agents = await call(AC, 'GET', '/b/v1/agents');
const alist = agents.body?.items || agents.body || [];
const myAgent = (Array.isArray(alist) ? alist : []).find((a) => a.id === AID || a.key === 'agent_rr_verify');
const agentKeys = myAgent?.ruleBindings?.ruleKeys || [];
L('  GET agents → my agent ruleKeys:', JSON.stringify(agentKeys), '| contains K01:', agentKeys.includes('K01'));
L('  C2', agentKeys.includes('K01') ? 'PASS ✅' : 'CHECK');

// ---- C3: skill additive fields (ruleBindings + mcpServers) ----
const skill = await call(AC, 'POST', '/b/v1/skills', { key: 'skill_rr_verify', name: 'RR 复验技能', summary: 'reviewer verify', body: 'reviewer verify body', ruleBindings: { ruleKeys: ['K01'], mode: 'PRE_CHECK' }, mcpServers: [{ mcpConfigId: 'solvers' }] });
const SID = skill.body?.id || skill.body?.skill?.id;
L('\nC3 skill create:', skill.status, 'id=' + SID);
await call(AC, 'POST', `/b/v1/skills/${SID}/publish?force=true`, {});
const skills = await call(AC, 'GET', '/b/v1/skills');
const slist = skills.body?.items || skills.body || [];
const mySkill = (Array.isArray(slist) ? slist : []).find((s) => s.id === SID || s.key === 'skill_rr_verify');
const skillKeys = mySkill?.ruleBindings?.ruleKeys || [];
const skillMcp = mySkill?.mcpServers || [];
L('  skill ruleKeys:', JSON.stringify(skillKeys), '| mcpServers:', JSON.stringify(skillMcp));
L('  C3', skillKeys.includes('K01') && skillMcp.length >= 1 && skillMcp[0]?.mcpConfigId ? 'PASS ✅' : 'CHECK');

// ---- C4: closed-loop reference graph (rules/{K01}/references lists agent + skill) ----
const refs = await call(DC, 'GET', `/a/v1/rules/${RID}/references`);
const rlist = refs.body?.references || refs.body?.items || [];
const kinds = (Array.isArray(rlist) ? rlist : []).map((r) => `${r.kind}:${r.key || r.id}`);
const hasAgent = kinds.some((k) => /agent/.test(k));
const hasSkill = kinds.some((k) => /skill/.test(k));
L('\nC4 rule references:', refs.status, '| count=' + (refs.body?.count ?? rlist.length));
L('  referrers:', JSON.stringify(kinds));
L('  agent referrer:', hasAgent, '| skill referrer:', hasSkill);
L('  C4', hasAgent && hasSkill ? 'PASS ✅ — 前端勾的码真进后端引用图(闭环·非装饰)' : 'CHECK');
