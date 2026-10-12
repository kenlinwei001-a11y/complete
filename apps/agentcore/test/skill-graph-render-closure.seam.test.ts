import { describe, expect, it } from "vitest";
import { compileGraph, SkillDefinitionSchema, SkillGraphSchema } from "@platform/contracts";
import { seedRegistry } from "../src/mocks/seed.js";
import { ADMIN, createTestApp, debugHeaders, type TestApp } from "./helpers.js";

/**
 * WO-SKILL-GRAPH-RENDER-CLOSURE · SEAM 接缝测试
 * 本体 §8 `G-SKILL-GRAPH-NO-RENDER-CLOSURE` · PRD-skill-runtime-orchestrator §0.4-R11
 *
 * ── 这条单为什么必须一次做两件事 ──────────────────────────────────────────────
 * 本体那一行自己写着：`render` 节点当时还是 `NOT_IMPLEMENTED`，此时强制 render 可达
 * ⇒ **任何图都编译不出来**。所以「实现 render 节点」与「补 R11 校验」只能同一单做：
 *   · 只补校验 → 把所有图编译废；
 *   · 只做节点 → 那道门还是没有，欠账照挂。
 * 本文件的接缝就跨在这两半之间：**编译期拒绝**（contracts/skill-graph.ts）
 * × **运行期真跑**（skill-orchestrator.ts 的 render 派发）× HTTP 路由 × 真实种子数据。
 * 任一半漏即红。
 *
 * ── 判据（不是「红了就行」）────────────────────────────────────────────────
 * 变异反证必须红在「**该拒的没拒**」上：把 R11 校验去掉 ⇒ T2/T3 必须由绿转红，
 * 且红的是 `expect(ok).toBe(false)`，**不是**「函数不见了 / 图跑不起来」。
 */

let t: TestApp;

async function runGraph(body: unknown, user = ADMIN): Promise<{ statusCode: number; json: () => unknown }> {
  t = await createTestApp();
  for (const s of seedRegistry().skills) await t.repos.skills.insert(s);
  return t.app.inject({
    method: "POST",
    url: "/b/v1/skill-graphs/run",
    headers: debugHeaders(user),
    payload: body as Record<string, unknown>,
  });
}

const g = (input: unknown): ReturnType<typeof SkillGraphSchema.parse> => SkillGraphSchema.parse(input);

// ---------------------------------------------------------------------------
// T1–T3 · 编译期：R11 是一道**有牙**的门
// ---------------------------------------------------------------------------

describe("T1/T2/T3 · compileGraph 的 R11 全链闭包校验", () => {
  it("T1 · 有 render 且每条链都汇进它 → 通过，并回报收口点", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "answer", kind: "render", params: { blocks: [] } },
        ],
        edges: [
          { from: "load", to: "solve" },
          { from: "solve", to: "answer" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renderNodeId).toBe("answer");
  });

  it("T2 · 没有 render 节点 → 拒绝，且错误点名图里有什么、缺什么（不是一句「R11 违规」）", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
        ],
        edges: [{ from: "load", to: "solve" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("RENDER_CLOSURE_MISSING");
    // 指认「是哪张图」：SkillGraph 契约上没有 id 字段，故用节点清单指认（含 kind，不只是 id）
    expect(r.message).toContain("load(skill)");
    expect(r.message).toContain("solve(solver)");
    // 说清「缺什么」+ 怎么修
    expect(r.message).toContain("render");
  });

  it("T3 · 有 render 但有链汇不进去 → 同样拒绝（证明咬的是**可达性**不是**存在性**）", () => {
    const r = compileGraph(
      g({
        nodes: [
          // 这条支线自己是入口，产物没有任何去处 —— 算了却进不了答案
          { id: "orphan", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "answer", kind: "render", params: { blocks: [] } },
        ],
        edges: [{ from: "solve", to: "answer" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("RENDER_CLOSURE_MISSING");
    // 红对地方：点名的是**走不到 render 的那个入口**
    expect(r.message).toContain("orphan");
    expect(r.message).toContain("answer");
  });

  it("T3' · 给 T3 那张图只加一条边（orphan→answer）→ 由拒转绿：可达性是唯一变量", () => {
    const nodes = [
      { id: "orphan", kind: "solver", params: { solverKey: "capacity_forecast" } },
      { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
      { id: "answer", kind: "render", params: { blocks: [] } },
    ];
    const before = compileGraph(g({ nodes, edges: [{ from: "solve", to: "answer" }] }));
    const after = compileGraph(
      g({ nodes, edges: [{ from: "solve", to: "answer" }, { from: "orphan", to: "answer" }] }),
    );
    // 节点一字未改，只多了一条边 ⇒ 前者拒、后者通
    expect(before.ok).toBe(false);
    expect(after.ok).toBe(true);
  });

  it("R11 之后仍不许把真病因盖掉：又有环又没 render → 报环，不报缺 render", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "a", kind: "solver" },
          { id: "b", kind: "solver" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CYCLIC_INVOCATION");
  });
});

// ---------------------------------------------------------------------------
// HTTP 层：编译期拒绝要走到调用方眼前（422 + 可读原因），不是在服务端咽掉
// ---------------------------------------------------------------------------

describe("R11 在 HTTP 入口的落点", () => {
  it("没收口的图 → 422 RENDER_CLOSURE_MISSING + 可读原因 + 统一错误信封", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
        ],
        edges: [{ from: "load", to: "solve" }],
      },
    });
    expect(res.statusCode).toBe(422);
    const err = res.json() as { error: { code: string; message: string; requestId?: string } };
    expect(err.error.code).toBe("RENDER_CLOSURE_MISSING");
    expect(err.error.message).toContain("render");
    expect(err.error.requestId).toBeTruthy(); // R7 错误信封统一
  });
});

// ---------------------------------------------------------------------------
// T4 · 端到端：render 节点**真的执行了**，不是 NOT_IMPLEMENTED
// ---------------------------------------------------------------------------

describe("T4 · 端到端：render 节点真的跑了，并产出可消费的答案形态", () => {
  it("★ 头号判据：求解器算出的**真值**流进了 render，产出带 provenance 的 Answer", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          {
            id: "solve",
            kind: "solver",
            params: {
              solverKey: "{{steps.load.output.solverKeys[0]}}",
              args: { modelId: "4680-NCM", weeks: 8 },
            },
          },
          {
            id: "answer",
            kind: "render",
            params: {
              blocks: [
                { type: "text", markdown: "产能推演结论" },
                // 值来自上游 solver 的真实产出（不是测试里写死的数）
                {
                  type: "kpi",
                  label: "产能 P50",
                  unit: "万",
                  value: "{{steps.solve.output.data.capWanP50}}",
                  fromStep: "solve",
                },
              ],
            },
          },
        ],
        edges: [
          { from: "load", to: "solve" },
          { from: "solve", to: "answer" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      layers: { index: number; nodeIds: string[] }[];
      nodeResults: { nodeId: string; kind: string; status: string; output?: unknown; error?: { code: string } }[];
    };
    expect(body.status).toBe("COMPLETED");

    const solve = body.nodeResults.find((r) => r.nodeId === "solve")!;
    const answer = body.nodeResults.find((r) => r.nodeId === "answer")!;

    // ① render 节点**真的跑了** —— 不是 NOT_IMPLEMENTED、不是 SKIPPED
    expect(answer.kind).toBe("render");
    expect(answer.status).toBe("COMPLETED");
    expect(answer.error).toBeUndefined();

    // ② 产出的是**可消费的答案形态**（QOS Answer 信封），不是一坨随便什么对象
    const out = answer.output as {
      trustLevel: string;
      blocks: { type: string; label?: string; value?: string; markdown?: string; provId?: string }[];
      provenance: { toolName: string; snapshotVersion?: string; outputPath: string }[];
      unverifiedNumerics: boolean;
    };
    expect(out.trustLevel).toBe("VERIFIED_WORKFLOW");
    expect(Array.isArray(out.blocks)).toBe(true);
    expect(out.blocks.map((b) => b.type)).toEqual(["text", "kpi"]);

    // ③ ★ 数据真的流过了边：KPI 上的值 = 上游求解器算出来的那个数（逐字相等）
    const solveData = (solve.output as { data: Record<string, unknown> }).data;
    expect(typeof solveData.capWanP50).toBe("number");
    const kpi = out.blocks.find((b) => b.type === "kpi")!;
    expect(kpi.value).toBe(String(solveData.capWanP50));
    expect(kpi.label).toBe("产能 P50");

    // ④ R13 可溯源：provenance 由 fromStep 生成，且认得出上游是求解器调用
    expect(out.provenance.length).toBe(1);
    expect(out.provenance[0]!.toolName).toBe("invoke_solver");
    expect(out.provenance[0]!.snapshotVersion).toBeTruthy();
    expect(kpi.provId).toBe((out.provenance[0] as unknown as { id: string }).id);

    // ⑤ 收口节点在最后一层（图确实以它结束）
    expect(body.layers[body.layers.length - 1]!.nodeIds).toEqual(["answer"]);
  });

  it("render 节点缺 params.blocks → 该节点 FAILED 并点名，不是静默产出空答案", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "answer", kind: "render", params: {} },
        ],
        edges: [{ from: "solve", to: "answer" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodeResults: { nodeId: string; status: string; error?: { code: string; message: string } }[] };
    const answer = body.nodeResults.find((r) => r.nodeId === "answer")!;
    expect(answer.status).toBe("FAILED");
    expect(answer.error?.message).toContain("blocks");
    // 「空答案」与「一切顺利」在界面上分不开 —— 所以这里必须是显式失败，不是产出一个空 Answer
  });

  it("render 只看得见祖先：没有边连过来的节点，它的数进不了答案（与模板作用域同一口径）", async () => {
    const res = await runGraph({
      graph: {
        nodes: [
          { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
          { id: "aside", kind: "solver", params: { solverKey: "capacity_forecast" } },
          {
            id: "answer",
            kind: "render",
            // 引用 aside，但图上没有 aside→answer 的边
            params: { blocks: [{ type: "text", markdown: "{{steps.aside.output.solverKey}}" }] },
          },
        ],
        edges: [
          { from: "solve", to: "answer" },
          // aside 也得收口，否则会先被 R11 拦下（那样就证不到本用例要证的东西）
          { from: "aside", to: "solve" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodeResults: { nodeId: string; status: string; visibleFrom?: string[] }[] };
    const answer = body.nodeResults.find((r) => r.nodeId === "answer")!;
    // aside 经 solve 间接成为 answer 的祖先 ⇒ 可见（传递闭包，不是只看直接前驱）
    expect(answer.visibleFrom).toEqual(["solve", "aside"]);
    expect(answer.status).toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// T5 · 存量图全集
// ---------------------------------------------------------------------------

describe("T5 · 存量图全集：今天仓里还有没有没收口的图", () => {
  /**
   * 实测结论（本单亲手，非转述）：**生产侧存量图 = 0 张**。
   *
   * 理由不是「我 grep 不到」，而是**结构上不可能有**：`SkillDefinitionSchema` 没有 `execution` 字段
   * ⇒ 没有任何 Skill 能携带自己的执行图，`GraphScheduler` 只能吃 HTTP 请求体里现传的图
   * （本体 §8 拟登记 `G-SKILL-EXEC-FIELD-ABSENT`，形态 =「接了线没数据」）。
   *
   * 这条断言是**机制不是注释**：等哪天有人给 `SkillDefinition` 加上 `execution`，
   * 它会当场变红，逼着那一单重做一次「存量图全集过 compileGraph」的盘点 ——
   * 而不是等着谁想起来。
   */
  it("金丝雀 + 判据：SkillDefinition 仍无 execution 字段 ⇒ 生产侧不存在「存量图」", () => {
    const keys = Object.keys(SkillDefinitionSchema.shape);
    // 金丝雀：抽取方式本身有效（已知必在的字段抽得到），否则下面的否定结论是空断言
    expect(keys).toContain("references");
    expect(keys).toContain("key");
    expect(keys.length).toBeGreaterThan(10);
    // 判据本体
    expect(keys).not.toContain("execution");
  });

  it("种子技能一张图都没带（同一口径复核，防「字段没有但别处塞了图」）", () => {
    const skills = seedRegistry().skills;
    // 金丝雀：种子里确实有技能，否则「零张图」是因为压根没数据
    expect(skills.length).toBeGreaterThan(0);
    const withGraph = skills.filter((s) => (s as unknown as { execution?: unknown }).execution !== undefined);
    expect(withGraph.map((s) => s.key)).toEqual([]);
  });
});
