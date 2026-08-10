import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { __resetSliceGovMock } from "@/mocks/handlers";

/**
 * WO-SLICE-DEFAULT-ARGS 接缝驱动测试 —— 「首屏默认那 4 条多跳切片点开就是十六张空卡」。
 *
 * ⚠ 本文件**不直接渲染 SliceLayersPanel**。只测「这个函数会解析 args」= 假绿第 9 形态
 * （咬的是函数不是链路）。这里一律走**面板默认加载的那条真实生产路径**：
 *   `renderApp("/admin/slices")` → SlicesPage（默认 scope="multihop"，`SlicesPage.tsx:39-41`）
 *   → 点切片行 → SliceInspector → SliceLayersPanel（**调用方给什么 args 就是什么**）。
 * 任何一环把实参丢了，下面的断言都会红。
 *
 * ── 病灶取证（真后端实测 2026-08-10 · demo 租户 · seed 42 · 内存模式 4093 端口亲手跑）──
 *   要求的实参（切片定义）            × 实际传的实参（生产调用侧）
 *   order_fulfillment_360 {{args.so}}   （battery.ts:2447）  × {}  ⇒ 交集空
 *   order_to_cash_720     {{args.so}}   （battery.ts:2492）  × {}  ⇒ 交集空
 *   enterprise_360        {{args.so}}   （battery.ts:2560）  × {}  ⇒ 交集空
 *   aop_scenario_chain    {{args.key}}  （battery.ts:2601）  × {}  ⇒ 交集空
 *   实测：无参 `nodes=0 edges=0 present=3/16`；给 `{"so":"SO-3391"}` → `nodes=531 edges=570 present=12/16`。
 *
 * 下面的 mock **忠实复刻这一行为**（给对参数才解得出子图），否则测的就不是这条链。
 * 数字与候选值全部照抄那次实测输出，不是编的。
 */

const LAYER_IDS = [
  "business_scenario", "decision_intent", "object", "property", "relation", "event",
  "state", "metric", "time", "rule", "constraint", "data_binding", "scenario",
  "evidence", "action", "governance",
] as const;

/** 真后端 `GET …/layers?args={"so":"SO-3391"}` 的层计数（order_fulfillment_360 · 实测）。 */
const COUNTS_RESOLVED: Record<string, number> = {
  object: 9, property: 127, relation: 9, event: 0, state: 32, metric: 17, time: 10,
  rule: 15, constraint: 13, data_binding: 9, scenario: 12, evidence: 1, action: 0,
  governance: 9, business_scenario: 0, decision_intent: 0,
};
/**
 * 真后端**无参**时的层计数（实测 present=3：constraint/evidence/governance 各 1）。
 * 复刻这一点很关键 —— 它正是旧界面敢在缺参时打出「3/16 层有数据」的来源：
 * 那 3 条根本不来自子图，却被摆在第一层当结论。测试若图省事写成"全 0"，
 * 就测不到这个坑（也就抓不住把默认实参改回 `{}` 的变异）。
 */
const COUNTS_UNRESOLVED: Record<string, number> = Object.fromEntries(
  LAYER_IDS.map((id) => [id, id === "constraint" || id === "evidence" || id === "governance" ? 1 : 0]),
);
const PLATFORM: Record<string, number> = { event: 372, rule: 28, scenario: 13, action: 10 };

/** 首屏默认列出的 4 条多跳业务切片（真租户实测：98 条切片里多跳恰好这 4 条）。 */
const MULTIHOP = [
  { sliceKey: "order_fulfillment_360", rootType: "Order", hops: 12, arg: "so" },
  { sliceKey: "order_to_cash_720", rootType: "Order", hops: 23, arg: "so" },
  { sliceKey: "enterprise_360", rootType: "Order", hops: 31, arg: "so" },
  { sliceKey: "aop_scenario_chain", rootType: "AnnualScenario", hops: 3, arg: "key" },
] as const;
/** 后端从**真 root 对象**上读出来的候选值（实测原文，按 objectKey 字典序）。 */
const CANDIDATES: Record<string, string[]> = {
  so: ["SO-3391", "SO-3402", "SO-3415", "SO-3420"],
  key: ["aggressive", "baseline", "conservative"],
};
const ROOT_TOTAL: Record<string, number> = { so: 24, key: 3 };

/**
 * 注意区分两件事（真后端也是两件事）：
 *  - `VALID`：填进去**真能解出子图**的值域（root 对象实际存在的键）。
 *  - `candidates`：后端**能不能把这些值当候选报出来**（`argCandidates`）。取不到时为空数组
 *    （诚实留白），但用户自填一个对的值照样解得出 —— 所以诚实态不是死路。
 */
function layersBody(sliceKey: string, rootType: string, argName: string, given: string | undefined, candidates: string[]) {
  const resolved = given !== undefined && (CANDIDATES[argName] ?? []).includes(given);
  const counts = resolved ? COUNTS_RESOLVED : COUNTS_UNRESOLVED;
  const layers = LAYER_IDS.map((id, i) => {
    const count = counts[id] ?? 0;
    const platformCount = PLATFORM[id];
    const status = count > 0 ? "present" : (platformCount ?? 0) > 0 ? "not_in_slice" : "absent";
    return {
      id, ordinal: i + 1, status, count, unit: "条",
      carrier: `carrier_of_${id}`,
      ...(platformCount !== undefined ? { platformCount } : {}),
      ...(status !== "present"
        ? {
            absentReason: resolved
              ? `平台有 ${platformCount ?? 0} 条，但本切片的路径没纳入。`
              : `本切片未解出子图 ⇒ 这一层还没被判定过（不是「平台没有」）。`,
          }
        : {}),
      items: Array.from({ length: count }, (_, k) => ({ key: `${id}-${k + 1}`, label: `${id}-${k + 1}`, group: rootType, detail: `d${k + 1}` })),
    };
  });
  return {
    sliceKey, version: 1, rootType,
    graph: {
      nodes: resolved ? 531 : 0,
      edges: resolved ? 570 : 0,
      truncated: false,
      typeKeys: resolved ? [rootType, "Base", "Model"] : [],
      linkKeys: resolved ? ["order_for_model"] : [],
      ...(resolved
        ? {}
        : {
            empty: {
              reason: "missing_args" as const,
              requiredArgs: [argName],
              missingArgs: [argName],
              rootObjectTotal: ROOT_TOTAL[argName] ?? 0,
              argCandidates: [{ arg: argName, values: candidates }],
              message: `子图为空是因为**缺试切参数**：该切片的 root selector 声明了 {{args.${argName}}}，本次未提供 ${argName} ⇒ root 过滤恒不匹配。`,
            },
          }),
    },
    snapshotVersion: "ov-77",
    layers,
    summary: {
      total: 16,
      present: layers.filter((l) => l.status === "present").length,
      notInSlice: layers.filter((l) => l.status === "not_in_slice").length,
      absent: layers.filter((l) => l.status === "absent").length,
    },
  };
}

/** 装上忠实 mock；`candidatesOverride` 用来制造「后端取不到候选」那一支（诚实态）。 */
function installSliceMocks(opts: { candidatesOverride?: Record<string, string[]> } = {}) {
  const seen: { key: string; args: string | null }[] = [];
  const candsFor = (arg: string) => opts.candidatesOverride?.[arg] ?? CANDIDATES[arg] ?? [];
  server.use(
    // 切片清单：4 条多跳 + 2 条覆盖切片（真租户 94 条覆盖切片，取 2 条足以驱动「默认只看多跳」的过滤）
    http.get("*/a/v1/ontology/slices", () =>
      HttpResponse.json([
        ...MULTIHOP.map((m) => ({
          sliceKey: m.sliceKey, version: 1, rootType: m.rootType, hops: m.hops,
          linkKeys: ["order_for_model"], maxNodes: 600, fixtures: 1,
        })),
        { sliceKey: "coverage_order", version: 1, rootType: "Order", hops: 0, linkKeys: [], maxNodes: 200, fixtures: 0 },
        { sliceKey: "coverage_base", version: 1, rootType: "Base", hops: 0, linkKeys: [], maxNodes: 200, fixtures: 0 },
      ]),
    ),
    // ⚠ 必须排在 `/slices/:sliceKey` 之前（MSW 按注册序匹配）。
    http.get("*/a/v1/ontology/slices/:sliceKey/layers", ({ request, params }) => {
      const key = String(params.sliceKey);
      const m = MULTIHOP.find((x) => x.sliceKey === key);
      const raw = new URL(request.url).searchParams.get("args");
      seen.push({ key, args: raw });
      if (!m) return HttpResponse.json(layersBody(key, "Order", "so", "SO-3391", CANDIDATES.so!));
      let given: string | undefined;
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const v = parsed[m.arg];
        if (typeof v === "string") given = v;
      }
      return HttpResponse.json(layersBody(key, m.rootType, m.arg, given, candsFor(m.arg)));
    }),
    // 内联子图：与 layers 同口径 —— 给对参数才有节点（真后端 executeSlice 就是这样）。
    http.post("*/a/v1/ontology/slices/:sliceKey/resolve", async ({ request, params }) => {
      const key = String(params.sliceKey);
      const m = MULTIHOP.find((x) => x.sliceKey === key);
      const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
      const v = m ? body.args?.[m.arg] : undefined;
      const resolved = typeof v === "string" && (CANDIDATES[m!.arg] ?? []).includes(v);
      return HttpResponse.json({
        nodes: resolved
          ? [
              { id: "n1", typeKey: m!.rootType, objectKey: String(v), props: {} },
              { id: "n2", typeKey: "Model", objectKey: "M-1", props: {} },
            ]
          : [],
        edges: resolved ? [{ linkKey: "order_for_model", from: "n1", to: "n2" }] : [],
        truncated: false,
        snapshotVersion: "ov-77",
      });
    }),
    http.get("*/a/v1/ontology/slices/:sliceKey", ({ params }) => {
      const key = String(params.sliceKey);
      const m = MULTIHOP.find((x) => x.sliceKey === key);
      return HttpResponse.json({
        sliceKey: key,
        version: 1,
        spec: {
          root: { typeKey: m?.rootType ?? "Order", selector: { byKey: `{{args.${m?.arg ?? "so"}}}` } },
          paths: [[{ linkKey: "order_for_model", direction: "out" }]],
          maxNodes: 600,
          contractFixtures: [],
        },
      });
    }),
  );
  return seen;
}

const countsOf = (sliceKey: string) =>
  LAYER_IDS.map((id) => screen.getByTestId(`slice-layer-count-${sliceKey}-${id}`).textContent ?? "");
const statusesOf = (sliceKey: string) =>
  LAYER_IDS.map((id) => screen.getByTestId(`slice-layer-status-${sliceKey}-${id}`).textContent ?? "");

/**
 * 「空卡」判据（本单硬性纪律）。**这个判据自己被变异反证修过一次，记在此处备忘**：
 * 初版写成「全部十六张都是 0/— 且有卡标缺席」，**抓不住回归** —— 真后端在子图为空时
 * 仍会回 `constraint/evidence/governance` 各 1 条（它们不来自子图），于是 counts 里永远有
 * 非 0 值，「全空」这个前提恒假、断言恒过。**拿一个看起来相关的数字当判据，而它并不度量
 * 我要度量的东西**（CLAUDE.md 铁律 0.6 的同一形态）。改成按「子图解没解出来」分支判：
 *
 *  - 子图**未**解出（屏上有 `slice-layers-empty-*`）⇒ 十六层压根没算过 ⇒
 *    **任何一张卡都不许自称「缺席 / 未纳入」**（那是"查过了、平台没有"的口气 = 静默错答）。
 *  - 子图**已**解出 ⇒ 必须真有内容，否则就是"点开一片空白"。
 */
function expectNoBlankCards(sliceKey: string) {
  const counts = countsOf(sliceKey);
  const statuses = statusesOf(sliceKey);
  const unresolved = screen.queryByTestId(`slice-layers-empty-${sliceKey}`) !== null;
  if (unresolved) {
    const liars = statuses.filter((s) => s.includes("缺席") || s.includes("未纳入"));
    expect(
      liars,
      `「十六张空卡」复发：子图未解出（算不了），却有 ${liars.length} 张卡自称已判定 —— ` +
        `把「算不了」显示成了「查了确实为空」。statuses=${JSON.stringify(statuses)} counts=${JSON.stringify(counts)}`,
    ).toHaveLength(0);
  } else {
    expect(
      counts.some((c) => c !== "0" && c !== "—"),
      `「十六张空卡」复发：子图已解出，十六张卡却全是空的 counts=${JSON.stringify(counts)}`,
    ).toBe(true);
  }
}

describe("WO-SLICE-DEFAULT-ARGS · 首屏默认那 4 条多跳切片不许再是十六张空卡", () => {
  beforeEach(() => __resetSliceGovMock());

  it("SEAM-D1 走真实默认路径：首屏点开 4 条多跳切片，每条都自动带上**真实实参**并解出十六层（零空卡）", async () => {
    const user = userEvent.setup();
    const seen = installSliceMocks();
    loginAs("planner");
    const { router } = renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    await screen.findByTestId(`slice-row-${MULTIHOP[0].sliceKey}`);
    // 首屏默认 scope=multihop ⇒ 表里就是这 4 条（本单说的「首屏默认那 4 条」= 这里）
    expect(screen.getByTestId("slices-breakdown").textContent).toContain("多跳业务切片");
    for (const m of MULTIHOP) expect(screen.getByTestId(`slice-row-${m.sliceKey}`)).toBeTruthy();
    expect(screen.queryByTestId("slice-row-coverage_order")).toBeNull();

    for (const m of MULTIHOP) {
      await user.click(screen.getByTestId(`slice-row-${m.sliceKey}`));
      await screen.findByTestId(`slice-layers-${m.sliceKey}`);
      const expected = CANDIDATES[m.arg]![0]!;

      // ① 接缝：默认实参**真的发到了后端**（不是本地假装）。首个请求无参（探需要哪些参数），
      //    随后必须出现一次带上后端候选值的请求 —— 这条断言是本单的命脉。
      await waitFor(() =>
        expect(
          seen.some((s) => s.key === m.sliceKey && s.args !== null && s.args.includes(expected)),
          `${m.sliceKey}：默认实参没发出去，seen=${JSON.stringify(seen.filter((s) => s.key === m.sliceKey))}`,
        ).toBe(true),
      );
      expect(seen.find((s) => s.key === m.sliceKey)!.args).toBeNull();

      // ② 结果：十六层解出来了（不是空卡）。计数来自后端响应，不是页面常数。
      await waitFor(() =>
        expect(screen.getByTestId(`slice-layer-count-${m.sliceKey}-property`).textContent).toBe("127"),
      );
      expect(screen.getByTestId(`slice-layer-count-${m.sliceKey}-rule`).textContent).toBe("15");
      expect(screen.getByTestId(`slice-layers-headline-${m.sliceKey}`).textContent).toContain("12/16");
      expect(screen.queryByTestId(`slice-layers-empty-${m.sliceKey}`)).toBeNull();
      expectNoBlankCards(m.sliceKey);

      // ③ 诚实位：当前用的是哪个实参必须**显式摆在屏上**，并说明它是自动取的默认值。
      const applied = screen.getByTestId(`slice-layers-applied-${m.sliceKey}`);
      expect(applied.textContent).toContain(`${m.arg}=${expected}`);
      expect(screen.getByTestId(`slice-layers-autodefault-${m.sliceKey}`)).toBeTruthy();

      // ④ 内联子图与十六层看的是**同一个 root**（否则会出现「上面有数据、下面 0 节点」的自相矛盾）
      await waitFor(() => expect(screen.queryByTestId(`slice-graph-empty-${m.sliceKey}`)).toBeNull());
      expect(screen.getByTestId(`slice-graph-nodes-${m.sliceKey}`).textContent).toBe("2");

      await user.click(screen.getByTestId(`slice-row-${m.sliceKey}`)); // 收起，换下一条
    }
    expect(router.state.location.pathname).toBe("/admin/slices"); // G-VIS：就地展开不跳转
  }, 60000);

  it("SEAM-D2 默认实参可换 root：点另一个候选 → 请求换值 → 屏上生效实参跟着换", async () => {
    const user = userEvent.setup();
    const seen = installSliceMocks();
    const key = MULTIHOP[0].sliceKey;
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId(`slice-row-${key}`);
    await user.click(screen.getByTestId(`slice-row-${key}`));
    await screen.findByTestId(`slice-layers-applied-${key}`);
    expect(screen.getByTestId(`slice-layers-applied-${key}`).textContent).toContain("so=SO-3391");

    // 候选按钮的值来自后端（首个无参响应留存的那份），不是页面写死
    await user.click(await screen.findByTestId(`slice-layers-cand-${key}-so-SO-3415`));
    await waitFor(() => expect(seen.some((s) => s.key === key && s.args?.includes("SO-3415"))).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId(`slice-layers-applied-${key}`).textContent).toContain("so=SO-3415"),
    );
    // 手动选过之后就不再是"默认实参"了，徽标必须撤掉（否则等于谎报来源）
    expect(screen.queryByTestId(`slice-layers-autodefault-${key}`)).toBeNull();
    expectNoBlankCards(key);
  }, 60000);

  it("SEAM-D3 诚实态兜底：后端取不到真实候选 ⇒ 不猜不编，显「需要参数」+ 选择入口，且十六张卡是「未判定」不是「缺席」", async () => {
    const user = userEvent.setup();
    // 后端候选为空 = 真取不到 ⇒ 修法 C：默认实参这条路走不通，必须诚实说「需要参数」
    installSliceMocks({ candidatesOverride: { so: [], key: [] } });
    const key = MULTIHOP[0].sliceKey;
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId(`slice-row-${key}`);
    await user.click(screen.getByTestId(`slice-row-${key}`));
    await screen.findByTestId(`slice-layers-${key}`);

    // 第一层：说清「需要哪几个参数」+ 给出选择/输入入口（不是一片空白）
    const bar = await screen.findByTestId(`slice-layers-empty-${key}`);
    expect(within(bar).getByTestId(`slice-layers-empty-title-${key}`).textContent).toContain("缺试切参数");
    expect(bar.textContent).toContain("需要参数：so");
    expect(screen.getByTestId(`slice-layers-nocand-${key}-so`).textContent).toContain("取不到候选值");
    expect(screen.getByTestId(`slice-layers-arginput-${key}-so`)).toBeTruthy(); // 选择入口

    // 「算不了」不许显示成「查了确实为空」：十六张卡一律 未判定 + `—`，绝不是「0 · 缺席」
    expectNoBlankCards(key);
    expect(countsOf(key).every((c) => c === "—"), `未判定态应显 —，实际 ${JSON.stringify(countsOf(key))}`).toBe(true);
    expect(statusesOf(key).every((s) => s.includes("未判定")), `状态应为「未判定」，实际 ${JSON.stringify(statusesOf(key))}`).toBe(true);
    expect(screen.getByTestId(`slice-layers-headline-${key}`).textContent).toContain("暂未判定");

    // 内联子图同样分得开：缺参数算不出来 ≠ 算了确实为空
    expect((await screen.findByTestId(`slice-graph-empty-${key}`)).textContent).toContain("需要 root 实参");

    // 自填一个真值 → 立刻解出（说明诚实态不是死路，是有出口的）
    await user.type(screen.getByTestId(`slice-layers-arginput-${key}-so`), "SO-3391");
    await user.click(screen.getByTestId(`slice-layers-argapply-${key}-so`));
    await waitFor(() => expect(screen.getByTestId(`slice-layer-count-${key}-property`).textContent).toBe("127"));
    expectNoBlankCards(key);
  }, 60000);
});
