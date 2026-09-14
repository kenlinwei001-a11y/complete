import { describe, expect, it } from "vitest";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, portfolioOptimize, classifySegment, type PortfolioInput } from "../src/solvers/portfolio.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";

/**
 * WO-GSIM-2-SOLVER · SEAM 守门（八条·跨「数据(换型 seed 口径/电芯来源) + 引擎(portfolio)」两半·一人整单）。
 *
 * in-proc solve 注入（InProcOptimizerClient·确定性贪心·R6·不依赖外部 CP-SAT sidecar），
 * 逐条**红咬接缝**（非只断言函数返回值）：物料/换型小时/两段路由/分批/硬锁/杠杆/递进/R6。
 */

const FORECAST_START = "2026-06-10";
const inproc = new InProcOptimizerClient();
const solve = (req: PortfolioRequest) => inproc.solvePortfolio!(req);

/** R14 系数（覆盖默认·测试可控）。 */
const mkCoeff = (over: Record<string, number> = {}) => (k: string, d: number): number => (k in over ? over[k]! : d);

/** 换型矩阵行（★hours 口径·lineId 全局）。 */
const co = (from: string, to: string, hours: number) => ({ pairId: `${from}__${to}`, fromModel: from, toModel: to, hours, lineId: null, minutes: hours * 60 });

/** 基地（factory_type 真语义：CELL/PACK/CELL+PACK）。 */
const base = (baseId: string, factory_type: string, util = 0) => ({ baseId, name: baseId, util, factory_type });
/** 产线。 */
const line = (baseId: string, lineId: string, capacityDaily: number) => ({ baseId, lineId, capacityDaily });
/** 订单。 */
const ord = (so: string, cust: string, model: string, qty: number, due: string, pri = "高", bases?: string[]) =>
  ({ so, cust, model, qty, due, pri, status: "OPEN", ...(bases ? { bases } : {}) });

const baseInput = (over: Partial<PortfolioInput>): PortfolioInput => ({
  forecastStart: FORECAST_START,
  orders: [], workOrders: [], demandSegments: [],
  bases: [], lines: [], changeover: [],
  modelBaseMap: {},
  seed: 42,
  coeff: mkCoeff({ windowDays: 7 }),
  ...over,
});

describe("WO-GSIM-2-SOLVER · SEAM 八条（in-proc solve 注入·确定性 R6）", () => {
  // ── ① 物料联合约束（种正极短缺 → 排产真变·被卡单归因 Material+Supplier） ──
  it("SEAM①物料：正极短缺压低 avail → 排产真变 + 被卡单归因具体 Material+Supplier", async () => {
    const world = (cathodeAvail: number): PortfolioInput => baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      lines: [line("changzhou", "cz-l1", 500)],
      modelBaseMap: { "4680-NCM": ["changzhou"] },
      orders: [
        ord("SO-A", "广汽集团", "4680-NCM", 1000, "2026-06-24"),
        ord("SO-B", "长安汽车", "4680-NCM", 1000, "2026-06-24"),
      ],
      materialConstraint: true,
      materials: [{ materialCode: "正极-NCM", avail: cathodeAvail, supplierId: "SUP-容百" }],
      bom: { "4680-NCM": [{ material: "正极-NCM", supplier: "SUP-容百", perUnit: 1 }] },
      scenarios: ["max_ontime"],
    });
    // 充足正极：两单皆可产（无物料卡单）。
    const rich = await globalSimOptimize(world(5000), solve);
    expect(rich.materialConstraint).toBe(true);
    const richMat = rich.blocked.filter((b) => b.reason === "material");
    expect(richMat.length).toBe(0);
    // 正极短缺（仅够一单）：另一单被物料卡·归因到 正极-NCM + 供应商。
    const scarce = await globalSimOptimize(world(1000), solve);
    const scarceMat = scarce.blocked.filter((b) => b.reason === "material");
    expect(scarceMat.length).toBeGreaterThan(0);
    expect(scarceMat[0]!.material).toBe("正极-NCM");
    expect(scarceMat[0]!.supplier).toBe("SUP-容百");
    expect(scarceMat[0]!.provenance.drillType).toBe("Material");
    // 排产真变：短缺态 material_blocked 排产行 > 充足态（同一求解·物料约束真改结果）。
    const okRich = rich.schedule.filter((r) => r.status === "ok").length;
    const okScarce = scarce.schedule.filter((r) => r.status === "ok").length;
    expect(okScarce).toBeLessThan(okRich);
  });

  // ── ② 换型小时（命门口径·全链小时·不残留分钟·调高换型 → cost 真升 → 真改选别线） ──
  it("SEAM②换型小时：调高线上 2170→4680 换型小时 → 该方案 cost 真升 → 求解器真改选别线（单位红线全链小时）", async () => {
    const world = (crossHours: number): PortfolioInput => baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      // 线级：cz-l1 当前跑 2170-NCM（切 4680 换型 crossHours）；cz-l2 当前跑 方形-NCM（切 4680 换型 5h）。
      lines: [line("changzhou", "cz-l1", 500), line("changzhou", "cz-l2", 500)],
      lineGranularity: true,
      lineCurrentModel: { "cz-l1": "2170-NCM", "cz-l2": "方形-NCM" },
      modelBaseMap: { "4680-NCM": ["changzhou"] },
      changeover: [co("2170-NCM", "4680-NCM", crossHours), co("方形-NCM", "4680-NCM", 5)],
      orders: [ord("SO-X", "广汽集团", "4680-NCM", 300, "2026-06-24")],
      scenarios: ["min_cost"],
    });
    // run1：cz-l1 换型 3h（< cz-l2 的 5h）→ min_cost 选 cz-l1。
    const r1 = await globalSimOptimize(world(3), solve);
    const a1 = r1.scenarios[0]!.allocation.find((a) => a.orderId === "SO-X")!;
    expect(a1.line).toBe("cz-l1");
    // ★单位红线：changeoverHours 是**小时**量级（3·非 180 分钟）——全链无分钟残留。
    expect(r1.scenarios[0]!.kpi.changeoverHours).toBe(3);
    expect(r1.scenarios[0]!.kpi.changeoverHours).toBeLessThan(60);
    // run2：cz-l1 换型飙到 48h（> cz-l2 的 5h）→ 该线该方案 cost 真升 → 求解器真改选 cz-l2。
    const r2 = await globalSimOptimize(world(48), solve);
    const a2 = r2.scenarios[0]!.allocation.find((a) => a.orderId === "SO-X")!;
    expect(a2.line).toBe("cz-l2");
    expect(r2.scenarios[0]!.kpi.changeoverHours).toBe(5); // 改选后走 cz-l2 的 5h（仍小时口径）
    expect(r2.scenarios[0]!.kpi.cost).toBeGreaterThan(r1.scenarios[0]!.kpi.cost); // 保护/改选有代价·cost 真升
  });

  // ── ③ 两段路由（命门·广汽单派邯郸 PACK-only → 自动从合肥调芯 → 交期真含在途 + 改 transitDays 交付日真变） ──
  it("SEAM③两段路由：邯郸(PACK-only)单自动从合肥调芯 → 交付日真含在途 + freight 计入 + 改 transitDays 交付日真变", async () => {
    const world = (transit: number): PortfolioInput => baseInput({
      bases: [base("handan", "PACK"), base("hefei", "CELL")],
      lines: [line("handan", "hd-l1", 500), line("hefei", "hf-l1", 500)],
      modelBaseMap: { "方形-LFP": ["handan"] }, // 派邯郸（PACK-only）
      orders: [ord("SO-GAC", "广汽集团", "方形-LFP", 300, "2026-07-08")],
      twoStage: true,
      packOnlyBases: ["handan"],
      cellCapableBases: ["hefei"],
      cellSourceMap: { handan: "hefei" }, // 邯郸供芯来源 = 合肥
      transitDaysMap: { "hefei->handan": transit },
      freightCostMap: { "hefei->handan": 0.2 },
      scenarios: ["max_ontime"],
    });
    const r = await globalSimOptimize(world(2), solve);
    const row = r.schedule.find((s) => s.orderId === "SO-GAC")!;
    expect(row.packBase).toBe("handan");
    expect(row.batches[0]!.cellBase).toBe("hefei"); // 自动从合肥调芯
    expect(row.transitDays).toBe(2);
    expect(row.freightCost).toBeGreaterThan(0); // 合肥→邯郸 freight 计入 cost
    const deliver2 = row.deliverDay;
    // 改 transitDays 2→5 → 交付日真变（有效交期真含在途）。
    const r5 = await globalSimOptimize(world(5), solve);
    const row5 = r5.schedule.find((s) => s.orderId === "SO-GAC")!;
    expect(row5.deliverDay).toBe(deliver2 + 3); // deliverDay = packWindow*windowDays + transitDays
    expect(r5.scenarios[0]!.kpi.transitInv).toBeGreaterThan(r.scenarios[0]!.kpi.transitInv); // 在途库存随 transit 升
  });

  // ── ④ 订单分批（allowSplit·一单 W2+W3 拆批·Σ=qty） ──
  it("SEAM④分批：allowSplit → 一单拆批落 ≥2 (基地,窗口)·Σ 子批 == qty", async () => {
    const world = baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      lines: [line("changzhou", "cz-l1", 40)], // cap/窗口 = 40×7 = 280（单窗口容不下整单 600）
      modelBaseMap: { "4680-NCM": ["changzhou"] },
      orders: [ord("SO-BIG", "广汽集团", "4680-NCM", 600, "2026-07-22")],
      allowSplit: true,
      splitBatch: 200, // 拆 3 批 ×200
      scenarios: ["max_ontime"],
      coeff: mkCoeff({ windowDays: 7, splitBatch: 200, splitMaxParts: 4 }),
    });
    const r = await globalSimOptimize(world, solve);
    const parts = r.scenarios[0]!.allocation.filter((a) => a.orderId.startsWith("SO-BIG#b"));
    expect(parts.length).toBeGreaterThanOrEqual(2); // 真拆多批
    const cells = new Set(parts.map((p) => `${p.base}|${p.window}`));
    expect(cells.size).toBeGreaterThanOrEqual(2); // 落 ≥2 (基地,窗口)
    const sum = parts.reduce((s, p) => s + p.qty, 0);
    expect(sum).toBe(600); // Σ 子批 == qty
  });

  // ── ⑤ 杠杆再优化（灭 G-WHATIF-HARDCODED-LEVERS·formationChannels{常州,+2} → 在时率真升·代价含杠杆·delta 可溯） ──
  it("SEAM⑤杠杆：formationChannels{常州,+2} → 在时率(ontime)真经派生链升 + delta 可溯(Lever)", async () => {
    const world = baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      lines: [line("changzhou", "cz-l1", 50)], // 单线·产能紧（cap/窗口 350）
      modelBaseMap: { "4680-NCM": ["changzhou"] },
      orders: [
        ord("SO-1", "广汽集团", "4680-NCM", 300, "2026-06-17"), // 早交期·须早窗
        ord("SO-2", "长安汽车", "4680-NCM", 300, "2026-06-17"),
        ord("SO-3", "吉利汽车", "4680-NCM", 300, "2026-06-17"),
      ],
      levers: [{ key: "formationChannels", target: "changzhou", delta: 2 }],
      scenarios: ["max_ontime"],
    });
    const r = await globalSimOptimize(world, solve);
    expect(r.leverDeltas.length).toBe(1);
    const d = r.leverDeltas[0]!;
    expect(d.after.ontime).toBeGreaterThan(d.before.ontime); // 加化成通道 → 在时率真升
    expect(d.provenance.drillType).toBe("Lever"); // delta 可溯到杠杆
    expect(d.provenance.drillValue).toBe(2);
  });

  // ── ⑥ 优先级硬锁（priorityLocks{segment:储能} → 储能 must_serve·保护有代价·总代价真升） ──
  it("SEAM⑥硬锁：priorityLocks{segment:储能} → 储能单 must_serve（不被挤）+ 挤掉他单（保护有代价·被挤总量真升）", async () => {
    // 产能紧到只容 2 单：单窗口 cap 700（windowDays 10·lateWindows 0·仅 window0 可排）。
    // 储能单 qty 小(200)→贪心大单先 → 自由态储能被挤；硬锁态储能 must_serve 反挤乘用车（保护有代价）。
    const world = (locks?: { segment: string }[]): PortfolioInput => baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      lines: [line("changzhou", "cz-l1", 70)], // cap/窗口 = 70×10 = 700
      modelBaseMap: { "4680-NCM": ["changzhou"], "方形-LFP": ["changzhou"] },
      orders: [
        ord("SO-PV1", "广汽集团", "4680-NCM", 300, "2026-06-11"), // 乘用车
        ord("SO-PV2", "长安汽车", "4680-NCM", 300, "2026-06-11"), // 乘用车
        ord("SO-ES1", "国家电网", "方形-LFP", 200, "2026-06-11"), // 储能（小单·贪心排最后 → 自由态被挤）
      ],
      priorityLocks: locks,
      scenarios: ["max_ontime"],
      coeff: mkCoeff({ windowDays: 10, lateWindows: 0 }),
    });
    const free = await globalSimOptimize(world(undefined), solve);
    const locked = await globalSimOptimize(world([{ segment: "储能" }]), solve);
    // 储能分类正确。
    expect(classifySegment("国家电网")).toBe("储能");
    // 自由态：储能单被挤（capacity·未被保护）。
    expect(free.blocked.some((b) => b.orderId === "SO-ES1")).toBe(true);
    // 硬锁态：储能单不在 blocked（must_serve·被保护）+ schedule 标 must_serve。
    expect(locked.blocked.some((b) => b.orderId === "SO-ES1")).toBe(false);
    expect(locked.schedule.some((s) => s.orderId === "SO-ES1" && s.status === "must_serve")).toBe(true);
    // 保护有代价：硬锁态反挤一张乘用车单 + 被挤总量 ≥ 自由态。
    expect(locked.blocked.some((b) => b.orderId.startsWith("SO-PV"))).toBe(true);
    const blockedQty = (g: typeof free) => g.blocked.reduce((s, b) => s + b.qty, 0);
    expect(blockedQty(locked)).toBeGreaterThanOrEqual(blockedQty(free));
  });

  // ── ⑦ 递进批次承诺（命门·提交批次1 后·常州净产能真减·长安单排布随之变） ──
  it("SEAM⑦递进：committedBatches 提交批次1 → 常州净产能真减批次1量 + 决策单排布随之变", async () => {
    const mk = (committed?: PortfolioInput["committedBatches"]): PortfolioInput => baseInput({
      bases: [base("changzhou", "CELL+PACK")],
      lines: [line("changzhou", "cz-l1", 100)], // cap/窗口 = 700
      modelBaseMap: { "4680-NCM": ["changzhou"] },
      orders: [ord("SO-CA", "长安汽车", "4680-NCM", 400, "2026-06-17")],
      committedBatches: committed,
      objective: "max_ontime",
      scenarios: ["max_ontime"],
    });
    // 无递进承诺：长安单排早窗（window 0·on-time·cap 700 足）。
    const before = await portfolioOptimize(mk(undefined), solve);
    const cellBefore = before.capacityLedger.find((c) => c.baseId === "changzhou" && c.window === 0)!;
    // 提交批次1：常州 window0 预占 500 → 净产能真减 500。
    const after = await portfolioOptimize(mk([{ orderId: "BATCH1", base: "changzhou", window: 0, qty: 500 }]), solve);
    const cellAfter = after.capacityLedger.find((c) => c.baseId === "changzhou" && c.window === 0)!;
    expect(cellBefore.cap - cellAfter.cap).toBe(500); // 净产能真减批次1量
    // 长安单排布随之变：window0 净剩 200 < 400 → 长安单被迫顺延到后窗（allocation window 变大或改变）。
    const wBefore = before.occupancy.find((o) => o.item === "SO-CA")?.window ?? -1;
    const wAfter = after.occupancy.find((o) => o.item === "SO-CA")?.window ?? -1;
    expect(wAfter).toBeGreaterThan(wBefore); // 递进承诺挤走早窗 → 排布顺延真变
  });

  // ── ⑧ R6 确定性（同输入同杠杆两跑对象/KPI 字节一致） ──
  it("SEAM⑧R6：同输入同杠杆两跑 GlobalSimResponse 字节一致（禁 Date.now/random·forecastStart 锚）", async () => {
    const world = baseInput({
      bases: [base("changzhou", "CELL+PACK"), base("hefei", "CELL")],
      lines: [line("changzhou", "cz-l1", 60), line("hefei", "hf-l1", 40)],
      modelBaseMap: { "4680-NCM": ["changzhou", "hefei"] },
      orders: [
        ord("SO-1", "广汽集团", "4680-NCM", 200, "2026-06-24"),
        ord("SO-2", "长安汽车", "4680-NCM", 200, "2026-07-02"),
      ],
      levers: [{ key: "formationChannels", target: "changzhou", delta: 1 }],
      scenarios: ["max_ontime", "min_cost"],
    });
    const a = await globalSimOptimize(world, solve);
    const b = await globalSimOptimize(world, solve);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
