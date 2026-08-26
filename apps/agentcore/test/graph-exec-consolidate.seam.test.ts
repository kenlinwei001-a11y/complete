import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ComposePlan } from "@platform/contracts";
import { executePlan } from "../src/router/execute-plan.js";
import { runParallelRoutes } from "../src/router/multi-route.js";
import { runLayeredGraph } from "../src/skill-orchestrator.js";
import type { DomainRoute } from "../src/router/domain-resolver.js";
import type { GuardedToolExecutor, ToolRunResult } from "../src/tools/executor.js";
import type { LlmClient } from "../src/llm/types.js";

/**
 * WO-GRAPH-EXEC-CONSOLIDATE · 图/扇出执行收编接缝测试
 *
 * 本单的验收判据是**「少了几套」**，不是「新的那套多好」——上一单加了第四套（GraphScheduler）
 * 而没收编前三套，分歧从 3 变成 4。所以这份文件里最重要的不是 T1/T2，是 **T3 那道数**：
 * 它现算「仓里还有几处独立的并发派发实现」并逐文件具名断言。下次有人再加一套，**机器先说话**。
 *
 * ⚠️ 金丝雀与主逻辑**共用同一份 `scanFanoutSites`**（不是各抄一份正则）——抄了就是装饰品：
 * 改主正则时金丝雀拿旧的去测、照样绿。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 扫描器（**唯一实现**·真扫与金丝雀共用）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 剥注释与字符串字面量。**这一步不是可选的**：本仓源码注释里到处写着 `Promise.all`
 * （execute-plan.ts / multi-route.ts 的文件头注释就有），不剥就会把「注释里提了一嘴」
 * 数成「代码里又写了一套」——正是「我用 X 当作 Y 的证据，而 X 并不度量 Y」那个形态。
 * 保留换行以维持行号对齐。
 */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "block" | "line" | '"' | "'" | "`" = "code";
  while (i < src.length) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "*") {
        mode = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && d === "/") {
        mode = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        mode = c;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") {
        mode = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += "\n";
        i++;
        continue;
      }
      out += " ";
      i++;
      continue;
    }
    // 字符串字面量内：转义整体跳过，同引号收尾
    if (c === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if (c === mode) {
      mode = "code";
      out += c;
      i++;
      continue;
    }
    out += c === "\n" ? "\n" : " ";
    i++;
  }
  return out;
}

/**
 * **并发派发原语**——「一处独立扇出实现」的机器判据。
 * 用 `\.\s*` 而非裸串，避免 `PromiseAll` / `Promise.allocate` 这类误咬（负金丝雀验此）。
 */
const FANOUT_PRIMITIVE = /\bPromise\s*\.\s*(all|allSettled|race|any)\s*\(/g;

/** **线性计划执行器**签名——收编后仅存的第二套（`workflow/executor.ts` 的 `for…await` 串行）。 */
const SERIAL_PLAN_EXECUTOR = /\bfor\s*\(\s*const\s+step\s+of\s+input\.steps\s*\)/g;

export interface FanoutSite {
  line: number;
  primitive: string;
}

/** 扫一份源码里的并发派发原语（已剥注释/字符串）。**真扫与金丝雀共用这一个函数**。 */
export function scanFanoutSites(source: string): FanoutSite[] {
  const code = stripCommentsAndStrings(source);
  const out: FanoutSite[] = [];
  FANOUT_PRIMITIVE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FANOUT_PRIMITIVE.exec(code)) !== null) {
    out.push({ line: code.slice(0, m.index).split("\n").length, primitive: m[0].replace(/\s+/g, "") });
  }
  return out;
}

/** 扫线性计划执行器签名（同样先剥注释）。 */
export function scanSerialPlanExecutor(source: string): FanoutSite[] {
  const code = stripCommentsAndStrings(source);
  const out: FanoutSite[] = [];
  SERIAL_PLAN_EXECUTOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SERIAL_PLAN_EXECUTOR.exec(code)) !== null) {
    out.push({ line: code.slice(0, m.index).split("\n").length, primitive: "for(const step of input.steps)" });
  }
  return out;
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const AGENTCORE_SRC = join(HERE, "..", "src");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** 全 agentcore src 现算：文件 → 该文件里的并发派发原语条数。扫描面**是整个 src**，不是几个点名文件 —— */
/*  「门 RC=0 不度量被守的东西干净」的老坑正是扫描面选窄了。 */
function scanRepoFanout(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of walkTs(AGENTCORE_SRC)) {
    const hits = scanFanoutSites(readFileSync(f, "utf8"));
    if (hits.length > 0) map[relative(AGENTCORE_SRC, f).split("\\").join("/")] = hits.length;
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// T3 · 收编计数（**本单最重要的一条**）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 交单时实测的全部并发派发站点（`file → 条数`）。**逐条标了角色**——
 * 只有 `graph-exec` 才算「一套图/扇出执行实现」，其余是并读/超时竞速/通用有界并发助手。
 *
 * 收编前（merge-base 9945e77c 实测）`graph-exec` 有 **3** 处并发实现：
 *   · `skill-orchestrator.ts` 1 条（GraphScheduler 内联 allSettled）
 *   · `router/execute-plan.ts` 1 条（组内 Promise.all）
 *   · `router/multi-route.ts`  1 条（多域 Promise.all）
 * 收编后只剩 `skill-orchestrator.ts` 的 `runLayeredGraph`（2 条 = 同一个函数里 propagate/capture 两个分支）。
 */
const EXPECTED_FANOUT: ReadonlyArray<{ file: string; count: number; role: string; why: string }> = [
  {
    file: "agent/loop.ts",
    count: 1,
    role: "bounded-map-helper",
    why: "mapLimit 的 worker 池——派发的是**同一轮 LLM 回合里的 tool_use 块**，不是计划节点；且在本单 🚦 范围外（agent/**），未收",
  },
  { file: "dril/resource-registry.ts", count: 1, role: "data-read", why: "并读各 package 的 intents，非执行派发" },
  { file: "resources.ts", count: 1, role: "data-read", why: "并读各 package 的 plans，非执行派发" },
  { file: "server.ts", count: 3, role: "data-read + timeout-race", why: "2 条 Promise.race 是超时竞速；1 条 Promise.all 并读场景闭包" },
  {
    file: "skill-orchestrator.ts",
    count: 2,
    role: "graph-exec",
    why: "**仓内唯一的图/扇出调度实现** runLayeredGraph；2 条 = propagate(Promise.all) / capture(allSettled) 两个分支，同一函数",
  },
  { file: "skill-probe.ts", count: 1, role: "timeout-race", why: "探针超时竞速，非执行派发" },
];

describe("T3 · 收编计数金丝雀：仓里还剩几套独立扇出实现（机器守着的数）", () => {
  it("金丝雀·必咬：真实生产形状的扇出必须被扫到", () => {
    // 样例形状取自**生产实物**（收编前 multi-route.ts:210 的原文形状），不是手写单行。
    const positive = `
      const products: DomainProduct[] = await Promise.all(
        routes.map(async (route): Promise<DomainProduct> => {
          const run = await ctx.executor.run("invoke_solver", { solverKey: route.solverKey });
          return { route, ok: run.ok };
        }),
      );`;
    const hits = scanFanoutSites(positive);
    expect(hits.map((h) => h.primitive)).toEqual(["Promise.all("]);

    // allSettled 形状（收编前 skill-orchestrator.ts:155 原文）同样必咬。
    expect(scanFanoutSites("const settled = await Promise.allSettled(batch.map(run));").map((h) => h.primitive)).toEqual([
      "Promise.allSettled(",
    ]);
  });

  it("金丝雀·必不咬①：只出现在注释里的 Promise.all（本仓注释里真的到处都是）", () => {
    const commentOnly = `
      /**
       * 按 parallelGroup 升序：同组并发（\`Promise.all\`·无依赖）·组间串行。
       */
      // 原先这里自写 Promise.all(routes.map(...))，现已收编。
      const x = 1;`;
    expect(scanFanoutSites(commentOnly)).toEqual([]);
  });

  it("金丝雀·必不咬②：形近但不是并发原语的标识符", () => {
    expect(scanFanoutSites("const a = PromiseAll(x); const b = Promise.allocate(y); const c = MyPromise.always(z);")).toEqual([]);
  });

  it("金丝雀·必不咬③：字符串字面量里的 Promise.all", () => {
    expect(scanFanoutSites('const msg = "用 Promise.all 扇出"; const t = `跑 Promise.allSettled`;')).toEqual([]);
  });

  it("工具自证：扫描面真的扫到了东西（否定结论前先证明工具没瞎）", () => {
    const actual = scanRepoFanout();
    // 报「没有多余的扇出」之前先证明扫描器在真仓库上有命中——空集不许冒充「没问题」。
    expect(Object.keys(actual).length).toBeGreaterThan(0);
    expect(actual["skill-orchestrator.ts"]).toBeGreaterThan(0);
  });

  it("★ 收编数：agentcore src 里的并发派发站点逐文件具名对账（多一处未登记的即红并点名）", () => {
    const actual = scanRepoFanout();
    const expected = Object.fromEntries(EXPECTED_FANOUT.map((e) => [e.file, e.count]));
    // 逐文件全等——新增一处未登记的 Promise.all，这里当场变红并把文件名打在 diff 里。
    expect(actual).toEqual(expected);
  });

  it("★ 收编数：`graph-exec` 角色的并发实现**有且只有 1 处**（收编前是 3 处）", () => {
    const graphExec = EXPECTED_FANOUT.filter((e) => e.role === "graph-exec");
    expect(graphExec.map((e) => e.file)).toEqual(["skill-orchestrator.ts"]);

    // 且被收编的两个文件里**真的一条并发原语都不剩**（证明是「删除」不是「留着旧实现再包一层」）。
    const actual = scanRepoFanout();
    expect(actual["router/execute-plan.ts"]).toBeUndefined();
    expect(actual["router/multi-route.ts"]).toBeUndefined();
  });

  it("★ 剩余套数：1 处并发实现 + 1 处线性计划执行器 = 2 套（收编前 4 套）", () => {
    const serialFiles: string[] = [];
    for (const f of walkTs(AGENTCORE_SRC)) {
      if (scanSerialPlanExecutor(readFileSync(f, "utf8")).length > 0) {
        serialFiles.push(relative(AGENTCORE_SRC, f).split("\\").join("/"));
      }
    }
    // 金丝雀（必咬）：线性执行器签名的生产原文形状。
    expect(scanSerialPlanExecutor("  for (const step of input.steps) {\n    const started = Date.now();").length).toBe(1);
    expect(serialFiles).toEqual(["workflow/executor.ts"]);

    const graphExecConcurrent = EXPECTED_FANOUT.filter((e) => e.role === "graph-exec").length;
    expect(graphExecConcurrent + serialFiles.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 测试替身
// ═══════════════════════════════════════════════════════════════════════════════

/** 记录并发度的假 executor：每次 run 进出各记一笔，留下**峰值在飞数**。 */
function makeConcurrencyProbeExecutor(opts: {
  failSolverKeys?: string[];
  holdMs?: number;
}): { executor: GuardedToolExecutor; peakInFlight: () => number; order: string[] } {
  let inFlight = 0;
  let peak = 0;
  const order: string[] = [];
  let seq = 0;
  const executor = {
    async run(_toolName: string, input: unknown): Promise<ToolRunResult> {
      const solverKey = (input as { solverKey?: string }).solverKey ?? "?";
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push(`start:${solverKey}`);
      // 两跳微任务 + 一个宏任务：足以让同批任务真的重叠（不靠时钟，R6 无随机）
      await new Promise((r) => setTimeout(r, opts.holdMs ?? 5));
      inFlight--;
      order.push(`end:${solverKey}`);
      const failed = opts.failSolverKeys?.includes(solverKey) ?? false;
      return {
        ok: !failed,
        payload: failed ? { error: "TOOL_ERROR", message: "boom" } : { data: { echo: solverKey, n: ++seq }, snapshotVersion: "v1" },
        toolCallId: `tc_${solverKey}`,
        outcome: failed ? "ERROR" : "OK",
        durationMs: 1,
      };
    },
  } as unknown as GuardedToolExecutor;
  return { executor, peakInFlight: () => peak, order };
}

function route(domain: string, solverKey: string): DomainRoute {
  return { domain, route: solverKey, solverKey, args: {}, perDomainScore: 0.9, requiredArgs: [] };
}

const NO_LLM = {
  compose: async () => {
    throw new Error("no provider in test");
  },
} as unknown as LlmClient;

// ═══════════════════════════════════════════════════════════════════════════════
// T1 · 并行真的发生了（断言并发度，不是断言「函数被调了」）
// ═══════════════════════════════════════════════════════════════════════════════

describe("T1 · 走收编后的 runLayeredGraph，并行真的发生了", () => {
  it("multi-route 三域：峰值在飞数 = 3（层内真并发）", async () => {
    const { executor, peakInFlight } = makeConcurrencyProbeExecutor({});
    const routes = [route("yield", "yield_diagnosis"), route("capacity", "capacity_forecast"), route("lta", "lta_gap")];
    const { answer, plan } = await runParallelRoutes(routes, [], { executor });
    expect(peakInFlight()).toBe(3); // > 1 才算并行真发生
    expect(plan.selectedIntents.map((s) => s.intentKey)).toEqual(["yield", "capacity", "lta"]); // R6 声明序
    expect(answer.provenance.length).toBe(3);
  });

  it("execute-plan：同组并发（峰值 2）· 组间串行（后组开始时前组已结束）", async () => {
    const { executor, peakInFlight, order } = makeConcurrencyProbeExecutor({});
    const plan: ComposePlan = {
      planId: "p1",
      synthesizeBlocks: ["根因"],
      steps: [
        { stepId: "s1", solverKey: "a", parallelGroup: 0, args: {}, argsFrom: [], reads: [] },
        { stepId: "s2", solverKey: "b", parallelGroup: 0, args: {}, argsFrom: [], reads: [] },
        { stepId: "s3", solverKey: "c", parallelGroup: 1, args: {}, argsFrom: [], reads: [] },
      ],
    };
    const res = await executePlan(plan, { executor, llm: NO_LLM, model: "m", tenantId: "demo" });
    expect(peakInFlight()).toBe(2); // 组 0 的两步真并发
    // 组间串行：c 起跑时 a/b 都已结束。
    expect(order.indexOf("start:c")).toBeGreaterThan(order.indexOf("end:a"));
    expect(order.indexOf("start:c")).toBeGreaterThan(order.indexOf("end:b"));
    expect(res.stepCount).toBe(3);
  });

  it("runLayeredGraph 有界并发：concurrency=1 时同层退化为串行（峰值 1）", async () => {
    let inFlight = 0;
    let peak = 0;
    await runLayeredGraph<number>({
      layers: [["a", "b", "c"]],
      concurrency: 1,
      onNodeThrow: "propagate",
      runNode: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return 1;
      },
    });
    expect(peak).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2 · 一个分支失败时另几个怎么办 —— 收编前后语义**逐条一致**
// ═══════════════════════════════════════════════════════════════════════════════

describe("T2 · 失败语义：两种策略泾渭分明，且与收编前一致", () => {
  it("multi-route（continue·R7 单失败不塌）：一域失败，其余域照样出产物", async () => {
    const { executor } = makeConcurrencyProbeExecutor({ failSolverKeys: ["capacity_forecast"] });
    const routes = [route("yield", "yield_diagnosis"), route("capacity", "capacity_forecast"), route("lta", "lta_gap")];
    const { answer, plan } = await runParallelRoutes(routes, [], { executor });

    // 失败域诚实标「未计算」，另两域**没有被取消**。
    expect(plan.parallelResults.capacity?.ok).toBe(false);
    expect(plan.parallelResults.yield?.ok).toBe(true);
    expect(plan.parallelResults.lta?.ok).toBe(true);
    const md = answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("该域未计算");
    expect(answer.provenance.length).toBe(3); // 三域各一条溯源，失败域也不塌
  });

  it("execute-plan（continue·失败不掐下游）：组 0 失败，组 1 仍然执行", async () => {
    const { executor, order } = makeConcurrencyProbeExecutor({ failSolverKeys: ["a"] });
    const plan: ComposePlan = {
      planId: "p2",
      synthesizeBlocks: ["方案"],
      steps: [
        { stepId: "s1", solverKey: "a", parallelGroup: 0, args: {}, argsFrom: [], reads: [] },
        { stepId: "s2", solverKey: "b", parallelGroup: 1, args: {}, argsFrom: [{ fromStep: "s1", outputPath: "$.echo", toArg: "x" }], reads: [] },
      ],
    };
    const res = await executePlan(plan, { executor, llm: NO_LLM, model: "m", tenantId: "demo" });
    expect(order).toContain("start:b"); // ★ 下游**没有**被跳过（与 GraphScheduler 的毒化正相反）
    expect(res.products.find((p) => p.stepId === "s1")?.ok).toBe(false);
    expect(res.products.find((p) => p.stepId === "s2")?.ok).toBe(true);
    // 上游失败 ⇒ readOutputPath 取不到值 ⇒ 该 arg 不填（宁缺不臆造），但下游照跑。
    expect(res.products.find((p) => p.stepId === "s2")?.args).not.toHaveProperty("x");
  });

  it("GraphScheduler 策略（poison·毒化后继）：上游失败 ⇒ 后继整个跳过、兄弟照跑", async () => {
    const poisoned = new Set<string>();
    const ran: string[] = [];
    const edges: Record<string, string[]> = { up: ["down"] };
    const out = await runLayeredGraph<{ status: string }>({
      layers: [
        ["up", "sibling"],
        ["down"],
      ],
      onNodeThrow: "capture",
      captureThrow: () => ({ status: "FAILED" }),
      isSkipped: (id) => poisoned.has(id),
      skipped: () => ({ status: "SKIPPED" }),
      runNode: async (id) => {
        ran.push(id);
        return { status: id === "up" ? "FAILED" : "COMPLETED" };
      },
      settle: (id, r) => {
        if (r.status !== "COMPLETED") for (const d of edges[id] ?? []) poisoned.add(d);
      },
    });
    expect(ran).toEqual(["up", "sibling"]); // down 一次都没跑
    expect(out.get("sibling")?.status).toBe("COMPLETED"); // 同层兄弟不受株连
    expect(out.get("down")?.status).toBe("SKIPPED"); // 后继被毒化
  });

  it("onNodeThrow 两档语义不可混：propagate 整体上抛（≡Promise.all）· capture 转成产物（≡allSettled）", async () => {
    const boom = async (id: string): Promise<string> => {
      if (id === "b") throw new Error("boom");
      return id;
    };
    await expect(
      runLayeredGraph<string>({ layers: [["a", "b"]], onNodeThrow: "propagate", runNode: boom }),
    ).rejects.toThrow("boom");

    const captured = await runLayeredGraph<string>({
      layers: [["a", "b"]],
      onNodeThrow: "capture",
      captureThrow: (id, reason) => `caught:${id}:${(reason as Error).message}`,
      runNode: boom,
    });
    expect(captured.get("a")).toBe("a");
    expect(captured.get("b")).toBe("caught:b:boom");
  });

  it("落账顺序恒为**声明序**而非完成序（R6 确定性：网络抖动不改输出字节）", async () => {
    const settled: string[] = [];
    // 让 b 先于 a 完成，落账顺序仍须是 a,b。
    await runLayeredGraph<string>({
      layers: [["a", "b"]],
      onNodeThrow: "propagate",
      runNode: async (id) => {
        await new Promise((r) => setTimeout(r, id === "a" ? 8 : 1));
        return id;
      },
      settle: (id) => settled.push(id),
    });
    expect(settled).toEqual(["a", "b"]);
  });

  it("多域 domain 重名（⑤LLM 多意图路径）：产物按下标回排，不被同名域吞掉", async () => {
    const { executor } = makeConcurrencyProbeExecutor({});
    const routes = [route("dup", "solver_x"), route("dup", "solver_y")];
    const { plan, answer } = await runParallelRoutes(routes, [], { executor }, "llm-multi-intent");
    expect(plan.selectedIntents.map((s) => s.solverKey)).toEqual(["solver_x", "solver_y"]);
    expect(answer.provenance.map((p) => p.toolCallId)).toEqual(["tc_solver_x", "tc_solver_y"]);
  });
});
