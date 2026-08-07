import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CHAIN_NODE_IDS, CHAIN_NODE_REGISTRY } from "@platform/contracts";

/**
 * WO-NODE-SEMANTICS · 节点语义包四样上屏的 SEAM 门（`evidence` / `kpi` / `pos` / `cf`）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 头号判据（接缝驱动，不是各半 unit）
 * ══════════════════════════════════════════════════════════════════════════════
 * **① 喂一份真实抓下来的 `chain_loss_attribution` 响应**（`fixtures/chain-loss-live-evidence.json`，
 *    内存态 datacore 真跑捕获、零手改，provenance 写在 fixture 里），断言
 *    `evidence[]` 里属于该节点的**每一条**都在屏上出现，且 `drillValue` 与 `conversion`
 *    **逐字符等于载荷原文**。前端改一个字、或自己算一遍 drillValue → 本门当场红。
 * **② 接不到就不显示**：节点不在载荷里 ⇒ 节点级流指标一行都不出（**绝不填设计稿里那些编的数**）。
 * **③ 没写语义的节点不得渲染空壳**：`pos` / `cf` 两块整块不出现（注册表 12→24 扩表后的优雅降级）。
 * **④ 语义表的键 ⊆ 契约注册表**：手抄词表漂移必须当场被抓（#99 的直接对策）。
 *
 * ── 变异反证（亲手注入 → 亲眼见红 → `git checkout --` 撤回；原文见交付报告）─────────
 *  ① `drillValueText` 改成前端自己算一遍（不透传）→ §1 逐字符对拍红。
 *  ② 让 `pos` / `cf` 在无语义节点上渲染空壳 → §3 红。
 */

// ── 仓根 = 自**本测试文件**向上第一个含 pnpm-workspace.yaml 的目录 ─────────────
// 刻意不用 process.cwd()：隔离 worktree 里跑时 cwd 仍指向主 checkout，曾据此读错文件造成假绿。
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[node-semantics.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/**
 * **真实抓下来的**载荷（不是手写 fixture）。
 * 这里刻意读**原始 JSON**、不经任何 schema —— 逐字符对拍必须拿"载荷原文"当基准，
 * 若拿解析后的对象当基准，解析层自己写歪了这道门也看不出来。
 */
const RAW = JSON.parse(readRepo("apps/frontend-shell/test/fixtures/chain-loss-live-evidence.json")) as {
  __fixture_provenance: { how: string; counts: { evidence: number; empty: number } };
  nodes: { nodeId: string; steps: { stepId: string }[] }[];
  attribution: { stepId: string; pctOfChainLoss: number }[];
  evidence: {
    stepId: string;
    nodeId: string;
    label: string;
    days: number;
    drillType: string;
    drillId: string;
    drillField: string;
    drillValue: number;
    drillUnit: string;
    conversion: string;
    derivationEdge: string;
  }[];
  empty: { stepId: string; nodeId: string; label: string; reason: string; emptyKind: string }[];
  anchor: { so: string };
};
/** 去掉取证头，剩下的就是求解器原样返回的那个 `data` 对象。 */
const PAYLOAD = (() => {
  const { __fixture_provenance: _p, ...rest } = RAW;
  return rest;
})();

// ── 网络：本视图会自取一次 chain_loss_attribution（宿主没传 lossPayload 时）─────────
const net = vi.hoisted(() => ({ payload: null as unknown, fail: null as unknown, calls: [] as { key: string; args: Record<string, unknown> }[] }));
vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (net.fail !== null) throw net.fail;
      return { data: net.payload, snapshotVersion: "sv" };
    }),
  };
});

import { NodeInspectorView, InspectorNodePanel } from "@/views/sim/InspectorNodePanel";
import {
  NodeSemanticPayloadSchema,
  buildNodeLiveView,
  buildPlaceholderInspectorInput,
  drillValueText,
} from "@/views/sim/inspectorModel";
import { CHAIN_NODE_SEMANTICS, chainNodeSemantics, chainNodeSemanticsCoverage } from "@/views/sim/chainNodeSemantics";

const PARSED = NodeSemanticPayloadSchema.parse(PAYLOAD);

/** 载荷里**真的带证据**的那批节点（本门必须咬到真数据，不能挑一个空节点自证清白）。 */
const NODES_WITH_EVIDENCE = [...new Set(RAW.evidence.map((e) => e.nodeId))].filter((id) => CHAIN_NODE_IDS.includes(id));
/** 载荷里只有诚实缺席行的节点。 */
const NODES_WITH_EMPTY_ONLY = [...new Set(RAW.empty.map((e) => e.nodeId))].filter(
  (id) => CHAIN_NODE_IDS.includes(id) && !NODES_WITH_EVIDENCE.includes(id),
);

const mountView = (nodeId: string) => render(<NodeInspectorView selectedNodeId={nodeId} />);

beforeEach(() => {
  net.payload = PAYLOAD;
  net.fail = null;
  net.calls.length = 0;
});
afterEach(() => cleanup());

// ═══════════════════════════════════════════════════════════════════════════════
// 0. fixture 自证：这份载荷真有东西可咬（否则整套门在空数据上假绿 —— 本仓 7/7 空数据那族病）
// ═══════════════════════════════════════════════════════════════════════════════
describe("§0 · fixture 自证（空数据上假绿的防线）", () => {
  it("是真抓下来的、且证据/缺席都非空，覆盖到在册节点", () => {
    expect(RAW.__fixture_provenance.how, "fixture 必须写清怎么抓的").toContain("chain_loss_attribution");
    expect(RAW.evidence.length).toBe(RAW.__fixture_provenance.counts.evidence);
    expect(RAW.evidence.length).toBeGreaterThan(20);
    expect(RAW.empty.length).toBeGreaterThan(3);
    expect(NODES_WITH_EVIDENCE.length, "没有一个在册节点带证据 ⇒ 本门咬不到东西").toBeGreaterThan(2);
    expect(NODES_WITH_EMPTY_ONLY.length, "没有只带缺席的在册节点 ⇒ §2 咬不到东西").toBeGreaterThan(0);
    // 换算式必须**至少两档**（1:1 与非 1:1），否则"透传"与"恰好等于原值"分不开
    const units = new Set(RAW.evidence.map((e) => e.drillUnit));
    expect(units.size, `只有一种单位（${[...units].join(",")}）⇒ 透传与巧合分不开`).toBeGreaterThan(1);
    expect(RAW.evidence.some((e) => e.days !== e.drillValue), "没有一条 days ≠ drillValue ⇒ 咬不到「零换算」").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM 头号判据 · evidence[] 逐条上屏 + drillValue / conversion 逐字符等于载荷原文
// ═══════════════════════════════════════════════════════════════════════════════
describe("§1 · SEAM · R13 下钻证据逐条上屏（逐字符对拍载荷原文）", () => {
  it.each(NODES_WITH_EVIDENCE)("节点 %s：evidence[] 每一条都在屏上，drillValue / conversion 一字不差", async (nodeId) => {
    mountView(nodeId);
    await screen.findByTestId("insp-drill-evidence");

    const mine = RAW.evidence.filter((e) => e.nodeId === nodeId);
    expect(mine.length, "本节点在载荷里没有证据 ⇒ 这条用例咬不到东西").toBeGreaterThan(0);

    await waitFor(() =>
      expect(screen.getByTestId("insp-drill-evidence").getAttribute("data-evidence-count")).toBe(String(mine.length)),
    );

    for (const e of mine) {
      // ① 每一条都真渲染出来了（一条不许少）
      const row = screen.getByTestId(`insp-drill-${e.stepId}`);
      expect(row, `证据行 ${e.stepId} 没上屏`).toBeTruthy();

      // ② 三元组：drillType.drillId.drillField 原样
      expect(screen.getByTestId(`insp-drill-triple-${e.stepId}`).textContent).toBe(
        `${e.drillType}.${e.drillId}.${e.drillField}`,
      );

      // ③ **drillValue 逐字符等于载荷原文**（前端改一个字 / 自己算一遍 → 红）
      const shown = screen.getByTestId(`insp-drill-value-${e.stepId}`).textContent;
      expect(shown, `drillValue 被前端改写了：载荷 ${String(e.drillValue)} vs 屏上 ${String(shown)}`).toBe(String(e.drillValue));
      expect(row.getAttribute("data-drill-value")).toBe(String(e.drillValue));

      // ④ **conversion 逐字符等于载荷原文**（引擎下发的换算式，前端不许重写一遍）
      expect(
        screen.getByTestId(`insp-drill-conversion-${e.stepId}`).textContent,
        `conversion 被前端改写了（这正是 gap_attribution 差 1e4 那次的病根形状）`,
      ).toBe(e.conversion);

      // ⑤ 单位原样透出（当不透明串，不复写词表、不据它换算）
      expect(screen.getByTestId(`insp-drill-unit-${e.stepId}`).textContent).toBe(e.drillUnit);

      // ⑥ days 是引擎给的那个数，未被前端重算
      expect(row.getAttribute("data-days")).toBe(String(e.days));

      // ⑦ 派生边原样
      if (e.derivationEdge !== "") {
        expect(screen.getByTestId(`insp-drill-edge-${e.stepId}`).textContent).toContain(e.derivationEdge);
      }
    }
  });

  it("`drillValueText` 是**唯一实现且只做透传**：对全部 26 条证据逐条 === String(载荷原值)", () => {
    for (const e of RAW.evidence) {
      expect(drillValueText({ drillValue: e.drillValue })).toBe(String(e.drillValue));
    }
    // 反面锚：门确实咬得住 —— 只要换算一下就与原文不等（证明上一断言不是恒真）
    const nonTrivial = RAW.evidence.find((e) => e.drillValue !== 0)!;
    expect(String(nonTrivial.drillValue / 2)).not.toBe(String(nonTrivial.drillValue));
  });

  it("宿主传 lossPayload ⇒ **不发第二次请求**（同一个问题不问两遍）", async () => {
    const nodeId = NODES_WITH_EVIDENCE[0]!;
    render(<NodeInspectorView selectedNodeId={nodeId} lossPayload={PAYLOAD} />);
    await screen.findByTestId("insp-drill-evidence");
    await waitFor(() =>
      expect(screen.getByTestId("insp-drill-evidence").getAttribute("data-evidence-count")).not.toBe("0"),
    );
    expect(net.calls, "宿主已给载荷却仍发了请求").toHaveLength(0);
    expect(screen.getByTestId("node-inspector-live-cost").textContent ?? "").toContain("未发第二次请求");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 诚实缺席：没有证据的环节显示引擎给的缺载原因原文，不空着
// ═══════════════════════════════════════════════════════════════════════════════
describe("§2 · 诚实缺席（EMPTY）—— 原文透出，不空着也不补 0", () => {
  it.each(NODES_WITH_EMPTY_ONLY)("节点 %s：只有缺席行时逐条给出 reason 原文 + emptyKind", async (nodeId) => {
    mountView(nodeId);
    await screen.findByTestId("insp-drill-evidence");
    const mine = RAW.empty.filter((e) => e.nodeId === nodeId);
    await waitFor(() => expect(screen.getByTestId("insp-drill-evidence").getAttribute("data-empty-count")).toBe(String(mine.length)));
    for (const e of mine) {
      const row = screen.getByTestId(`insp-drill-empty-${e.stepId}`);
      expect(row.getAttribute("data-empty-kind")).toBe(e.emptyKind);
      expect(row.textContent ?? "", `缺席原因原文被吞了：${e.stepId}`).toContain(e.reason);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. kpi · 接得到就是引擎真值；接不到**一行都不出**（不抄设计稿里那些编的数）
// ═══════════════════════════════════════════════════════════════════════════════
describe("§3 · 节点级流指标：真值 or 不显示", () => {
  it("载荷里有的节点：占全链损失 == Σ 引擎 attribution（前端不定义分母、不重算百分比）", async () => {
    const nodeId = NODES_WITH_EVIDENCE.find((id) => {
      const n = RAW.nodes.find((x) => x.nodeId === id);
      return n !== undefined && RAW.attribution.some((a) => n.steps.some((s) => s.stepId === a.stepId));
    })!;
    expect(nodeId, "找不到既在 nodes[] 又有归因行的节点 ⇒ 本例咬不到东西").toBeTruthy();
    mountView(nodeId);
    const row = await screen.findByTestId("insp-kpi-pctOfChainLoss");

    const node = RAW.nodes.find((n) => n.nodeId === nodeId)!;
    const expected =
      Math.round(
        RAW.attribution.filter((a) => node.steps.some((s) => s.stepId === a.stepId)).reduce((s, a) => s + a.pctOfChainLoss, 0) * 100,
      ) / 100;
    expect(row.getAttribute("data-value")).toBe(`${String(expected)}%`);
    expect(row.textContent ?? "", "没写清这个数凭什么").toContain("attribution[].pctOfChainLoss");
  });

  it("**不在载荷里的在册节点：KPI 一行都不出**，且当面说清为什么（不是 0，是没有这个节点）", async () => {
    const absent = CHAIN_NODE_REGISTRY.map((n) => n.nodeId).find(
      (id) => !RAW.nodes.some((n) => n.nodeId === id) && !RAW.empty.some((e) => e.nodeId === id),
    );
    expect(absent, "载荷覆盖了全部在册节点 ⇒ 本例咬不到东西（换一份 fixture 或放宽）").toBeTruthy();
    mountView(absent!);
    await screen.findByTestId("insp-kpi");
    await waitFor(() => expect(screen.getByTestId("insp-kpi").getAttribute("data-kpi-count")).toBe("0"));
    expect(screen.getByTestId("insp-kpi-empty").textContent ?? "").toContain("本节点不在这一次的载荷里");
  });

  it("设计稿里那些编的数字**一个都没进源码正文**（14.8% / 18,400 / 87.4% …）", () => {
    // 注释不参与判定：本单的说明书里就写着"设计稿给了 14.8% 这类读数、一个都没抄"，
    // 不剥注释的话门会咬到自己的说明书（而注释本来也不会被渲染出去）。同族做法见既有三色系门。
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const src = [
      readRepo("apps/frontend-shell/src/views/sim/inspectorModel.ts"),
      readRepo("apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx"),
      readRepo("apps/frontend-shell/src/views/sim/chainNodeSemantics.ts"),
    ]
      .map(strip)
      .join("\n");
    for (const fake of ["14.8%", "18,400", "87.4%", "97.95", "1,240吨", "0.62"]) {
      expect(src.includes(fake), `设计稿里编的数字被抄进了源码：${fake}`).toBe(false);
    }
    // 反面锚：门确实咬得住（把那个数塞进"正文"必被抓出）
    expect(`${src}\nconst kpi = "14.8%";`.includes("14.8%")).toBe(true);
  });

  it("取数失败 ⇒ 屏上写清失败原因，**不静默退回占位数字**", async () => {
    net.fail = new Error("BOOM 引擎挂了");
    mountView(NODES_WITH_EVIDENCE[0]!);
    await screen.findByTestId("insp-kpi");
    await waitFor(() => expect(screen.getByTestId("insp-kpi-empty").textContent ?? "").toContain("BOOM 引擎挂了"));
    expect(screen.getByTestId("insp-kpi").getAttribute("data-kpi-count")).toBe("0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. pos / cf · 键 ⊆ 契约注册表 · 没写语义的节点**不得渲染空壳**
// ═══════════════════════════════════════════════════════════════════════════════
describe("§4 · 节点语义常量表（编辑口径）", () => {
  it("键必须 ⊆ CHAIN_NODE_REGISTRY（**包含**关系，不是相等 —— 注册表正在 12→24 扩表）", () => {
    const keys = Object.keys(CHAIN_NODE_SEMANTICS);
    expect(keys.length).toBeGreaterThan(0);
    const strays = keys.filter((k) => !CHAIN_NODE_IDS.includes(k));
    expect(strays, `语义表里出现不在册的节点键（手抄词表漂移·#99 复发）：${strays.join(", ")}`).toEqual([]);
    // 反面锚：门咬得住（往键集里塞一个自由串必被抓出）
    expect([...keys, "totally.made.up::node"].filter((k) => !CHAIN_NODE_IDS.includes(k))).toHaveLength(1);
  });

  it("每条 cf 都有**能翻到的 file:line 依据**，且依据文件真的存在（指不出依据的一条都不许写）", () => {
    let checked = 0;
    for (const [, sem] of Object.entries(CHAIN_NODE_SEMANTICS)) {
      for (const c of sem?.cf ?? []) {
        expect(c.basis.length, `冲突 ${c.conflictId} 没给依据`).toBeGreaterThan(0);
        for (const b of c.basis) {
          // 形如 `path/to/file.ts:123` 或 `…:123-456`
          const m = /^([^\s:]+\.(?:ts|tsx)):(\d+)(?:-\d+)?/.exec(b);
          expect(m, `依据不是 file:line 形态：${b}`).not.toBeNull();
          const rel = m![1]!;
          const line = Number(m![2]);
          expect(existsSync(join(REPO_ROOT, rel)), `依据指向的文件不存在：${rel}`).toBe(true);
          const lines = readRepo(rel).split("\n");
          expect(line, `依据行号越界：${b}（该文件共 ${lines.length} 行）`).toBeLessThanOrEqual(lines.length);
          checked += 1;
        }
      }
    }
    expect(checked, "一条 cf 依据都没检到 ⇒ 本例是恒真的废门").toBeGreaterThan(8);
  });

  it("写了语义的节点：`pos` 上屏且标明是**编辑口径不是引擎下发**", async () => {
    const withSem = CHAIN_NODE_REGISTRY.find((n) => chainNodeSemantics(n.nodeId) !== undefined)!;
    mountView(withSem.nodeId);
    const pos = await screen.findByTestId("insp-pos");
    expect(pos.getAttribute("data-origin")).toBe("editorial");
    expect(pos.textContent ?? "").toContain(chainNodeSemantics(withSem.nodeId)!.pos);
    expect(pos.textContent ?? "", "没说清这是人写的口径").toContain("编辑口径");
  });

  it("写了 cf 的节点：逐条上屏 + 逐条附依据", async () => {
    const withCf = CHAIN_NODE_REGISTRY.find((n) => (chainNodeSemantics(n.nodeId)?.cf ?? []).length > 0)!;
    mountView(withCf.nodeId);
    await screen.findByTestId("insp-cf");
    for (const c of chainNodeSemantics(withCf.nodeId)!.cf!) {
      expect(screen.getByTestId(`insp-cf-${c.conflictId}`).textContent ?? "").toContain(c.text);
      const basis = screen.getByTestId(`insp-cf-basis-${c.conflictId}`);
      for (const b of c.basis) expect(basis.textContent ?? "").toContain(b);
    }
  });

  it("**没写语义的节点：pos / cf 两块整块不渲染**（不留空壳 —— 扩表后的优雅降级）", () => {
    // 直接喂面板一个不在语义表里的节点（等价于注册表扩了、语义还没补的那一刻）
    const input = buildPlaceholderInspectorInput({ nodeId: "brand.new::node", label: "刚扩进来的节点", stage: "DEMAND" });
    expect(chainNodeSemantics(input.node.nodeId)).toBeUndefined();
    render(<InspectorNodePanel input={input} />);
    expect(screen.getByTestId("insp-panel")).toBeInTheDocument(); // 面板本体照常
    expect(screen.queryByTestId("insp-pos"), "没写语义却渲染了节点定位空壳").toBeNull();
    expect(screen.queryByTestId("insp-cf"), "没写语义却渲染了跨节点冲突空壳").toBeNull();
    // 空壳的另一种形态：区块在、里面是"暂无"。整个 DOM 里不许出现这两个标题。
    const txt = screen.getByTestId("insp-panel").textContent ?? "";
    expect(txt).not.toContain("节点定位");
    expect(txt).not.toContain("跨节点冲突");
  });

  it("覆盖率读数是**派生**的（注册表一扩就掉下来），且屏上说清未覆盖的那些整块不出现", async () => {
    const cov = chainNodeSemanticsCoverage();
    expect(cov.registered).toBe(CHAIN_NODE_REGISTRY.length);
    expect(cov.withSemantics).toBe(Object.keys(CHAIN_NODE_SEMANTICS).length);
    expect(cov.withSemantics + cov.missing.length).toBe(cov.registered);
    mountView(CHAIN_NODE_REGISTRY[0]!.nodeId);
    const el = await screen.findByTestId("node-inspector-semantics-coverage");
    expect(el.getAttribute("data-with-semantics")).toBe(String(cov.withSemantics));
    expect(el.getAttribute("data-registered")).toBe(String(cov.registered));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 派生层纯度（R6）：同一份载荷两次投影字节一致、不排序、不改字
// ═══════════════════════════════════════════════════════════════════════════════
describe("§5 · buildNodeLiveView 纯度", () => {
  it("同输入两跑字节一致，且证据顺序 == 引擎给的顺序（前端不引入第二套全序）", () => {
    const nodeId = NODES_WITH_EVIDENCE[0]!;
    const a = buildNodeLiveView(nodeId, PARSED);
    const b = buildNodeLiveView(nodeId, PARSED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.evidence.map((e) => e.stepId)).toEqual(RAW.evidence.filter((e) => e.nodeId === nodeId).map((e) => e.stepId));
  });

  it("载荷为 null ⇒ present:false + 全空（**不造一个填了默认值的投影**）", () => {
    const v = buildNodeLiveView(CHAIN_NODE_REGISTRY[0]!.nodeId, null);
    expect(v.present).toBe(false);
    expect(v.node).toBeNull();
    expect(v.evidence).toEqual([]);
    expect(v.empty).toEqual([]);
    expect(v.kpis).toEqual([]);
  });
});
