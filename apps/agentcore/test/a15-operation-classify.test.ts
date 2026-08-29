import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN } from "./helpers.js";
import { classifyOperation, OPERATION_CATALOG } from "@platform/contracts";

/**
 * A15 · CLI 通用操作外壳 —— 操作型意图分类（确定性 R6，CLI 与 GUI 平行同源）。
 * 自然语言 → QUERY（走 QOS ask）/ OPERATION（路由模块）；低置信/多候选 → candidates 不瞎猜。
 */
describe("A15 · classifyOperation 确定性分类（L0）", () => {
  it("操作型关键词 → OPERATION + 正确 op + 端点/槽/R4", () => {
    const imp = classifyOperation("把这个 csv 导入进来");
    expect(imp.kind).toBe("OPERATION");
    expect(imp.op).toBe("import");
    expect(imp.endpoint).toBe("/a/v1/connectors/upload");
    const build = classifyOperation("按这个故事建域：工序共享瓶颈");
    expect(build.op).toBe("build");
    const rule = classifyOperation("加一条规则约束订单产能");
    expect(rule.op).toBe("rule");
    expect(rule.r4).toBe(true); // 写真值经 R4
  });

  it("无操作关键词 → QUERY（走 QOS ask）", () => {
    const q = classifyOperation("常州基地影响哪些订单？");
    expect(q.kind).toBe("QUERY");
    expect(q.op).toBeUndefined();
  });

  it("新增求解器语义 → solve op 带 uiDeepLink（CLI 不内联，深链跳 GUI，§3.6）", () => {
    const s = classifyOperation("调用求解器算一下");
    expect(s.op).toBe("solve");
    expect(s.uiDeepLink).toBe("/admin/solvers/new");
  });

  it("R6 确定性：同输入同输出", () => {
    expect(JSON.stringify(classifyOperation("导入并建模"))).toBe(JSON.stringify(classifyOperation("导入并建模")));
  });

  it("R15 对等：OPERATION_CATALOG 每条都有 cliCommand 或 uiDeepLink", () => {
    expect(OPERATION_CATALOG.length).toBeGreaterThanOrEqual(15);
    expect(OPERATION_CATALOG.every((e) => e.cliCommand || e.uiDeepLink)).toBe(true);
  });
});

describe("A15 · QOS classifier misrouting regression（PRD-CLI §A3b 10/10）", () => {
  it("缺区操作不再落 QUERY / 错模块", () => {
    const cases: { input: string; op: string; endpoint: string }[] = [
      { input: "配置 LLM 供应商", op: "llm", endpoint: "/a/v1/llm-providers" },
      { input: "配 MCP 工具服务", op: "mcp", endpoint: "/b/v1/mcp-configs" },
      { input: "跑评测套件", op: "eval", endpoint: "/b/v1/evals" },
      { input: "看通知中心", op: "notify", endpoint: "/a/v1/notifications" },
      { input: "配工厂日历", op: "platform-config", endpoint: "/a/v1/prompt-templates" },
      { input: "管理租户用户角色", op: "tenant", endpoint: "/a/v1/tenants" },
      { input: "S&OP 月度平衡版本", op: "sop", endpoint: "/a/v1/sop/versions" },
      { input: "看系统本体影响分析", op: "meta", endpoint: "/a/v1/meta/sync" },
      { input: "跑 VLE 校验", op: "validate", endpoint: "/a/v1/validation/runs" },
      { input: "本体切片规划", op: "slice", endpoint: "/a/v1/slices" },
      { input: "新建一个工作流编排", op: "workflow", endpoint: "/b/v1/workflows" },
    ];
    for (const c of cases) {
      const r = classifyOperation(c.input);
      expect(r.kind).toBe("OPERATION");
      expect(r.op).toBe(c.op);
      expect(r.endpoint).toBe(c.endpoint);
    }
  });

  it("场景 vs 场景配置 不互相挤占", () => {
    expect(classifyOperation("看有哪些场景").op).toBe("scenario");
    expect(classifyOperation("场景配置").op).toBe("scene-config");
  });
});

describe("A15 · POST /b/v1/operations/classify（真端点，OBO）", () => {
  it("操作型 NL → OPERATION 路由（合成数据）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/operations/classify", headers: debugHeaders(ADMIN), payload: { input: "合成一批数据 seed 42" } });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { kind: string; op?: string; endpoint?: string };
    expect(out.kind).toBe("OPERATION");
    expect(out.op).toBe("synth");
    expect(out.endpoint).toBe("/a/v1/synthetic/jobs");
  });

  it("查询型 NL → QUERY（CLI 据此走 ask）", async () => {
    const t = await createTestApp();
    const out = (await (await t.app.inject({ method: "POST", url: "/b/v1/operations/classify", headers: debugHeaders(ADMIN), payload: { input: "产能能否按期交付？" } })).json()) as { kind: string };
    expect(out.kind).toBe("QUERY");
  });
});
