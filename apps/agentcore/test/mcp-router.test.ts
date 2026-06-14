import { describe, expect, it } from "vitest";
import { rankMcpTools, selectMcpTools } from "../src/agent/mcp-router.js";

const TOOLS = [
  { name: "mcp__erp__get_receivables", description: "查询客户应收账款与逾期" },
  { name: "mcp__erp__get_credit_limit", description: "查询客户信用额度" },
  { name: "mcp__carbon__lookup_factor", description: "查询第三方碳因子" },
  { name: "mcp__mes__line_oee", description: "产线 OEE 实时" },
  { name: "mcp__plm__cert_status", description: "型号认证状态" },
  { name: "mcp__wms__stock", description: "仓储库存" },
  { name: "mcp__srm__po_status", description: "采购单状态" },
  { name: "mcp__qms__defect", description: "质量缺陷" },
  { name: "mcp__hr__roster", description: "人员排班" },
];

describe("Phase6C MCP router", () => {
  it("MR1: 信用/应收问句把 ERP 信用与应收工具排前", () => {
    const ranked = rankMcpTools("这个客户信用额度还够吗，应收逾期多少", TOOLS);
    const top2 = ranked.slice(0, 2).map((r) => r.tool.name);
    expect(top2).toContain("mcp__erp__get_credit_limit");
    expect(top2).toContain("mcp__erp__get_receivables");
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it("MR2: selectMcpTools 收窄到 top-k，其余 deferred；≤topK 时全量", () => {
    const sel = selectMcpTools("碳因子达标吗", TOOLS, 3);
    expect(sel.full).toHaveLength(3);
    expect(sel.deferred).toHaveLength(TOOLS.length - 3);
    expect(sel.full.map((t) => t.name)).toContain("mcp__carbon__lookup_factor");

    const all = selectMcpTools("任意", TOOLS.slice(0, 2), 8);
    expect(all.full).toHaveLength(2);
    expect(all.deferred).toHaveLength(0);
  });

  it("MR3: 无 query → 全量(不收窄)；确定性同输入同输出", () => {
    const a = selectMcpTools(undefined, TOOLS, 3);
    expect(a.full).toHaveLength(TOOLS.length);
    const r1 = rankMcpTools("库存", TOOLS).map((r) => r.tool.name);
    const r2 = rankMcpTools("库存", TOOLS).map((r) => r.tool.name);
    expect(r1).toEqual(r2);
  });
});
