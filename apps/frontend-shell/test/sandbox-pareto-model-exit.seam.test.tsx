import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  ParetoAssembleResultSchema,
  ParetoRequestSchema,
  type ParetoAssembleResult,
  type ParetoRequest,
  type ParetoResult,
  type SimSession,
} from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import SandboxOptRoute from "@/views/sim/console/SandboxOptRoute";

/**
 * ══ WO-SIM-PARETO-MODEL-EXIT · 「方案寻优」页**模型那一半**的接缝门（前端半）═══════
 *
 * ── 病灶：今天的行为是 X，应该是 Y ─────────────────────────────────────────────
 *
 * **X（实测·上一张单收工时的真实态）**：真浏览器打开页4，两个诚实位一真一假 ——
 * ```
 *   sandbox-opt=placeholder        ← 前沿图
 *   sandbox-opt-grid=endpoint      ← 执行对比甘特（已真）
 * ```
 * 原因不是"没接线"，而是**模型没人给**：宿主会校验、会补 `sessionId`、会拒坏形状，
 * 但 `view.options.paretoRequest` 全仓无人下发，而模型的唯一自动装配口在后端且
 * **没有出口**（`assembleBaselineFromSelection` 是 `private`，且只回 Δ目标不回 `args`）。
 *
 * **Y（现在）**：后端开了 `POST /a/v1/sim/optimize-pareto/assemble`。宿主
 * 「要范围 → 拿模型 → 原样求解」，前沿图的 `data-source` 因此翻 `endpoint`，
 * 规格占位卡从屏上消失。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每条用例都真渲染适配层 `SandboxOptRoute`（= `registry.ts` 注册的那个默认导出），
 * 让它自己发装配请求、自己把回包透给求解、自己落回。判据全部读**真发出去的请求体**
 * 与**屏上的诚实位/卡片**，不读任何内部函数返回值（本仓记过的假绿第 9 形态）。
 *
 * ── 与后端半的接缝怎么保证不漂 ─────────────────────────────────────────────────
 * 前端跑不起 DataCore，故装配回包由本门**用共享契约现造**（`ParetoAssembleResultSchema.parse`）——
 * 契约变了两侧同时红，这正是 `contracts-only-shared` 这条约定要买的东西。
 * 后端那半（真装配 → 真求解 → 真前沿）由 `apps/datacore/test/opt-pareto-assemble.seam.test.ts`
 * 用同一个 schema 咬住，两门共用一份契约，不各写一套形状。
 *
 * ── 变异反证（本门真会说话的证据）─────────────────────────────────────────────
 * 见报告 ⑤ 段：把 `SandboxOptRoute` 里 `applicable` 那一格的判断去掉（装不出也照发），
 * 用例 ② 当场红；把「装回来的那份再过一遍 `resolveParetoRequest`」去掉，用例 ③ 当场红。
 *
 * R6 确定性：网络全桩、无随机、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物与桩
// ══════════════════════════════════════════════════════════════════════════

let seen: { method: string; url: string; body: string }[] = [];

const record = async ({ request }: { request: Request }): Promise<void> => {
  const body = request.method === "POST" ? await request.clone().text() : "";
  seen.push({ method: request.method, url: request.url, body });
};

/** ⚠ 两条正则**必须互斥**：`/optimize-pareto` 是 `/optimize-pareto/assemble` 的前缀， */
/**   写成 `includes` 会把装配请求算进求解请求，于是「零求解请求」永远为假。 */
const SOLVE_RE = /\/a\/v1\/sim\/optimize-pareto$/;
const ASSEMBLE_RE = /\/a\/v1\/sim\/optimize-pareto\/assemble$/;
const solveCalls = (): { url: string; body: string }[] => seen.filter((r) => SOLVE_RE.test(r.url));
const assembleCalls = (): { url: string; body: string }[] => seen.filter((r) => ASSEMBLE_RE.test(r.url));

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
 * 服务端**装配出来的**那份模型。
 *
 * 形状照 `apps/datacore` 真跑出来的那份（族 `cross_object_occupancy`、目标带 `label` =
 * 出处、杠杆 target 是 `lines.<id>.capacity`），数值缩小成两根杠杆两档以便逐项断言。
 * ⚠ 刻意**不带 `sessionId`** —— 用例① 要证明宿主仍然自己补那一格（R6 确定性键）。
 */
const ASSEMBLED: ParetoRequest = ParetoRequestSchema.parse({
  family: "cross_object_occupancy",
  args: {
    orders: [{ id: "o1", revenue: 100, penalty: 50, qty: 12 }, { id: "o2", revenue: 60, penalty: 5, qty: 8 }],
    lines: [{ id: "c1", capacity: 20 }, { id: "c2", capacity: 10 }],
    contracts: [],
    eligibility: [
      { order: "o1", line: "c1", cost: 5 }, { order: "o1", line: "c2", cost: 3 },
      { order: "o2", line: "c1", cost: 5 }, { order: "o2", line: "c2", cost: 3 },
    ],
    seed: 42,
  },
  objectives: [
    { key: "revenue", dir: "max", label: "TicketOrder.farePrice" },
    { key: "cost", dir: "min", label: "Coach.runCost" },
  ],
  levers: [
    { key: "lines.c1.capacity", label: "c1", values: [10, 20] },
    { key: "lines.c2.capacity", label: "c2", values: [10, 20] },
  ],
});

const ASSEMBLE_OK: ParetoAssembleResult = ParetoAssembleResultSchema.parse({
  applicable: true,
  request: ASSEMBLED,
  roles: [
    { role: "line", kind: "objectType", ref: "Coach" },
    { role: "order", kind: "objectType", ref: "TicketOrder" },
  ],
  unboundRoles: ["contract", "penalty"],
  note: "装配自本租户已发布本体",
});

const ASSEMBLE_MISS: ParetoAssembleResult = ParetoAssembleResultSchema.parse({
  applicable: false,
  missingRoles: ["cost（没有可产对类型，且 Coach 上没有命中成本词库的数值字段）"],
  note: "只接地到 1 个真目标",
});

/** 端点回包：解 id 刻意不与规格占位（`S-00xx`/`D-xx`）重名 ⇒ 屏上出现它只可能来自端点。 */
const RESULT: ParetoResult = {
  objectives: ASSEMBLED.objectives,
  frontier: [
    { id: "pareto_c1=20|c2=20", label: "c1=20 · c2=20", levers: [{ key: "lines.c1.capacity", value: 20 }, { key: "lines.c2.capacity", value: 20 }], metrics: { revenue: 160, cost: 8 }, bindings: [], feasible: true },
    { id: "pareto_c1=10|c2=10", label: "c1=10 · c2=10", levers: [{ key: "lines.c1.capacity", value: 10 }, { key: "lines.c2.capacity", value: 10 }], metrics: { revenue: 100, cost: 3 }, bindings: [], feasible: true },
  ],
  dominated: [
    { id: "pareto_c1=20|c2=10", label: "c1=20 · c2=10", levers: [{ key: "lines.c1.capacity", value: 20 }, { key: "lines.c2.capacity", value: 10 }], metrics: { revenue: 100, cost: 5 }, bindings: [], feasible: true },
  ],
  iterations: 4,
  residual: 1,
};

const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_seam" } }, { status });

function installHandlers(assembleBody: unknown, opts?: { assembleStatus?: number }): void {
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [SESSION_RUNNING] })),
    http.post("*/a/v1/sim/optimize-pareto/assemble", () =>
      opts?.assembleStatus && opts.assembleStatus !== 200
        ? err(opts.assembleStatus, "BOOM")
        // `assembleBody` 刻意是 `unknown` —— 这道门的一半价值就在于能喂**坏形状**
        // （服务端说装不出却夹带模型 / 字段缺失 / 类型不对）。若把形参收成 `JsonBodyType`，
        // 那几条用例连编译都过不去，等于把要测的东西从测试里删掉。
        // 故收窄放在**调用点**：MSW 只要求它是可序列化的 JSON，运行期由各用例自己负责。
        : HttpResponse.json(assembleBody as Parameters<typeof HttpResponse.json>[0]),
    ),
    http.post("*/a/v1/sim/optimize-pareto", () => HttpResponse.json(RESULT)),
    // 执行对比那一半与本门无关；显式桩成 404 让它**确定性**落占位。
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

describe("WO-SIM-PARETO-MODEL-EXIT · 宿主要范围 → 服务端装配 → 求解 → 前沿真上屏（接缝）", () => {
  beforeEach(() => {
    seen = [];
    server.events.on("request:start", record);
  });
  afterEach(() => {
    server.events.removeListener("request:start", record);
    cleanup();
  });

  it("⓪ 金丝雀：装置与探针先自证（不中 ⇒ 报「工具坏了」，不许读作「接线对了」）", async () => {
    installHandlers(ASSEMBLE_OK);
    // (a) 两条 URL 正则**真的互斥** —— 写反了「零求解请求」这句话就恒真，用例②③ 会空转变绿。
    seen = [
      { method: "POST", url: "http://a.test/a/v1/sim/optimize-pareto", body: "" },
      { method: "POST", url: "http://a.test/a/v1/sim/optimize-pareto/assemble", body: "" },
    ];
    expect(solveCalls().map((c) => c.url), "求解正则把装配请求也算进来了").toHaveLength(1);
    expect(assembleCalls().map((c) => c.url), "装配正则一条都没匹到").toHaveLength(1);
    seen = [];
    // (b) 装置里那份「装配回包」自己真的合法（否则用例① 会因别的原因红）。
    expect(ParetoAssembleResultSchema.safeParse(ASSEMBLE_OK).success).toBe(true);
    expect(ParetoRequestSchema.safeParse(ASSEMBLED).success, "装置里的 ASSEMBLED 自己过不了契约").toBe(true);
    // (c) 屏上探针选得到（选不到 ⇒ 恒 null、恒不等于 endpoint，用例② 会因错误原因变绿）。
    const root = mount();
    await waitFor(() => expect(optSource(root), '探针 [data-testid="sandbox-opt"] 选不到元素').not.toBeNull());
  });

  it("① 正向整条缝：宿主要范围 → 装配 → **原样求解** → data-source 翻 endpoint、占位卡消失", async () => {
    installHandlers(ASSEMBLE_OK);
    const root = mount(); // `view.options` 恒空 —— 这就是今天真实部署里的那一态

    await waitFor(() => expect(hostReason(root), "宿主没查到那条 RUNNING 会话").toBe("auto"));
    await waitFor(() => expect(optSource(root), "前沿图诚实位没翻 endpoint").toBe("endpoint"));

    // ── 反向证据 1：**要范围**这一步真发生了，且只发一次（会话还在路上就装配会发两次）。
    const asm = assembleCalls();
    expect(asm.map((c) => c.body), "装配请求的份数不是 1").toHaveLength(1);
    expect(JSON.parse(asm[0]!.body), "宿主没把会话 scope 当作范围递过去").toEqual({ sessionId: "sims_running" });

    // ── 反向证据 2：**模型一格没被宿主改写**，只补了 `sessionId`。
    const solves = solveCalls();
    expect(solves.map((c) => c.body), "求解请求的份数不是 1").toHaveLength(1);
    const sent = JSON.parse(solves[0]!.body) as ParetoRequest;
    expect(sent, "宿主改写了服务端装出来的模型（只许补齐不许改）").toEqual({ ...ASSEMBLED, sessionId: "sims_running" });

    // ── 反向证据 3：**端点的解真的到了屏上**（这两个 id 不在规格占位表里）。
    for (const id of ["pareto_c1=20|c2=20", "pareto_c1=10|c2=10"]) {
      expect(root.querySelector(`[data-testid="sandbox-opt-card-${id}"]`), `端点的前沿解 ${id} 没上屏`).not.toBeNull();
    }
    // ── 反向证据 4：**规格占位卡一张都不许还在**（还在 = 两套数混在同一屏上）。
    for (const id of ["S-0042", "S-0117", "S-0083"]) {
      expect(root.querySelector(`[data-testid="sandbox-opt-card-${id}"]`), `规格占位卡 ${id} 还留在屏上`).toBeNull();
    }
  });

  it("② 反向：服务端说装不出（applicable:false）⇒ **零求解请求** + data-source 仍是 placeholder", async () => {
    installHandlers(ASSEMBLE_MISS);
    const root = mount();

    await waitFor(() => expect(hostReason(root)).toBe("auto"));
    await waitFor(() => expect(assembleCalls(), "装配请求都没发出去 ⇒ 本用例在测别的东西").toHaveLength(1));
    expect(optSource(root), "装不出却报了 endpoint").toBe("placeholder");
    expect(solveCalls().map((c) => c.url), "装不出还是把求解请求发出去了（会换回一个必然 400）").toEqual([]);
    // 屏上仍是规格占位那一套（诚实位与内容一致，不是"位翻了内容没翻"）。
    expect(root.querySelector('[data-testid="sandbox-opt-card-S-0042"]'), "落占位却连占位卡都没有").not.toBeNull();
  });

  it("③ 装配回包**形状不对** ⇒ 同样零求解请求（不做部分修补、不发必然 400 的请求）", async () => {
    // 少了 `levers`（违反 `ParetoRequestSchema.levers.min(1)`）—— 服务端版本错位/代理改写的真实形态。
    const BROKEN = { applicable: true, request: { ...ASSEMBLED, levers: [] }, roles: [], unboundRoles: [], note: "x" };
    expect(ParetoAssembleResultSchema.safeParse(BROKEN).success, "装置里的 BROKEN 居然合法 ⇒ 本用例在测别的东西").toBe(false);
    installHandlers(BROKEN);
    const root = mount();

    await waitFor(() => expect(hostReason(root)).toBe("auto"));
    await waitFor(() => expect(assembleCalls()).toHaveLength(1));
    expect(optSource(root)).toBe("placeholder");
    expect(solveCalls().map((c) => c.body), "坏形状的模型被原样发去求解了").toEqual([]);
  });

  it("④ 装配这一跳自己失败（500）⇒ 零求解请求、保留占位（**不知道** ≠ 装不出，但处置相同：不发）", async () => {
    installHandlers(ASSEMBLE_OK, { assembleStatus: 500 });
    const root = mount();
    await waitFor(() => expect(hostReason(root)).toBe("auto"));
    await waitFor(() => expect(assembleCalls()).toHaveLength(1));
    expect(optSource(root)).toBe("placeholder");
    expect(solveCalls().map((c) => c.body)).toEqual([]);
  });

  it("⑤ 服务端说装不出**却夹带了一份模型** ⇒ 前端不许用它（`applicable` 这一格是判据不是装饰）", async () => {
    // 这一态在契约上不合法（`applicable:false` 那一支是 `strictObject`，多一格 `request` 就过不了），
    // 但**线上真会出现**：服务端版本比前端旧/新、代理拼包、缓存串包。
    // ⚠ 本用例是被变异反证逼出来的：原先只有 ②（干净的 applicable:false，回包里根本没有 request），
    //   把 `applicable` 那一格的判断删掉照样绿 —— 因为"没有 request"这件事替它挡住了。
    //   两件事必须分开测：**「没给模型」和「说装不出却给了模型」是两个不同的命题。**
    const DISOWNED = { ...ASSEMBLE_MISS, request: ASSEMBLED };
    expect(ParetoAssembleResultSchema.safeParse(DISOWNED).success, "装置里的 DISOWNED 居然合法 ⇒ 本用例在测别的东西").toBe(false);
    installHandlers(DISOWNED);
    const root = mount();

    await waitFor(() => expect(hostReason(root)).toBe("auto"));
    await waitFor(() => expect(assembleCalls()).toHaveLength(1));
    expect(optSource(root), "服务端自己都说装不出，前端却拿它的夹带模型算了一条前沿").toBe("placeholder");
    expect(solveCalls().map((c) => c.body), "用了服务端已经声明「装不出」的那份模型去求解").toEqual([]);
  });

  it("⑥ 显式 > 自动：`view.options.paretoRequest` 有值 ⇒ 用它，**连装配口都不调**", async () => {
    installHandlers(ASSEMBLE_OK);
    const EXPLICIT: ParetoRequest = { ...ASSEMBLED, family: "cross_object_occupancy", levers: [{ key: "lines.c1.capacity", label: "c1", values: [10] }] };
    const root = mount({ paretoRequest: EXPLICIT });

    await waitFor(() => expect(optSource(root)).toBe("endpoint"));
    expect(assembleCalls().map((c) => c.url), "显式给了模型还去调装配口 ⇒ 白发一个请求，且优先级在网络层看起来是反的").toEqual([]);
    const sent = JSON.parse(solveCalls()[0]!.body) as ParetoRequest;
    expect(sent.levers, "显式模型被自动装配的那份覆盖了").toEqual(EXPLICIT.levers);
  });
});
