import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";
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
    for (const [key, rel] of [["order-chain", "apps/frontend-shell/src/views/plan/OrderChainView.tsx"]] as [string, string][]) {
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
    const summary = await screen.findByTestId("oc-edge-summary", {}, { timeout: 5000 });
    await user.click(summary);

    // 渲染层：面板真出现，且列的是 MSW 真响应里的边（不是写死的占位行）。
    // ⚠ 这一段是**变异反证的对照组**：把重算那一步拆掉后，本段仍然全绿 ——
    //   于是下面那段红的时候，红的原因只能是「数没出来/没变」，不可能是「面板不见了」。
    const panel = await screen.findByTestId("edge-active-order-chain-panel", {}, { timeout: 5000 });
    expect(within(panel).getByTestId("edge-active-order-chain-count").textContent).toContain("3 条边");
    const rowA = within(panel).getByTestId(`edge-active-order-chain-edge-${EDGE_A}`);
    expect(rowA.textContent).toContain("TypeA.s1"); // 源/目标/链路/系数逐字段直取 PropagationRule
    expect(rowA.textContent).toContain("linkAB");
    expect(rowA.textContent).toContain("系数 0.5");
    expect(rowA.getAttribute("data-active")).toBe("true");

    // 交互层：拨一下开关（不点任何「再运行一次」）。
    // MSW fixture：TypeB#0.s1 基线 30，关掉 EDGE_A 后 30 − 0.5×60 = 0 ⇒ Δ = −30，方向 ↓。
    await user.click(within(panel).getByTestId(`edge-active-order-chain-toggle-${EDGE_A}`));
    const diff = await within(panel).findByTestId("edge-active-order-chain-diff", {}, { timeout: 5000 });
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
    await user.click(within(panel).getByTestId(`edge-active-order-chain-toggle-${EDGE_B}`)); // 改关另一条
    await waitFor(
      () => {
        const d = within(panel).getByTestId("edge-active-order-chain-diff");
        const cellB = within(d).getByTestId("edge-active-order-chain-diff-TypeB#0-s2");
        expect(cellB.textContent).toContain("↓");
        expect(cellB.textContent).toContain("−10");
      },
      { timeout: 5000 },
    );
    // 且上一次那一格**不再变化**（证明关的是这一条，不是把整张表停了）。
    expect(within(panel).queryByTestId("edge-active-order-chain-diff-TypeB#0-s1")).toBeNull();
    expect(within(panel).getByTestId("edge-active-order-chain-verdict").textContent).toContain("发生变化");
  });
});
