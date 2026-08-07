import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { WORKSHOP_REGISTRY } from "@platform/contracts";
import { server } from "./setup";
import { tokenStore } from "@/api/tokenStore";
import { PhysicalTopologyView } from "@/views/sim/PhysicalTopologyView";
import {
  buildCellFacts,
  buildTopology,
  cellKeyOf,
  lineIdOfWorkshop,
  TOPOLOGY_FACT_QUERIES,
  type AggRow,
  type TopologyFacts,
} from "@/views/sim/physicalTopology";

/**
 * WO-TOPO-REALDATA · 物理拓扑 130 格「占位 → 真值」的接缝门。
 *
 * ── 这道门咬的是接缝，不是函数 ──────────────────────────────────────────────
 *  数据半（DataCore 对象聚合的**真形状**载荷）× 引擎半（本模块的聚合口径）× 呈现半（逐格 provenance）
 *  三者在一条断言里对齐；任一半改口径都要红。
 *
 * ── 期望值一律**手算硬编码**，绝不拿实现再算一遍去比自己（那是同义反复）────────
 *  · util  1800 ÷ 2400 = 0.75            → 75
 *  · util  1751 ÷ 1920 = 0.911979…       → 91.2
 *  · oee   0.6421 × 100 = 64.21          → 64.2
 *  · takt  max(2.5, 0.9)                 → 2.5
 *  · wip   Σ = 1234                      → 1234
 *
 * ── 载荷形状的出处（不是照 schema 抄，是 curl 实测原文）──────────────────────
 *  2026-08-07 · 内存态 datacore（SEED_DEMO=1, seed 42）· `POST /a/v1/objects/aggregate`：
 *    { "group": { "baseId": "changzhou", "lineId": "LINE-WS-changzhou-assembly" },
 *      "metrics": { "avg_oee": 0.816095, "sum_actualProductionTime": 18342,
 *                   "sum_plannedProductionTime": 20160,
 *                   "min_plannedProductionTime": 480, "max_plannedProductionTime": 480 } }
 *    `GET /a/v1/objects?type=Workshop` →
 *    { "props": { "workshopId": "WS-changzhou-assembly", "baseId": "changzhou",
 *                 "name": "常州装配车间", "processType": "装配" } }
 *  实测规模：EquipmentOEE 5460 行 / Equipment 780 行 / WIPLot 260 行 / Workshop 130 行。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 载荷构造（形状照抄实测；数值为手算友好的整数）
// ═══════════════════════════════════════════════════════════════════════════════

const CZ = "changzhou";
const XM = "xiamen";
/** 车间册行（形状照抄 `GET /a/v1/objects?type=Workshop` 的 props）。 */
const ws = (baseId: string, suffix: string) => {
  const w = WORKSHOP_REGISTRY.find((x) => x.suffix === suffix);
  if (!w) throw new Error(`[fixture] WORKSHOP_REGISTRY 无 suffix=${suffix} —— 载荷造错了，不是被测代码错了`);
  return { workshopId: `WS-${baseId}-${suffix}`, baseId, name: `${baseId}${w.type}车间`, processType: w.type };
};
const oeeRow = (
  baseId: string,
  suffix: string,
  m: { avg: number | null; act: number | null; plan: number | null; minPlan: number | null; maxPlan: number | null },
): AggRow => ({
  group: { baseId, lineId: lineIdOfWorkshop(`WS-${baseId}-${suffix}`) },
  metrics: {
    avg_oee: m.avg,
    sum_actualProductionTime: m.act,
    sum_plannedProductionTime: m.plan,
    min_plannedProductionTime: m.minPlan,
    max_plannedProductionTime: m.maxPlan,
  },
});
const eqRow = (baseId: string, suffix: string, maxCt: number | null, minCt: number | null, n: number): AggRow => ({
  group: { baseId, lineId: lineIdOfWorkshop(`WS-${baseId}-${suffix}`) },
  metrics: { max_ctSeconds: maxCt, min_ctSeconds: minCt, count_equipId: n },
});
const wipRow = (baseId: string, suffix: string, qty: number | null, lots: number): AggRow => ({
  group: { lineId: lineIdOfWorkshop(`WS-${baseId}-${suffix}`) },
  metrics: { sum_qty: qty, count_lotId: lots },
});

/** 孤儿事实：lineId 不在车间册里（缺维 / 拼错 / null）—— **必须整行丢弃，不摊到任何一格**。 */
const ORPHAN_OEE: AggRow = {
  group: { baseId: "ghost", lineId: "LINE-WS-ghost-assembly" },
  metrics: { avg_oee: 0.99, sum_actualProductionTime: 999_999, sum_plannedProductionTime: 1_000_000, min_plannedProductionTime: 480, max_plannedProductionTime: 480 },
};
/**
 * ⚠ 毒值必须落在**所有占位值域之外**，否则"没被摊派"会被占位值撞出假红：
 *    utilPct 52–98 · oeePct 55–92 · wipCells 1200–26000（整数）。
 *    首版取 88.8 → 恰好可能是某格的占位 OEE，本用例当场假红一次（这次是测试写错，不是代码错）。
 *    4242.5 同时越过百分比上限且非整数 → 三个值域都造不出来。
 */
const ORPHAN_CT = 4242.5;
const ORPHAN_EQ_NULL_LINE: AggRow = {
  group: { baseId: CZ, lineId: null },
  metrics: { max_ctSeconds: ORPHAN_CT, min_ctSeconds: ORPHAN_CT, count_equipId: 3 },
};
const ORPHAN_WIP: AggRow = { group: { lineId: "LINE-NOPE" }, metrics: { sum_qty: 777_777, count_lotId: 9 } };

/** 车间册里 processType 不在 `WORKSHOP_REGISTRY`（映射不到列 → 整格放弃，不猜一列）。 */
const UNMAPPED_WS = { workshopId: `WS-${CZ}-polish`, baseId: CZ, name: "常州抛光车间", processType: "抛光" };

function facts(): TopologyFacts {
  return {
    workshops: [ws(CZ, "assembly"), ws(CZ, "coating"), ws(XM, "pack"), UNMAPPED_WS],
    oee: [
      // A 格：等权（min===max）→ oee 承认；util = 1800/2400 = 75
      oeeRow(CZ, "assembly", { avg: 0.6421, act: 1800, plan: 2400, minPlan: 480, maxPlan: 480 }),
      // B 格：不等权（400 ≠ 480）→ oee 必须 EMPTY；util 仍可算 = 1751/1920 = 91.2
      oeeRow(CZ, "coating", { avg: 0.9999, act: 1751, plan: 1920, minPlan: 400, maxPlan: 480 }),
      ORPHAN_OEE,
    ],
    equipment: [eqRow(CZ, "assembly", 2.5, 0.9, 6), ORPHAN_EQ_NULL_LINE],
    wip: [wipRow(CZ, "assembly", 1234, 2), wipRow(XM, "pack", 4321, 3), ORPHAN_WIP],
  };
}

const A = cellKeyOf(CZ, "assembly");
const B = cellKeyOf(CZ, "coating");
const C = cellKeyOf(XM, "pack");

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 口径 SEAM：真形状载荷 → 硬编码期望值
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 对象聚合 → 格（口径单源，期望值手算硬编码）", () => {
  it("① 四条度量都进真值档，值 = 手算结果（不是拿实现再算一遍）", () => {
    const { byCell } = buildCellFacts(facts());
    const a = byCell.get(A)!;

    expect(a.util).toMatchObject({ value: 75, provenance: "aggregate", unit: "%" });
    expect(a.oee).toMatchObject({ value: 64.2, provenance: "aggregate", unit: "%" });
    expect(a.takt).toMatchObject({ value: 2.5, provenance: "aggregate", unit: "s/电芯" });
    expect(a.wip).toMatchObject({ value: 1234, provenance: "aggregate", unit: "电芯" });
  });

  it("② util 是「和比和」不是「比率平均」——两者在不等权载荷下必然分叉", () => {
    // B 格 Σ实际/Σ计划 = 1751/1920 = 91.1979…% → 91.2
    const { byCell } = buildCellFacts(facts());
    expect(byCell.get(B)!.util).toMatchObject({ value: 91.2, provenance: "aggregate" });
    // 口径算式必须上屏（本仓出过"口径藏在代码里换了没人知道"的事故）
    expect(byCell.get(B)!.util!.basis).toMatch(/Σ实际生产时间 1751 ÷ Σ计划生产时间 1920/);
    expect(byCell.get(B)!.util!.basis).toMatch(/加权/);
  });

  it("③ takt 取最慢工位（max），不取平均 —— 平均值 1.7 出现即错", () => {
    const { byCell } = buildCellFacts(facts());
    expect(byCell.get(A)!.takt!.value).toBe(2.5);
    expect(byCell.get(A)!.takt!.value).not.toBe((2.5 + 0.9) / 2);
    expect(byCell.get(A)!.takt!.basis).toMatch(/最慢工位/);
  });

  it("④ 只有部分度量到货的格（C 只有 wip）：到货的进真值档，没到货的不许伪装", () => {
    const { byCell } = buildCellFacts(facts());
    const c = byCell.get(C)!;
    expect(c.wip).toMatchObject({ value: 4321, provenance: "aggregate" });
    expect(c.util).toBeUndefined();
    expect(c.oee).toBeUndefined();
    expect(c.takt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 等权门：avg 不许冒充 weighted_avg
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · OEE 等权门（本仓有过 avg 冒充 weighted_avg 的真事故）", () => {
  it("计划工时不等权 → OEE 标 EMPTY 且说明原因，**不落 avg 的那个数**", () => {
    const { byCell, diagnostics } = buildCellFacts(facts());
    const b = byCell.get(B)!;
    expect(b.oee).toMatchObject({ value: null, provenance: "empty" });
    expect(b.oee!.reason).toMatch(/不等权/);
    expect(b.oee!.reason).toMatch(/不拿简单平均冒充加权平均/);
    expect(diagnostics.oeeUnweighted).toBe(1);
  });

  it("计划工时全等 → 承认 avg，并在算式里写明「等权 ⇒ 恒等于加权」", () => {
    const { byCell } = buildCellFacts(facts());
    expect(byCell.get(A)!.oee!.basis).toMatch(/等权算术平均恒等于按计划工时加权平均/);
    // 样本量由 Σ计划 ÷ min计划 反解（metrics 契约上限 5 条，count 挤不进去）
    expect(byCell.get(A)!.oee!.basis).toMatch(/over 5 条/); // 2400 ÷ 480 = 5
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 孤儿事实不许摊派（对应工单的「缺 processId 的设备不得被摊到任意一格」）
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 落不到格的事实行整行丢弃，绝不「就近」摊派", () => {
  it("lineId 不在车间册 / 为 null 的三行全部丢弃并计数", () => {
    const { byCell, diagnostics } = buildCellFacts(facts());
    expect(diagnostics.orphanRows).toEqual({ oee: 1, equipment: 1, wip: 1 });
    expect(diagnostics.unmappedWorkshops).toBe(1);
    // 只应有 A/B/C 三格拿到事实
    expect([...byCell.keys()].sort()).toEqual([A, B, C].sort());
  });

  it("孤儿行里那些扎眼的数字，一个都不许出现在任何一格里", () => {
    const m = buildTopology(42, facts());
    const all = m.rows.flatMap((r) => r.cells).flatMap((c) => [c.util.value, c.oee.value, c.wip.value, c.takt.value]);
    for (const poison of [999_999, 777_777, ORPHAN_CT]) {
      expect(all, `孤儿事实 ${poison} 被摊进了某一格 —— 这等于凭空造数`).not.toContain(poison);
    }
  });

  it("车间册映射不到列的行（processType=抛光）不会凭空造出一格", () => {
    const { byCell } = buildCellFacts(facts());
    expect([...byCell.keys()].some((k) => k.includes("polish") || k.includes("抛光"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 真值缺席 → 诚实回落占位（不是"功能开关"，是回落路径）
// ═══════════════════════════════════════════════════════════════════════════════
describe("诚实回落 · 取不到真值就回到占位，并说清为什么", () => {
  it("facts=null 与不传参逐字节一致（= 接线前的行为）", () => {
    expect(JSON.stringify(buildTopology(42, null))).toBe(JSON.stringify(buildTopology(42)));
  });

  it("回落时每条占位都带 reason，且 R6 确定性不变", () => {
    const m = buildTopology(42, null);
    const c = m.rows[0]!.cells[0]!;
    expect(c.util.provenance).toBe("placeholder");
    expect(c.util.reason).toMatch(/回落 seed 占位/);
    expect(c.takt).toMatchObject({ value: null, provenance: "empty" });
    expect(JSON.stringify(buildTopology(42, null))).toBe(JSON.stringify(buildTopology(42, null)));
    expect(JSON.stringify(buildTopology(42, null))).not.toBe(JSON.stringify(buildTopology(7, null)));
  });

  it("节拍不回落占位：假节拍会被当成排产输入，比空白危险", () => {
    for (const m of [buildTopology(42, null), buildTopology(42, facts())]) {
      for (const row of m.rows) {
        for (const cell of row.cells) {
          expect(cell.takt.provenance === "aggregate" || cell.takt.provenance === "empty").toBe(true);
        }
      }
    }
  });

  it("统计是逐条数出来的，不是 cellCount×常数（混排后常数乘法就是屏上一个假数）", () => {
    const m = buildTopology(42, facts());
    // A 格 4 条全真、B 格 util 真+oee EMPTY+wip 占位+takt EMPTY、C 格 wip 真
    expect(m.stats.realCells).toBe(3);
    expect(m.stats.realMeasures).toBe(4 + 1 + 1); // A:util/oee/takt/wip · B:util · C:wip
    expect(m.stats.realMeasures + m.stats.placeholderMeasures + m.stats.emptyMeasures).toBe(m.stats.cellCount * 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 列轴裁决取证：join 键必须是 lineId，不是 processId
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 列轴 = Workshop 层（lineId），不是 Process 层（processId）", () => {
  /**
   * 实测原文（2026-08-07，内存态 datacore，`GET /a/v1/objects?type=Equipment` 全 780 行）：
   *   processId 末段 distinct = ["assembly","coating","winding"]        ← 仅 3 值
   *   lineId    末段 distinct = 十车间 suffix 全集                        ← 10 值
   * 故按 processId 定列只能点亮 13×3=39 格，另外 91 格永远空。本用例把这条事实钉死。
   */
  const REAL_EQUIPMENT_SAMPLE = [
    { equipId: "LINE-WS-changzhou-assembly-assembly-E1", processId: "LINE-WS-changzhou-assembly-assembly", lineId: "LINE-WS-changzhou-assembly", baseId: "changzhou" },
    { equipId: "LINE-WS-changzhou-assembly-coating-E1", processId: "LINE-WS-changzhou-assembly-coating", lineId: "LINE-WS-changzhou-assembly", baseId: "changzhou" },
    { equipId: "LINE-WS-changzhou-pack-winding-E2", processId: "LINE-WS-changzhou-pack-winding", lineId: "LINE-WS-changzhou-pack", baseId: "changzhou" },
  ];

  it("同一 lineId 下的两个不同 processId 属于同一格（证明列轴是车间不是工序）", () => {
    const [a, b] = REAL_EQUIPMENT_SAMPLE;
    expect(a!.processId).not.toBe(b!.processId);
    expect(a!.lineId).toBe(b!.lineId);
    expect(lineIdOfWorkshop(`WS-changzhou-assembly`)).toBe(a!.lineId);
  });

  it("processId 末段只覆盖 3 个 suffix，撑不起十列（工单初判那条链会塌成 39 格）", () => {
    const bySuffix = new Set(REAL_EQUIPMENT_SAMPLE.map((e) => e.processId.split("-").pop()));
    expect([...bySuffix].sort()).toEqual(["assembly", "coating", "winding"]);
    expect(bySuffix.size).toBeLessThan(WORKSHOP_REGISTRY.length);
    // lineId 末段则落在十车间册上
    for (const e of REAL_EQUIPMENT_SAMPLE) {
      expect(WORKSHOP_REGISTRY.some((w) => w.suffix === e.lineId.split("-").pop())).toBe(true);
    }
  });

  it("请求体单一来源：groupBy 必须带 lineId；WIPLot 不按 baseId 分组（该属性不存在）", () => {
    expect(TOPOLOGY_FACT_QUERIES.oee.groupBy).toContain("lineId");
    expect(TOPOLOGY_FACT_QUERIES.equipment.groupBy).toContain("lineId");
    expect(TOPOLOGY_FACT_QUERIES.wip.groupBy).toEqual(["lineId"]);
    // 契约上限：metrics ≤5、groupBy ≤2
    for (const q of Object.values(TOPOLOGY_FACT_QUERIES)) {
      expect(q.metrics.length).toBeLessThanOrEqual(5);
      expect(q.groupBy.length).toBeLessThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 端到端接缝：HTTP → 组件 → 屏上那一格
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 端到端（真形状 HTTP 响应 → 屏上格子的 provenance 与数字）", () => {
  const renderTopo = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhysicalTopologyView />
      </QueryClientProvider>,
    );

  /** 把载荷按 typeKey 分派给 `/objects/aggregate`，Workshop 走 `/objects`。 */
  function wireBackend(f: TopologyFacts, opts?: { fail?: boolean }) {
    server.use(
      http.post("*/a/v1/objects/aggregate", async ({ request }) => {
        if (opts?.fail) return HttpResponse.json({ error: { code: "BOOM", message: "聚合炸了", requestId: "r1" } }, { status: 500 });
        const body = (await request.json()) as { typeKey: string };
        const rows = body.typeKey === "EquipmentOEE" ? f.oee : body.typeKey === "Equipment" ? f.equipment : body.typeKey === "WIPLot" ? f.wip : [];
        return HttpResponse.json({ rows, rowCount: rows.length, truncated: false });
      }),
      http.get("*/a/v1/objects", ({ request }) => {
        const type = new URL(request.url).searchParams.get("type");
        if (type !== "Workshop") return HttpResponse.json({ items: [], total: 0 });
        const items = f.workshops.map((w, i) => ({ id: `w${i}`, type: "Workshop", props: w }));
        return HttpResponse.json({ items, total: items.length });
      }),
    );
  }

  beforeEach(() => {
    tokenStore.set("seam-token"); // 无会话不读租户对象（enabled 门），端到端用例须先有 token
  });

  it("接上真值：常州·装配格 provenance=aggregate，屏上就是 75（手算值）", async () => {
    wireBackend(facts());
    renderTopo();
    const cell = screen.getByTestId(`phys-topo-cell-${CZ}-assembly`);
    await waitFor(() => expect(cell).toHaveAttribute("data-provenance", "aggregate"));
    expect(cell).toHaveTextContent("75");
    expect(cell).toHaveTextContent("真值"); // 角标随档位变（真值格也标，免得两种数看起来一样）
  });

  it("详情面板：四条度量逐条标来源 + 附算式；OEE 不等权那格显 EMPTY 不显数", async () => {
    const user = userEvent.setup();
    wireBackend(facts());
    renderTopo();
    await waitFor(() => expect(screen.getByTestId(`phys-topo-cell-${CZ}-assembly`)).toHaveAttribute("data-provenance", "aggregate"));

    await user.hover(screen.getByTestId(`phys-topo-cell-${CZ}-assembly`));
    expect(screen.getByTestId("phys-topo-detail-util")).toHaveAttribute("data-provenance", "aggregate");
    expect(screen.getByTestId("phys-topo-detail-util")).toHaveTextContent("75 %");
    expect(screen.getByTestId("phys-topo-detail-util")).toHaveTextContent("真值·对象聚合");
    expect(screen.getByTestId("phys-topo-detail-util-basis")).toHaveTextContent(/Σ实际生产时间 1800 ÷ Σ计划生产时间 2400/);
    expect(screen.getByTestId("phys-topo-detail-takt")).toHaveTextContent("2.5 s/电芯");
    expect(screen.getByTestId("phys-topo-detail-wip")).toHaveTextContent("1234 电芯");

    await user.hover(screen.getByTestId(`phys-topo-cell-${CZ}-coating`));
    const oeeLine = screen.getByTestId("phys-topo-detail-oee");
    expect(oeeLine).toHaveAttribute("data-provenance", "empty");
    expect(oeeLine).toHaveTextContent("EMPTY");
    expect(oeeLine).not.toHaveTextContent("99.99"); // avg 那个数不许漏到屏上
  });

  it("没接上的格仍是占位、仍带占位角标 —— 一格都不许悄悄升档", async () => {
    wireBackend(facts());
    renderTopo();
    await waitFor(() => expect(screen.getByTestId(`phys-topo-cell-${CZ}-assembly`)).toHaveAttribute("data-provenance", "aggregate"));
    // 载荷里没有 眉山·卷绕
    const untouched = screen.getByTestId("phys-topo-cell-meishan-winding");
    expect(untouched).toHaveAttribute("data-provenance", "placeholder");
    expect(untouched).toHaveTextContent("占位");
    // 横幅照实播报：几格真、几格占位
    expect(screen.getByTestId("phys-topo-banner-stats")).toHaveTextContent("真值度量 6 项");
    expect(screen.getByTestId("phys-topo-facts-diagnostics")).toHaveTextContent("孤儿事实行 OEE 1 / 设备 1 / 在制 1");
    expect(screen.getByTestId("phys-topo-facts-diagnostics")).toHaveTextContent("不摊到任何一格");
  });

  it("后端 500 → 全格回落占位并明说读取失败，不拿旧值/假值顶替", async () => {
    wireBackend(facts(), { fail: true });
    renderTopo();
    expect(await screen.findByTestId("phys-topo-facts-error")).toHaveTextContent(/真值读取失败/);
    expect(screen.getByTestId(`phys-topo-cell-${CZ}-assembly`)).toHaveAttribute("data-provenance", "placeholder");
  });

  it("未登录 → 根本不发请求，横幅照实说明（不是「加载中」转圈骗人）", async () => {
    tokenStore.clear();
    // 不装 handler：只要发出请求，setup 的 onUnhandledRequest:"error" 就会炸出来
    renderTopo();
    expect(await screen.findByTestId("phys-topo-facts-anonymous")).toHaveTextContent("未登录");
    expect(screen.getByTestId(`phys-topo-cell-${CZ}-assembly`)).toHaveAttribute("data-provenance", "placeholder");
  });

  it("诚实位没丢：横幅 testid 与「占位值」三字仍在（沙盘控制台 SEAM 门靠它）", async () => {
    wireBackend(facts());
    renderTopo();
    const banner = await screen.findByTestId("phys-topo-placeholder-banner");
    expect(banner.textContent ?? "").toContain("占位值");
    // 接线台账：四条已接线 + 两条仍是缺口，逐条可见
    const ledger = within(screen.getByTestId("phys-topo-entrypoints"));
    for (const f of ["util", "oee", "wip", "takt"]) {
      expect(ledger.getByTestId(`phys-topo-entry-${f}`), `度量 ${f} 的接线台账不见了`).toHaveAttribute("data-status", "connected");
    }
    expect(ledger.getByTestId("phys-topo-entry-capacity_rollup")).toHaveAttribute("data-status", "gap");
    expect(ledger.getByTestId("phys-topo-entry-bottleneck_matrix")).toHaveAttribute("data-status", "gap");
  });
});
