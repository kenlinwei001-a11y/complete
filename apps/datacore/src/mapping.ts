import type { MappingRow } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import { SOLVER_KEYS } from "./solvers/service.js";
import { AGENT_SEEDS, CONN_SYSTEM, DOMAIN_ORDER, GRAPH_DOMAIN, SOLVER_GRAPH } from "./graphmeta.js";

/**
 * §7.20 业务建模映射表：服务端由本体元数据 + sourceBindings + 规则 scope + 派生公式
 * + 求解器注册表 + Agent 静态清单拼装，按数据域分组、组内按显示名排序后下发。
 */
export async function buildMappingRows(repos: Repos, tenantId: string): Promise<MappingRow[]> {
  const types = await repos.ontologyTypes.list(tenantId, (t) => t.status === "ACTIVE");
  const rules = await repos.rules.list(tenantId, (r) => r.status === "PUBLISHED");
  const conns = await repos.connections.list(tenantId);
  const connName = (connId?: string): string | undefined => {
    if (!connId) return undefined;
    return conns.find((c) => c.id === connId)?.name ?? CONN_SYSTEM[connId] ?? connId;
  };

  const rows: MappingRow[] = [];
  for (const t of types) {
    const binding = (t.sourceBindings ?? [])[0];
    const domain = GRAPH_DOMAIN[t.key] ?? "factory";
    rows.push({
      domain,
      objectKey: t.key,
      displayName: t.displayName ?? t.key,
      kind: "object",
      sourceSystem: binding ? (CONN_SYSTEM[binding.connId] ?? binding.connId) : domain === "plan" ? "平台·计划域" : "—",
      keyProps: (t.properties ?? []).slice(0, 5).map((p) => p.propKey),
      rules: rules.filter((r) => (r.scopeObjectTypes ?? []).includes(t.key)).map((r) => r.key).sort(),
      derivations: (t.derivedProperties ?? []).map((d) => `${d.propKey} = ${d.formula}`),
      lineage: {
        ...(binding ? { connName: connName(binding.connId), dataset: binding.dataset } : {}),
        fieldCount: binding ? Object.keys(binding.fieldMappings ?? {}).length : 0,
      },
    });
  }
  // 求解器行（kind="solver"）
  for (const solverKey of SOLVER_KEYS) {
    const meta = SOLVER_GRAPH[solverKey];
    if (!meta) continue;
    rows.push({
      domain: "solver",
      objectKey: solverKey,
      displayName: meta.label,
      kind: "solver",
      sourceSystem: "平台求解器",
      keyProps: [],
      rules: [...meta.ruleRefs],
      derivations: [`输出绑定 → ${meta.target}`],
      lineage: { fieldCount: 0 },
    });
  }
  // Agent 行（kind="agent"，静态种子清单）
  for (const a of AGENT_SEEDS) {
    rows.push({
      domain: "agent",
      objectKey: a.key,
      displayName: a.displayName,
      kind: "agent",
      sourceSystem: "AgentCore",
      keyProps: [],
      rules: [],
      derivations: [a.summary],
      lineage: { fieldCount: 0 },
    });
  }
  // 分组排序：数据域顺序 → 显示名（码点序，跨环境确定性）
  const domainIdx = (d: string) => {
    const i = DOMAIN_ORDER.indexOf(d);
    return i === -1 ? DOMAIN_ORDER.length : i;
  };
  rows.sort((a, b) => {
    const di = domainIdx(a.domain) - domainIdx(b.domain);
    if (di !== 0) return di;
    return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
  });
  return rows;
}
