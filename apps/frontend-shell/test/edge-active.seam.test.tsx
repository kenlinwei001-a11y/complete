import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";
import { buildDiffRows, buildEdgeRows, buildVerdict, pickProbeSession, toggleEdge } from "@/views/sim/edgeActiveModel";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 门脚本 `scripts/check-edge-active-mounts.mjs` 导出的判定函数。
 * **刻意从门脚本里借**（而不是在本文件另写一份）—— 这就是「金丝雀必须与主逻辑共用同一份实现」：
 * 抄一份出来，改门脚本的判据时本文件拿旧的去测、照样绿，那份金丝雀就是装饰品。
 * 门脚本有 `import.meta.url === argv[1]` 守卫，import 它不会跑门、不会 `process.exit`。
 */
type MountAnalysis = { ok: boolean; reason: string; mounts: number[]; outside?: number[]; range: [number, number] | null };
const loadAnalyze = async (): Promise<(src: string) => MountAnalysis> =>
  ((await import(resolve(__dirname, "../../../scripts/check-edge-active-mounts.mjs"))) as { analyze: (s: string) => MountAnalysis }).analyze;

/**
 * WO-ACTIVE-EDGE-UX · **前端接缝门**：从真实 workspace 出发 → 导航到推演页 → 面板渲染出真边
 * → 拨开关 → 差异显示出来。
 *
 * ── 为什么不从手搓 props 起跑（这条门的全部价值都在这里）─────────────────────────────
 * `render(<EdgeActivePanel rules={…} diffs={…} />)` 测的是**组件**，不是**链路**。本仓已经栽过
 * 至少五次同一个形态（F2/F3/F4/阻滞点/流程等待态）：组件实现有、SEAM 全绿、**零生产调用方** ——
 * 页面一次都打不开。所以本文件一律：
 *   · 走 `renderApp("/v/<page>")`（真 router → 真 ViewPage/专用 route → 真 renderer）
 *   · 不 mock `@/api/endpoints`（那会把病灶那一跳一起 mock 掉），在 MSW 层拦**真实 URL**
 *   · 断言落在**屏幕上真出现了什么**，不落在"函数被调用了几次"
 *
 * ── 三层判据（各咬一层，缺一层就有一种假绿）───────────────────────────────────────
 *  ① **可达层**：八个页的挂载点静态可达（与门脚本 `check-edge-active-mounts.mjs` **共用同一份
 *     `analyze`**，不另抄一份判据 —— 抄了就是装饰品）。它答「有没有路径」。
 *  ② **渲染层**：真打开一页，面板真把**真边**画出来（边的类型/链路/系数来自 MSW 的真响应）。
 *     它答「那条路径走过去到底出不出东西」。
 *  ③ **交互层**：拨一下开关 ⇒ 真发 `POST …/counterfactual` ⇒ 差异**带方向和量级**显示出来，
 *     且关掉的边**没有从列表里消失**（§3.3：可见地降级，不是消失）。它答「关掉之后看不看得到变化」。
 *
 * MSW 桩见 `src/mocks/handlers.ts`：差值由**契约** `diffTickStates` 现算（与真后端同一支实现），
 * 桩只供两份世界态 —— 所以屏上那个差值不可能与后端的算术漂移。
 */

/** MSW fixture 里那两条传导边的 key（`MOCK_PROPAGATION_RULES`）。 */
const EDGE_A = "mock_a_to_b";
const EDGE_B = "mock_a_to_b_slow";

describe("WO-ACTIVE-EDGE-UX · 前端接缝：从 workspace 到「关掉一条边看差异」", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色（无独立 admin 账号）
  });

  // ── ① 可达层：八页挂载点（与门脚本共用同一份 analyze）────────────────────────────
  it("🔴 可达：九个推演页都挂了 EdgeActivePanel，且都挂在主组件里（与门脚本同一份判据）", async () => {
    const analyze = await loadAnalyze();
    const PAGES: [string, string][] = [
      ["sandbox", "apps/frontend-shell/src/views/sim/SandboxView.tsx"],
      ["project-sim", "apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
      ["global-sim", "apps/frontend-shell/src/views/sim/GlobalSimView.tsx"],
      ["plan-generate", "apps/frontend-shell/src/views/sim/PlanGenerateView.tsx"],
      ["what-if", "apps/frontend-shell/src/views/WhatIfView.tsx"],
      ["optimize-whatif", "apps/frontend-shell/src/views/OptimizeWhatifView.tsx"],
      ["decision-play", "apps/frontend-shell/src/views/DecisionPlayView.tsx"],
      ["sop-balance", "apps/frontend-shell/src/views/sim/SopBalanceView.tsx"],
      // 第 9 页 —— 工单 §1 那张表漏的：它按 registry 的 renderer 语义取表、把本页读成「风险看板」，
      // 而真实 workspace 下发的标题是「产能推演」（`mocks/fixtures.ts` 的 `{ key:"risk", title:"产能推演" }`）。
      ["risk-board", "apps/frontend-shell/src/views/RiskBoardView.tsx"],
    ];
    // 金丝雀：同一个 analyze 对两个已知答案的合成样例必须给出相反结论。
    // 不跑它就没资格把下面的"八页全过"读成结论（铁律 0.6）。
    expect(analyze(`export default function P() {\n  return <EdgeActivePanel />;\n}\n`).ok).toBe(true);
    const sub = analyze(`export default function P() {\n  return <S />;\n}\nfunction S() {\n  return <EdgeActivePanel />;\n}\n`);
    expect(sub.ok).toBe(false);
    expect(sub.reason).toBe("MOUNTED_IN_SUBCOMPONENT");

    const root = resolve(__dirname, "../../..");
    for (const [key, rel] of PAGES) {
      const r = analyze(readFileSync(resolve(root, rel), "utf8"));
      expect(`${key}:${r.reason}`).toBe(`${key}:OK`);
    }
  });

  // ── 金丝雀：mock workspace 真下发这一页（否则下面"没渲染出来"会被误读成"组件坏了"）────
  //
  // 选 `project-sim` 而不是 `what-if` 作主用例的落点，理由是**它走的是真 workspace 那条路**：
  // `/v/:viewKey` → `ViewPage` → 查 `workspace.features` 的 `view.<key>` ∧ `workspace.views` 有该条目
  // → `getRenderer(view.renderer)`。`what-if` 在 `App.tsx` 有**专用静态 route**，会绕过这两道闸 ——
  // 拿它当"从真实 workspace 响应出发"的证据是不成立的（本单初稿踩过，实测 mock workspace 里
  // 压根没有 `what-if` 这一条，而页面照样打得开）。
  it("金丝雀：mock workspace 真下发 project-sim（视图 + feature 双闸都开）", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    const views = ws.views ?? [];
    expect(views.find((v) => v.key === "project-sim" || v.renderer === "project-sim")).toBeDefined();
    expect(ws.features).toContain("view.project-sim");
  });

  // ── ②③ 渲染层 + 交互层：真导航 → 真边 → 拨开关 → 真差异 ──────────────────────────
  it("🔴 SEAM：/v/project-sim 打开 → 面板列出真边 → 拨开关 → 差异带方向与量级显示出来", async () => {
    const user = userEvent.setup();
    renderApp("/v/project-sim");

    // ② 渲染层：面板真出现，且列的是 MSW 真响应里的边（不是写死的占位行）。
    // ⚠ **口径订正 2026-08-14（合并时被逼出来的，不是放宽断言）**：本条原写 "2 条边"。
    //   合并 WO-BEFE-A × WO-BEFE-E × WO-ACTIVE-EDGE 时实测：同一个 URL
    //   `GET /a/v1/sim/propagation-rules` 注册了 **3 个 MSW handler**，MSW 先匹配先赢
    //   ⇒ 本单那份 fixture **永远不触发**，面板实际只看得到 1 条边（当时报 "1 条边"）。
    //   三份 fixture 已收成一个源（`MOCK_RULE_SEED`，见 handlers.ts 该常量尾部注释），
    //   条数因此 2 → **3**（本单 2 条 + BEFE-A 的 seed_line_to_base 1 条）。
    //   数的仍是"面板列出了几条真边"，判据一个字没松。
    const panel = await screen.findByTestId("edge-active-project-sim-panel", {}, { timeout: 5000 });
    expect(within(panel).getByTestId("edge-active-project-sim-count").textContent).toContain("3 条边");
    const rowA = within(panel).getByTestId(`edge-active-project-sim-edge-${EDGE_A}`);
    // 边的字段来自真 `PropagationRule`：源/目标/链路/系数/延迟，前端零加工。
    expect(rowA.textContent).toContain("TypeA.s1");
    expect(rowA.textContent).toContain("linkAB");
    expect(rowA.textContent).toContain("TypeB.s1");
    expect(rowA.textContent).toContain("×0.5");
    expect(rowA.getAttribute("data-active")).toBe("true");

    // ③ 交互层：拨一下开关 —— 不点任何"再运行一次"的按钮（§3.3「立刻看到差异」）。
    await user.click(within(panel).getByTestId(`edge-active-project-sim-toggle-${EDGE_A}`));

    // 差异表真的出来了，且**带方向和量级**（不是只标个"变了"）。
    // MSW fixture：TypeB#0.s1 基线 30，关掉这条边后 30 − 0.5×60 = 0 ⇒ Δ = −30，方向 ↓。
    const diff = await within(panel).findByTestId("edge-active-project-sim-diff", {}, { timeout: 5000 });
    const cell = within(diff).getByTestId("edge-active-project-sim-diff-TypeB#0-s1");
    expect(cell.textContent).toContain("↓");
    expect(cell.textContent).toContain("−30");

    // 关掉的边**没有从列表里消失**，而是可见地降级（§3.3：消失了用户就不知道自己关了什么）。
    const rowAfter = within(panel).getByTestId(`edge-active-project-sim-edge-${EDGE_A}`);
    expect(rowAfter.getAttribute("data-active")).toBe("false");
    expect(within(panel).getByTestId(`edge-active-project-sim-off-${EDGE_A}`).textContent).toContain("已关闭");
    // 另一条边**没被连坐**（证明关的是这一条，不是把整张表停了）。
    expect(within(panel).getByTestId(`edge-active-project-sim-edge-${EDGE_B}`).getAttribute("data-active")).toBe("true");

    // 结论句必须是 CHANGED 那一支（有变化），不是"没变"的两种诚实缺席之一。
    expect(within(panel).getByTestId("edge-active-project-sim-verdict").textContent).toContain("发生变化");
  });

  // ── ④ 「没变」的两种成因必须分开说（同一个数盖住两个不同事实 = 本仓的老病）─────────
  it("🔴 诚实位：差值为空时，「这条边本来就没触发」与「关了它没影响」给出不同结论句", () => {
    const common = {
      fromTick: 0, ticks: 1, suppressedRules: [], baselineState: {}, counterfactualState: {}, diffs: [],
    };
    const neverFired = buildVerdict({ ...common, disabledRuleKeys: [EDGE_A], suppressedRulesFiredInBaseline: [] } as never);
    expect(neverFired.kind).toBe("NEVER_FIRED");
    expect(neverFired.text).toContain("一次都没触发");

    const noEffect = buildVerdict({ ...common, disabledRuleKeys: [EDGE_A], suppressedRulesFiredInBaseline: [EDGE_A] } as never);
    expect(noEffect.kind).toBe("NO_EFFECT");
    // 两句话**必须不同** —— 这就是"不许一个数盖住两个事实"在断言层的落点。
    expect(noEffect.text).not.toBe(neverFired.text);

    expect(buildVerdict({ ...common, disabledRuleKeys: [], suppressedRulesFiredInBaseline: [] } as never).kind)
      .toBe("NOTHING_DISABLED");
  });

  // ── ⑤ 纯模型：排序/开关/降级标记/方向记号（无 React，确定性）──────────────────────
  it("纯模型：buildEdgeRows 按 key 全序 + 关掉的边只降级不消失；toggleEdge 去重全序；buildDiffRows 按量级降序", () => {
    const mk = (key: string, id: string) => ({
      id, tenantId: "demo", key, sourceTypeKey: "T", sourceStateVar: "s", viaLinkKey: "l",
      targetTypeKey: "U", targetStateVar: "t", coefficient: 1, delayTicks: 0,
      combine: "sum" as const, decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, status: "PUBLISHED" as const,
    });
    const rows = buildEdgeRows([mk("b", "2"), mk("a", "1")], ["a"]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]); // 全序（不靠上游碰巧有序）
    expect(rows.length).toBe(2); // 🔴 关掉的边**仍在列表里**
    expect(rows[0]!.active).toBe(false);
    expect(rows[0]!.dimmed).toBe(true);

    expect(toggleEdge(["b", "a"], "c", false)).toEqual(["a", "b", "c"]);
    expect(toggleEdge(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleEdge(["a"], "a", false)).toEqual(["a"]); // 幂等（重复关不产生重复项）

    const diffs = buildDiffRows([
      { objectId: "o1", stateVar: "x", baseline: 10, counterfactual: 11, delta: 1, direction: "up" },
      { objectId: "o2", stateVar: "y", baseline: 10, counterfactual: 0, delta: -10, direction: "down" },
      { objectId: "o3", stateVar: "z", baseline: null, counterfactual: 5, delta: null, direction: "unknown" },
    ]);
    expect(diffs.map((d) => d.objectId)).toEqual(["o2", "o1", "o3"]); // 影响量级降序
    expect(diffs[0]!.arrow).toBe("↓");
    expect(diffs[0]!.deltaText).toBe("−10");
    expect(diffs[0]!.absentIn).toBe("none");
    expect(diffs[1]!.arrow).toBe("↑");
    // 两侧都缺 ⇒ 真的算不出（`delta === null`），文案说"算不出"而不是编一个 0。
    expect(diffs[2]!.deltaText).toBe("算不出");
    expect(diffs[2]!.relative).toBeNull();
    // 只有一侧缺 ⇒ 显示层标"无此格"，但**变化量照样算得出**（引擎缺格读 0 的约定）。
    const oneSide = buildDiffRows([
      { objectId: "o4", stateVar: "w", baseline: 10, counterfactual: null, delta: -10, direction: "down" },
    ]);
    expect(oneSide[0]!.absentIn).toBe("counterfactual");
    expect(oneSide[0]!.deltaText).toBe("−10");
  });

  // ── ⑥ 会话挑选：方案快照 bag 不是可推演的世界，必须排除 ──────────────────────────
  it("pickProbeSession：排除方案快照会话（scope.snapshotKind），其余按 createdAt 降序取最新（R6 全序）", () => {
    const s = (id: string, createdAt: string, scope: Record<string, unknown> = {}) => ({ id, createdAt, scope });
    expect(pickProbeSession([])).toBeNull();
    expect(pickProbeSession([s("a", "2026-01-01T00:00:00Z", { snapshotKind: "gslive" })])).toBeNull();
    const picked = pickProbeSession([
      s("old", "2026-01-01T00:00:00Z"),
      s("snap", "2026-09-01T00:00:00Z", { snapshotKind: "gslive" }),
      s("new", "2026-02-01T00:00:00Z"),
    ]);
    expect(picked!.id).toBe("new"); // 最新的**可推演**会话，不是最新的那一行
  });

  // ── ⑦ 未知 key 不静默忽略：真打后端（MSW 镜像了同一条纪律）⇒ 400 而不是"看着关掉了" ──
  it("🔴 未知 ruleKey ⇒ 后端 400 UNKNOWN_PROPAGATION_RULE_KEY（mock 与真后端同一条纪律）", async () => {
    const { patchSimDisabledRules } = await import("@/api/endpoints");
    // 先建一个会话（走真 endpoint，MSW 落 store）
    const { createSimSession } = await import("@/api/endpoints");
    const s = await createSimSession({ baseSnapshot: { "TypeA#0": { s1: 60 } } });
    await expect(patchSimDisabledRules(s.id, ["no_such_edge"])).rejects.toThrow();
    // 金丝雀：喂**真 key** 必须成功 —— 否则上面的 reject 可能只是"路由压根没镜像"。
    await expect(patchSimDisabledRules(s.id, [EDGE_A])).resolves.toMatchObject({ disabledRuleKeys: [EDGE_A] });
  });
});
