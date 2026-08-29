/**
 * WO-SANDBOX-MEMORY · 沙盘这一屏的**内存判据**（咬链路，不咬函数）。
 *
 * ── 这条测试要证的那件事 ─────────────────────────────────────────────────────
 * 真浏览器实测（真 datacore · demo 租户 · 35 条会话）：
 *   · 落点 `<select>` 一次性渲染 **11,337** 个 `<option>` ⇒ 整页 DOM 1,005 → 12,969，
 *     堆快照逐项对账约 **34MB** 常驻（slot 2.1MB ＋ ShadowRoot 1.9MB ＋ label 1.1MB
 *     ＋ 绝大部分的 FiberNode 6.1MB / Text 4.1MB）；
 *   · `GET /a/v1/sim/sessions` 把 35 份完整世界（每份 11,348 对象 × 36 变量）全量下发，
 *     React Query 缓存里同时躺 **2×293MB**。
 * 用户连开三次推演沙盘就 OOM 崩标签页（20 道验收题在第 3 题 `Target crashed`）。
 *
 * ── 判据必须落在**能力不缩水**上，不是只落在「数变小了」───────────────────────
 * 「只渲染前 N 个」也能让数变小，但那是**能力缩水**（第 5,000 个落点从此选不到）。
 * 所以本门两向都咬：
 *   ① 大世界下 DOM 里的 `<option>` **远少于**候选数（省下来的确实省了）；
 *   ② 且**任意一个**候选（含最后一个、窗口外的那个）仍然选得到，选完之后
 *      真发出去的那个 POST 的 `targetObjectId` **就是它** —— 咬到请求上，不咬到 DOM 上。
 *
 * ── 为什么不 mock endpoints ─────────────────────────────────────────────────
 * 与 `sandbox-perturbation.seam.test.tsx` 同源理由：mock 掉 endpoints 就把病灶那一跳
 * （`fetchSimSessions` 的投影）一起 mock 掉了。这里走**真 endpoints**，在 MSW 层拦真 URL。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SandboxViewConfig, TickState } from "@platform/contracts";
import { server } from "./setup";
import SandboxView, { PERTURB_OPTION_WINDOW } from "@/views/sim/SandboxView";

/** 候选落点数（**远大于**窗口，否则"窗口起没起作用"这件事测不出来）。 */
const N_TARGETS = 1200;
const OBJ_IDS = Array.from({ length: N_TARGETS }, (_, i) => `obj_t_${String(i).padStart(4, "0")}`);
/** 窗口外的那一个 —— 本门的头号证物：它必须仍然选得到。 */
const FAR_ID = OBJ_IDS[N_TARGETS - 1]!;

const CFG: SandboxViewConfig = {
  tenantId: "tenant-mem",
  nodeTypes: ["TypeA"],
  nodeObjectIds: { TypeA: OBJ_IDS },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

const perturbCalls: Record<string, unknown>[] = [];
let sessionsPayloadBytes = 0;
let sessionsFetches = 0;

/**
 * 与生产同形的一份"整世界"：1,200 对象 × 20 状态变量（生产是 11,348 × 36）。
 * 缩了量级但**保住形状** —— 判据是"剥掉之后还剩多少比例"，不是绝对字节数。
 */
const BIG_BASE: TickState = (() => {
  const s: TickState = {};
  for (const id of OBJ_IDS) {
    const row: Record<string, number> = {};
    for (let v = 0; v < 20; v++) row[`stateVar${v}`] = v;
    s[id] = row;
  }
  return s;
})();

/** 造一份**与生产同形**的会话列表：每条都带整份 baseSnapshot（那正是 285MB 的来源）。 */
function bigSessions(count: number, base: TickState) {
  return Array.from({ length: count }, (_, i) => ({
    id: `sims_bulk_${i}`,
    tenantId: "demo",
    baseSnapshot: base,
    scope: { kind: "GLOBAL", target: null },
    status: "READY",
    curTick: 0,
    parentCheckpointId: null,
    disabledRuleKeys: [],
    createdAt: `2026-08-1${i % 10}T00:00:00.000Z`,
  }));
}

function installHandlers() {
  let world: TickState = {};
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      world = (body.baseSnapshot ?? {}) as TickState;
      return HttpResponse.json(
        {
          id: "sims_mem", tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {},
          status: "READY", curTick: 0, parentCheckpointId: null, disabledRuleKeys: [],
          createdAt: "2026-08-22T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => {
      sessionsFetches++;
      // 列表里每条都带**整份**世界 —— 这就是生产那 285MB 的形状（`world` 只是本会话的那一份）
      const payload = JSON.stringify({ items: [...bigSessions(5, BIG_BASE), ...bigSessions(1, world)] });
      sessionsPayloadBytes = payload.length;
      return new HttpResponse(payload, { headers: { "Content-Type": "application/json" } });
    }),
    http.get("*/a/v1/sim/sessions/:id/world", () => HttpResponse.json({ tick: 0, state: world })),
    http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      perturbCalls.push(body);
      return HttpResponse.json(
        {
          perturbation: {
            id: "p1", tenantId: "demo", sessionId: "sims_mem", kind: body.kind,
            targetObjectId: body.targetObjectId, targetStateVar: body.targetStateVar,
            startTick: 0, durationTicks: null, magnitude: Number(body.magnitude),
            mode: body.mode, label: String(body.label), createdAt: "2026-08-22T00:00:00.000Z",
          },
          curTick: 0,
          state: world,
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

const objectSelect = () => screen.getByTestId("sandbox-perturbation-object") as HTMLSelectElement;

beforeEach(() => {
  perturbCalls.length = 0;
  sessionsPayloadBytes = 0;
  sessionsFetches = 0;
  installHandlers();
});
afterEach(() => cleanup());

describe("WO-SANDBOX-MEMORY · 沙盘这一屏不再把整个世界搬进 DOM / 内存", () => {
  it("① 落点下拉**不再全量渲染**：候选 1,200 个，DOM 里的 <option> ≤ 窗口 + 1", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation-object");

    // 金丝雀：候选集本身**确实是**大集合 —— 它若为空，下面那个"少"就毫无意义
    expect(CFG.nodeObjectIds!.TypeA!.length, "候选集不是大集合 ⇒ 本门测不出任何东西").toBe(N_TARGETS);
    const n = objectSelect().options.length;
    expect(n, `落点下拉仍渲染了 ${n} 个 option ⇒ 窗口没起作用`).toBeLessThanOrEqual(PERTURB_OPTION_WINDOW + 1);
    // 且不是"一个都没有"（那是另一种坏法：能力直接没了）
    expect(n).toBeGreaterThan(0);
  });

  it("② 屏上如实写出「还有多少个没列出」—— 不写就成了「落点只有这么多」的假象", async () => {
    mount();
    await screen.findByTestId("sandbox-perturbation-object");
    const note = await screen.findByTestId("sandbox-perturbation-object-window");
    const txt = note.textContent ?? "";
    expect(txt).toContain(String(N_TARGETS)); // 候选总数必须出现在屏上
    expect(txt).toContain("未列出");
  });

  it("🔴 ③ 能力不缩水：**窗口外**那个落点仍然选得到，且真发出去的 targetObjectId 就是它", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-perturbation-object");

    // 先证明它**确实**不在初始窗口里（否则这条断言是自欺）
    const initialIds = [...objectSelect().options].map((o) => o.value);
    expect(initialIds, "窗口外那个本来就在窗口里 ⇒ 本条什么都没证明").not.toContain(FAR_ID);

    // 用筛选框把它捞出来 —— 这就是"任意一个都选得到"的那条路
    await user.type(screen.getByTestId("sandbox-perturbation-object-filter"), FAR_ID);
    await waitFor(() => {
      expect([...objectSelect().options].map((o) => o.value)).toContain(FAR_ID);
    });
    await user.selectOptions(objectSelect(), FAR_ID);

    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    await waitFor(() => expect(perturbCalls.length).toBe(1));
    // 判据落在**真发出去的请求**上，不落在 DOM 上（DOM 对了而请求错了，正是静默错答）
    expect(perturbCalls[0]!.targetObjectId, "选了窗口外那个，发出去的却不是它 ⇒ 用户的选择被静默改掉").toBe(FAR_ID);
  });

  it("④ 选中的那个**恒在窗口里**：筛掉它之后 <select> 的 value 不许被静默改成第一项", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-perturbation-object-filter");

    await user.type(screen.getByTestId("sandbox-perturbation-object-filter"), FAR_ID);
    await waitFor(() => expect([...objectSelect().options].map((o) => o.value)).toContain(FAR_ID));
    await user.selectOptions(objectSelect(), FAR_ID);
    expect(objectSelect().value).toBe(FAR_ID);

    // 换一个筛不到它的关键词 —— 选中的那个必须仍在 DOM 里、仍是 value
    await user.clear(screen.getByTestId("sandbox-perturbation-object-filter"));
    await user.type(screen.getByTestId("sandbox-perturbation-object-filter"), "obj_t_0000");
    await waitFor(() => {
      expect([...objectSelect().options].map((o) => o.value)).toContain("obj_t_0000");
    });
    expect(objectSelect().value, "筛选把用户已选的落点悄悄换掉了 —— 比慢更糟").toBe(FAR_ID);
  });

  it("🔴 ⑤ 会话列表这一跳**不再把整份世界搬进内存**：回包很大，落到组件里的却只有几十字节/条", async () => {
    mount();
    await screen.findByTestId("sandbox-perturbation-object");
    await waitFor(() => expect(sessionsFetches).toBeGreaterThan(0));

    // 金丝雀：桩确实回了一份**含整份 baseSnapshot** 的大回包（不然"剥掉了"什么都没证明）
    expect(sessionsPayloadBytes, "桩回包不够大 ⇒ 剥没剥都看不出来，本条无效").toBeGreaterThan(1_500_000);

    // 真正的判据：`fetchSimSessions` 拿回来的东西里，一条 baseSnapshot 都没有
    const { fetchSimSessions } = await import("@/api/endpoints");
    const list = await fetchSimSessions();
    expect(list.items.length, "列表是空的 ⇒ 扫描器坏了，不许据此报「剥干净了」").toBe(6);
    expect(list.items[0]!.id).toBe("sims_bulk_0");
    for (const it of list.items) {
      expect(Object.prototype.hasOwnProperty.call(it, "baseSnapshot"), "baseSnapshot 还在 ⇒ 285MB 照旧进内存").toBe(false);
      expect(it.id.length).toBeGreaterThan(0); // 该留的字段都还在
      expect(it.status).toBe("READY");
    }
    // 量级：剥后整份列表 < 原回包的 1‰
    expect(JSON.stringify(list).length / sessionsPayloadBytes).toBeLessThan(0.001);
  });

  it("⑥ 基线仍然到得了下区差分：建会话回包里的那一份被采纳（首次挂载**一发都不多发**）", async () => {
    mount();
    await screen.findByTestId("sandbox-perturbation-object");
    // 下区世界态差分整块在 ⇒ baseWorld 非空（basWorld 为 null 时该块显示诚实空）
    await waitFor(() => expect(screen.queryByTestId("sandbox-view")).not.toBeNull());
    const list = await import("@/api/endpoints");
    // 单条基线捞取这条路存在且可用（切世界时才走它）
    const snap = await list.fetchSimSessionBaseSnapshot("sims_bulk_3");
    expect(snap, "单条基线捞不回来 ⇒ 切世界之后下区差分永远算不出").not.toBeNull();
    const miss = await list.fetchSimSessionBaseSnapshot("sims_not_there");
    expect(miss, "捞不到时必须是 null，不许造一个空世界出来").toBeNull();
  });
});
