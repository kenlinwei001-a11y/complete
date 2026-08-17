import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * WO-STATEVAR-DISPLAYNAME · 状态变量中文名的**接缝门**（前端这一半）。
 *
 * ── 头号判据：**改真值源 ⇒ 屏上那个词跟着变**（不是"字段存在"、不是"函数被调用了"）────────
 * 后端把名字放在 `synthetic/battery.ts` 的 `STATE_VAR_DISPLAY_NAMES`，经
 * `GET /sim/view-config` 与 `GET /sim/propagation-rules` 的 `stateVarNames` 字典下发。
 * 本文件在**响应这一层**换掉那个词，断言**屏上的字符串跟着换** —— 两端在契约字段处会师：
 *   · 后端「表 → 响应」由 `apps/datacore/test/statevar-display-name.seam.test.ts` 咬（含逐条对拍单源表）；
 *   · 前端「响应 → 屏上」由本文件咬。
 * 两支都绿 ⇒ 表里改一个词，屏上那个词真的会变。
 *
 * ── 变异反证（这条决定了本门是不是装饰品）────────────────────────────────────────
 * 把 `SandboxView.tsx` 里读名字那一步拆掉（`stateVarLabel(r.v, cfg.stateVarNames)` 改回裸 `{r.v}`）：
 * 本文件用例 ① 必须红在 **`负载指数` 找不到、屏上还是 `loadIndex`** 这句上，
 * **不是**红在「组件不见了 / 函数不存在 / testid 找不到」——
 * 红在后者只证明代码被删了，证明不了这条链在传名字。
 * 故本文件的断言一律落在**可见文本**上（`textContent`），并且**先断裸键在改名前后都在 testid 上**，
 * 以此把"组件还在"与"名字变了"两件事分开，红的时候一眼能看出是哪一件坏了。
 */

const tickFn = vi.fn();
vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  runSolver: vi.fn(async (key: string) =>
    key === "chain_impediments"
      ? {
          data: {
            scanId: "scan_test", scope: {}, impediments: [],
            counts: { total: 0, BOTTLENECK: 0, CONGESTION: 0, BREAK: 0 },
            unresolved: [], caveats: [], thresholds: [],
          },
          snapshotVersion: "ov-test",
        }
      : Promise.reject({ error: { code: "NOT_STUBBED", message: "本用例不桩该求解器", requestId: "req_test" } }),
  ),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (sessionId: string, n: number) => {
    tickFn(sessionId, n);
    return { curTick: n, state: { __mut: { v: 999 } } };
  }),
  simWorld: vi.fn(async () => ({ tick: 0, state: {} })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "tick1", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchSimCertification: vi.fn(async () => ({
    scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
    dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
    l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
    trialTick: { passed: false, rulesFired: 0, at: null, error: null },
    worldCompleteness: { pct: 55, stateVars: { present: 2, needed: 4 }, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, entering: [] },
    canEnterSimulation: false,
    gaps: [],
    computedAt: "2026-06-25T00:00:00.000Z",
  })),
}));

import SandboxView from "@/views/sim/SandboxView";
import { stateVarLabel, qualifiedStateVarText } from "@/views/sim/stateVarLabel";
import { buildEdgeRows, buildDiffRows } from "@/views/sim/edgeActiveModel";

/**
 * 一份**最小**沙盘配置：两个状态变量，一个**有**中文名、一个**没有**。
 * 两态并存是刻意的 —— 只测有名字那半，"诚实回落"就永远没被走到过（本仓反复吃过这个亏）。
 */
function cfgWith(stateVarNames: Record<string, string> | undefined): SandboxViewConfig {
  return {
    tenantId: "demo",
    nodeTypes: ["Base", "Line"],
    // 必须给已物化对象 id：`canPerturb` 要求 `perturbTargets` 非空，否则扰动区如实渲染
    // 「本体暂无已物化对象 ⇒ 扰动无处落点」而**不出下拉**（组件的诚实缺席分支，不是 bug）。
    // 用例 ④ 要断的是下拉里的文案，所以这里得先把世界喂成"有东西可扰动"。
    nodeObjectIds: { Base: ["obj_base_changzhou"], Line: ["obj_line_cz_01"] },
    linkTypes: ["line_belongs_to_base"],
    stateVars: ["loadIndex", "__unnamed_var__"],
    radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
    screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
    propagationCount: 1,
    stateVarNames,
  };
}

function wrap(cfg: SandboxViewConfig) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

/** 沙盘 KPI 里某个状态变量那一格的**可见文本**。 */
async function kpiText(stateVar: string): Promise<string> {
  const cell = await screen.findByTestId(`sandbox-kpi-${stateVar}`);
  return cell.textContent ?? "";
}

describe("WO-STATEVAR-DISPLAYNAME · 状态变量中文名真上屏（SEAM）", () => {
  afterEach(() => cleanup());

  it("① 🔴 头号判据：真值源里的词改了 ⇒ 沙盘 KPI 屏上那个词跟着变（不是断言字段存在）", async () => {
    // —— 第一版真值：loadIndex = 「负载指数」——
    wrap(cfgWith({ loadIndex: "负载指数" }));
    await screen.findByTestId("sandbox-view");
    expect(await kpiText("loadIndex")).toContain("负载指数");
    // 同时证明屏上**不再**是裸键（改前的病灶原样）。
    expect(await kpiText("loadIndex")).not.toContain("loadIndex");
    cleanup();

    // —— 换一版真值：同一个变量改名成「基地负荷」——
    // 只动**下发的那个词**，组件、配置结构、testid 全不动。
    wrap(cfgWith({ loadIndex: "基地负荷" }));
    await screen.findByTestId("sandbox-view");
    const after = await kpiText("loadIndex");
    expect(after, "改了真值源里的词，屏上那个词必须跟着变").toContain("基地负荷");
    expect(after).not.toContain("负载指数");
  });

  it("② 诚实回落：本体没登记中文名的变量**显裸键**，且回落态是可断言的（data-statevar-named=false）", async () => {
    wrap(cfgWith({ loadIndex: "负载指数" }));
    await screen.findByTestId("sandbox-view");

    // 有名字的那个：显中文 + 标记为"已命名"。
    const named = await screen.findByTestId("sandbox-kpi-loadIndex");
    expect(named.getAttribute("data-statevar-named")).toBe("true");

    // 没名字的那个：**显裸键本身**（不空白、不编名字），并如实标成回落。
    const unnamed = await screen.findByTestId("sandbox-kpi-__unnamed_var__");
    expect(unnamed.textContent ?? "").toContain("__unnamed_var__");
    expect(unnamed.getAttribute("data-statevar-named")).toBe("false");
  });

  it("③ 字典整个缺席（老响应/未接该字段的租户）⇒ 全部回落裸键，页面照常可用（additive 可回退）", async () => {
    wrap(cfgWith(undefined));
    await screen.findByTestId("sandbox-view");
    expect(await kpiText("loadIndex")).toContain("loadIndex");
    expect(await kpiText("__unnamed_var__")).toContain("__unnamed_var__");
  });

  it("④ 扰动落点下拉同样显人话名，但提交给引擎的 value 仍是**接线名**（改的是展示层，不是接线名）", async () => {
    wrap(cfgWith({ loadIndex: "负载指数" }));
    await screen.findByTestId("sandbox-view");

    const select = await screen.findByTestId("sandbox-perturbation-statevar");
    const opts = within(select).getAllByRole("option") as HTMLOptionElement[];
    const target = opts.find((o) => o.value === "loadIndex");
    expect(target, "下拉里应有 loadIndex 这一项").toBeDefined();
    // 屏上是中文……
    expect(target!.textContent ?? "").toContain("负载指数");
    // ……而 value 必须原样是接线名：这条一旦破，扰动会写到一个引擎不认识的键上，
    // 屏上看着变了、下游一动不动（本仓点名过的"静默错答"形态）。
    expect(target!.value).toBe("loadIndex");
  });

  it("⑤ 纯模型：传导边第一级 = 类型名 · 变量名；两段**各自独立**回落，不因一段缺名牵连另一段", () => {
    const mkRule = (sourceStateVar: string, targetStateVar: string) => ({
      id: "id_x", tenantId: "demo", key: "k", sourceTypeKey: "Base", sourceStateVar,
      viaLinkKey: "line_belongs_to_base", targetTypeKey: "Line", targetStateVar,
      coefficient: 1, delayTicks: 0, combine: "sum" as const, decay: null, clamp: null,
      coefficientRef: null, cadenceNodeId: null, status: "PUBLISHED" as const,
      domainKey: null, domainName: null,
      sourceTypeName: null as string | null, targetTypeName: null as string | null,
    });
    const typeNames = new Map([["Base", "生产基地"]]); // Line 故意没有类型名
    const varNames = { loadIndex: "负载指数" }; // utilPressure 故意没有变量名

    const [row] = buildEdgeRows(
      [mkRule("loadIndex", "utilPressure")], [], typeNames, varNames,
    );
    // 两段都有名 ⇒ 都显名。
    expect(row!.sourceLabel).toBe("生产基地 · 负载指数");
    // 类型名缺 + 变量名也缺 ⇒ 两段各自回落到自己的 key，**不是**整条退回裸串。
    expect(row!.targetLabel).toBe("Line · utilPressure");

    // 第二级系统键那一行原样保留（对账/深链接认它）。
    expect(row!.from).toBe("Base.loadIndex");
    expect(row!.to).toBe("Line.utilPressure");
  });

  it("⑥ 纯模型：差异表带人话名，但 stateVar 接线名原样保留（两者并存，不是替换）", () => {
    const [d] = buildDiffRows(
      [{ objectId: "obj_base_changzhou", stateVar: "loadIndex", baseline: 10, counterfactual: 12, delta: 2, direction: "up" }],
      { loadIndex: "负载指数" },
    );
    expect(d!.stateVarName).toBe("负载指数");
    expect(d!.stateVar).toBe("loadIndex"); // 排序/testid/对账全认它
  });

  it("⑦ 纯函数口径：空串按'没名字'处理；缺字典逐条回落（前端零中文名映射表）", () => {
    expect(stateVarLabel("loadIndex", { loadIndex: "负载指数" })).toEqual({
      text: "负载指数", named: true, key: "loadIndex",
    });
    // 后端不该下发空串；真下发了也不能让屏上出现一个看不见的标签。
    expect(stateVarLabel("loadIndex", { loadIndex: "" })).toEqual({
      text: "loadIndex", named: false, key: "loadIndex",
    });
    expect(stateVarLabel("loadIndex", undefined).named).toBe(false);
    expect(qualifiedStateVarText("Base", "loadIndex", undefined, undefined)).toBe("Base · loadIndex");
  });
});
