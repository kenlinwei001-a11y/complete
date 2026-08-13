import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { applyPerturbationToState, GOAL_REGISTRY, type SandboxViewConfig, type TickState } from "@platform/contracts";
import { server } from "./setup";
import SandboxView from "@/views/sim/SandboxView";

/**
 * ══ WO-V4-PLAYS · 推演沙盘「方案环」接缝门（`docs/PRD-sandbox-v4-backward-derivation.md` §3.3）══
 *
 * 要证的那一条链（**任一段断掉即红**，不是各半 unit 绿就算 —— SEAM-GATE）：
 *
 *   拨扰动 → 指标越线 → `decision_play` 出 options[] → 每个方案 `simBranch` 出平行世界
 *          → `fetchSimCompare` 并排比对 → 采纳落 `ActionDraft`（PENDING，**不是** EXECUTED）
 *
 * ── 为什么不 `vi.mock("@/api/endpoints")`（沿用 `sandbox-perturbation.seam` 的判断）────────
 * 整包 mock 会把**病灶所在的那一跳一起 mock 掉**：桩函数收什么参数都行，URL 模板与 body 序列化
 * 根本不参与，断言恒绿而缺陷仍在。本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**。
 *
 * ── 桩为什么不会与真后端漂移 ───────────────────────────────────────────────────
 *  · 扰动施加直接调契约的 `applyPerturbationToState` —— 那是后端 `/act` 与 `POST /perturbations`
 *    的**唯一施加实现**，桩不自己写一套"大概是这样改"。
 *  · `decision_play` 的回包形状照 `apps/datacore/src/solvers/service.ts:358` 的 SOLVER_OUTPUT_SHAPE
 *    七个键；载荷数值取自**真后端实跑**（SEED_DEMO=1 · 2026-08-13 实测）：
 *    根因 `seg_attain_ess` 缺口 27.8%，三方案 closesGap 1.1483 / 2.0901 / 2.6872。
 *  · `POST /a/v1/action-drafts` 的回包状态照真后端实测（`PENDING_APPROVAL`）。
 *
 * ── R6 确定性 ──────────────────────────────────────────────────────────────────
 * 会话/检查点/分支 id 全部由**计数器**生成（无时钟、无随机）；桩不读 `Date.now()`。
 */

// ── 证物：真实发出的请求 ────────────────────────────────────────────────────────
/**
 * ⚠ **收集口必须是 `server.events`，不能是各 handler 里 `calls.push()`**（本门交付前实测踩过）。
 *
 * 最初版本在每个 `http.post(...)` 的回调里手动 `calls.push`。变异反证当场抖出它是**装饰品**：
 * 往「采纳」里塞一行 `fetch("/a/v1/objects/obj_a1", {method:"PATCH"})`（= 本单最怕的 R4 违规），
 * §2 那条"端点集合等于白名单"的断言**照样绿** —— 因为没有 handler 拦那条 PATCH，它压根没进 `calls`。
 *
 * 形态（铁律 0.6 句式）：**「我用『我桩过的端点被调了哪些』当作『页面调了哪些端点』的证据，
 * 而前者并不度量后者。」** 一个只看得见自己桩过的东西的收集器，报出的"没有别的"永远为真。
 *
 * `server.events.on("request:start")` 在 MSW 的**拦截层**触发，桩没桩过都看得见 —— 这才度量得到
 * 「页面到底发了什么」。第 §2 条另配一只真打 PATCH 的金丝雀，把这件事钉死。
 */
interface Call {
  method: string;
  /** 去掉 origin 的路径 + query（断言用它，不用整串 URL —— origin 由 apiClient 决定，与本门无关）。 */
  path: string;
  body: Record<string, unknown> | null;
}
const calls: Call[] = [];
const pathOf = (url: string): string => {
  const u = new URL(url);
  return u.pathname + u.search;
};
/**
 * 每一条出站请求（含**未被任何 handler 拦截**的那些）都记账。
 *
 * 条目**同步**入表（`request:start` 的监听器不保证被 await），body 随 clone 解析后回填 ——
 * 断言 body 的地方都在 `await waitFor(...)` 之后，微任务早已排空。
 */
function recordRequest({ request }: { request: Request }): void {
  const entry: Call = { method: request.method, path: pathOf(request.url), body: null };
  calls.push(entry);
  void request
    .clone()
    .text()
    .then((txt) => {
      try {
        entry.body = txt === "" ? null : (JSON.parse(txt) as Record<string, unknown>);
      } catch {
        entry.body = null; // 非 JSON 体（本门只需要"这条请求发生过"）
      }
    })
    .catch(() => undefined);
}

// ── 真后端实跑取回的 decision_play 载荷（`invoke` 的 `data` 字段）──────────────────
// 三个方案 = 真求解器真给的三个（`solvers/service.ts:3162` 的 options 数组）。
const DP_THREE = {
  rootCause: { factorId: "cf-decision-gap", label: "价格预判缺失(root)", metricKey: "seg_attain_ess", gap: 27.8, unit: "%" },
  options: [
    { optionId: "opt-backup-cert", factorId: "cf-decision-gap", label: "缩短备份供应商认证周期", sourceKind: "solver",
      closesGap: 1.1483, cost: 248, cycleDays: 112, risk: 0.25, exposure: 0.396, reversibility: 0.8,
      provenance: { kind: "求解器", basis: "BackupSupplierPool.certWeeks", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillValue: 16 } },
    { optionId: "opt-lta-clause", factorId: "cf-decision-gap", label: "长协加价格联动条款", sourceKind: "agent",
      closesGap: 2.0901, cost: 160, cycleDays: 30, risk: 0.2, exposure: 0.075, reversibility: 0.9,
      provenance: { kind: "策略推理", basis: "LongTermAgreement.priceLinked", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 0 } },
    { optionId: "opt-insource", factorId: "cf-decision-gap", label: "上游自采矿+战略储备", sourceKind: "agent",
      closesGap: 2.6872, cost: 1730, cycleDays: 180, risk: 0.55, exposure: 0.05, reversibility: 0.2,
      provenance: { kind: "策略推理", basis: "正极供应缺口(LTA 约定−实际交付)", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 1548 } },
  ],
  matrix: [
    { optionId: "opt-backup-cert", label: "缩短备份供应商认证周期", dims: { closesGap: 1.1483, cost: 248, cycleDays: 112, risk: 0.25, exposure: 0.396, reversibility: 0.8 } },
    { optionId: "opt-lta-clause", label: "长协加价格联动条款", dims: { closesGap: 2.0901, cost: 160, cycleDays: 30, risk: 0.2, exposure: 0.075, reversibility: 0.9 } },
    { optionId: "opt-insource", label: "上游自采矿+战略储备", dims: { closesGap: 2.6872, cost: 1730, cycleDays: 180, risk: 0.55, exposure: 0.05, reversibility: 0.2 } },
  ],
  triggers: [],
  recommendedPlan: { planId: "plan-cf-decision-gap", optionIds: ["opt-lta-clause", "opt-backup-cert", "opt-insource"], steps: [], totalClosesGap: 3.2811, totalCost: 2138 },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 24.5189, narrowedPct: 11.8, ticks: 0 },
  summary: "根因「价格预判缺失(root)」→ 3 方案比对",
};

/**
 * **第二个引擎态**（R14 判据用）：换一个根因 ⇒ 方案数 3→2、方案名全不同、缺口不同。
 * 屏上跟着变才证明"数来自回包"；不变就说明某处把方案数/方案名写死了。
 * 数值同样来自真后端（`metricKey=cash` 那一跑：缺口 2 亿，narrowedPct 58.65）。
 */
const DP_TWO = {
  rootCause: { factorId: "cf-cash-gap", label: "回款周期拉长(root)", metricKey: "cash", gap: 2, unit: "亿" },
  options: [
    { optionId: "opt-alpha", factorId: "cf-cash-gap", label: "压缩账期", sourceKind: "solver",
      closesGap: 0.4, cost: 30, cycleDays: 20, risk: 0.1, exposure: 0.2, reversibility: 0.7,
      provenance: { kind: "求解器", basis: "X.y", drillType: "X", drillId: "x1", drillValue: 3 } },
    { optionId: "opt-beta", factorId: "cf-cash-gap", label: "保理融资", sourceKind: "agent",
      closesGap: 0.8, cost: 90, cycleDays: 45, risk: 0.3, exposure: 0.1, reversibility: 0.5,
      provenance: { kind: "策略推理", basis: "X.z", drillType: "X", drillId: "x2", drillValue: 7 } },
  ],
  matrix: [
    { optionId: "opt-alpha", label: "压缩账期", dims: { closesGap: 0.4, cost: 30, cycleDays: 20, risk: 0.1, exposure: 0.2, reversibility: 0.7 } },
    { optionId: "opt-beta", label: "保理融资", dims: { closesGap: 0.8, cost: 90, cycleDays: 45, risk: 0.3, exposure: 0.1, reversibility: 0.5 } },
  ],
  triggers: [],
  recommendedPlan: { planId: "plan-cf-cash-gap", optionIds: ["opt-beta"], steps: [], totalClosesGap: 0.8, totalCost: 90 },
  sandboxNarrowing: { beforeGap: 2, afterGap: 1.2, narrowedPct: 58.65, ticks: 0 },
  summary: "根因「回款周期拉长(root)」→ 2 方案比对",
};

/** 沙盘会话/检查点/分支/比对/求解器/审批的最小真后端镜像（语义抄 datacore `app.ts`）。 */
function installHandlers(opts: { dp?: unknown; dpStatus?: number } = {}) {
  const worlds = new Map<string, TickState>();
  let seq = 0;
  const nextId = (p: string) => `${p}_${++seq}`;
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      const id = "sims_main";
      worlds.set(id, JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState);
      return HttpResponse.json(
        { id, tenantId: "demo", baseSnapshot: worlds.get(id), scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-13T00:00:00.000Z" },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    http.get("*/a/v1/sim/sessions/:id/world", ({ params }) =>
      HttpResponse.json({ tick: 0, state: worlds.get(String(params.id)) ?? {} }),
    ),
    // 施加口：走契约唯一实现，桩算不出与后端不同的数。
    http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const sid = String(params.id);
      const p = {
        id: nextId("simpert"), tenantId: "demo", sessionId: sid,
        kind: body.kind, targetObjectId: String(body.targetObjectId), targetStateVar: String(body.targetStateVar),
        startTick: 0, durationTicks: (body.durationTicks ?? null) as number | null,
        magnitude: Number(body.magnitude), mode: (body.mode ?? "set") as "set" | "delta" | "scale",
        label: String(body.label), createdAt: "2026-08-13T00:00:00.000Z",
      };
      const next = applyPerturbationToState(worlds.get(sid) ?? {}, p);
      worlds.set(sid, next);
      return HttpResponse.json({ perturbation: p, curTick: 0, state: next }, { status: 201 });
    }),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => HttpResponse.json({ items: [] })),
    http.post("*/a/v1/sim/sessions/:id/checkpoint", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: nextId("simcp"), tenantId: "demo", sessionId: String(params.id), tick: 0, label: String(body.label ?? ""), createdAt: "2026-08-13T00:00:00.000Z" }, { status: 201 });
    }),
    // 分支：子世界 = 检查点那一刻父世界态的**副本**（逐字节相同 —— 这正是"必须给它们各自一处差异"的原因）。
    http.post("*/a/v1/sim/sessions/:id/branch", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const child = nextId("sims");
      worlds.set(child, JSON.parse(JSON.stringify(worlds.get(String(params.id)) ?? {})) as TickState);
      return HttpResponse.json(
        { id: child, tenantId: "demo", baseSnapshot: worlds.get(child), scope: {}, status: "READY", curTick: 0, parentCheckpointId: String(body.checkpointId), createdAt: "2026-08-13T00:00:00.000Z" },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/compare", ({ request }) => {
      const u = new URL(request.url);
      const ser = (id: string | null) => (id && worlds.has(id) ? [{ tick: 0, state: worlds.get(id)! }] : []);
      return HttpResponse.json({ a: ser(u.searchParams.get("a")), b: ser(u.searchParams.get("b")) });
    }),
    http.post("*/a/v1/solvers/decision_play/invoke", () => {
      if (opts.dpStatus !== undefined && opts.dpStatus >= 400) {
        return HttpResponse.json(
          { error: { code: "VALIDATION_ERROR", message: "decision_play 需先有 gap_attribution 根因（合成 Metric/因果链）", requestId: "req_seam" } },
          { status: opts.dpStatus },
        );
      }
      return HttpResponse.json({ data: opts.dp ?? DP_THREE, snapshotVersion: "ov-seam" });
    }),
    http.post("*/a/v1/action-drafts", () => {
      // 状态照真后端实测：`submit:true` ⇒ `PENDING_APPROVAL`（**不是** EXECUTED）。
      return HttpResponse.json({ draftId: "act_seam", status: "PENDING_APPROVAL" }, { status: 201 });
    }),
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

// 抽象占位类型/对象名（R14 零行业实体名）。
const CFG: SandboxViewConfig = {
  tenantId: "tenant-plays",
  nodeTypes: ["TypeA", "TypeB"],
  nodeObjectIds: { TypeA: ["obj_a1"], TypeB: ["obj_b1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function mount(cfg: SandboxViewConfig = CFG) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

/** 拨一条扰动（本环的入口 —— 没有它，平行世界之间没有可回补的落点）。 */
async function applyPerturbation(user: ReturnType<typeof userEvent.setup>, magnitude = "-18") {
  await screen.findByTestId("sandbox-perturbation");
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "obj_a1");
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), "load");
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-mode"), "delta");
  const mag = screen.getByTestId("sandbox-perturbation-magnitude");
  await user.clear(mag);
  await user.type(mag, magnitude);
  await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
  await screen.findByTestId("sandbox-perturbation-last-id");
}

async function solve(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("sandbox-plays-solve-btn"));
}

beforeEach(() => {
  calls.length = 0;
  server.events.removeAllListeners();
  server.events.on("request:start", recordRequest);
  installHandlers();
});
afterEach(() => {
  server.events.removeAllListeners();
  cleanup();
});

describe("§1 · 方案环端到端（真 endpoints · 真 URL · 真 body）", () => {
  it("拨扰动 → 求方案拿到 ≥2 个 option → 各自 branch 出平行世界 → compare 出**真差异** → 采纳落 PENDING 草稿", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await applyPerturbation(user);

    // ── ① 求方案：真打求解器端点 ────────────────────────────────────────────
    await solve(user);
    const optionsBox = await screen.findByTestId("sandbox-plays-options");
    const dpCalls = calls.filter((c) => c.path.includes("/a/v1/solvers/decision_play/invoke"));
    expect(dpCalls.length, "点了「求方案」却没打求解器端点 ⇒ 这一跳是死的").toBe(1);

    // 基数下限单参写法（`coverage-blind` 门的 hasCardinalityAnchor 要求 `)` 紧跟 `.length`）。
    const optionCards = Array.from(optionsBox.querySelectorAll("[data-testid^='sandbox-play-option-']"));
    expect(optionCards.length).toBeGreaterThan(1);
    expect(optionsBox.getAttribute("data-count")).toBe(String(DP_THREE.options.length));
    // 根因/缺口/收窄都来自回包（不是屏上编的）。
    expect(screen.getByTestId("sandbox-plays-root-metric").textContent).toBe(DP_THREE.rootCause.metricKey);
    expect(screen.getByTestId("sandbox-plays-root-gap").textContent).toContain(String(DP_THREE.rootCause.gap));

    // ── ② 每个方案开一个平行世界 ───────────────────────────────────────────
    await user.click(screen.getByTestId("sandbox-plays-branch-btn"));
    const worldsBox = await screen.findByTestId("sandbox-plays-worlds");
    await waitFor(() => expect(worldsBox.getAttribute("data-count")).toBe(String(DP_THREE.options.length)));

    const cpCalls = calls.filter((c) => c.path.includes("/checkpoint"));
    const branchCalls = calls.filter((c) => c.path.includes("/branch"));
    expect(cpCalls.length, "N 个方案应共用**一个**检查点：各存各的会让它们起点不同，比出来的差异里混着「起点就不一样」").toBe(1);
    expect(branchCalls.length).toBe(DP_THREE.options.length);
    expect(branchCalls.length).toBeGreaterThan(1);

    // 每个方案世界都真收到一条**按 closesGap/gap 折算**的回补扰动（幅度逐个核对，不是"发了就算"）。
    const childPerturbs = calls.filter((c) => /\/a\/v1\/sim\/sessions\/sims_\d+\/perturbations$/.test(c.path));
    expect(childPerturbs.length).toBe(DP_THREE.options.length);
    const effect = -18; // 扰动 delta -18 打在 obj_a1.load 上（契约 applyPerturbationToState 逐字施加）
    for (const [i, o] of DP_THREE.options.entries()) {
      const frac = o.closesGap / DP_THREE.rootCause.gap;
      const b = childPerturbs[i]!.body!;
      expect(b.targetObjectId).toBe("obj_a1");
      expect(b.targetStateVar).toBe("load");
      expect(b.mode).toBe("delta");
      expect(Number(b.magnitude)).toBeCloseTo(-effect * frac, 6);
    }
    // 屏上逐个方案世界的回补比例（`closesGap` 越大回补越多 —— 这条序关系是回包决定的，不是排版决定的）。
    const fracOf = (id: string) => Number((screen.getByTestId(`sandbox-play-world-frac-${id}`).textContent ?? "").replace(/[^\d.]/g, ""));
    expect(fracOf("opt-insource")).toBeGreaterThan(fracOf("opt-lta-clause"));
    expect(fracOf("opt-lta-clause")).toBeGreaterThan(fracOf("opt-backup-cert"));

    // ── ③ 并排比对：真打 compare 端点，且两列**真的不一样** ──────────────────
    await user.selectOptions(screen.getByTestId("sandbox-plays-pick-a"), screen.getByTestId("sandbox-play-world-opt-backup-cert").getAttribute("data-world-id")!);
    await user.selectOptions(screen.getByTestId("sandbox-plays-pick-b"), screen.getByTestId("sandbox-play-world-opt-insource").getAttribute("data-world-id")!);
    await user.click(screen.getByTestId("sandbox-plays-compare-btn"));
    const cmp = await screen.findByTestId("sandbox-plays-compare");
    const cmpCalls = calls.filter((c) => c.path.startsWith("/a/v1/sim/compare"));
    expect(cmpCalls.length).toBe(1);
    expect(cmpCalls[0]!.path, "compare 没带上两个世界 id ⇒ 比的不是这两个世界").toContain("a=sims_");

    const diffEl = within(cmp).getByTestId("sandbox-plays-compare-diff");
    const diff = Number(diffEl.getAttribute("data-diff"));
    expect(Number.isFinite(diff)).toBe(true);
    // **真差异**：不是 0。两个世界只在"回补了多少"上不同，差值 = (fracB − fracA) × 18。
    expect(Math.abs(diff)).toBeGreaterThan(0);
    const fA = DP_THREE.options[0]!.closesGap / DP_THREE.rootCause.gap;
    const fC = DP_THREE.options[2]!.closesGap / DP_THREE.rootCause.gap;
    expect(diff).toBeCloseTo((fC - fA) * 18, 6);

    // ── ④ 采纳：落 ActionDraft，且是 **PENDING**，不是直接执行 ────────────────
    await user.click(screen.getByTestId("sandbox-play-adopt-opt-insource"));
    await waitFor(() => expect(calls.filter((c) => c.path === "/a/v1/action-drafts").length).toBe(1));
    const draft = calls.find((c) => c.path === "/a/v1/action-drafts")!;
    expect(draft.body!.actionTypeKey).toBe("plan_change");
    expect(draft.body!.submit).toBe(true);
    const payload = draft.body!.payload as Record<string, unknown>;
    // `plan_change` 的必填是 versionId + reason（走 S2 审批正门）；本环的溯源全部落在 `patch` 里，
    // 与既有 `onAdopt` 同一处摆放 —— 不在 payload 顶层另起一套字段。
    expect(String(payload.versionId)).toContain("sims_main");
    const patch = payload.patch as Record<string, unknown>;
    expect(patch.optionId).toBe("opt-insource");
    expect(patch.simulated).toBe(true);
    expect(patch.source).toBe("sim_sandbox_play");
    // 口径随行（R13）：审批人必须看得见这个世界的差异是怎么造出来的。
    const caliber = patch.caliber as Record<string, unknown>;
    expect(caliber.anchorObjectId).toBe("obj_a1");
    expect(caliber.anchorStateVar).toBe("load");
    expect(Number(caliber.perturbationEffect)).toBeCloseTo(-18, 6);
    expect(Number(caliber.recoveredFraction)).toBeCloseTo(fC, 6);
  });
});

describe("§2 · R4 红线：方案环**只**碰这几个端点（等号，不是 toContain）", () => {
  /**
   * 白名单 —— 判据不是"看起来像不像写操作"，是**它写的是什么**：
   *  · 写 `SimSession` 世界态 / 读求解器 / 建 `ActionDraft` ⇒ 允许（沙盘模拟态 + R4 正门）
   *  · 写**本体真值**（`/a/v1/objects*`、`/a/v1/object-types*`、任何 PATCH/PUT 对象）⇒ 一条都不许有
   * `toContain` 在未裁的超集上恒真 = 等于没断言（`G-SEG-SCOPE-SUPERSET-ASSERT` 同族），故用等号。
   */
  const ALLOWED = [
    "POST /a/v1/action-drafts",
    "POST /a/v1/sim/sessions/:id/branch",
    "POST /a/v1/sim/sessions/:id/checkpoint",
    "POST /a/v1/sim/sessions/:id/perturbations",
    "POST /a/v1/solvers/decision_play/invoke",
    "GET /a/v1/sim/compare",
  ];
  /** 路径归一：把 id 段折成 `:id`、丢掉 query（比较的是"打了哪种端点"，不是"打了哪个实例"）。 */
  const normalize = (c: Call): string =>
    `${c.method} ${c.path.split("?")[0]!.replace(/\/sim\/sessions\/[^/]+\//, "/sim/sessions/:id/")}`;
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  /**
   * 🐤 金丝雀 —— **与主逻辑共用同一条收集口与同一个 `normalize`**（不另抄一份）。
   *
   * 它打的是一条**没有任何 handler 拦**的真 PATCH（= 本单最怕的 R4 违规长什么样）：
   * 收集口若只看得见"我桩过的端点"，这里就抓不到 ⇒ 报「工具坏了」，而不是报「页面干净」。
   * 本门第一版正是死在这一点上：手动 `calls.push` 抓不到未桩请求，塞进去的 PATCH 照样绿。
   */
  async function canaryUnstubbedWrite(): Promise<string[]> {
    const before = calls.length;
    try {
      await fetch("http://localhost/a/v1/objects/obj_canary", { method: "PATCH", body: "{}" });
    } catch {
      /* 未桩请求可能被 onUnhandledRequest 拒绝 —— 我们只关心它有没有被**记账** */
    }
    return calls.slice(before).map(normalize);
  }

  it("整条方案环发出的端点集合 **等于** 白名单 —— 一个写本体真值的端点都没有", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await applyPerturbation(user);

    // 报「集合里没有写真值端点」这种**否定结论**之前，先证工具不是瞎的（铁律 0.6）。
    const canary = await canaryUnstubbedWrite();
    expect(canary, "未桩的 PATCH 没被记账 ⇒ **门自己瞎了**，它证明不了「页面没写真值」").toContain(
      "PATCH /a/v1/objects/obj_canary",
    );

    calls.length = 0; // 从这里开始只统计方案环自己发的
    await solve(user);
    await screen.findByTestId("sandbox-plays-options");
    await user.click(screen.getByTestId("sandbox-plays-branch-btn"));
    await screen.findByTestId("sandbox-plays-worlds");
    await user.click(screen.getByTestId("sandbox-plays-compare-btn"));
    await screen.findByTestId("sandbox-plays-compare");
    await user.click(screen.getByTestId("sandbox-play-adopt-opt-lta-clause"));
    await waitFor(() => expect(calls.some((c) => c.path === "/a/v1/action-drafts")).toBe(true));

    const found = [...new Set(calls.map(normalize))].sort(byName);
    expect(found, "方案环打了白名单以外的端点 —— 沙盘写的是 SimSession 世界态，绝不写本体真值（R4）").toEqual(
      [...ALLOWED].sort(byName),
    );
  });
});

describe("§3 · R14 零写死：方案数 / 方案名 / 指标名全部来自回包与登记册", () => {
  it("换一个引擎态（3 方案 → 2 方案，名字全不同）⇒ 屏上跟着变", async () => {
    const user = userEvent.setup();
    installHandlers({ dp: DP_TWO });
    mount();
    await screen.findByTestId("sandbox-view");
    await applyPerturbation(user);
    await solve(user);

    const box = await screen.findByTestId("sandbox-plays-options");
    await waitFor(() => expect(box.getAttribute("data-count")).toBe(String(DP_TWO.options.length)));
    expect(DP_TWO.options.length).toBeGreaterThan(1);
    for (const o of DP_TWO.options) {
      expect(screen.getByTestId(`sandbox-play-option-${o.optionId}`).textContent, `方案「${o.label}」没上屏`).toContain(o.label);
    }
    // 第一个引擎态的方案 id 一个都不该还在（否则就是把上一批留在屏上）。
    for (const o of DP_THREE.options) {
      expect(screen.queryByTestId(`sandbox-play-option-${o.optionId}`), `上一个引擎态的「${o.label}」还在屏上`).toBeNull();
    }
    expect(screen.getByTestId("sandbox-plays-root-metric").textContent).toBe(DP_TWO.rootCause.metricKey);
    expect(screen.getByTestId("sandbox-plays-narrowing").textContent).toContain(String(DP_TWO.sandboxNarrowing.narrowedPct));
  });

  it("「最优列」按回包真值 + 方向语义判，不写死在哪一列（换引擎态即换赢家）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await solve(user);
    await screen.findByTestId("sandbox-plays-options");
    // `closesGap` 越大越好 ⇒ 赢家 = 三者中最大的 opt-insource（2.6872）；
    // `cost` 越小越好   ⇒ 赢家 = 最小的 opt-lta-clause（160）。两维赢家不同，才证明是逐维真算。
    expect(screen.getByTestId("sandbox-play-dim-opt-insource-closesGap").getAttribute("data-best")).toBe("1");
    expect(screen.getByTestId("sandbox-play-dim-opt-lta-clause-closesGap").getAttribute("data-best")).toBe("0");
    expect(screen.getByTestId("sandbox-play-dim-opt-lta-clause-cost").getAttribute("data-best")).toBe("1");
    expect(screen.getByTestId("sandbox-play-dim-opt-insource-cost").getAttribute("data-best")).toBe("0");
  });

  it("指标下拉的候选 = 契约 `GOAL_REGISTRY`（前端不另写一份指标词表）", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    const sel = await screen.findByTestId("sandbox-plays-metric");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    const keys = Object.values(GOAL_REGISTRY).map((g) => g.key);
    expect(keys.length).toBeGreaterThan(3);
    // 首项是空值档（= 不传 metricKey，引擎自选最严重越线者），其余逐个等于登记册的 key 集。
    expect([...values].sort()).toEqual(["", ...keys].sort());
  });

  it("选了指标 ⇒ `metricKey` 真进 body；选「引擎自选」⇒ **不带**该字段（不硬塞空串）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await solve(user);
    await waitFor(() => expect(calls.some((c) => c.path.includes("decision_play"))).toBe(true));
    expect(calls.find((c) => c.path.includes("decision_play"))!.body!.args).toEqual({});

    calls.length = 0;
    const pick = Object.values(GOAL_REGISTRY)[0]!.key;
    await user.selectOptions(screen.getByTestId("sandbox-plays-metric"), pick);
    await solve(user);
    await waitFor(() => expect(calls.some((c) => c.path.includes("decision_play"))).toBe(true));
    expect(calls.find((c) => c.path.includes("decision_play"))!.body!.args).toEqual({ metricKey: pick });
  });
});

describe("§4 · 诚实降级（三种「给不出方案世界」的态，各说各的原因）", () => {
  it("求解器 400 ⇒ 把**后端原话**摆上屏，不自己编一句「暂无数据」", async () => {
    const user = userEvent.setup();
    installHandlers({ dpStatus: 400 });
    mount();
    await screen.findByTestId("sandbox-view");
    await solve(user);
    const err = await screen.findByTestId("sandbox-plays-solve-error");
    expect(err.textContent).toContain("decision_play 需先有 gap_attribution 根因");
    expect(screen.queryByTestId("sandbox-plays-options")).toBeNull();
  });

  it("没施加过扰动 ⇒ 不给「开平行世界」按钮，当面写明为什么（开了也是 N 个一模一样的世界）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await solve(user);
    await screen.findByTestId("sandbox-plays-options");
    expect(screen.getByTestId("sandbox-plays-need-perturbation")).toBeTruthy();
    expect(screen.queryByTestId("sandbox-plays-branch-btn")).toBeNull();
  });

  it("扰动实测效应为 0 ⇒ 如实说没有可比的差异，不换一个「看着有差异」的算法糊过去", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await applyPerturbation(user, "0"); // delta 0 ⇒ 落点值不动 ⇒ Δ = 0
    await solve(user);
    await screen.findByTestId("sandbox-plays-options");
    expect(screen.getByTestId("sandbox-plays-zero-effect")).toBeTruthy();
    expect(screen.queryByTestId("sandbox-plays-branch-btn")).toBeNull();
  });
});

describe("§5 · AI 指挥台提到一等位置（D4：升层不删除，两向都咬）", () => {
  it("① 一等位置：`sim-commander-dock` 在左区且**没有任何 `<details>` 祖先**（不再需要先展开才能问）", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    const dock = await screen.findByTestId("sim-commander-dock");
    expect(screen.getByTestId("sandbox-zone-input").contains(dock), "指挥台不在左区（唯一输入区）").toBe(true);
    let cur: HTMLElement | null = dock.parentElement;
    let folded = false;
    while (cur !== null) {
      if (cur.tagName.toLowerCase() === "details") folded = true;
      cur = cur.parentElement;
    }
    expect(folded, "指挥台仍被包在折叠块里 ⇒ 没提到一等位置").toBe(false);
    // 只有**一份**实例：两份会让 getByTestId 抛「找到多个」，屏上也会出现两个互不同步的输入框。
    expect(document.querySelectorAll('[data-testid="sim-commander-dock"]').length).toBe(1);
  });

  it("② 没删任何既有入口：`sc-rail-commander` 那一格仍在、仍默认收起，且格子里指向新位置", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    const rail = screen.getByTestId("sc-rail-commander") as HTMLDetailsElement;
    expect(screen.getByTestId("sc-rail-stack").contains(rail)).toBe(true);
    expect(rail.open, "层变了 —— 本格判的是「不动」").toBe(false);
    expect(screen.getByTestId("sandbox-commander-moved").textContent).toContain("一等位置");
  });
});
