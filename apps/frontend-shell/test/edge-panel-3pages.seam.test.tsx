import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { deriveDisruptionLayers, edgeKeyOf, type OTypeLite } from "@/views/DisruptionRadiusView";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ══ WO-EDGE-PANEL-3PAGES · 三页补「关掉一条边看结果怎么变」的接缝门 ══
 *
 * ── 本单在判什么（先说清楚，免得把「面板渲染出来了」读成「能用了」）────────────────
 * `WO-INFER-PAGE-SSOT` 把 `check-edge-active-mounts` 的受检名册从**手抄 9 条**改成**现算**之后，
 * 抖出三页此前**从未被那道门问过**的缺口（`G-GATE-ROSTER-HANDCOPIED` 的确切现场）：
 * `cleanroom-attr` / `disruption-radius` / `order-chain`。
 *
 * 本单**不是**把三个 `<EdgeActivePanel>` 补齐就算完 —— 那样做等于把「不适用」伪装成「符合」。
 * 逐页判定的结论（论据写在各页挂载点的注释里，不在这里复述）：
 *   · `order-chain`       ⇒ **可挂**（左导航「推演」组 · demo 传导边里 Order 是一等端点）
 *   · `disruption-radius` ⇒ **可挂**，且这一页有它**自己的**可关的边（本体 ref 反向扇出链），
 *                            故除共享面板外另配一套**页自有**的边开关：关掉一跳 ⇒ 扇出链改道或断链
 *                            ⇒ 半径 / 波及对象总数 / 分层 DAG **真的换一批数**。
 *   · `cleanroom-attr`    ⇒ **不适用**（理由见 `docs/PRD-harness-ux-adoption.md` §4.3 与本文件 §④）
 *
 * ── 三层判据（各咬一层，缺一层就有一种假绿）──────────────────────────────────────
 *  ① **可达层**：挂载点静态可达，且**与门脚本共用同一份 `analyze`** —— 抄一份出来就是装饰品
 *     （改门脚本判据时本文件拿旧的去测、照样绿）。
 *  ② **接缝层（共享面板）**：真 `renderApp` → 真路由 → 面板列出**真边** → 拨开关 →
 *     差值**带方向和量级**出现。且**关不同的边给出不同的数** —— 这一条是本文件的**变异反证锚**：
 *     把重算那一步（`simCounterfactual`）拆掉之后，面板照样在、边照样列、
 *     **只有这一条会红**，红在「数没变/数没出来」而不是「面板不见了」。
 *  ③ **接缝层（页自有边）**：`disruption-radius` 关掉一跳 ⇒ 屏上**本页自己的读数**真的变
 *     （`dr-radius` / `dr-total` / `dr-layer-*`），不是面板自己的差值表。
 *
 * ── 为什么不从手搓 props 起跑 ──────────────────────────────────────────────────
 * `render(<EdgeActivePanel rules={…} />)` 测的是**组件**，不是**链路**。本仓已栽过多次同一形态：
 * 组件实现有、测试全绿、**零生产调用方**。故本文件一律走 `renderApp("/v/<page>")`，
 * 不 mock `@/api/endpoints`（那会把病灶那一跳一起 mock 掉），断言落在**屏上真出现了什么**。
 */

/**
 * 门脚本 `scripts/check-edge-active-mounts.mjs` 导出的判定函数（**借用，不另写一份**）。
 * 门脚本有 `import.meta.url === argv[1]` 守卫，import 它不会跑门、不会 `process.exit`。
 */
type MountAnalysis = { ok: boolean; reason: string; mounts: number[]; outside?: number[]; range: [number, number] | null };
const loadAnalyze = async (): Promise<(src: string) => MountAnalysis> =>
  ((await import(resolve(__dirname, "../../../scripts/check-edge-active-mounts.mjs"))) as { analyze: (s: string) => MountAnalysis }).analyze;

/** MSW fixture 里的传导边 key（`MOCK_RULE_SEED`，`src/mocks/handlers.ts`）。 */
const EDGE_A = "mock_a_to_b"; // TypeA.s1 −(0.5)→ TypeB.s1
const EDGE_B = "mock_a_to_b_slow"; // TypeA.s2 −(0.25)→ TypeB.s2

// ══ disruption-radius 的本体夹具 ═════════════════════════════════════════════════════
/**
 * **刻意造成第一跳有两条候选边**（`Material.supplierRef` 与 `Warehouse.supplierRef`）——
 * 这是本文件与既有 `test/disruption-radius.test.tsx` 那条线性链夹具的**唯一实质差别**，
 * 也是它存在的理由：线性链只演得出「关掉 ⇒ 断链」，演不出「关掉 ⇒ **改道**」。
 * 而「改道」才是本页「关掉一条关系边」最容易被做错的那一半：
 * 若实现写成「截断到第 i−1 跳」，改道这一支永远不出现，且**看不出来**（数照样变小）。
 * 判据排序是 type→viaField 字典序 ⇒ `Material` < `Warehouse` ⇒ 默认走 Material 这条。
 */
const DR_TYPES = [
  { key: "Supplier", displayName: "供应商", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
  { key: "Material", displayName: "物料", status: "ACTIVE", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { key: "Warehouse", displayName: "仓库", status: "ACTIVE", properties: [{ propKey: "whId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { key: "Order", displayName: "销售订单", status: "ACTIVE", properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }] },
];
type DrObj = { id: string; type: string; props: Record<string, unknown> };
const DR_OBJECTS: Record<string, DrObj[]> = {
  Supplier: [{ id: "sup_1", type: "Supplier", props: { supplierId: "S1", name: "华东电解液" } }],
  Material: [
    { id: "m1", type: "Material", props: { matId: "M1", supplierRef: "S1" } },
    { id: "m2", type: "Material", props: { matId: "M2", supplierRef: "S1" } },
  ],
  Warehouse: [{ id: "w1", type: "Warehouse", props: { whId: "W1", supplierRef: "S1" } }],
  Order: [{ id: "o1", type: "Order", props: { soId: "O1", materialRef: "M1" } }],
};
const DR_PK: Record<string, string> = { Supplier: "supplierId", Material: "matId", Warehouse: "whId", Order: "soId" };

/**
 * 忠实迷你引擎（与 datacore `service.supplierDisruptionRadius` 同口径，**按 args 现算**）。
 * 必须现算而不是按 rootId 写死：本用例要证的正是「前端把**不同的 layers** 发过去了」——
 * 桩若按 rootId 回写死值，屏上的数不变也照样绿，那这条门就什么都没证明。
 */
function drSolve(args: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] }) {
  let frontier = new Set<string>([args.rootId]);
  const result: { type: string; viaField: string; count: number; ids: string[] }[] = [];
  let radius = 0;
  for (const layer of args.layers) {
    const pk = DR_PK[layer.type];
    const hit = (DR_OBJECTS[layer.type] ?? []).filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
    const ids = hit.map((o) => String((pk ? o.props[pk] : undefined) ?? o.id)).sort();
    result.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
    if (ids.length > 0) radius += 1;
    frontier = new Set(ids);
    if (ids.length === 0) break;
  }
  const leaf = result[result.length - 1];
  const totalAffected = result.reduce((s, l) => s + l.count, 0);
  return {
    rootType: args.rootType, rootId: args.rootId, layers: result, radius, totalAffected,
    leafType: leaf?.type ?? null, leafCount: leaf?.count ?? 0,
    summary: `断供「${args.rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象`,
  };
}

function renderDR() {
  server.use(
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(DR_TYPES)),
    http.get("*/a/v1/objects", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type") ?? "";
      const items = DR_OBJECTS[type] ?? [];
      return HttpResponse.json({ items, total: items.length });
    }),
    http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { args?: Parameters<typeof drSolve>[0] };
      return HttpResponse.json({ data: drSolve(body.args!), snapshotVersion: "ov-dr" });
    }),
  );
  return renderApp("/v/disruption-radius");
}

describe("WO-EDGE-PANEL-3PAGES · 三页的「关掉一条边看结果怎么变」", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色（无独立 admin 账号）
  });

  // ── ① 可达层：本单补挂的两页挂载点静态可达（与门脚本共用同一份 analyze）────────────
  it("🔴 可达：order-chain / disruption-radius 都挂了 EdgeActivePanel，且挂在主组件里", async () => {
    const analyze = await loadAnalyze();
    // 金丝雀：同一个 analyze 对两个已知答案的合成样例必须给出**相反**结论。
    // 不跑它就没资格把下面的结果读成结论（铁律 0.6：报否定结论前先自证工具）。
    expect(analyze(`export default function P() {\n  return <EdgeActivePanel />;\n}\n`).ok).toBe(true);
    const sub = analyze(`export default function P() {\n  return <S />;\n}\nfunction S() {\n  return <EdgeActivePanel />;\n}\n`);
    expect(sub.ok).toBe(false);
    expect(sub.reason).toBe("MOUNTED_IN_SUBCOMPONENT");

    const root = resolve(__dirname, "../../..");
    for (const [key, rel] of [
      ["order-chain", "apps/frontend-shell/src/views/plan/OrderChainView.tsx"],
      ["disruption-radius", "apps/frontend-shell/src/views/DisruptionRadiusView.tsx"],
    ] as [string, string][]) {
      expect(`${key}:${analyze(readFileSync(resolve(root, rel), "utf8")).reason}`).toBe(`${key}:OK`);
    }

    // 反面：判为「不适用」的那一页**确实没挂**（本单的账要对得上，不许嘴上说不适用手上偷偷挂）。
    const cr = analyze(readFileSync(resolve(root, "apps/frontend-shell/src/views/cleanroom/CleanroomAttrView.tsx"), "utf8"));
    expect(cr.reason).toBe("NO_MOUNT");
  });

  // ── 前置哨兵：mock workspace 真下发 order-chain（否则「面板没出现」会被误读成「组件坏了」）──
  it("哨兵：mock workspace 真下发 order-chain（视图 + feature 双闸都开）", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    expect((ws.views ?? []).find((v) => v.key === "order-chain" || v.renderer === "order-chain")).toBeDefined();
    expect(ws.features).toContain("view.order-chain");
  });

  // ── ② 接缝层：order-chain 打开 → 拨开关 → 差值带方向与量级，且**换一条边就换一个数** ────
  it("🔴 SEAM order-chain：拨开关 → 差值带方向与量级；关另一条边 ⇒ 变的是另一格、另一个数", async () => {
    const user = userEvent.setup();
    renderApp("/v/order-chain");

    // 面板默认折叠在 `<details>` 里（本页在 check-ui-first-layer 棘轮内，不许往第一层堆）。
    // ⚠ 2026-08-19 WO-TIMEOUT-5000-SWEEP：findBy 预算 5s→20s（共享机高负载下 5s 等不到懒加载 chunk，
    //   同型假红见 edge-active 调查 c9ff5936f）；判据一个字未动，只抬等待预算。
    const summary = await screen.findByTestId("oc-edge-summary", {}, { timeout: 20000 });
    await user.click(summary);

    // 渲染层：面板真出现，且列的是 MSW 真响应里的边（不是写死的占位行）。
    // ⚠ 这一段是**变异反证的对照组**：把重算那一步拆掉后，本段仍然全绿 ——
    //   于是下面那段红的时候，红的原因只能是「数没出来/没变」，不可能是「面板不见了」。
    const panel = await screen.findByTestId("edge-active-order-chain-panel", {}, { timeout: 20000 });
    expect(within(panel).getByTestId("edge-active-order-chain-count").textContent).toContain("3 条边");
    const rowA = within(panel).getByTestId(`edge-active-order-chain-edge-${EDGE_A}`);
    expect(rowA.textContent).toContain("TypeA.s1"); // 源/目标/链路/系数逐字段直取 PropagationRule
    expect(rowA.textContent).toContain("linkAB");
    expect(rowA.textContent).toContain("系数 0.5");
    expect(rowA.getAttribute("data-active")).toBe("true");

    // 交互层：拨一下开关（不点任何「再运行一次」）。
    // MSW fixture：TypeB#0.s1 基线 30，关掉 EDGE_A 后 30 − 0.5×60 = 0 ⇒ Δ = −30，方向 ↓。
    await user.click(within(panel).getByTestId(`edge-active-order-chain-toggle-${EDGE_A}`));
    const diff = await within(panel).findByTestId("edge-active-order-chain-diff", {}, { timeout: 20000 });
    const cellA = within(diff).getByTestId("edge-active-order-chain-diff-TypeB#0-s1");
    expect(cellA.textContent).toContain("↓");
    expect(cellA.textContent).toContain("−30");

    // 关掉的边**没有从列表里消失**，而是可见地降级（消失了用户就不知道自己关了什么）。
    expect(within(panel).getByTestId(`edge-active-order-chain-edge-${EDGE_A}`).getAttribute("data-active")).toBe("false");
    expect(within(panel).getByTestId(`edge-active-order-chain-off-${EDGE_A}`).textContent).toContain("已关闭");

    // 🔴 **变异反证锚**：把 EDGE_A 拨回、改关 EDGE_B ⇒ 受影响的**格**与**数**必须都换一套
    //    （TypeB#0.s2：25 − 0.25×40 = 15 ⇒ Δ = −10）。
    //    一个写死的差值表、或一个「渲染出来就算数」的实现，都过不了这一条：
    //    它要求屏上的数**跟着关的是哪条边走**。
    await user.click(within(panel).getByTestId(`edge-active-order-chain-toggle-${EDGE_A}`)); // 拨回
    // WO-DISRUPTION-CARDS：面板改成**按业务域分片**后，一屏只渲染选中那一片的行
    //（35 条一次全倒是本单要治的病灶）。EDGE_B 在 fixture 里是**未归域**那一片
    // ⇒ 要先切到那一片才拨得到它。这一步不是绕过判据，恰恰是**加了一层**：
    // 它顺带证明「切到另一片之后，那一片的边照样拨得动、照样出差值」。
    await user.click(within(panel).getByTestId("edge-active-order-chain-domain-__unassigned__"));
    await user.click(within(panel).getByTestId(`edge-active-order-chain-toggle-${EDGE_B}`)); // 改关另一条
    await waitFor(
      () => {
        const d = within(panel).getByTestId("edge-active-order-chain-diff");
        const cellB = within(d).getByTestId("edge-active-order-chain-diff-TypeB#0-s2");
        expect(cellB.textContent).toContain("↓");
        expect(cellB.textContent).toContain("−10");
      },
      { timeout: 20000 },
    );
    // 且上一次那一格**不再变化**（证明关的是这一条，不是把整张表停了）。
    expect(within(panel).queryByTestId("edge-active-order-chain-diff-TypeB#0-s1")).toBeNull();
    expect(within(panel).getByTestId("edge-active-order-chain-verdict").textContent).toContain("发生变化");
    // 整条墙钟预算同理上调（WO-TIMEOUT-5000-SWEEP）：renderApp+懒加载链路在共享机负载下会超全局 20s。
  }, 60000);

  // ── ③ 纯模型：关掉一条关系边 ⇒ **改道**（不是简单截断）、且确定性 ─────────────────────
  it("🔴 模型 disruption-radius：关掉首选边 ⇒ 倒推改走次选边（不是截断），同输入同输出", () => {
    const types = DR_TYPES as OTypeLite[];
    // 全开：Material 字典序在 Warehouse 之前 ⇒ 走 Material，再沿 Order.materialRef 下探一跳。
    const full = deriveDisruptionLayers(types, "Supplier");
    expect(full).toEqual([
      { type: "Material", viaField: "supplierRef" },
      { type: "Order", viaField: "materialRef" },
    ]);
    // 关掉首选边 ⇒ **改道**到 Warehouse。
    // 🔴 这一条正是「截断式实现」过不去的地方：截断只会得到 `[]`，得不到 Warehouse。
    const rerouted = deriveDisruptionLayers(types, "Supplier", new Set([edgeKeyOf(full[0]!)]));
    expect(rerouted).toEqual([{ type: "Warehouse", viaField: "supplierRef" }]);
    // 两条都关掉 ⇒ 真的无边可走（断链），这才是空链。
    expect(deriveDisruptionLayers(types, "Supplier", new Set(["Material.supplierRef", "Warehouse.supplierRef"]))).toEqual([]);
    // 确定性（R6）：类型数组顺序不影响结论 —— 排序在过滤之前。
    expect(JSON.stringify(deriveDisruptionLayers([...types].reverse(), "Supplier", new Set(["Material.supplierRef"])))).toBe(
      JSON.stringify(rerouted),
    );
    // 缺省实参不变式：不传 disabledEdges ⇒ 与旧行为逐字节相同（既有 8 条用例靠它）。
    expect(JSON.stringify(deriveDisruptionLayers(types, "Supplier", new Set()))).toBe(JSON.stringify(full));
  });

  // ── ③ 接缝层：关掉一条关系边 ⇒ **本页自己的读数**真的变（不是面板自己的差值表）───────
  it("🔴 SEAM disruption-radius：关掉一条关系边 ⇒ 半径 2→1、波及 3→1、扇出改道到另一类对象", async () => {
    const user = userEvent.setup();
    renderDR();

    // 关掉之前：Supplier → 物料 ×2 → 订单 ×1 ⇒ 半径 2 层、波及 3 个。
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("2 层"), { timeout: 8000 });
    expect(screen.getByTestId("dr-total")).toHaveTextContent("3");
    expect(screen.getByTestId("dr-layer-0")).toHaveTextContent("物料");
    expect(screen.getByTestId("dr-layer-1")).toHaveTextContent("销售订单");
    // 开关列表列的是**当前链上的真边**（引用方类型 · 引用字段），不是写死的行。
    await user.click(screen.getByTestId("dr-edges-summary"));
    expect(screen.getByTestId("dr-edge-Material.supplierRef").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("dr-edge-Order.materialRef")).toBeInTheDocument();

    // 🔴 关掉第一跳那条关系边。
    await user.click(screen.getByTestId("dr-edge-toggle-Material.supplierRef"));

    // 屏上**本页自己的读数**真的换了一批：半径 2→1、波及 3→1。
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("1 层"), { timeout: 8000 });
    expect(screen.getByTestId("dr-total")).toHaveTextContent("1");
    // 且是**改道**不是截断：第一层换成了「仓库」这一类对象（截断式实现在这里只会给出空态）。
    expect(screen.getByTestId("dr-layer-0")).toHaveTextContent("仓库");
    expect(screen.getByTestId("dr-leaf")).toHaveTextContent("仓库 1");
    // 关掉的边**没有从列表里消失**，而是可见地降级 + 显式「已关闭」（消失了就拨不回来）。
    expect(screen.getByTestId("dr-edge-Material.supplierRef").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("dr-edge-off-Material.supplierRef").textContent).toContain("已关闭");
    // 「这些数是反事实」必须留在第一层（折起来也看得见），否则用户会把它读成现状。
    expect(screen.getByTestId("dr-edges-off-badge").textContent).toContain("已关 1 条");
    // 「关掉之前是什么样」同屏可比 —— 只给关掉之后，用户分不清这次是改道还是变短。
    expect(screen.getByTestId("dr-edges-before").textContent).toContain("2 跳 → 现 1 跳");

    // 拨回去 ⇒ 读数**回到原样**（证明这是一次可逆的假设，不是把本体改了）。
    await user.click(screen.getByTestId("dr-edge-toggle-Material.supplierRef"));
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("2 层"), { timeout: 8000 });
    expect(screen.getByTestId("dr-total")).toHaveTextContent("3");
    expect(screen.queryByTestId("dr-edges-off-badge")).toBeNull();
  });

  // ── ③c 共享面板在 disruption-radius 上**真渲染得出来**（静态可达 ≠ 打得开）──────────
  //
  // 为什么单列一条而不是靠上面的「① 可达」：那一条读的是**源码文本**，它答「有没有路径」，
  // 答不了「那条路径走过去到底出不出东西」。本仓栽过的正是后者（实现有、门绿、页面打不开）。
  it("🔴 SEAM disruption-radius：共享面板真渲染出真边（静态可达 ≠ 打得开）", async () => {
    const user = userEvent.setup();
    renderDR();
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("2 层"), { timeout: 8000 });

    await user.click(screen.getByTestId("dr-edge-panel-summary"));
    const panel = await screen.findByTestId("edge-active-disruption-radius-panel", {}, { timeout: 8000 });
    // 列的是 MSW 真响应里的传导边（`MOCK_RULE_SEED` 三条），不是占位行。
    expect(within(panel).getByTestId("edge-active-disruption-radius-count").textContent).toContain("3 条边");
    expect(within(panel).getByTestId(`edge-active-disruption-radius-edge-${EDGE_A}`).textContent).toContain("TypeA.s1");

    // 🔴 **两套开关互不干扰**（本页最容易被做错的地方：两族边共用一个 state ⇒ 关一边动两边）。
    //    拨传导边 ⇒ 面板出差值，而**本页自己的半径一格不动**（它由关系边决定，不由传导边决定）。
    await user.click(within(panel).getByTestId(`edge-active-disruption-radius-toggle-${EDGE_A}`));
    const diff = await within(panel).findByTestId("edge-active-disruption-radius-diff", {}, { timeout: 8000 });
    expect(within(diff).getByTestId("edge-active-disruption-radius-diff-TypeB#0-s1").textContent).toContain("−30");
    expect(screen.getByTestId("dr-radius")).toHaveTextContent("2 层"); // 没被连坐
    expect(screen.queryByTestId("dr-edges-off-badge")).toBeNull(); // 关系边一条都没关
  });

  // ── ③b 两种「空」必须分得开：本体没链 ≠ 你把链关断了（修法完全相反）────────────────
  it("🔴 诚实位 disruption-radius：把链上的边全关掉 ⇒ 空态说的是「边被关了」，不是「本体没链」", async () => {
    const user = userEvent.setup();
    renderDR();
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("2 层"), { timeout: 8000 });
    await user.click(screen.getByTestId("dr-edges-summary"));

    await user.click(screen.getByTestId("dr-edge-toggle-Material.supplierRef"));
    await waitFor(() => expect(screen.getByTestId("dr-layer-0")).toHaveTextContent("仓库"), { timeout: 8000 });
    await user.click(screen.getByTestId("dr-edge-toggle-Warehouse.supplierRef"));

    // 无边可走 ⇒ 走「边被关了」这一支，**不是**「本体无反向引用链」那一支。
    await waitFor(() => expect(screen.getByTestId("dr-empty-edges-cut")).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.queryByTestId("dr-empty-no-layers")).toBeNull(); // 两句话必须不同，不许一句盖住两个事实
    expect(screen.queryByTestId("dr-metrics")).toBeNull();
    // 成段解释在浮层里（第一层只留短结论 + `?`，check-ui-first-layer D2b）。
    await user.click(screen.getByTestId("info-dr-edges-cut"));
    expect(screen.getByTestId("dr-edges-cut-body").textContent).toContain("本体里的引用关系一个字节都没有改动");
  });
});
