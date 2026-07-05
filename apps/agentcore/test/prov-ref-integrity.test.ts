import { describe, expect, it } from "vitest";
import type { AnswerBlock, ProvenanceRef } from "@platform/contracts";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { GuardedToolExecutor } from "../src/tools/executor.js";
import { resolveNumericRefs } from "../src/util/prov-refs.js";
import { runWorkflow, summarizeSolverOutput } from "../src/workflow/executor.js";

/**
 * WO PROV-REF-INTEGRITY 齿检（审计簇⑥⑩·治死角标 + 单一 provId 泛化悬停·R13/G-3）：
 *  ① 模板/模型作者位数字索引 ⟦ref:n⟧ 在答案组装口解析成**真实 provId**（provenance[n].id）——
 *     前端 provIndex/悬停按 id 查条目，数字索引直出即 [0] 死角标恒『加载中…』（S01 [0][0][0]）。
 *     revert 齿：去掉 resolveNumericRefs 接线 → 文本残留 ⟦ref:数字⟧ → 本文件多处断言红。
 *  ② solver_summary 逐 KPI/表/叙事独立 provId + 字段级 outputPath（$.data.<field> 非恒 $.data）——
 *     悬停出该字段真路径；前端 testid=kpi-{provId} 随之唯一（原共用单 provId 撞车）。
 *  全确定性·无网络/时钟/LLM。
 */

const NUMERIC_REF = /⟦ref:\d+⟧/u;
const REF_ID_RE = /⟦ref:([^⟧]+)⟧/gu;

function refsIn(md: string): string[] {
  REF_ID_RE.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = REF_ID_RE.exec(md)) !== null) out.push(m[1]!);
  return out;
}

function textBlocks(blocks: AnswerBlock[]): string[] {
  return blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown);
}

/** 极简 runWorkflow 挽具：按工具名回放固定 payload（确定性·真走 renderAnswer/规则拦截全链）。 */
function makeHarness(payloads: Record<string, unknown>) {
  let seq = 0;
  const executor = {
    run: async (name: string) => ({
      ok: true,
      outcome: "OK" as const,
      toolCallId: `tc_${name}_${++seq}`,
      payload: payloads[name],
      durationMs: 1,
    }),
  } as unknown as GuardedToolExecutor;
  const deps = {
    executor,
    llm: {} as LlmClient,
    metrics: new Metrics(),
    composeModel: "mock",
    emit: async () => {},
  };
  const input = (steps: unknown[]) => ({
    steps: steps as never,
    slots: {},
    context: {},
    nesting: { callChain: [], budget: new BudgetTracker() },
  });
  return { deps, input };
}

describe("resolveNumericRefs（单一解析口·作者位数字索引 → 真实 provId）", () => {
  const prov: ProvenanceRef[] = [
    { id: "prov_A", toolCallId: "tc_1", toolName: "invoke_solver", outputPath: "$.data.p50", source: "TOOL_RESULT" },
    { id: "prov_B", toolCallId: "tc_1", toolName: "invoke_solver", outputPath: "$.data.p90", source: "TOOL_RESULT" },
  ] as ProvenanceRef[];

  it("⟦ref:0⟧⟦ref:1⟧ → 按下标解析成 provenance[n].id", () => {
    const [md] = textBlocks(resolveNumericRefs([{ type: "text", markdown: "P50 见 ⟦ref:0⟧，P90 见 ⟦ref:1⟧。" }], prov));
    expect(md).toBe("P50 见 ⟦ref:prov_A⟧，P90 见 ⟦ref:prov_B⟧。");
  });

  it("越界索引诚实摘除（连同前导空格）——不留点不出内容的假角标", () => {
    const [md] = textBlocks(resolveNumericRefs([{ type: "text", markdown: "缺口 3 套 ⟦ref:9⟧。" }], prov));
    expect(md).toBe("缺口 3 套。");
    expect(md).not.toContain("⟦ref:");
  });

  it("已是真实 provId 的标记原样保留；非 text 块不动", () => {
    const blocks: AnswerBlock[] = [
      { type: "text", markdown: "已锚定 ⟦ref:prov_X⟧。" },
      { type: "kpi", label: "P50", value: "120", provId: "prov_A" },
    ];
    const out = resolveNumericRefs(blocks, prov);
    expect(textBlocks(out)[0]).toBe("已锚定 ⟦ref:prov_X⟧。");
    expect(out[1]).toBe(blocks[1]);
  });
});

describe("① Path A renderAnswer：S01 形态模板（三 KPI + ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧）→ 三个真实 provId 按序对齐", () => {
  const capacitySteps = [
    {
      id: "s2",
      type: "invoke_solver",
      params: { solverKey: "capacity_forecast", args: {} },
    },
    {
      id: "render",
      type: "render_answer",
      params: {
        blocks: [
          { type: "kpi", label: "P50 产能", value: "{{steps.s2.output.data.p50}}", unit: "GWh", fromStep: "s2" },
          { type: "kpi", label: "P90 产能", value: "{{steps.s2.output.data.p90}}", unit: "GWh", fromStep: "s2" },
          { type: "kpi", label: "缺口比例", value: "{{steps.s2.output.data.gapPct}}", unit: "%", fromStep: "s2" },
          { type: "text", markdown: "主要瓶颈为{{steps.s2.output.data.mainBottleneck}}，P50/P90 与缺口见上方指标 ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧。" },
        ],
      },
    },
  ];

  it("角标=真溯源条目 id（悬停可出内容）·零数字索引残留（revert 齿）·KPI provId 唯一", async () => {
    const { deps, input } = makeHarness({
      invoke_solver: { data: { p50: 118.6, p90: 96.2, gapPct: 12.5, mainBottleneck: "化成" } },
    });
    const r = await runWorkflow(deps, input(capacitySteps));
    expect(r.status).toBe("COMPLETED");
    if (r.status !== "COMPLETED") return;
    const { answer } = r;
    const md = textBlocks(answer.blocks).join("\n");
    // 齿（revert 即红）：数字索引一个不许残留——残留即前端 [0] 死角标
    expect(md).not.toMatch(NUMERIC_REF);
    // 三个角标按序解析成 provenance[0..2].id，且每个 id 都真实存在于 provenance（悬停必出条目）
    const ids = refsIn(md);
    expect(ids).toEqual([answer.provenance[0]?.id, answer.provenance[1]?.id, answer.provenance[2]?.id]);
    for (const id of ids) {
      expect(id).toMatch(/^prov_/);
      expect(answer.provenance.some((p) => p.id === id)).toBe(true);
    }
    // KPI provId 唯一（前端 testid=kpi-{provId} 不撞车）
    const kpiIds = answer.blocks.filter((b) => b.type === "kpi").map((b) => (b as { provId: string }).provId);
    expect(new Set(kpiIds).size).toBe(kpiIds.length);
    // 齿②：显式 kpi 模板的纯绑定 {{steps.s2.output.data.p50}} → 字段级 outputPath（revert 恒 $.data 即红）
    expect(answer.provenance.map((p) => p.outputPath)).toEqual(["$.data.p50", "$.data.p90", "$.data.gapPct"]);
    expect(answer.unverifiedNumerics).toBe(false); // 数字全被真角标覆盖
  });

  it("规则拦截块（BLOCK 早退路径）：⟦ref:0⟧ → 违规条目真实 provId", async () => {
    const { deps, input } = makeHarness({
      evaluate_rules: [{ ruleId: "C03", passed: false, severity: "BLOCK", explanation: "需求增量超过 30% 上限" }],
    });
    const r = await runWorkflow(deps, input([{ id: "s3", type: "evaluate_rules", params: { ruleIds: ["C03"], payload: {} } }]));
    expect(r.status).toBe("COMPLETED");
    if (r.status !== "COMPLETED") return;
    const md = textBlocks(r.answer.blocks).join("\n");
    expect(md).not.toMatch(NUMERIC_REF);
    const ids = refsIn(md);
    expect(ids).toEqual([r.answer.provenance[0]?.id]);
    expect(r.answer.provenance[0]?.toolName).toBe("evaluate_rules");
  });
});

describe("② solver_summary 字段级溯源（逐 KPI 独立 provId + $.data.<field> 路径）", () => {
  const summarySteps = [
    { id: "s1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } },
    {
      id: "render",
      type: "render_answer",
      params: { blocks: [{ type: "solver_summary", output: "{{steps.s1.output}}", fromStep: "s1" }] },
    },
  ];
  const payload = {
    data: {
      p50: 118.6,
      p90: 96.2,
      gapPct: 12.5,
      feasible: true,
      rows: [
        { so: "SO-1", qty: 1200 },
        { so: "SO-2", qty: 800 },
      ],
      summary: "六周内 P90 口径存在缺口 1.2 GWh。",
    },
  };

  it("每 KPI 独立 provId（testid 唯一）·溯源条目 outputPath=字段级路径（revert 共用 $.data 即红）", async () => {
    const { deps, input } = makeHarness({ invoke_solver: payload });
    const r = await runWorkflow(deps, input(summarySteps));
    expect(r.status).toBe("COMPLETED");
    if (r.status !== "COMPLETED") return;
    const { answer } = r;
    const byId = new Map(answer.provenance.map((p) => [p.id, p]));

    const kpis = answer.blocks.filter((b) => b.type === "kpi") as { label: string; provId: string }[];
    expect(kpis.length).toBeGreaterThanOrEqual(4); // p50/p90/gapPct/feasible
    // 齿：provId 全体唯一（原案全 KPI 共用 1 个 → 前端 kpi-{provId} testid 撞车 + 悬停同一泛化 blob）
    expect(new Set(kpis.map((k) => k.provId)).size).toBe(kpis.length);
    // 齿：每 KPI 溯源条目存在且 outputPath 为字段级（$.data.<field>，绝非恒 $.data）
    const kpiPaths = kpis.map((k) => byId.get(k.provId)?.outputPath);
    for (const p of kpiPaths) {
      expect(p).toMatch(/^\$\.data\.\w+/u);
      expect(p).not.toBe("$.data");
    }
    expect(new Set(kpiPaths)).toEqual(new Set(["$.data.p50", "$.data.p90", "$.data.gapPct", "$.data.feasible"]));

    // 表块锚数组字段路径
    const table = answer.blocks.find((b) => b.type === "table") as { provId: string } | undefined;
    expect(table).toBeDefined();
    expect(byId.get(table!.provId)?.outputPath).toBe("$.data.rows");

    // summary 叙事段的角标 → $.data.summary 条目（真实 provId·非数字索引）
    const mds = textBlocks(answer.blocks);
    const summaryMd = mds.find((m) => m.includes("六周内"));
    expect(summaryMd).toBeDefined();
    expect(summaryMd).not.toMatch(NUMERIC_REF);
    const summaryRefs = refsIn(summaryMd!);
    expect(summaryRefs.length).toBeGreaterThan(0);
    expect(byId.get(summaryRefs[0]!)?.outputPath).toBe("$.data.summary");

    // 全答案零数字索引残留 + 每个角标 id 都能在 provenance 查到（悬停必出内容）
    for (const m of mds) {
      expect(m).not.toMatch(NUMERIC_REF);
      for (const id of refsIn(m)) expect(byId.has(id)).toBe(true);
    }
    expect(answer.unverifiedNumerics).toBe(false);
  });

  it("直调投影（记录 minter）：路径逐字段铸造·无孤儿条目（截断块不铸）·兼容字符串旧形态", () => {
    const minted: { id: string; path: string }[] = [];
    let n = 0;
    const mint = (path: string) => {
      const id = `prov_m${++n}`;
      minted.push({ id, path });
      return id;
    };
    const blocks = summarizeSolverOutput(payload, mint, "capacity_forecast");
    const usedIds = new Set<string>();
    for (const b of blocks) {
      if ("provId" in b) usedIds.add((b as { provId: string }).provId);
      if (b.type === "text") for (const id of refsIn(b.markdown)) usedIds.add(id);
    }
    // 铸出的每一条都被某块引用（无孤儿 provenance）
    for (const m of minted) expect(usedIds.has(m.id)).toBe(true);
    // 字段级路径真对应
    expect(minted.map((m) => m.path)).toContain("$.data.p50");
    expect(minted.map((m) => m.path)).toContain("$.data.rows");
    expect(minted.map((m) => m.path)).toContain("$.data.summary");
    // 旧字符串形态（存量单测）仍可用：全块共用同一 provId
    const legacy = summarizeSolverOutput(payload, "prov_shared", "capacity_forecast");
    const legacyIds = legacy.filter((b) => "provId" in b).map((b) => (b as { provId: string }).provId);
    expect(new Set(legacyIds)).toEqual(new Set(["prov_shared"]));
  });
});
