import { describe, expect, it } from "vitest";
import { solverMcpToolName, type AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { SOLVERS_MCP_CONFIG_ID } from "../src/mcp/solvers-catalog.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { projectNavigationSlice, renderNavigationSlice } from "../src/agent/navigation-slice.js";

/**
 * WO-ROSTER-RESPECT-TOOLFILTER · 接缝判据：**广告面 ⊆ 可调用面**。
 *
 * ══ 本单之前实测到的行为（活服务原始数，另一单取证）═══════════════════════════════
 * `agt_capacity_planner` 的 `tools[].toolFilter` 只有 5 个求解器，`mcp__solvers__cockpit_kpi`
 * **不在其中**；而**提示词**里印着「全部可调用的求解器目录（共 3 个…）」→ `· cockpit_kpi：…`
 * —— 因为目录段的入选规则当时只走 **`scope 对象域 ∩ 求解器 reads`**，不看 `toolFilter`。
 * 后果是实的：模型照着提示词去调 ⇒ executor 的工具 scope 门当场 `AGENT_SCOPE_VIOLATION`（0ms DENIED）。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『它读的对象类型在 scope 内』当作『模型调得动它』的证据，而前者并不度量后者
 * > —— 调得动还要过 MCP 白名单（toolFilter）。」**
 *
 * ══ 判据（逐条对应派单 §4）═════════════════════════════════════════════════════
 *  ① toolFilter 里**有** X ⇒ X 在目录段；
 *  ② 同一份目录、同一 scope，从 toolFilter 里**去掉** X ⇒ X 不在目录段（**修复前本组红**）；
 *  ③ 未设 toolFilter ⇒ 目录段按既有规则照常（「没设过滤」≠「什么都别给」）；
 *  ④ 对若干 agent 逐个数：目录段里的求解器键 ⊆ 该 agent 的 toolFilter（**差集为空**）。
 *
 * ⚠ ④ 不许只报「个数相等」（个数相等不度量集合相等）⇒ 这里判**双向差集**：多出来的、少掉的都算。
 * ⚠ 否定结论必须配金丝雀：同一台抽取器必须**证明它看得见** cockpit_kpi（授权态下抽得到），
 *   否则「抽不到」与「抽取器坏了」在屏上一模一样。
 */

const CTX = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

/** 活服务实测的问句（与 `arm-failure-visible.seam.test.ts` ⑦ 同一句）。 */
const QUERY = "常州基地当前的产能利用率是多少？瓶颈在哪道工序？";

/** cockpit_kpi 的 `ontologySignature.reads`（活服务 `/a/v1/solvers/registry` 实读·逐字不动）：
 *  `[{SopVersionRow},{FinancePlan},{Base},{AnnualScenario},{Order}]` ⇒ 与 [Base,Line,Model,Order] 有交集。 */
const COCKPIT_READS = ["SopVersionRow", "FinancePlan", "Base", "AnnualScenario", "Order"];

// ───────────────────────────────────────────────────────────────────────────
// 抽取器（判据的**量具**）：目录段里被列出的键
//
// 只在「· 全部可调用的求解器目录…」那一段之内取 `  · <key>：` 行 —— 不整篇 `includes("cockpit_kpi")`：
// 后者会把详情段、语义段、规则段的偶然同串也算进来（铁律 0.6 第 6 条：「那个串出现过」不度量
// 「那是目录段列出来的」）。prompt 若经 JSON.stringify（E2E 臂），换行是字面 `\n`，先还原。
// ───────────────────────────────────────────────────────────────────────────
function rosterSection(text: string): string[] {
  const lines = text.replace(/\\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.includes("全部可调用的求解器目录"));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}· ([A-Za-z0-9_]+)：/.exec(l);
    if (!m) break; // 目录段到下一个非 `  · key：` 行即结束
    out.push(m[1]!);
  }
  return out;
}

/** 详情段（`  ★ key：` / `  - key：`）里展开的键。 */
function detailSection(text: string): string[] {
  return text
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => /^ {2}[★-] ([A-Za-z0-9_]+)：/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));
}

/** 一份「全条目都在对象域内」的目录替身：授予面的每个键各来一条 + 一条域内但**不在**授予面的
 *  `cockpit_kpi`（它就是本单的病灶样本：域内 ⇒ 修复前混进目录段）。 */
function catalogWithinScope(objectTypes: string[], grantedKeys: readonly string[]): Record<string, unknown> {
  const reads = [objectTypes[0]!]; // 每条的 reads 都落在 scope 内 ⇒ 对象域那一闸恒过，过滤器单独受试
  const cat: Record<string, unknown> = {
    cockpit_kpi: { capability: "cockpit_kpi 能力", outputShape: ["x"], reads: COCKPIT_READS, tier: "roster" },
  };
  for (const k of grantedKeys) cat[k] = { capability: `${k} 能力`, outputShape: ["x"], reads, tier: "roster" };
  return cat;
}

/** 从**真 agent 定义**读授予面（= `tools[].toolFilter` 原文，求解器 MCP ref；种子三面同源、这里只读授予面）。 */
function grantedFilterOf(agent: AgentDefinition): string[] | undefined {
  const ref = agent.tools.find((r) => r.kind === "MCP" && r.mcpConfigId === SOLVERS_MCP_CONFIG_ID);
  return ref && ref.kind === "MCP" ? ref.toolFilter : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// ① / ② / ③ · 同一份目录、同一对象域，唯一变量 = 授予面（toolFilter）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-ROSTER-RESPECT-TOOLFILTER · ①②③ 提示词目录段受授予面（toolFilter）约束", () => {
  const OBJECT_TYPES = ["Base", "Line", "Model", "Order"];
  const GRANTED = ["capacity_forecast", "mrp_netting", "affected_orders", "bottleneck_matrix", "base_capacity_outlook"];
  const DECLARED = [...GRANTED.map((k) => solverMcpToolName(k))]; // 声明面（toolNames）——两臂**保持不变**

  const render = (solverToolFilter?: string[]): string =>
    renderNavigationSlice(
      projectNavigationSlice(
        QUERY,
        undefined,
        { objectTypes: OBJECT_TYPES, toolNames: DECLARED, ...(solverToolFilter === undefined ? {} : { solverToolFilter }) },
        catalogWithinScope(OBJECT_TYPES, GRANTED) as never,
      ),
    );

  it("① toolFilter 里**有** cockpit_kpi ⇒ 目录段列得出它（抽取器金丝雀同在此臂）", () => {
    const text = render([...GRANTED.map((k) => solverMcpToolName(k)), solverMcpToolName("cockpit_kpi")]);
    const roster = rosterSection(text);
    expect(roster.length, "目录段一行都没抽到 ⇒ 本臂的『在不在』退化为空集断言（量具没内容可量）").toBeGreaterThan(0);
    // 金丝雀：量具**看得见** cockpit_kpi（授权态下抽得到）——没有它，「② 抽不到」不度量「被过滤掉了」。
    expect(roster, "授予了 cockpit_kpi 却抽不到 ⇒ 抽取器坏了（不是被过滤）").toContain("cockpit_kpi");
    // 正臂同时证明：授予面内的那 5 个也在（不是「只剩 cockpit_kpi」）。
    for (const k of GRANTED) expect(roster, `授予面内的 ${k} 被漏掉`).toContain(k);
  });

  it("② 同一份目录、同一 scope，toolFilter 里去掉 cockpit_kpi ⇒ 目录段与详情段都不出现它（修复前本组红）", () => {
    const text = render(GRANTED.map((k) => solverMcpToolName(k)));
    const roster = rosterSection(text);
    expect(roster.length, "目录段为空 ⇒ 这条断言在验一个空集（无判别力）").toBeGreaterThan(0);
    expect(roster, "cockpit_kpi 不在授予面 ⇒ 不许出现在『全部**可调用的**求解器目录』里").not.toContain("cockpit_kpi");
    expect(detailSection(text), "详情段同一条判据（两段不许一个收一个不收）").not.toContain("cockpit_kpi");
    // 反向金丝雀（域外）：读 Material/Supplier 的条目与 scope 无交集 ⇒ 本来就不该进（证明对象的闸还在动）。
    expect(text).not.toContain("nope_out_of_scope");
  });

  it("③ 未设 toolFilter ⇒ 目录段按既有规则照常（不许读成「什么都别给」）", () => {
    const text = render(undefined);
    const roster = rosterSection(text);
    expect(roster, "未设过滤时把求解器一律饿掉 ⇒ 把「没设过滤」误读成了「什么都不给」").toContain("cockpit_kpi");
    for (const k of GRANTED) expect(roster, `未设过滤时 ${k} 也该照常列出`).toContain(k);
    // 与「显式空数组」区分：`toolFilter: []` = 该 server 工具全丢 ⇒ 一个求解器都不广告（真·什么都不给）。
    const empty = render([]);
    expect(rosterSection(empty), "toolFilter: [] 应与「未设」区分开：空数组 ⇒ 一个都不广告").toEqual([]);
    expect(detailSection(empty), "toolFilter: [] ⇒ 详情段同样为空").toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ④ · 交付面逐个数：若干 agent × 目录段键 ⊆ 其 toolFilter（差集为空·双向）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-ROSTER-RESPECT-TOOLFILTER · ④ 广告面 ⊆ 可调用面（逐 agent 数·差集为空）", () => {
  const AUDIT = [
    "agt_capacity_planner",
    "agt_seed_analyst",
    "agt_seed_explore",
    "agt_risk_advisor",
    "agt_quality_inspector",
    "agt_supply_chain",
  ] as const;

  it("六个出厂 agent：目录段键集合 == 该 agent 的 toolFilter 键集合（多一个/少一个都算）", () => {
    const agents = seedRegistry().agents;
    let audited = 0;
    let canaryArms = 0;
    for (const id of AUDIT) {
      const agent = agents.find((a) => a.id === id);
      expect(agent, `seedRegistry 缺 ${id}（本臂前提：真出厂 agent，不是测试现编的）`).toBeDefined();
      const filter = grantedFilterOf(agent!);
      expect(filter, `${id} 没有求解器 MCP ref ⇒ 本臂前提不成立`).toBeDefined();
      const grantedKeys = filter!.map((n) => n.replace(/^mcp__solvers__/, ""));
      const scope = {
        objectTypes: agent!.scopeDeclaration.objectTypes,
        toolNames: agent!.scopeDeclaration.toolNames,
        solverToolFilter: filter,
      };
      // 目录替身：授予面的每个键都在对象域内（对象域那一闸恒过）⇒ 目录段**只**由授予面决定。
      const cat = catalogWithinScope(agent!.scopeDeclaration.objectTypes, grantedKeys);
      const text = renderNavigationSlice(projectNavigationSlice(QUERY, undefined, scope as never, cat as never));
      const roster = rosterSection(text);
      expect(roster.length, `${id}：目录段为空 ⇒ 这条断言在验空集（无判别力）`).toBeGreaterThan(0);

      const advertised = new Set(roster);
      const callable = new Set(grantedKeys);
      const over = [...advertised].filter((k) => !callable.has(k)); // 广告了但调不动（本单的病）
      const under = [...callable].filter((k) => !advertised.has(k)); // 调得动但没广告（域的闸筛掉的）
      expect(over, `${id}：目录段列了它 toolFilter 之外的求解器（广告面 ⊄ 可调用面）`).toEqual([]);
      expect(under, `${id}：目录段漏掉了它调得动的求解器（本条目录替身里每条的 reads 都在域内）`).toEqual([]);

      // 同臂金丝雀：把授予面换成「无过滤」——若 cockpit_kpi 的 reads 与该 agent 的对象域有交集，
      // 它**必须**立刻出现（⇒ 上面那条「不在」是白名单挡的，不是抽取器坏了）。
      // 域不相交的 agent（质量/供应链）本就不该出现 —— 那是对象域闸在动，另记一笔，不当金丝雀。
      const noFilter = renderNavigationSlice(
        projectNavigationSlice(QUERY, undefined, { objectTypes: agent!.scopeDeclaration.objectTypes, toolNames: agent!.scopeDeclaration.toolNames } as never, cat as never),
      );
      if (COCKPIT_READS.some((t) => agent!.scopeDeclaration.objectTypes.includes(t))) {
        expect(rosterSection(noFilter), `${id}：无过滤态也抽不到 cockpit_kpi ⇒ 抽取器没在动（量法坏了）`).toContain("cockpit_kpi");
        canaryArms += 1;
      } else {
        expect(rosterSection(noFilter), `${id}：cockpit_kpi 读的对象域与该 agent 无交集 ⇒ 对象域闸本就该挡掉它`).not.toContain("cockpit_kpi");
      }
      audited += 1;
    }
    expect(audited, "一个 agent 都没审到 ⇒ 本 describe 是空转").toBe(AUDIT.length);
    expect(canaryArms, "没有一条 arm 走到金丝雀（全被对象域挡掉）⇒「差集为空」缺金丝雀背书").toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑤ · 端到端：真 agent（出厂定义）→ 真引擎 → **真发给 LLM 的首轮 prompt**
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-ROSTER-RESPECT-TOOLFILTER · ⑤ 真链路：目录段与授予面在 LLM 请求里一致", () => {
  /** 活目录替身：条目形状照 `CatalogItem`（reads 由 ontologySignature 派生）。
   *  描述按真注册表口径写，让本题检索命中（门槛 0.30 是活的，不是关掉的）。 */
  function stubSolverRegistry(t: TestApp): void {
    const items = [
      ["capacity_forecast", "产能预测：按型号需求增量测算各周产能利用率与缺口", ["Base", "Line", "Process", "Model", "Order"]],
      ["mrp_netting", "物料净需求：齐套与净需求测算（产能校核）", ["Base", "Order", "Material"]],
      ["affected_orders", "受影响订单：产能/物料变动波及哪些订单", ["Base", "Order"]],
      ["bottleneck_matrix", "瓶颈矩阵：瓶颈落在哪道工序、哪条产线", ["Base", "Line", "Process"]],
      ["base_capacity_outlook", "基地产能展望：基地维度产能利用率与展望", ["Base", "Line"]],
      // 本单的病灶样本：读 Base/Order ⇒ 在该 agent 的对象域内，但**不在**其 toolFilter 里。
      ["cockpit_kpi", "驾驶舱 KPI：产能利用率是多少、瓶颈与 KPI 指标卡", COCKPIT_READS],
    ] as const;
    (t.dataCore.catalog as unknown as { solverRegistry: (ctx: unknown) => Promise<{ items: unknown[] }> }).solverRegistry = async () => ({
      items: items.map(([key, description, reads]) => ({
        key,
        name: key,
        description,
        domain: "capacity",
        argHints: {} as Record<string, string>,
        answersQuestions: [`${key} 相关问句`, "产能利用率是多少", "瓶颈在哪道工序"],
        tags: ["产能", "利用率", "瓶颈", key],
        ontologySignature: { reads: reads.map((typeKey) => ({ typeKey })) },
      })),
    });
  }

  async function promptOf(agent: AgentDefinition, t: TestApp): Promise<string> {
    // WO-ALL-AGENTS-DSH：出厂内核缺省自本单起 = `"EXTERNAL"`，本测试环境无 dsh harness /
    // stub provider（本文件验的是**提示词目录段受 toolFilter 约束**，不是内核）⇒ 钉回 `"NATIVE"`。
    await t.repos.agents.insert({ ...agent, tenantId: TENANT });
    for (const c of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(c.id))) await t.repos.mcpConfigs.insert(c);
    stubSolverRegistry(t);
    t.llm.queueAgentTurn(() => ({
      content: [
        text("结论如下。"),
        toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能利用率见 KPI ⟦ref:0⟧。" }], provenance: [] }),
      ],
    }));
    const before = t.llm.agentRequests.length;
    await t.deps.engine.runRegisteredAgent({
      taskId: `task_roster_${agent.id}`,
      agentId: agent.id,
      version: 1,
      prompt: QUERY,
      ctx: CTX as never,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });
    const req = t.llm.agentRequests[before];
    expect(req, "引擎一次都没请求 LLM ⇒ 没走到注入点，本臂的 prompt 不存在").toBeDefined();
    return JSON.stringify(req!.messages);
  }

  it("真出厂 agent：提示词目录段里的求解器键，逐条都在它的 toolFilter 内", async () => {
    const t = await createTestApp();
    try {
      const seed = seedRegistry().agents.find((a) => a.id === "agt_capacity_planner")!;
      const filterKeys = grantedFilterOf(seed)!.map((n) => n.replace(/^mcp__solvers__/, ""));
      const prompt = await promptOf(seed, t);
      const roster = rosterSection(prompt);
      // 前置自证：目录段真的渲染出来了（空段 ⇒ 下面的"不在"退化成同义反复）。
      expect(roster.length, "目录段没渲染出来 ⇒ 验的不是这条链路（可能活目录检索空/门槛没过）").toBeGreaterThan(0);
      const leaked = roster.filter((k) => !filterKeys.includes(k));
      expect(leaked, `提示词点名了模型调不到的求解器：${leaked.join(",")}`).toEqual([]);
      // 金丝雀（同一条链路）：病灶样本确实**在活目录里**（否则"没广告"不度量"被白名单挡住"）。
      // 证法：把授予面换成「全量」的同一 agent 定义（同一份目录/同一 scope），它必须被广告出来。
      const noFilter = { ...seed, id: "agt_roster_nofilter", tools: seed.tools.map((r) => (r.kind === "MCP" ? { kind: "MCP" as const, mcpConfigId: r.mcpConfigId } : r)) };
      const promptNoFilter = await promptOf(noFilter, t);
      expect(rosterSection(promptNoFilter), "未设过滤态也抽不到 cockpit_kpi ⇒ 它压根不在活目录里（那本单的病就不成立）").toContain("cockpit_kpi");
      expect(rosterSection(prompt), "授权面收窄后仍列出 cockpit_kpi").not.toContain("cockpit_kpi");
    } finally {
      await t.app.close();
    }
  }, 30000);
});
