import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ParetoRequestSchema, type ParetoRequest, type ParetoResult, type SimSession } from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import SandboxOptRoute, { resolveParetoRequest } from "@/views/sim/console/SandboxOptRoute";
import type { ConsoleSession } from "@/views/sim/console/useConsoleSession";

/**
 * ══ WO-SIM-PARAM-WIRE ① · 「方案寻优」页**宿主参数组装**的接缝门 ═════════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y ─────────────────────────────────────────────
 *
 * **X（改造前实测原文）**：`SandboxOptRoute.tsx` 旧第 29 行
 * `{...(p.paretoRequest ? { paretoRequest: p.paretoRequest } : {})}` —— `p` 是
 * `(view.options ?? {})` 的**裸 cast**：不校验形状、不补 `sessionId`、给什么透什么。
 * 配上 `useParetoFrontier.ts:618` 的 `const enabled = req !== undefined;`，
 * 于是「宿主不给 ⇒ 一个请求都不发 ⇒ 落 `PLACEHOLDER_OPT_MODEL`」。
 *
 * **Y（现在）**：宿主真的**组装**参数 —— 校验（真过契约）、补齐（`sessionId` ← 会话 scope）、
 * 拒绝（解析不出就一个请求都不发）。三件事各有一条用例咬。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每条用例都**真渲染适配层** `SandboxOptRoute`（= `registry.ts` 注册的那个默认导出），
 * 让它自己组装、自己发请求、自己落回，再读**屏上的诚实位**与**真发出去的请求体**。
 * 断言 `resolveParetoRequest()` 的返回值只出现在 ⓪ 金丝雀里（证判官可用），
 * **不作为通过判据** —— 那是"测函数"，本仓记过的假绿第 9 形态。
 *
 * ── 三条边各自的诚实位（不许拿一个盖另一个）─────────────────────────────────
 *   · 前沿图  `[data-testid="sandbox-opt"]`      `data-source` ← `useParetoFrontier(req)`
 *   · 执行对比 `[data-testid="sandbox-opt-grid"]` `data-source` ← `useExecutionCompare(sessionId)`
 *   · 会话     `[data-testid="sandbox-console-host"]` `data-session-reason` / `data-session-id`
 * 本门只判**第一条**；后两条由 `sandbox-host-wiring.seam.test.tsx` 守着，此处只做旁证。
 *
 * ── 变异反证（本门真会说话的证据，不是"我觉得它会红"）─────────────────────────
 * 把 `resolveParetoRequest` 里的 `ParetoRequestSchema.safeParse` 那两行换成
 * `const req = raw as ParetoRequest;`（= 改造前的裸透传），实测原文：
 * ```
 *   × ⓪ 金丝雀 → 坏形状被放行了: expected { family: 'multi_objective', …(1) } to be undefined
 *   × ③ 形状不对 → 坏形状的 request 被发出去了: expected [ Array(1) ] to deeply equal []
 *   Tests  2 failed | 3 passed (5)
 * ```
 * ①②④ 保持绿 ⇒ 变异**精确命中**校验这一条，没有连坐。
 *
 * R6 确定性：网络全桩、时间戳固定、无随机数、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物与桩
// ══════════════════════════════════════════════════════════════════════════

/** 每一条真发出去的请求（含 body 文本）。「发了几条」「body 里有没有 sessionId」全靠它。 */
let seen: { method: string; url: string; body: string }[] = [];

const record = async ({ request }: { request: Request }): Promise<void> => {
  // `request` 在 `request:start` 上还没被消费，clone 后读 body 不影响 handler。
  const body = request.method === "POST" ? await request.clone().text() : "";
  seen.push({ method: request.method, url: request.url, body });
};

const PARETO_RE = /\/a\/v1\/sim\/optimize-pareto$/;
const paretoCalls = (): { url: string; body: string }[] => seen.filter((r) => PARETO_RE.test(r.url));

const SESSION_RUNNING: SimSession = {
  id: "sims_running",
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  createdAt: "2026-08-02T00:00:00.000Z",
};

/**
 * 一份**合法**的 `ParetoRequest`：族 + 两目标 + 一根杠杆（三件套齐）。
 *
 * ⚠ 刻意**不带 `sessionId`** —— 这正是用例①要证明的那一格：宿主必须自己把
 * 会话 scope 里那条补进去（契约原话：`sessionId` 是 R6 确定性键的一部分）。
 * 杠杆 target 用 `objectives.<key>.weight`（`opt-whatif.ts` 的 DF.8 接地语法之一），
 * 与 `apps/datacore/test/opt-pareto.seam.test.ts` 的路由用例同形，两侧不各写一套。
 */
const MODEL: ParetoRequest = {
  family: "multi_objective",
  args: {
    vars: [{ id: "x", kind: "bool" }],
    constraints: [{ terms: [{ var: "x", coef: 1 }], op: "<=", rhs: 1 }],
    objectives: [
      { key: "ot", sense: "min", terms: [{ var: "x", coef: 1 }], weight: 0 },
      { key: "os", sense: "min", terms: [{ var: "x", coef: 1 }], weight: 0 },
    ],
    method: "weighted",
  },
  objectives: [
    { key: "days", dir: "min", label: "全链非增值天数", unit: "天" },
    { key: "cost", dir: "min", label: "外协成本", unit: "万元" },
  ],
  levers: [{ key: "objectives.ot.weight", label: "加班", values: [0, 8, 16] }],
};

/**
 * 端点回包：两个前沿解 + 一个被支配解。账是平的（`iterations = 2 + 1 + 0`）。
 *
 * 解的 `id` 刻意**不与规格占位数任何一个重名**（占位是 `S-00xx` / `D-xx`）——
 * 于是「屏上出现 `pareto_w=16`」这件事只可能来自端点，不可能来自占位表。
 * 只断 `data-source === "endpoint"` 是不够的：那一位可以被一个常量改绿。
 */
const RESULT: ParetoResult = {
  objectives: MODEL.objectives,
  frontier: [
    { id: "pareto_w=16", label: "加班=16", levers: [{ key: "objectives.ot.weight", value: 16 }], metrics: { days: 14, cost: 12 }, bindings: [], feasible: true },
    { id: "pareto_w=8", label: "加班=8", levers: [{ key: "objectives.ot.weight", value: 8 }], metrics: { days: 18, cost: 6 }, bindings: [], feasible: true },
  ],
  dominated: [
    { id: "pareto_w=0", label: "加班=0", levers: [{ key: "objectives.ot.weight", value: 0 }], metrics: { days: 30, cost: 12 }, bindings: [], feasible: true },
  ],
  iterations: 3,
  residual: 0,
  // WO-PARETO-AXES 新增的四格（本用例咬的是"宿主发不发请求"，不咬名次）。
  weights: { days: 1, cost: 1 },
  ranking: [
    { id: "pareto_w=16", rank: 1, score: 0.5 },
    { id: "pareto_w=8", rank: 2, score: 0.5 },
  ],
  recommendedId: "pareto_w=16",
  unavailableObjectives: [],
};

const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_seam" } }, { status });

function installHandlers(): void {
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [SESSION_RUNNING] })),
    http.post("*/a/v1/sim/optimize-pareto", () => HttpResponse.json(RESULT)),
    // WO-SIM-PARETO-MODEL-EXIT · 宿主在「显式模型缺席」时会向装配口要一份模型。
    // 本门测的是**显式那一路**，故这里显式桩成「装不出」：于是用例② 的
    // 「一个 optimize-pareto 都不发」量的仍然是同一件事（宿主没模型就不求解），
    // 而不是被一份自动装配出来的模型悄悄改成绿。自动那一路由
    // `sandbox-pareto-model-exit.seam.test.tsx` 单独咬。
    http.post("*/a/v1/sim/optimize-pareto/assemble", () =>
      HttpResponse.json({ applicable: false, missingRoles: ["order（本门不测自动装配）"], note: "本门显式桩" }),
    ),
    // 执行对比那一半与本门无关；显式桩成 404 让它**确定性**落占位，
    // 而不是靠 MSW 的未处理请求告警（那会在别的用例里变成噪声）。
    http.get("*/a/v1/sim/sessions/:id/metric-series", () => err(404, "NOT_FOUND")),
  );
}

const viewOf = (options?: Record<string, unknown>): ViewConfigVM => ({
  key: "sim-optimize",
  title: "sim-optimize",
  renderer: "sim-optimize",
  layout: undefined,
  options,
});

function mount(options?: Record<string, unknown>): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <SandboxOptRoute view={viewOf(options)} />
    </QueryClientProvider>,
  );
  return container;
}

const optSource = (root: HTMLElement): string | null =>
  root.querySelector('[data-testid="sandbox-opt"]')?.getAttribute("data-source") ?? null;

const hostReason = (root: HTMLElement): string | null =>
  root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-session-reason") ?? null;

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-PARAM-WIRE · 方案寻优页宿主参数组装（接缝）", () => {
  beforeEach(() => {
    seen = [];
    server.events.on("request:start", record);
    installHandlers();
  });
  afterEach(() => {
    server.events.removeListener("request:start", record);
    cleanup();
  });

  it("⓪ 金丝雀：装置与探针先自证（不中 ⇒ 报「工具坏了」，不许读作「接线对了」）", async () => {
    // (a) `MODEL` 真的合法 —— 否则用例① 的「发出去了」会因为**别的原因**红，
    //     而用例②③ 的「没发出去」会因为**同一个错误原因**绿，两头都读错。
    expect(ParetoRequestSchema.safeParse(MODEL).success, "装置里的 MODEL 自己就过不了契约").toBe(true);
    // (b) 判官会说话：坏形状必须真的被拒（恒返 undefined 的判官会让用例③空转）。
    const AUTO: ConsoleSession = { sessionId: "sims_running", reason: "auto", isLoading: false };
    const LOADING: ConsoleSession = { reason: "loading", isLoading: true };
    expect(resolveParetoRequest(MODEL, AUTO)?.sessionId, "补 sessionId 这一步没生效").toBe("sims_running");
    expect(resolveParetoRequest({ family: "multi_objective" }, AUTO), "坏形状被放行了").toBeUndefined();
    expect(resolveParetoRequest(undefined, AUTO), "缺席被放行了").toBeUndefined();
    expect(resolveParetoRequest(MODEL, LOADING), "会话还在路上就把 request 放行了（用例① 的『只发一条』会当场红）").toBeUndefined();

    // (c) 请求记录器：先证它**真记得到东西**，否则下面每一条「一个请求都没发」都是空转。
    expect(seen, "记录器起点必须干净").toHaveLength(0);
    await fetch("http://a.test/a/v1/sim/optimize-pareto", { method: "POST", body: '{"canary":1}' });
    expect(paretoCalls(), "记录器一条都没记到 ⇒ 记录器坏了，不是「没发请求」").toHaveLength(1);
    expect(paretoCalls()[0]?.body, "记录器记到了请求却没记到 body ⇒ 用例① 的 body 断言是空转").toContain("canary");

    // (d) 屏上探针选得到（选不到 ⇒ 读出来恒 null、恒不等于 "endpoint"，用例② 会因错误原因变绿）。
    const root = mount();
    await waitFor(() => expect(optSource(root), '探针 [data-testid="sandbox-opt"] 选不到元素').not.toBeNull());
  });

  it("① 正向整条缝：宿主组装参数 → 发请求 → 端点回真数据 → data-source 翻 endpoint", async () => {
    const root = mount({ paretoRequest: MODEL });

    // 先等宿主定态再读诚实位（顺序反了会把"还没查完"读成"查完了"，
    // 同 `sandbox-host-wiring.seam.test.tsx` 用例① 被变异反证逼出来的那条顺序）。
    await waitFor(() => expect(hostReason(root), "宿主没查到那条 RUNNING 会话").toBe("auto"));
    await waitFor(() => expect(optSource(root), "前沿图诚实位没翻 endpoint").toBe("endpoint"));

    // ── 反向证据 1：这一位是**真发了请求**换来的，不是把常量改成了 "endpoint"。
    //    数量咬死 **1**（不是 ≥1）：会话还在路上时若照样组装，会先发一份**缺会话**的 request、
    //    列表回来后 `queryKey` 变了再发第二份 —— 一次开页两次求解，且第一份正是本单要消灭的
    //    那种"没带 R6 确定性键的解"。改造中实测原文：
    //      `AssertionError: 一条 optimize-pareto 都没发出去: expected [ … ] to have a length of 1 but got 2`
    //    这条断言就是那次红逼出来的，写成 `not.toHaveLength(0)` 会把它放过去。
    const calls = paretoCalls();
    expect(calls.map((c) => c.body), "optimize-pareto 发出去的份数不是 1").toHaveLength(1);

    // ── 反向证据 2：**宿主把会话 scope 补进了 body**。`MODEL` 自己不带 `sessionId`，
    //    body 里出现它 ⇒ 只可能是宿主组装时补的（契约：R6 确定性键的一部分）。
    const sent = JSON.parse(calls[0]!.body) as ParetoRequest;
    expect(sent.sessionId, "宿主没把会话 scope 补进 request（R6 确定性键缺一格）").toBe("sims_running");
    expect(sent.family, "模型部分被宿主改写了 —— 宿主只许补齐，不许改").toBe(MODEL.family);
    expect(sent.levers, "杠杆网格被宿主改写了").toEqual(MODEL.levers);
    expect(sent.objectives, "目标声明被宿主改写了").toEqual(MODEL.objectives);

    // ── 反向证据 3：**端点的解真的到了屏上**。这三个 id 不在规格占位表里，
    //    只可能来自回包 ⇒ 排除「诚实位翻了但画的还是占位数」这种半截接线。
    for (const id of ["pareto_w=16", "pareto_w=8"]) {
      expect(root.querySelector(`[data-testid="sandbox-opt-card-${id}"]`), `端点的前沿解 ${id} 没上屏`).not.toBeNull();
    }
    // 占位表那五张卡一张都不许还在（还在 = 两套数混在同一屏上）。
    expect(root.querySelector('[data-testid="sandbox-opt-card-S-0042"]'), "规格占位卡还留在屏上").toBeNull();
  });

  it("② 宿主没给模型 ⇒ 一个 optimize-pareto 都不发，data-source 仍是 placeholder", async () => {
    const root = mount(); // `view.options` 恒空 —— 这就是今天真实部署里的那一态

    await waitFor(() => expect(hostReason(root)).toBe("auto")); // 会话查得到，排除"卡在 loading"
    expect(optSource(root), "没给模型却报了 endpoint").toBe("placeholder");
    expect(paretoCalls().map((c) => c.url), "没给模型还是把请求发出去了").toEqual([]);
  });

  it("③ 宿主给的模型**形状不对** ⇒ 仍然一个请求都不发（不补默认、不发必然 400 的请求）", async () => {
    // 单目标：违反 `ParetoRequestSchema.objectives.min(2)`。
    // 契约注释原话：「允许 1 个目标只会让调用方以为自己在做权衡分析，而其实没有」。
    // ⚠ 这一条是本单**唯一会退化**的那一半：改造前这份坏 request 会被原样透下去、
    //   真发出去、换回 400、再被 hook 静默吞成占位 —— 屏上与用例② 长得一模一样。
    const BAD = { ...MODEL, objectives: [MODEL.objectives[0]] };
    expect(ParetoRequestSchema.safeParse(BAD).success, "装置里的 BAD 居然是合法的 ⇒ 本用例在测别的东西").toBe(false);

    const root = mount({ paretoRequest: BAD });
    await waitFor(() => expect(hostReason(root)).toBe("auto"));
    expect(optSource(root)).toBe("placeholder");
    expect(paretoCalls().map((c) => c.body), "坏形状的 request 被发出去了").toEqual([]);

    // 杠杆一根都没有（违反 `levers.min(1)`）—— 另一条必填边，同样不许发。
    cleanup();
    seen = [];
    const root2 = mount({ paretoRequest: { ...MODEL, levers: [] } });
    await waitFor(() => expect(hostReason(root2)).toBe("auto"));
    expect(optSource(root2)).toBe("placeholder");
    expect(paretoCalls().map((c) => c.body), "空杠杆网格的 request 被发出去了").toEqual([]);
  });

  it("④ 宿主显式给的 sessionId **优先**，不被自动查到的那条覆盖（显式 > 自动）", async () => {
    const root = mount({ paretoRequest: { ...MODEL, sessionId: "sims_explicit" } });

    await waitFor(() => expect(optSource(root)).toBe("endpoint"));
    const calls = paretoCalls();
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]!.body) as ParetoRequest;
    expect(sent.sessionId, "宿主把显式指定的会话覆盖成了自动查到的那条").toBe("sims_explicit");
  });
});
