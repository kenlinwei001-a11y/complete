import { describe, expect, it } from "vitest";
import { type AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { SOLVERS_MCP_CONFIG_ID } from "../src/mcp/solvers-catalog.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";
import { projectNavigationSlice, renderNavigationSlice } from "../src/agent/navigation-slice.js";

/**
 * WO-MCP-TOP8-VS-ROSTER · 接缝判据：**广告面 ⊆ 运行时真授予面**。
 *
 * ══ 改前实测（真引擎链路·本文件同一台量具）══════════════════════════════════════
 * `agt_seed_analyst`（`tools[].toolFilter` = **16** 个求解器）走真 `runRegisteredAgent`，
 * 首轮发给 LLM 的请求里：
 *   · 目录段点名的求解器 **16**（自称「**全部可调用的**求解器目录」）；
 *   · `tools[]` 真带上的 `mcp__solvers__*` 只有 **6**（Phase6C `selectMcpTools` top-8，
 *     8 个名额里 2 个给了本体切片工具）：atp_check / base_capacity_outlook / bottleneck_matrix /
 *     capacity_forecast / kit_readiness / risk_timeline；
 *   · **差集 10 条**：affected_orders / credit_exposure / decision_play / finance_pnl /
 *     gap_attribution / generic_inference / metric_rollup / mrp_netting /
 *     supply_demand_gap_attribution / yield_diagnosis（改后为空，见 ②④）。
 * 被 deferred 的既不在模型 `tools` 里、`discover(kind:"mcp_tools")` 今天又返回空表
 * （按需加载模式未启用）⇒ **模型真的调不到**，而那句「任何一条你都能直接调用」在断言它们可调。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『它过了 toolFilter（配置允许调）』当作『模型拿到它了』的证据，而前者并不度量后者
 * > —— 模型面还被 Phase6C 相关性 top-k 收窄过一层。」**
 *
 * ══ 判据（逐条对应派单 §4）═════════════════════════════════════════════════════
 *  ① MCP 工具 ≤8 的 agent：目录段与可调用面**双向差集为空**（既有行为不许变）；
 *  ② MCP 工具 >8 的 agent：改前差集非空（**这就是病**）·改后空；
 *  ③ 对照实验：把某个被 deferred 的键**调进去**（改相关性输入）⇒ 它**从「不在目录段」变成「在」**
 *     （证明判据有牙，不是恒空）；
 *  ④ 反向：`可调用 − 广告` 也必须是空集（不许把调得动的从目录段抹掉）。
 *
 * ⚠ 否定结论必须配金丝雀：同一台抽取器在真链路上必须**抽得到**（目录段非空 + 授予面非空），
 *   否则「抽不到」与「抽取器坏了」在屏上一模一样。
 */

const CTX = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
/** 与 `arm-failure-visible.seam.test.ts` ⑦ / `roster-toolfilter.seam.test.ts` 同一句（活服务实测问句）。 */
const Q_CAPACITY = "常州基地当前的产能利用率是多少？瓶颈在哪道工序？";
/** ③ 对照实验的相关性输入：把 deferred 样本 `gap_attribution` 抬进 top-8 的那一句（实测取样得到）。 */
const Q_GAP = "缺口归因：把总缺口拆解到各驱动因子（gap attribution）";
/** ③ 的样本键：Q_CAPACITY 下被 deferred、Q_GAP 下被授予（两个臂都由同一次真链路实测断言）。 */
const CONTROL_KEY = "gap_attribution";

// ───────────────────────────────────────────────────────────────────────────
// 量具（与 `roster-toolfilter.seam.test.ts` 同一套抽取器：只在目录段标题之后取 `  · key：` 行）
// ───────────────────────────────────────────────────────────────────────────
function rosterSection(text: string): string[] {
  const lines = text.replace(/\\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.includes("全部可调用的求解器目录"));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}· ([A-Za-z0-9_]+)：/.exec(l);
    if (!m) break;
    out.push(m[1]!);
  }
  return out;
}

/** 同一份 LLM 请求里 `tools[]` 实际带上的求解器键（= `selectMcpTools` 的产出）。 */
function grantedSolverKeys(toolNames: string[]): string[] {
  return toolNames.filter((n) => n.startsWith("mcp__solvers__")).map((n) => n.replace(/^mcp__solvers__/, ""));
}

/** 从**真 agent 定义**读授予面（= `tools[].toolFilter` 原文，求解器 MCP ref）。 */
function grantedFilterOf(agent: AgentDefinition): string[] {
  const ref = agent.tools.find((r) => r.kind === "MCP" && r.mcpConfigId === SOLVERS_MCP_CONFIG_ID);
  return ref && ref.kind === "MCP" ? (ref.toolFilter ?? []) : [];
}

/**
 * 活目录替身（`CatalogItem` 形状；描述**逐键不同**，让相关性排序有真实区分度 = ③ 的前提）。
 * `reads` 全部落在 analyst / capacity_planner 的对象域内 ⇒ 对象域那一闸恒过，由授予面单独受试。
 */
const KEY_DESCS: Record<string, string> = {
  gap_attribution: "缺口归因：把总缺口拆解到各驱动因子与责任方（gap attribution）",
  decision_play: "决策打法：给出成套对策组合与优先级",
  metric_rollup: "指标汇总：跨层级指标滚动汇总与口径核对",
  credit_exposure: "信用敞口：新单是否使客户敞口超信用额度",
  finance_pnl: "财务损益：毛利与净利口径测算",
  supply_demand_gap_attribution: "供需缺口归因：需求端与供给端双向分摊总缺口",
  atp_check: "可承诺量：现货+在制+交期前可排产能校核",
  bottleneck_matrix: "瓶颈矩阵：瓶颈落在哪道工序、哪条产线",
  base_capacity_outlook: "基地产能展望：基地维度产能利用率与展望",
  generic_inference: "通用推演：沿派生 DAG 重算因子变动影响",
  capacity_forecast: "产能预测：按型号需求增量测算各周产能利用率与缺口",
  affected_orders: "受影响订单：产能/物料变动波及哪些订单",
  kit_readiness: "齐套就绪：物料齐套与净需求测算",
  risk_timeline: "风险时间线：未来 30 天延期风险最高的对象",
  mrp_netting: "物料净需求：MRP 净需求测算（产能校核）",
  yield_diagnosis: "良率诊断：工序良率异常定位与归因",
};

function stubRegistry(t: TestApp, keys: readonly string[]): void {
  (t.dataCore.catalog as unknown as { solverRegistry: (ctx: unknown) => Promise<{ items: unknown[] }> }).solverRegistry = async () => ({
    items: keys.map((key) => ({
      key,
      name: key,
      description: KEY_DESCS[key] ?? `${key}：能力说明`,
      domain: "capacity",
      argHints: {} as Record<string, string>,
      answersQuestions: [KEY_DESCS[key] ?? key, "产能利用率是多少", "瓶颈在哪道工序"],
      tags: ["产能", "利用率", "瓶颈", key],
      ontologySignature: { reads: ["Base", "Order", "Model", "Line", "Process"].map((typeKey) => ({ typeKey })) },
    })),
  });
}

/** 真链路：真 agent 定义 → 真引擎 → 首轮发给 LLM 的请求原文 + 目录段键。 */
async function runOnce(
  t: TestApp,
  agent: AgentDefinition,
  query: string,
  idSuffix: string,
): Promise<{ roster: string[]; granted: string[]; allToolNames: string[] }> {
  const def = { ...agent, id: `${agent.id}__${idSuffix}` };
  await t.repos.agents.insert({ ...def, tenantId: TENANT });
  for (const c of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(c.id))) await t.repos.mcpConfigs.insert(c);
  stubRegistry(t, grantedFilterOf(agent).map((n) => n.replace(/^mcp__solvers__/, "")));
  t.llm.queueAgentTurn(() => ({
    content: [
      text("结论如下。"),
      toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能利用率见 KPI ⟦ref:0⟧。" }], provenance: [] }),
    ],
  }));
  const before = t.llm.agentRequests.length;
  await t.deps.engine.runRegisteredAgent({
    taskId: `task_top8_${def.id}`,
    agentId: def.id,
    version: 1,
    prompt: query,
    ctx: CTX as never,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", def.id),
    emit: async () => {},
  });
  const req = t.llm.agentRequests[before];
  expect(req, "引擎一次都没请求 LLM ⇒ 没走到注入点，本臂的 prompt 不存在").toBeDefined();
  const toolNames = req!.tools.map((x) => x.name);
  return { roster: rosterSection(JSON.stringify(req!.messages)), granted: grantedSolverKeys(toolNames), allToolNames: toolNames };
}

/** 双向差集（多出来的 / 少掉的）。 */
function diff(a: string[], b: string[]): { over: string[]; under: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return { over: [...sa].filter((k) => !sb.has(k)), under: [...sb].filter((k) => !sa.has(k)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// ① MCP 工具 ≤8 的 agent：既有行为不许变（双向差集为空）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-MCP-TOP8-VS-ROSTER · ① ≤8 个 MCP 工具的 agent：目录段 == 可调用面", () => {
  it("agt_capacity_planner（5 求解器 + 本体切片面，≤8）：双向差集为空，且 == 其 toolFilter", async () => {
    const t = await createTestApp();
    try {
      const agent = seedRegistry().agents.find((a) => a.id === "agt_capacity_planner")!;
      const filterKeys = grantedFilterOf(agent).map((n) => n.replace(/^mcp__solvers__/, ""));
      expect(filterKeys.length, "前提：本 agent 的求解器授予面 ≤8（不触发 top-k 收窄）").toBeLessThanOrEqual(8);
      const { roster, granted, allToolNames } = await runOnce(t, agent, Q_CAPACITY, "arm1");

      // 金丝雀（量具活着）：目录段抽得到 + 工具面真带着求解器。
      expect(roster.length, "目录段一行都没抽到 ⇒ 量具没内容可量").toBeGreaterThan(0);
      expect(granted.length, "工具面一个求解器都没授予 ⇒ 前提不成立").toBeGreaterThan(0);
      // ≤8 ⇒ 不触发收窄：全部 MCP 工具都进了模型面（既有行为）。
      expect(allToolNames.filter((n) => n.startsWith("mcp__")).length, "≤8 条 MCP 工具却被收窄了").toBeLessThanOrEqual(8);

      const vsGrant = diff(roster, granted);
      expect(vsGrant.over, `目录段列了模型拿不到的：${vsGrant.over.join(",")}`).toEqual([]);
      expect(vsGrant.under, `调得动却没进目录段：${vsGrant.under.join(",")}`).toEqual([]);
      // 既有行为锚：目录段 = toolFilter 键集（与 WO-ROSTER-RESPECT-TOOLFILTER ④ 同一口径）。
      const vsFilter = diff(roster, filterKeys);
      expect(vsFilter.over, `目录段超出 toolFilter：${vsFilter.over.join(",")}`).toEqual([]);
      expect(vsFilter.under, `toolFilter 内的键没进目录段：${vsFilter.under.join(",")}`).toEqual([]);
    } finally {
      await t.app.close();
    }
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// ② + ④ MCP 工具 >8 的 agent（16 求解器 analyst）：差集必须为空（改前 10 条非空）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-MCP-TOP8-VS-ROSTER · ②④ >8 个 MCP 工具的 agent：广告面 ⊆ 可调用面 且 可调用 ⊆ 广告面", () => {
  it("agt_seed_analyst（16 求解器）：目录段键集 == 模型面求解器键集（双向差集为空）", async () => {
    const t = await createTestApp();
    try {
      const agent = seedRegistry().agents.find((a) => a.id === "agt_seed_analyst")!;
      const filterKeys = grantedFilterOf(agent).map((n) => n.replace(/^mcp__solvers__/, ""));
      // 前提自证：本 agent 就是「MCP 工具 >8」那一档（16 > 8）。
      expect(filterKeys.length, "前提：analyst 的求解器授予面必须 >8，否则本臂测的不是那条路").toBeGreaterThan(8);
      const { roster, granted, allToolNames } = await runOnce(t, agent, Q_CAPACITY, "arm2");

      expect(roster.length, "目录段一行都没抽到 ⇒ 量具没内容可量").toBeGreaterThan(0);
      expect(granted.length, "工具面一个求解器都没授予 ⇒ 前提不成立").toBeGreaterThan(0);
      // 前提自证：收窄**真的发生了**（求解器只剩 16 条里的一部分）。
      // ⚠ WO-BUILTIN-TO-DSH：`allToolNames` 里现在还多一件**不参与 top-k 的内置工具**
      // （`mcp__builtin__query_objects`，平台内置工具面按构造恒全量注入）⇒ 判据落回
      // 「**参与收窄的那一面**恰为 top-8」＝全 MCP 面 − 内置面，而不是全 MCP 面 == 8。
      const builtinFace = allToolNames.filter((n) => n.startsWith("mcp__builtin__"));
      expect(builtinFace.length, "内置工具面恰一件（豁免不计入 top-k 名额）").toBe(1);
      expect(
        allToolNames.filter((n) => n.startsWith("mcp__") && !n.startsWith("mcp__builtin__")).length,
        "参与收窄的 MCP 工具面没被截到 top-8 ⇒ 本臂前提不成立",
      ).toBe(8);
      expect(granted.length, "16 条求解器全进了工具面 ⇒ 收窄没生效").toBeLessThan(filterKeys.length);

      const d = diff(roster, granted);
      // ② 广告面 ⊆ 可调用面（改前：10 条非空 = 病）
      expect(d.over, `目录段点名了模型拿不到的求解器：${d.over.join(",")}`).toEqual([]);
      // ④ 反向：可调用 − 广告 = 空（不许把真授予的从目录段抹掉）
      expect(d.under, `模型拿得到却没进目录段：${d.under.join(",")}`).toEqual([]);
    } finally {
      await t.app.close();
    }
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// ③ 对照实验：换相关性输入 ⇒ 被 deferred 的键「从不在目录段变成在」（判据有牙）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-MCP-TOP8-VS-ROSTER · ③ 对照：把 deferred 的键调进去 ⇒ 它进目录段", () => {
  it("gap_attribution：Q_CAPACITY 下不在目录段（deferred）· Q_GAP 下在（granted）", async () => {
    const t = await createTestApp();
    try {
      const agent = seedRegistry().agents.find((a) => a.id === "agt_seed_analyst")!;
      const a = await runOnce(t, agent, Q_CAPACITY, "arm3a");
      const b = await runOnce(t, agent, Q_GAP, "arm3b");

      expect(a.roster.length, "改前臂目录段空 ⇒ 量具坏了").toBeGreaterThan(0);
      expect(b.roster.length, "对照臂目录段空 ⇒ 量具坏了").toBeGreaterThan(0);
      // A 臂：deferred（不在工具面）⇒ 不许在目录段 —— 抽取器在这一臂**看得见别的键**，
      // 故「抽不到它」不是量具坏了（同臂内 `bottleneck_matrix` 之类必在，见 ② 的 roster 非空 + 差集为空）。
      expect(a.granted, "前提：Q_CAPACITY 下 gap_attribution 应被 top-k 截掉（deferred）").not.toContain(CONTROL_KEY);
      expect(a.roster, `deferred 的 ${CONTROL_KEY} 却出现在目录段（广告面 ⊄ 可调用面）`).not.toContain(CONTROL_KEY);
      // B 臂：同一条真链路、同一个 agent，只换相关性输入 ⇒ 它被授予 ⇒ 它必须出现在目录段。
      expect(b.granted, "对照臂：换相关性输入后 gap_attribution 仍未进工具面 ⇒ 对照不成立（换一句）").toContain(CONTROL_KEY);
      expect(b.roster, `已授予的 ${CONTROL_KEY} 却没进目录段（④ 反向：可调用被抹掉）`).toContain(CONTROL_KEY);
    } finally {
      await t.app.close();
    }
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 投影层单向对拍：同一份目录/同一 scope，唯一变量 = 运行时授予面（缺省 ⇒ 不收窄 = 旧行为）
// ═══════════════════════════════════════════════════════════════════════════
describe("WO-MCP-TOP8-VS-ROSTER · 投影层：solverGrantedToolNames 缺省不收窄（旧行为）/ 显式收窄", () => {
  const KEYS = ["capacity_forecast", "gap_attribution", "yield_diagnosis"];
  const cat: Record<string, unknown> = Object.fromEntries(
    KEYS.map((k) => [k, { capability: `${k} 能力`, outputShape: ["x"], reads: ["Base"], tier: "roster" }]),
  );
  const render = (solverGrantedToolNames?: string[]): string[] =>
    rosterSection(
      renderNavigationSlice(
        projectNavigationSlice(Q_CAPACITY, undefined, {
          objectTypes: ["Base"],
          toolNames: ["invoke_solver"],
          ...(solverGrantedToolNames === undefined ? {} : { solverGrantedToolNames }),
        }, cat as never),
      ),
    );

  it("缺省 ⇒ 三条都在（旧行为）；显式只给一条 ⇒ 只剩它（另一条被收窄掉）", () => {
    expect(render(), "缺省（未传）时不该收窄").toEqual(expect.arrayContaining(KEYS));
    expect(render(["mcp__solvers__gap_attribution"])).toEqual(["gap_attribution"]);
    // 显式空数组 ⇒ 一条求解器都不广告（诚实缺席，与 toolFilter: [] 同语义）。
    expect(render([])).toEqual([]);
    // 金丝雀：不收窄那一臂看得见 KEYS —— 证明上面「只剩一条」是授予面挡的，不是抽取器坏了。
    expect(render(["mcp__solvers__gap_attribution"]).length, "收窄臂一条都没抽到 ⇒ 量具坏了").toBe(1);
  });
});
