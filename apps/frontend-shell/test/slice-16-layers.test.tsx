import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { __resetSliceGovMock } from "@/mocks/handlers";
import SliceLayersPanel from "@/pages/admin/SliceLayersPanel";

/**
 * WO-SLICE-16-LAYERS 接缝驱动测试。
 *
 * **头号判据（SEAM-GATE）**：界面上逐层显示的计数，必须来自后端响应，不是页面常数。
 * 所以下面的断言一律**先改后端响应、再断言界面跟着变**（变异反证），
 * 而不是断言某个写死的数字 —— 后者只能证明「组件会渲染」，证明不了「接线通」。
 *
 * 判据二（诚实两向）：有数据的层渲染数据；缺席的层渲染诚实说明**且不渲染占位内容**。
 */

/** 造一条形状与真后端契约一致的 layers 响应；n[i] = 第 i 层的条数（0 = 该层无数据）。 */
function layersFixture(opts: {
  sliceKey?: string;
  counts: number[]; // 16 个
  platform?: Record<number, number>; // ordinal → 平台条数（用于 not_in_slice）
  reasons?: Record<number, string>; // ordinal → 结构性缺席原因（用于 absent）
  /** 子图未解出（真后端 graph.empty）——「层没数据」与「子图没解出来」是两件事。 */
  empty?: {
    reason: "missing_args" | "no_root_objects" | "no_match";
    requiredArgs: string[];
    missingArgs: string[];
    rootObjectTotal: number;
    argCandidates: { arg: string; values: string[] }[];
    message: string;
  };
  graphNodes?: number;
}) {
  const ids = [
    "business_scenario", "decision_intent", "object", "property", "relation", "event",
    "state", "metric", "time", "rule", "constraint", "data_binding", "scenario",
    "evidence", "action", "governance",
  ];
  const layers = ids.map((id, i) => {
    const ordinal = i + 1;
    const count = opts.counts[i] ?? 0;
    const platformCount = opts.platform?.[ordinal];
    const reason = opts.reasons?.[ordinal];
    const status = count > 0 ? "present" : (platformCount ?? 0) > 0 && !reason ? "not_in_slice" : "absent";
    return {
      id, ordinal, status, count,
      unit: "条",
      carrier: `carrier_of_${id}`,
      ...(platformCount !== undefined ? { platformCount } : {}),
      ...(status !== "present" ? { absentReason: reason ?? `平台有 ${platformCount ?? 0} 条，本切片未纳入` } : {}),
      items: Array.from({ length: count }, (_, k) => ({
        key: `${id}-${k + 1}`, label: `${id}-item-${k + 1}`, group: "G", detail: `d${k + 1}`,
      })),
    };
  });
  return {
    sliceKey: opts.sliceKey ?? "model_capacity_network",
    version: 1,
    rootType: "Model",
    graph: {
      nodes: opts.graphNodes ?? 531,
      edges: 570,
      truncated: false,
      typeKeys: ["Model", "Base"],
      linkKeys: ["model_producible_at"],
      ...(opts.empty ? { empty: opts.empty } : {}),
    },
    snapshotVersion: "ov-77",
    layers,
    summary: {
      total: 16 as const,
      present: layers.filter((l) => l.status === "present").length,
      notInSlice: layers.filter((l) => l.status === "not_in_slice").length,
      absent: layers.filter((l) => l.status === "absent").length,
    },
  };
}

function stubLayers(body: ReturnType<typeof layersFixture>) {
  server.use(
    http.get("*/a/v1/ontology/slices/:sliceKey/layers", () => HttpResponse.json(body)),
  );
}

function renderPanel(sliceKey = "model_capacity_network") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SliceLayersPanel sliceKey={sliceKey} />
    </QueryClientProvider>,
  );
}

describe("WO-SLICE-16-LAYERS · 切片十六层结构", () => {
  beforeEach(() => __resetSliceGovMock());

  it("SEAM-1 接缝驱动：逐层计数来自后端响应（换一组数，界面 16 个数全跟着变）", async () => {
    // 第一组：一组彼此不同的计数，逐层对回去 —— 若界面用的是常数，必有一层对不上。
    const A = [0, 0, 9, 127, 5, 0, 32, 17, 10, 15, 13, 9, 12, 1, 0, 7];
    stubLayers(layersFixture({ counts: A, platform: { 6: 372, 15: 10 } }));
    const first = renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");
    const ids = [
      "business_scenario", "decision_intent", "object", "property", "relation", "event",
      "state", "metric", "time", "rule", "constraint", "data_binding", "scenario",
      "evidence", "action", "governance",
    ];
    for (let i = 0; i < 16; i++) {
      expect(
        screen.getByTestId(`slice-layer-count-model_capacity_network-${ids[i]}`).textContent,
        `第 ${i + 1} 层（${ids[i]}）计数应等于后端返回的 ${A[i]}`,
      ).toBe(String(A[i]));
    }
    // 首屏结论也来自响应（present = A 里 >0 的个数，由 A 现算而不是写死 —— 写死就又是常数）
    const presentA = A.filter((n) => n > 0).length;
    expect(screen.getByTestId("slice-layers-headline-model_capacity_network").textContent).toContain(`${presentA}/16`);
    // 子图规模同样来自响应，不是页面常数
    expect(screen.getByTestId("slice-layers-graph-model_capacity_network").textContent).toContain("531");
    expect(screen.getByTestId("slice-layers-graph-model_capacity_network").textContent).toContain("570");
    first.unmount();

    // 第二组（变异）：把每一层的数都改掉 → 界面必须整组改变。
    const B = [2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8];
    stubLayers(layersFixture({ counts: B }));
    renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");
    for (let i = 0; i < 16; i++) {
      expect(screen.getByTestId(`slice-layer-count-model_capacity_network-${ids[i]}`).textContent).toBe(String(B[i]));
    }
    expect(screen.getByTestId("slice-layers-headline-model_capacity_network").textContent).toContain("16/16");
  });

  it("SEAM-2 诚实两向：有数据的层渲染明细；缺席的层只渲染原因、零明细行（不画占位）", async () => {
    stubLayers(
      layersFixture({
        counts: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        platform: { 6: 372 },
        reasons: { 1: "AgentCore 只上报 rule 引用，从不产出 kind:slice ⇒ 反查恒空" },
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");

    // ── 正向：有数据的层（③对象=3 条）展开后渲染 3 行明细 ──
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-object"));
    const detail = await screen.findByTestId("slice-layer-detail-model_capacity_network-object");
    expect(within(detail).getAllByTestId(/^slice-layer-item-/)).toHaveLength(3);
    expect(screen.queryByTestId("slice-layer-reason-model_capacity_network-object")).toBeNull();

    // ── 反向 a：平台有、本切片未纳入（⑥事件）→ 标 not_in_slice + 平台条数，且零明细行 ──
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-event").textContent).toContain("本切片未纳入");
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-event").textContent).toContain("372");
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-event"));
    const evDetail = await screen.findByTestId("slice-layer-detail-model_capacity_network-event");
    expect(within(evDetail).queryAllByTestId(/^slice-layer-item-/)).toHaveLength(0); // 绝不画占位内容
    expect(screen.getByTestId("slice-layer-reason-model_capacity_network-event").textContent).toBeTruthy();

    // ── 反向 b：结构性缺席（①业务场景）→ 标 absent + 说明缺在哪一环，且零明细行 ──
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-business_scenario").textContent).toContain("缺席");
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-business_scenario"));
    const bsDetail = await screen.findByTestId("slice-layer-detail-model_capacity_network-business_scenario");
    expect(within(bsDetail).queryAllByTestId(/^slice-layer-item-/)).toHaveLength(0);
    expect(screen.getByTestId("slice-layer-reason-model_capacity_network-business_scenario").textContent).toContain(
      "从不产出 kind:slice",
    );
  });

  it("SEAM-3 变异反证：把某层数据改空 → 该层从「有数据」翻成诚实态，且明细行消失", async () => {
    const user = userEvent.setup();
    // 变异前：⑩规则 15 条 → present，展开有 15 行
    stubLayers(layersFixture({ counts: [0, 0, 2, 0, 0, 0, 0, 0, 0, 15, 0, 0, 0, 0, 0, 0], platform: { 10: 28 } }));
    const before = renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-rule").textContent).toBe("15");
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-rule").textContent).toContain("有数据");
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-rule"));
    expect(
      within(await screen.findByTestId("slice-layer-detail-model_capacity_network-rule")).getAllByTestId(/^slice-layer-item-/),
    ).toHaveLength(15);
    before.unmount();

    // 变异后：同一层改成 0（平台仍有 28 条）→ 必须翻成 not_in_slice + 零明细行 + 给出原因
    stubLayers(layersFixture({ counts: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], platform: { 10: 28 } }));
    renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-rule").textContent).toBe("0");
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-rule").textContent).not.toContain("有数据");
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-rule").textContent).toContain("28");
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-rule"));
    const after = await screen.findByTestId("slice-layer-detail-model_capacity_network-rule");
    expect(within(after).queryAllByTestId(/^slice-layer-item-/)).toHaveLength(0);
    expect(screen.getByTestId("slice-layer-reason-model_capacity_network-rule").textContent).toBeTruthy();
  });

  it("SEAM-4 恒 16 层 + 承载物/口径进浮层（第一层留记号，不静默删除）", async () => {
    const user = userEvent.setup();
    stubLayers(layersFixture({ counts: Array<number>(16).fill(1) }));
    renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");
    // 层数守恒：少一层界面上立刻看得见
    expect(screen.getByTestId("slice-layers-total-model_capacity_network").textContent).toContain("16");
    // 浮层：承载物是「凭什么」，属于浮层不属于第一层；但第一层必须留可见记号
    const mark = screen.getByTestId("slice-layer-why-model_capacity_network-rule");
    expect(mark).toBeTruthy();
    expect(screen.queryByTestId("slice-layer-why-model_capacity_network-rule-pop")).toBeNull();
    // 坑①：onClick 幂等 setOpen(true)，**不取反** —— 连点两次仍是开着的
    await user.click(mark);
    expect(await screen.findByTestId("slice-layer-why-model_capacity_network-rule-pop")).toBeTruthy();
    await user.click(mark);
    expect(screen.getByTestId("slice-layer-why-model_capacity_network-rule-pop")).toBeTruthy();
    // 坑②：戴 popover-surface（不自写背景，否则底下正文透上来 · 欠账 #104）
    expect(
      screen.getByTestId("slice-layer-why-model_capacity_network-rule-pop").className,
    ).toContain("popover-surface");
    expect(screen.getByTestId("slice-layer-why-model_capacity_network-rule-pop").textContent).toContain("carrier_of_rule");
  });

  it("SEAM-5 页面接线：本体切片页点切片行 → 就地出现十六层结构（走 MSW 默认 handler，非本用例 stub）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const { router } = renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    // 第一层结论：切片总数 + 多跳/覆盖拆分（来自 fetchSlices 响应，非常数）。
    // 先等行渲染出来再断言总数 —— 页面骨架先于数据到达，直接断言会读到加载中的 0。
    await screen.findByTestId("slice-row-model_capacity_network");
    expect(screen.getByTestId("slices-total").textContent).toBe("2");
    expect(screen.getByTestId("slices-breakdown").textContent).toContain("多跳业务切片");

    await user.click(screen.getByTestId("slice-row-model_capacity_network"));
    await screen.findByTestId("slice-layers-model_capacity_network");
    // 默认 handler 的三态：present 12 / not_in_slice 1（⑥事件 平台 372）/ absent 3（①②⑮）
    await waitFor(() =>
      expect(screen.getByTestId("slice-layers-summary-model_capacity_network").textContent).toMatch(
        /\d+ 层有数据 · \d+ 层平台有但本切片未纳入 · \d+ 层缺席/,
      ),
    );
    expect(screen.getByTestId("slice-layer-status-model_capacity_network-event").textContent).toContain("372");
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-action").textContent).toBe("0");
    // 不跳转（G-VIS 就地展开）
    expect(router.state.location.pathname).toBe("/admin/slices");
  });

  /**
   * SEAM-6 —— 复核补的一组：**「子图没解出来」不许被读成「平台没有这十六层」**。
   *
   * 真后端实测（4093 端口逐条跑完 98 条切片）：无参调用时 12 条空子图，其中 **4 条正是
   * 首屏默认只显示的多跳业务切片**（root selector 写着 `{{args.so}}` / `{{args.key}}`）。
   * 也就是说不接这块，仓主点开首屏那 4 条里的任何一条，看到的仍然是十六张空卡 ——
   * 「看不到」这个原始投诉换个位置原样复发。
   */
  it("SEAM-6a 空子图必须先说清楚为什么：短结论进第一层，长因由只在浮层（诚实位降层但留记号）", async () => {
    const user = userEvent.setup();
    const MSG = "子图为空是因为缺试切参数：该切片的 root selector 声明了 {{args.so}}，本次未提供 so ⇒ root 过滤恒不匹配。";
    stubLayers(
      layersFixture({
        counts: Array<number>(16).fill(0),
        graphNodes: 0,
        platform: { 6: 372, 10: 28 },
        empty: {
          reason: "missing_args",
          requiredArgs: ["so"],
          missingArgs: ["so"],
          rootObjectTotal: 24,
          argCandidates: [{ arg: "so", values: ["SO-3391", "SO-3402"] }],
          message: MSG,
        },
      }),
    );
    renderPanel();
    await screen.findByTestId("slice-layers-model_capacity_network");

    // 第一层：给出**短结论**（是"子图没解出来"，不是"平台没有"）+ 状态徽标
    const bar = await screen.findByTestId("slice-layers-empty-model_capacity_network");
    expect(within(bar).getByTestId("slice-layers-empty-title-model_capacity_network").textContent).toContain("子图未解出");
    // R-UI-3：长因由（口径/解释）**不在第一层**，只在浮层 —— 但第一层留了 ⚠ 记号
    expect(screen.queryByTestId("slice-layers-empty-message-model_capacity_network")).toBeNull();
    const why = screen.getByTestId("slice-layers-empty-why-model_capacity_network");
    expect(why).toBeTruthy();
    await user.click(why);
    const pop = await screen.findByTestId("slice-layers-empty-why-model_capacity_network-pop");
    expect(pop.className).toContain("popover-surface"); // 不自写背景（欠账 #104）
    expect(pop.textContent).toContain("缺试切参数");

    /*
     * WO-UI-BURNDOWN-21 · **降层 ≠ 删除**（`docs/CONVENTION-ui-information-layering.md` §1）
     *
     * 「缺席的层不画占位内容」这条**平台策略**从第一层降进了 `?` 浮层。
     * 它是诚实位，§1 的红线是「允许降到浮层，**绝不允许删除**」——
     * 只有「第一层不再有它」这一半断言的话，把它整段删掉也会绿，那正好是红线要拦的事。
     * 故三判据 + 反向断言配成一对。
     * ⚠ `InfoPopover` 在 `open===false` 时**不渲染**，故写 `toBeNull()`；
     *   写 `not.toBeVisible()` 会让 jest-dom 自己抛错，那是测试报错不是判据成立。
     */
    const honestyTrigger = screen.getByTestId("info-slice-layers-honesty-model_capacity_network");
    expect(honestyTrigger).toBeVisible(); // ① 第一层留着可见记号
    expect(screen.queryByTestId("slice-layers-honesty-body-model_capacity_network")).toBeNull(); // ②
    // ④ 反向：这句策略不许还摆在第一层
    expect(
      screen.getByTestId("slice-layers-model_capacity_network").textContent,
      "策略说明还留在第一层 ⇒ 没降层",
    ).not.toContain("宁可显示空并说明为什么");
    // ③ hover 后原文一字不少
    await user.hover(honestyTrigger);
    const honestyBody = await screen.findByTestId("slice-layers-honesty-body-model_capacity_network");
    expect(honestyBody).toBeVisible();
    expect(honestyBody.textContent).toContain("缺席的层不画占位内容");
    expect(honestyBody.textContent).toContain("本平台宁可显示空并说明为什么，也不画假数据");
    await user.unhover(honestyTrigger);

    // 十六层仍然全在（层数守恒），且**一条占位明细都不许有**
    expect(screen.getByTestId("slice-layers-total-model_capacity_network").textContent).toContain("16");
    await user.click(screen.getByTestId("slice-layer-card-model_capacity_network-rule"));
    const detail = await screen.findByTestId("slice-layer-detail-model_capacity_network-rule");
    expect(within(detail).queryAllByTestId(/^slice-layer-item-/)).toHaveLength(0);
  });

  /**
   * ⚠ WO-SLICE-DEFAULT-ARGS 改写了本例的**前半段**（行为变更，不是为了让测试变绿）：
   * 面板现在首屏**默认就注入一个真实实参**（值取自后端 argCandidates 的第一个），
   * 所以「一打开就看见空子图条 + 候选按钮」这个旧前提不再成立 —— 那正是本单要消灭的画面。
   * 后半段（清空 → 诚实态 → 手选候选 → 请求真带上 args → 界面翻面）原样保留，
   * 老断言一条没删，只是挪到「用户主动要看原始态」之后。
   */
  it("SEAM-6b 候选值来自后端且真能试切：默认自动带上第一个真值；清空后手选一个 → 请求带上 args → 界面翻成有数据", async () => {
    const user = userEvent.setup();
    const seenArgs: (string | null)[] = [];
    const emptyBody = layersFixture({
      counts: Array<number>(16).fill(0),
      graphNodes: 0,
      empty: {
        reason: "missing_args",
        requiredArgs: ["so"],
        missingArgs: ["so"],
        rootObjectTotal: 24,
        argCandidates: [{ arg: "so", values: ["SO-3391", "SO-3402"] }],
        message: "缺 so",
      },
    });
    const filledBody = layersFixture({ counts: [0, 0, 9, 127, 5, 0, 32, 17, 10, 15, 13, 9, 12, 1, 0, 7] });
    server.use(
      http.get("*/a/v1/ontology/slices/:sliceKey/layers", ({ request }) => {
        const a = new URL(request.url).searchParams.get("args");
        seenArgs.push(a);
        // 后端行为的忠实模拟：给了参数才解得出子图。
        return HttpResponse.json(a && a.includes("SO-3391") ? filledBody : emptyBody);
      }),
    );
    renderPanel();
    // ── 新前提（WO-SLICE-DEFAULT-ARGS）：首屏默认就解出来了，不再是十六张空卡 ──
    await screen.findByTestId("slice-layers-applied-model_capacity_network");
    expect(seenArgs[0]).toBeNull(); // 首次不带 args（探"需要哪些参数 + 能填什么"）
    await waitFor(() => expect(seenArgs.some((a) => a !== null && a.includes("SO-3391"))).toBe(true));
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-property").textContent).toBe("127");
    expect(screen.getByTestId("slice-layers-autodefault-model_capacity_network")).toBeTruthy();
    expect(screen.queryByTestId("slice-layers-empty-model_capacity_network")).toBeNull();

    // ── 用户要看原始诚实态：清空参数 → 空子图条回来，候选值仍来自后端 ──
    await user.click(screen.getByTestId("slice-layers-clearargs-model_capacity_network"));
    await screen.findByTestId("slice-layers-empty-model_capacity_network");
    // 候选值是后端给的两个真值，不是页面写死的
    expect(screen.getByTestId("slice-layers-cand-model_capacity_network-so-SO-3391")).toBeTruthy();
    expect(screen.getByTestId("slice-layers-cand-model_capacity_network-so-SO-3402")).toBeTruthy();

    await user.click(screen.getByTestId("slice-layers-cand-model_capacity_network-so-SO-3391"));
    // 接缝：点击必须真的把参数发出去（不是本地假装）
    await waitFor(() => expect(seenArgs.some((a) => a !== null && a.includes("SO-3391"))).toBe(true));
    // 界面随后端翻面：空子图条消失、层计数变成后端返回的那组
    await waitFor(() => expect(screen.queryByTestId("slice-layers-empty-model_capacity_network")).toBeNull());
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-property").textContent).toBe("127");
    expect(screen.getByTestId("slice-layer-count-model_capacity_network-rule").textContent).toBe("15");
    // 当前生效参数显式摆在第一层（否则用户不知道自己在看哪个 root 的切片）
    expect(screen.getByTestId("slice-layers-applied-model_capacity_network").textContent).toContain("so=SO-3391");
  });

  it("SEAM-6c 取不到候选就明说取不到（诚实留白，绝不拿假值凑）", async () => {
    stubLayers(
      layersFixture({
        counts: Array<number>(16).fill(0),
        graphNodes: 0,
        empty: {
          reason: "no_match",
          requiredArgs: ["so"],
          missingArgs: [],
          rootObjectTotal: 24,
          argCandidates: [{ arg: "so", values: [] }], // 真取不到
          message: "过滤后无匹配",
        },
      }),
    );
    renderPanel();
    await screen.findByTestId("slice-layers-empty-model_capacity_network");
    expect(screen.getByTestId("slice-layers-nocand-model_capacity_network-so").textContent).toContain("取不到候选值");
    // 一个候选按钮都不许凭空造出来
    expect(screen.queryAllByTestId(/^slice-layers-cand-/)).toHaveLength(0);
    expect(screen.getByTestId("slice-layers-empty-title-model_capacity_network").textContent).toContain("过滤无匹配");
  });
});
