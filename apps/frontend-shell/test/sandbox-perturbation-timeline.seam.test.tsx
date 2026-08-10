import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  applyPerturbationToState,
  isPerturbationActiveAt,
  type Perturbation,
  type SandboxViewConfig,
  type TickState,
} from "@platform/contracts";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";
import { invalidateForEvent } from "@/store/eventInvalidation";
import SandboxView from "@/views/sim/SandboxView";

/**
 * WO-SIM-PERTURB-TIMELINE · **扰动时间轴接缝门**（前任 WO-SIM-ACT-CLOSE 留下的两个残口）。
 *
 * ── 这条门要证的那件事 ─────────────────────────────────────────────────────────
 * 上一单把**写端**接通了（施加扰动 → 世界当场变），但 `fetchSimPerturbations` 零调用方 ⇒
 * 「这个世界受过哪些扰动」在界面上**问不出来**。本门断言的是那条**跨读写两端的整链**：
 *
 *     用户在右栏施加一次扰动 → 真 POST …/perturbations → 真 GET …/perturbations
 *       → 时间轴上真的出现这一条（带它的落点 / 幅度 / 生效状态 / 时序位置）
 *
 * **不是各半 unit**：不 mock `@/api/endpoints`（那会把病灶所在的那一跳一起 mock 掉），
 * 走真 endpoints，在 MSW 层拦**真实 URL**；写端与读端打的是同一个 MSW 会话 store，
 * 任一半断了整条链就红 —— 这正是 SEAM-GATE 要的「驱动接缝」。
 *
 * ── MSW 桩为什么不会与后端漂移 ─────────────────────────────────────────────────
 * 施加走契约的 `applyPerturbationToState`、生效判据走契约的 `isPerturbationActiveAt` ——
 * 两者都是后端路由与引擎**共用的唯一实现**（`packages/contracts/src/sim.ts`）。
 * 桩不自己写「大概是这样」的逻辑，所以屏上的数与真后端算的是同一份。
 * 清单排序也照后端 `listPerturbations` 的口径：`startTick` → 建单先后，**不以随机 id 作二级键**。
 *
 * ── 必须用单例 queryClient ────────────────────────────────────────────────────
 * `invalidateForEvent` 打的是 `@/store/queryClient` 那个单例。用 `new QueryClient()` 挂载，
 * 事件永远打不到组件的 query 上 —— ⑦ 那条会以"什么都没发生"的形式恒红（不是恒绿，所以安全），
 * 但仍写明，免得后人照抄错。
 */

// ── 本门自己的"服务端"（写端与读端共用同一份状态；也可在组件不知情时被改动）───────────
const SID = "sims_ptl";
let world: TickState = {};
let curTick = 0;
let perturbations: Perturbation[] = [];
/** 读端被真正打了几次（用于证明"重取真的发生了"，而不是靠肉眼看屏）。 */
let listHits = 0;
/** 真实发出的写请求（证明打的是真端点、真 body）。 */
const postCalls: { url: string; body: Record<string, unknown> }[] = [];
const deleteCalls: string[] = [];
let pertSeq = 0;

/** 后端 `listPerturbations` 的定序口径：`startTick` → 建单先后。**禁以随机 id 作二级键**（破 R6）。 */
function orderedList(): Perturbation[] {
  return perturbations
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.startTick - b.p.startTick || a.i - b.i)
    .map((x) => x.p);
}

function seedPerturbation(over: Partial<Perturbation>): Perturbation {
  const p: Perturbation = {
    id: `simpert_${++pertSeq}`,
    tenantId: "demo",
    sessionId: SID,
    kind: "capacity_loss",
    targetObjectId: "obj_a1",
    targetStateVar: "load",
    startTick: 0,
    durationTicks: null,
    magnitude: -10,
    mode: "delta",
    label: "seeded",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...over,
  };
  perturbations.push(p);
  return p;
}

function installHandlers() {
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      world = JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState;
      return HttpResponse.json(
        {
          id: SID, tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {},
          status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-10T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    http.get("*/a/v1/sim/sessions/:id/world", () => HttpResponse.json({ tick: curTick, state: world })),
    // ── 写端（上一单接通的那一跳）──
    http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>;
      postCalls.push({ url: request.url, body: b });
      const p = seedPerturbation({
        kind: b.kind as Perturbation["kind"],
        targetObjectId: String(b.targetObjectId),
        targetStateVar: String(b.targetStateVar),
        startTick: typeof b.startTick === "number" ? b.startTick : curTick,
        durationTicks: (b.durationTicks ?? null) as number | null,
        magnitude: Number(b.magnitude),
        mode: (b.mode ?? "set") as Perturbation["mode"],
        label: String(b.label),
      });
      // 语义镜像 datacore：**已在当前 tick 生效**的才立刻落世界态（判据走契约单源）。
      if (isPerturbationActiveAt(p, curTick)) world = applyPerturbationToState(world, p);
      return HttpResponse.json({ perturbation: p, curTick, state: world }, { status: 201 });
    }),
    // ── 读端（★ 本单要接的那一跳）──
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => {
      listHits += 1;
      return HttpResponse.json({ items: orderedList() });
    }),
    http.delete("*/a/v1/sim/sessions/:id/perturbations/:pid", ({ params }) => {
      const pid = String((params as { pid: string }).pid);
      deleteCalls.push(pid);
      // 删记录**不回滚世界态**（与后端同语义）。
      perturbations = perturbations.filter((p) => p.id !== pid);
      return HttpResponse.json({ deleted: true });
    }),
    http.post("*/a/v1/sim/sessions/:id/tick", () => {
      curTick += 1;
      return HttpResponse.json({ curTick, state: world });
    }),
    // 认证 entitlement 在本门不参与：404 让右栏走既有的诚实降级分支。
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

/** 抽象占位类型/对象名（R14 零行业实体名）。`nodeObjectIds` 是**真物化对象 id**。 */
const CFG: SandboxViewConfig = {
  tenantId: "tenant-ptl",
  nodeTypes: ["TypeA", "TypeB"],
  nodeObjectIds: { TypeA: ["obj_a1"], TypeB: ["obj_b1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

/** ★ 单例 queryClient（见文件头）。 */
function mount(cfg: SandboxViewConfig = CFG) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

const timeline = () => screen.getByTestId("sandbox-perturbation-timeline");

/** 从右栏表单施加一次扰动（= 用户真实动作，走的是上一单接通的那条写端）。 */
async function applyOnce(
  user: ReturnType<typeof userEvent.setup>,
  opts: { magnitude: string; mode?: "delta" | "scale" | "set"; duration?: string; stateVar?: string },
) {
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "obj_a1");
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), opts.stateVar ?? "load");
  await user.selectOptions(screen.getByTestId("sandbox-perturbation-mode"), opts.mode ?? "delta");
  const mag = screen.getByTestId("sandbox-perturbation-magnitude");
  await user.clear(mag);
  await user.type(mag, opts.magnitude);
  const dur = screen.getByTestId("sandbox-perturbation-duration");
  await user.clear(dur);
  if (opts.duration) await user.type(dur, opts.duration);
  await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
}

beforeEach(() => {
  world = {};
  curTick = 0;
  perturbations = [];
  listHits = 0;
  pertSeq = 0;
  postCalls.length = 0;
  deleteCalls.length = 0;
  installHandlers();
});
afterEach(() => cleanup());

describe("WO-SIM-PERTURB-TIMELINE · 扰动时间轴接缝（写端 → 读端整链，真 endpoints + 真 URL）", () => {
  it("① SEAM：用户施加一次扰动 → 时间轴上真的出现这一条（读端此前零调用方，问不出来）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");

    // 起跑线：世界干净，时间轴当面说"还没受过扰动"（不拿空清单冒充别的意思）。
    await screen.findByTestId("ptl-empty");
    expect(within(timeline()).getByTestId("ptl-total").textContent).toBe("0");
    const listHitsBefore = listHits;
    expect(listHitsBefore, "读端一次都没被打过 ⇒ useQuery 根本没接上（本单要修的就是这个）").toBeGreaterThan(0);

    await applyOnce(user, { magnitude: "40" });

    // ★ 写端真的打出去了（上一单那半仍然通）。
    await waitFor(() => expect(postCalls.length, "点了按钮但一个写请求都没发").toBe(1));
    expect(postCalls[0]!.url).toContain(`/a/v1/sim/sessions/${SID}/perturbations`);

    // ★ 读端真的被重取了（施加后清单必须刷新，否则屏上永远停在"0 次"）。
    await waitFor(() => expect(listHits, "施加后清单没重取 ⇒ 用户看不到自己刚做的那一下").toBeGreaterThan(listHitsBefore));

    // ★ 效果层·本门头号判据：**那一条真的出现在时间轴上**，且带着它的落点/幅度/状态。
    const pid = perturbations[0]!.id;
    const bar = await screen.findByTestId(`ptl-bar-${pid}`);
    expect(bar.getAttribute("data-status"), "刚施加、永久生效 ⇒ 此刻必须是「生效中」").toBe("active");
    expect(bar.textContent, "第一层必须能读出「幅度」——只写个名字等于没回答").toContain("+40");
    expect(bar.textContent).toContain("生效中");
    // 泳道按落点归并（objectId.stateVar）——这是"叠加关系"能被看见的前提。
    await screen.findByTestId("ptl-lane-obj_a1-load");
    // 头部计数也跟上（第一层的「数值」）。
    await waitFor(() => expect(within(timeline()).getByTestId("ptl-total").textContent).toBe("1"));
    expect(within(timeline()).getByTestId("ptl-active").textContent).toBe("1");
  });

  it("② 时序真的被表达：到期的扰动在推进 tick 后变「已结束」（判据走契约单源，不是前端另算一遍）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");
    await screen.findByTestId("ptl-empty");

    // 只生效 1 个 tick（tick0 生效、tick1 到期）。
    await applyOnce(user, { magnitude: "40", duration: "1" });
    await waitFor(() => expect(postCalls.length).toBe(1));
    expect(postCalls[0]!.body.durationTicks, "填了 1 就必须原样传 1").toBe(1);

    const pid = perturbations[0]!.id;
    await waitFor(() => expect(screen.getByTestId(`ptl-bar-${pid}`).getAttribute("data-status")).toBe("active"));

    // 推进一个 tick：curTick 0 → 1，契约判据 `1 < 0+1` 为假 ⇒ 已结束。
    await user.click(screen.getByTestId("sandbox-tick-btn"));
    await waitFor(() =>
      expect(
        screen.getByTestId(`ptl-bar-${pid}`).getAttribute("data-status"),
        "tick 推进后到期的扰动仍显示「生效中」⇒ 屏上的世界与引擎里的世界不是同一个",
      ).toBe("past"),
    );
    await waitFor(() => expect(within(timeline()).getByTestId("ptl-active").textContent).toBe("0"));
    // 总数不变：到期 ≠ 消失（"这个世界受过哪些扰动"问的是历史，不是此刻）。
    expect(within(timeline()).getByTestId("ptl-total").textContent).toBe("1");
  });

  it("③ 未来排期的扰动显示「未开始」，不冒充已经发生（诚实位的另一面）", async () => {
    // 从表单发不出未来排期（表单没有 startTick 输入），故直接种在服务端 —— 本条验的是**渲染三态**，
    // 接缝由 ① 覆盖，两条各司其职，不互相冒充。
    seedPerturbation({ startTick: 5, durationTicks: 2, magnitude: 3, mode: "delta", label: "future" });
    mount();
    await screen.findByTestId("sandbox-view");
    const bar = await screen.findByTestId("ptl-bar-simpert_1");
    expect(bar.getAttribute("data-status"), "curTick=0 < startTick=5 ⇒ 必须是「未开始」").toBe("future");
    expect(bar.textContent).toContain("未开始");
    expect(within(timeline()).getByTestId("ptl-active").textContent, "未开始的不该算进「此刻生效」").toBe("0");
  });

  it("④ 同落点叠加：两条同时生效 ⇒ 泳道标「叠加 2 层」，且编号保后端返回序（顺序是语义不是排版）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");
    await screen.findByTestId("ptl-empty");

    await applyOnce(user, { magnitude: "40", mode: "delta" });
    await waitFor(() => expect(postCalls.length).toBe(1));
    await applyOnce(user, { magnitude: "1.5", mode: "scale" });
    await waitFor(() => expect(postCalls.length).toBe(2));

    // 两条都落在 obj_a1.load 且都永久生效 ⇒ 同一泳道、同时生效。
    const lane = await screen.findByTestId("ptl-lane-obj_a1-load");
    await waitFor(() =>
      expect(
        within(lane).getByTestId("ptl-stack-obj_a1-load").textContent,
        "同落点同时生效却不标叠加 ⇒ delta/scale 不可交换这件事在屏上不可见",
      ).toContain("叠加 2 层"),
    );

    // 编号 = 后端返回序（startTick 相同 ⇒ 建单先后）。先施加的 delta 必须排在 scale 之前。
    const [first, second] = orderedList();
    const barFirst = within(lane).getByTestId(`ptl-bar-${first!.id}`);
    const barSecond = within(lane).getByTestId(`ptl-bar-${second!.id}`);
    expect(barFirst.textContent, "第一条应带 ① 且是先施加的 delta").toContain("①");
    expect(barFirst.textContent).toContain("+40");
    expect(barSecond.textContent, "第二条应带 ② 且是后施加的 scale").toContain("②");
    expect(barSecond.textContent).toContain("×1.5");
  });

  it("⑤ 信息分层：口径/公式不在第一层，只在 `?` 浮层；且全组件零 HTML title / 零 SVG <title>", async () => {
    const user = userEvent.setup();
    seedPerturbation({ magnitude: -10, mode: "delta", label: "x" });
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("ptl-bar-simpert_1");

    const box = timeline();
    // R-UI-3：生效判据那条公式属于「解释」，第一层不许有。
    expect(box.textContent, "公式出现在第一层 ⇒ 违反 CONVENTION §2 R-UI-3").not.toContain("startTick + durationTicks");
    // 浮层默认不在 DOM（"不点就看见"的只有数值/状态/名字）。
    expect(screen.queryByTestId("ptl-hint-pop"), "浮层默认就展开 = 第一层过载").toBeNull();

    // 悬停 → 出现；移开 → **立即消失**（原生 tooltip 滞留事故的对策）。
    await user.hover(screen.getByTestId("ptl-hint"));
    const pop = await screen.findByTestId("ptl-hint-pop");
    expect(pop.textContent, "浮层里必须写清生效判据（公式的正确归宿）").toContain("startTick + durationTicks");
    expect(pop.textContent, "浮层里必须写清字段出处（不许编造）").toContain("/a/v1/sim/sessions/:id/perturbations");
    await user.unhover(screen.getByTestId("ptl-hint"));
    await waitFor(() => expect(screen.queryByTestId("ptl-hint-pop"), "移开后浮层滞留 = 复刻 ChainLineMapView 那次事故").toBeNull());

    // 键盘可达：focus 显示 / Esc 关闭。
    screen.getByTestId("ptl-hint").focus();
    await screen.findByTestId("ptl-hint-pop");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("ptl-hint-pop")).toBeNull());

    // ★ 硬判据：整个时间轴子树里不许有 `title` 属性 / `<title>` 元素充当浮层。
    expect(box.querySelectorAll("[title]").length, "用 HTML title 当浮层 —— 规范明令禁止").toBe(0);
    expect(box.querySelectorAll("title").length, "用 SVG <title> 当浮层 —— 规范明令禁止").toBe(0);
  });

  it("⑥ 诚实位：第一层留可见记号「无归因量」，明细里写明缺什么（不留空、不造占位）", async () => {
    const user = userEvent.setup();
    seedPerturbation({ magnitude: -10, mode: "delta", label: "x" });
    mount();
    await screen.findByTestId("sandbox-view");

    // 降层了，但第一层必须留记号（CONVENTION §1「静默降层等于删除」）。
    expect((await screen.findByTestId("ptl-honesty-flag")).textContent).toContain("无归因量");

    // 第二层（一次点击）才是逐字段明细。
    expect(screen.queryByTestId("ptl-detail-simpert_1"), "明细默认就摊开 = 第一层过载").toBeNull();
    await user.click(screen.getByTestId("ptl-bar-simpert_1"));
    const detail = await screen.findByTestId("ptl-detail-simpert_1");
    expect(within(detail).getByTestId("ptl-detail-id-simpert_1").textContent).toBe("simpert_1");
    expect(within(detail).getByTestId("ptl-detail-window-simpert_1").textContent).toContain("永久");
    expect(
      within(detail).getByTestId("ptl-detail-attr-simpert_1").textContent,
      "本条影响留空 / 编一个数 —— 两者都不行，端点没有就写没有",
    ).toContain("无归因量（端点不返回）");
  });

  it("⑦ 删除：真发 DELETE …/perturbations/:pid，清单重取后那一条真的没了（世界态不回滚）", async () => {
    const user = userEvent.setup();
    seedPerturbation({ magnitude: -10, mode: "delta", label: "x" });
    mount();
    await screen.findByTestId("sandbox-view");
    await user.click(await screen.findByTestId("ptl-bar-simpert_1"));
    await user.click(await screen.findByTestId("ptl-delete-simpert_1"));

    await waitFor(() => expect(deleteCalls, "点了删除但没发 DELETE").toEqual(["simpert_1"]));
    await waitFor(() => expect(screen.queryByTestId("ptl-bar-simpert_1"), "删完清单没重取 ⇒ 屏上还挂着一条不存在的扰动").toBeNull());
    await screen.findByTestId("ptl-empty");
  });

  it("⑧ 事件层：另一个标签页施加了扰动 → sim.perturbation_created → 本页时间轴真的多一条", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("ptl-empty");

    // 另一个标签页（或另一个用户）施加了一条：服务端有了，本页尚不知情。
    seedPerturbation({ magnitude: 7, mode: "delta", label: "from-other-tab" });

    // ★ 前置：没发事件之前，屏上**不该**自己冒出来 —— 否则下面那条证明不了是事件的功劳。
    expect(
      screen.queryByTestId("ptl-bar-simpert_1"),
      "还没发事件就已经在屏上了 ⇒ 是别的机制刷出来的，本条断言不成立（staleTime:Infinity 就是为了这个）",
    ).toBeNull();

    // ★ 事件到达（真实链路：datacore outbox → useDomainEventStream 轮询 → 同一个函数）。
    invalidateForEvent("sim.perturbation_created");

    await waitFor(() =>
      expect(
        screen.getByTestId("ptl-bar-simpert_1"),
        "事件到了但时间轴没变 ⇒ EVENT_INVALIDATES / LABEL_TO_KEYS 那一跳断了",
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(within(timeline()).getByTestId("ptl-total").textContent).toBe("1"));
  });

  it("⑨ 反证：事件名拼错一个字母 → 时间轴什么都不变（证咬的是真事件名，不是任意字符串）", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("ptl-empty");
    seedPerturbation({ magnitude: 7, mode: "delta", label: "from-other-tab" });

    const hitsBefore = listHits;
    for (const bad of ["sim.perturbation_create", "sim.perturbations_created", "sim_perturbation_created", "sim.perturbation_createdd"]) {
      invalidateForEvent(bad);
    }
    // 给足一轮微任务/重取窗口，再断言"什么都没发生"。
    await new Promise((r) => setTimeout(r, 60));
    expect(listHits, "拼错的事件名也触发了重取 ⇒ 失效表咬的不是事件名").toBe(hitsBefore);
    expect(screen.queryByTestId("ptl-bar-simpert_1")).toBeNull();
  });
});
