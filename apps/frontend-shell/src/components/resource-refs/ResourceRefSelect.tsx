import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMcpConfigs, fetchRules, fetchSolverMcpServer } from "@/api/endpoints";

/**
 * WO-RESOURCE-REF · 统一资源引用控件（G-10 规则即一等引用 · 本体 §86/§475）。
 * 抽自 WorkflowsPage 内联 RuleRefMultiSelect（`:652` 起）为共享组件，供 workflow/agent/skill
 * 三方复用——把"自由文本码/缺失引用"升为真库 picker（规则库 status===PUBLISHED · 约束条件不额外过滤，
 * 发布即列，本体 §86）。空态给去创作页链接（D-27 空态有路），绝不留死下拉。
 */

type RuleValue = "ALL_APPLICABLE" | string[];
export interface RefOption {
  value: string;
  label: string;
}

/**
 * 规则引用多选：ALL_APPLICABLE 单选 或 勾选具体已发布规则码。
 * options 缺省时内部 fetchRules（过滤 status===PUBLISHED）；调用方（如 workflow 已有 refData）可传 options 复用其查询。
 */
export function RuleRefSelect({
  value,
  disabled,
  options,
  testid,
  label = "ruleKeys",
  allHint = "ALL_APPLICABLE（自动取适用规则）",
  onChange,
}: {
  value: unknown;
  disabled?: boolean;
  options?: RefOption[];
  testid: string;
  label?: string;
  allHint?: string;
  onChange: (v: RuleValue) => void;
}) {
  // 未传 options 时自取规则库（发布态），约束条件同列（本体 §86，不按 ruleType 过滤）。
  const { data: rules } = useQuery({
    queryKey: ["a", "rules"],
    queryFn: fetchRules,
    enabled: options === undefined,
  });
  const opts: RefOption[] =
    options ??
    (rules ?? [])
      .filter((r) => r.status === "PUBLISHED")
      .map((r) => ({ value: r.key, label: `${r.name}（${r.key}）` }));

  const isAll = value === "ALL_APPLICABLE" || value == null;
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange([...next]);
  };

  return (
    <label style={{ minWidth: 260, display: "block" }}>
      {label}
      <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="radio"
            data-testid={`${testid}-all`}
            checked={isAll}
            disabled={disabled}
            onChange={() => onChange("ALL_APPLICABLE")}
          />
          <span>{allHint}</span>
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="radio" data-testid={`${testid}-pick`} checked={!isAll} disabled={disabled} onChange={() => onChange([...selected])} />
          <span>指定规则码：</span>
        </label>
        {!isAll &&
          (opts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 18 }}>
              {opts.map((o) => (
                <label key={o.value} className="badge" style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    data-testid={`${testid}-opt-${o.value}`}
                    checked={selected.has(o.value)}
                    disabled={disabled}
                    onChange={() => toggle(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          ) : (
            <Link to="/admin/rules" data-testid={`${testid}-empty`} className="badge amber" style={{ marginLeft: 18, textDecoration: "none" }}>
              尚无已发布规则，点击去规则库创建 →
            </Link>
          ))}
      </div>
    </label>
  );
}

/**
 * MCP 引用多选：数据源 = 用户自建 MCP（fetchMcpConfigs）∪ 内置求解器 server（fetchSolverMcpServer）。
 * 值为 { mcpConfigId }[]；内置求解器 server 以 SOLVERS_MCP_SERVER 名（"solvers"）作为 mcpConfigId 引用。
 * 空态给去 /admin/mcp。
 */
export function McpRefSelect({
  value,
  disabled,
  testid,
  onChange,
}: {
  value: { mcpConfigId: string }[];
  disabled?: boolean;
  testid: string;
  onChange: (v: { mcpConfigId: string }[]) => void;
}) {
  const { data: configs } = useQuery({ queryKey: ["b", "mcp-configs", {}], queryFn: fetchMcpConfigs });
  const { data: solverServer } = useQuery({ queryKey: ["b", "mcp-solvers-server"], queryFn: fetchSolverMcpServer });

  const opts: RefOption[] = [
    ...(configs ?? []).map((c) => ({ value: c.id, label: c.name })),
    ...(solverServer ? [{ value: solverServer.server.name, label: `${solverServer.server.displayName}（内置·READ）` }] : []),
  ];
  const selected = new Set((value ?? []).map((m) => m.mcpConfigId));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next].map((mcpConfigId) => ({ mcpConfigId })));
  };

  return (
    <div data-testid={testid}>
      {opts.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {opts.map((o) => (
            <label key={o.value} className="badge" style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input
                type="checkbox"
                data-testid={`${testid}-opt-${o.value}`}
                checked={selected.has(o.value)}
                disabled={disabled}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      ) : (
        <Link to="/admin/mcp" data-testid={`${testid}-empty`} className="badge amber" style={{ textDecoration: "none" }}>
          尚无 MCP 服务器，点击去创建 →
        </Link>
      )}
    </div>
  );
}
