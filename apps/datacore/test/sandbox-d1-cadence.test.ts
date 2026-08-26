/**
 * WO-SANDBOX-D1 · 节拍承载（数据半）验收门。
 *
 * 本门咬四件事，**每件都是接缝驱动，不是"函数被调用了"**：
 *  ① 值真的来自种子 —— 独立在测试里重算一遍种子的发生序列，与产出对拍；
 *     再把种子**改一改**（克隆后换铺法），断言产出跟着变 ⇒ 排除"写死一个看着对的数"。
 *  ② SEAM（数据半 × 引擎半）—— 产出经**真 `parse`**（S0 冻结的 strict schema）而非手写断言；
 *     并真的把种子推出来的等待期望塞进 `propagateTick` 的 `delayTicks`，
 *     断言贡献**恰好**在那个 tick 到达（值驱动行为，不是形状对上就算）。
 *  ③ 诚实缺席 —— 删掉某节点的证据 ⇒ 消费方拿到 `EMPTY` / `null`，**不是默认值、不是 0**。
 *  ④ R6 —— 同 (industry, scale, seed=42) 重跑字节一致。
 */
import { describe, expect, it } from "vitest";
import {
  CadenceSchema,
  ChainNodeSchema,
  ChainStepSchema,
  PropagationRuleSchema,
  expectedCadenceWaitDays,
  nodeLeadTimeDays,
  type PropagationRule,
  type TickState,
} from "@platform/contracts";
import { generateBattery, type GeneratedBattery } from "../src/synthetic/battery.js";
import {
  CADENCE_NODES,
  cadenceChainSteps,
  cadenceOfNode,
  cadenceWaitDaysOfNode,
  deriveChainCadences,
  deriveIntervalDays,
  type CadenceSeedRow,
} from "../src/synthetic/cadence.js";
import { propagateTick, type PropagationGraph } from "../src/sim/propagation.js";

const DAY = 86400000;
const gen = (): GeneratedBattery => generateBattery(42, "S");
const rowOf = (rows: readonly CadenceSeedRow[], nodeId: string): CadenceSeedRow => {
  const r = rows.find((x) => x.nodeId === nodeId);
  if (!r) throw new Error(`节点未登记：${nodeId}`);
  return r;
};

/** 测试侧**独立**重算相邻间隔（不复用被测函数 —— 复用了就是自己给自己作证）。 */
function independentDeltas(dates: readonly string[]): number[] {
  const ms = [...new Set(dates)].filter(Boolean).map((d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < ms.length; i++) out.push((ms[i]! - ms[i - 1]!) / DAY);
  return out;
}

describe("WO-SANDBOX-D1 · 节拍承载", () => {
  // ────────────────────────────────────────────────────────────────────────
  // ① 值真的来自种子
  // ────────────────────────────────────────────────────────────────────────

  it("D1-1 工单点名的 7 个限流环节全部在册（查不到证据的也必须在册并标 EMPTY）", () => {
    const ids = CADENCE_NODES.map((n) => n.nodeId);
    for (const id of ["demand.consensus", "order.review", "capacity.schedule", "material.mrp", "capacity.qc_batch", "material.shipping", "order.settlement"]) {
      expect(ids).toContain(id);
    }
    // 每个节点都必须留下取证痕迹：要么指向种子集合，要么写清查过什么。
    for (const n of CADENCE_NODES) {
      if (n.evidence.kind === "SERIES") expect(n.evidence.collection.length).toBeGreaterThan(0);
      else expect(n.evidence.probed.length).toBeGreaterThan(20);
    }
  });

  it("D1-2 S&OP 共识会：everyDays 与种子 SopVersionRow 的真实落期间隔逐位相等（口径对拍）", () => {
    const g = gen();
    const seedDates = g.sopVersionRows.map((r) => String((r as Record<string, unknown>).date));
    const deltas = independentDeltas(seedDates);
    // 种子自身必须是等距的，否则本节点根本不该被判定为节拍。
    expect(new Set(deltas).size).toBe(1);
    expect(deltas.length).toBeGreaterThanOrEqual(2);

    const row = rowOf(deriveChainCadences(g), "demand.consensus");
    expect(row.dataMode).toBe("SYNTHETIC");
    expect(row.cadence?.everyDays).toBe(deltas[0]);
    expect(row.cadence?.kind).toBe("meeting");
    // 实测基线（种子今天铺的是 14 天一版；改种子铺法 → 本行必红，这是变异反证的注入点）。
    expect(row.cadence?.everyDays).toBe(14);
  });

  it("D1-3 其余三条 DERIVED 节拍同样与种子对拍（主计划排产 / 过程质检攒批 / 计划检修窗）", () => {
    const g = gen();
    const rows = deriveChainCadences(g);

    // 主计划排产：同一工单下相邻排产行的间隔。
    const bySched = new Map<string, string[]>();
    for (const p of g.productionSchedules) {
      const r = p as Record<string, unknown>;
      const k = String(r.woId);
      (bySched.get(k) ?? bySched.set(k, []).get(k)!).push(String(r.scheduledDate));
    }
    const schedDeltas = [...bySched.values()].flatMap(independentDeltas);
    expect(new Set(schedDeltas).size).toBe(1);
    expect(rowOf(rows, "capacity.schedule").cadence?.everyDays).toBe(schedDeltas[0]);

    // 过程质检攒批：同一在制批相邻质检点的间隔。
    const byLot = new Map<string, string[]>();
    for (const c of g.wipQualityCheckpoints) {
      const r = c as Record<string, unknown>;
      const k = String(r.lotId);
      (byLot.get(k) ?? byLot.set(k, []).get(k)!).push(String(r.checkTime));
    }
    const chkDeltas = [...byLot.values()].flatMap(independentDeltas);
    expect(new Set(chkDeltas).size).toBe(1);
    expect(rowOf(rows, "capacity.qc_batch").cadence?.everyDays).toBe(chkDeltas[0]);

    // 计划检修窗：历史窗 → 预测窗，13 基地各贡献 1 个间隔且全等。
    const maint = rowOf(rows, "capacity.maint");
    expect(maint.dataMode).toBe("SYNTHETIC");
    expect(maint.cadence?.everyDays).toBe(77);
    if (maint.dataMode === "SYNTHETIC") expect(maint.intervalCount).toBe(g.maintPlans.length);

    // 实测基线（同 D1-2：改种子即须变）。
    expect(rowOf(rows, "capacity.schedule").cadence?.everyDays).toBe(1);
    expect(rowOf(rows, "capacity.qc_batch").cadence?.everyDays).toBe(1);
  });

  it("D1-4 反写死门：换一种铺法的种子 ⇒ everyDays 必须跟着变（排除『值写死在代码里』）", () => {
    const g = gen();
    const before = rowOf(deriveChainCadences(g), "demand.consensus").cadence?.everyDays;
    expect(before).toBeDefined();

    // 克隆一份种子，把 S&OP 版本改成另一种等距铺法（间隔 × 3），其余一字不动。
    const t0 = Date.parse(`${String(g.sopVersionRows[0]!.date).slice(0, 10)}T00:00:00Z`);
    const respaced: GeneratedBattery = {
      ...g,
      sopVersionRows: g.sopVersionRows.map((r, i) => ({
        ...(r as Record<string, unknown>),
        date: new Date(t0 + i * before! * 3 * DAY).toISOString().slice(0, 10),
      })) as GeneratedBattery["sopVersionRows"],
    };
    const after = rowOf(deriveChainCadences(respaced), "demand.consensus").cadence?.everyDays;
    expect(after).toBe(before! * 3);
    expect(after).not.toBe(before);
  });

  it("D1-5 推导规则本身：不等距的发生序列一律 NON_UNIFORM，不许平均成一个数", () => {
    expect(deriveIntervalDays([["2026-01-01", "2026-01-08", "2026-01-15"]])).toEqual({ ok: true, everyDays: 7, intervalCount: 2 });
    // 平均也是 7，但间隔不等 ⇒ 必须拒绝（把事件流平均成节拍就是编数）。
    expect(deriveIntervalDays([["2026-01-01", "2026-01-05", "2026-01-15"]])).toEqual({ ok: false, reason: "NON_UNIFORM" });
    expect(deriveIntervalDays([["2026-01-01"]])).toEqual({ ok: false, reason: "NO_INTERVAL" });
    expect(deriveIntervalDays([])).toEqual({ ok: false, reason: "NO_INTERVAL" });
    // 同日重复不构成日内节拍（种子只带到「日」）。
    expect(deriveIntervalDays([["2026-01-01", "2026-01-01"]])).toEqual({ ok: false, reason: "NO_INTERVAL" });
  });

  // ────────────────────────────────────────────────────────────────────────
  // ② SEAM · 数据半 × 引擎半
  // ────────────────────────────────────────────────────────────────────────

  it("SEAM-1 产出形状经 S0 冻结契约的**真 parse**（strict：多字段/错枚举都抛）", () => {
    const rows = deriveChainCadences(gen());
    const derived = rows.filter((r) => r.cadence !== undefined);
    expect(derived.length).toBeGreaterThan(0);

    for (const r of derived) {
      // 真 parse，不是手写 typeof 断言。
      const parsed = CadenceSchema.parse(r.cadence);
      expect(parsed.everyDays).toBe(r.cadence!.everyDays);
      // 相位必须落在 [0, everyDays)（S0 superRefine 已锁；这里断言我们真的产出了合法相位）。
      if (parsed.offsetDays !== undefined) {
        expect(parsed.offsetDays).toBeGreaterThanOrEqual(0);
        expect(parsed.offsetDays).toBeLessThan(parsed.everyDays);
      }
    }
    // strict 真的有牙：多一个字段就抛。
    expect(() => CadenceSchema.parse({ ...derived[0]!.cadence, everyWeeks: 2 })).toThrow();
  });

  it("SEAM-2 摊成 ChainStep 时 days 由契约唯一公式产出（== everyDays/2，不是 everyDays、不是 0）", () => {
    const rows = deriveChainCadences(gen());
    const steps = cadenceChainSteps(rows);
    expect(steps.length).toBe(rows.filter((r) => r.cadence !== undefined && r.flowGate).length);

    for (const s of steps) {
      const parsed = ChainStepSchema.parse(s); // 真 parse
      expect(parsed.kind).toBe("cadence");
      expect(parsed.valueAdd).toBe(false); // 等节拍恒非增值
      expect(parsed.cadence).toBeDefined();
      expect(parsed.days).toBe(expectedCadenceWaitDays(parsed.cadence!));
      // 两个被 S0 显式排除的错法。
      expect(parsed.days).not.toBe(parsed.cadence!.everyDays);
      expect(parsed.days).not.toBe(0);
    }

    // 组装成 ChainNode 也过 parse（节点内 stepId 唯一 + nodeId 一致由 S0 校验）。
    const sop = steps.find((s) => s.nodeId === "demand.consensus")!;
    const node = ChainNodeSchema.parse({ nodeId: "demand.consensus", label: "S&OP 共识会", stage: "DEMAND", steps: [sop] });
    expect(nodeLeadTimeDays(node)).toBe(sop.days);
  });

  it("SEAM-3 值驱动引擎：种子推出的等待期望塞进 propagateTick 的 delayTicks ⇒ 贡献恰在该 tick 到达", () => {
    const rows = deriveChainCadences(gen());
    const wait = cadenceWaitDaysOfNode(rows, "demand.consensus");
    expect(wait).not.toBeNull();
    expect(Number.isInteger(wait)).toBe(true); // 14/2 = 7，可整表示为 tick

    const rule: PropagationRule = PropagationRuleSchema.parse({
      id: "pr-d1",
      tenantId: "demo",
      key: "d1_cadence_gate",
      sourceTypeKey: "SopGate",
      sourceStateVar: "pressure",
      viaLinkKey: "gates",
      targetTypeKey: "Downstream",
      targetStateVar: "load",
      coefficient: 1,
      delayTicks: wait, // ← 数据半的值，未经任何加工
      status: "PUBLISHED",
    });

    const graph: PropagationGraph = {
      objects: [
        { id: "src", typeKey: "SopGate" },
        { id: "dst", typeKey: "Downstream" },
      ],
      links: [{ fromId: "src", toId: "dst", linkKey: "gates" }],
    };

    // tick 0 只放一次料，之后不再注入新规则 ⇒ 只观察那一笔延迟贡献何时落地。
    const t0 = propagateTick(graph, { src: { pressure: 1 } }, [rule], [], 0);
    let state: TickState = t0.next;
    let pending = t0.pending;
    expect(state.dst?.load ?? 0).toBe(0); // 立刻到 = 把节拍当没有
    expect(pending.map((p) => p.arriveTick)).toEqual([wait]); // 排期就等于种子推出的等待期望

    const arrivals: number[] = [];
    for (let t = 1; t <= wait!; t++) {
      const r = propagateTick(graph, state, [], pending, t);
      state = r.next;
      pending = r.pending;
      arrivals.push(state.dst?.load ?? 0);
    }
    // 到达前逐 tick 恒 0，恰在第 wait 个 tick 变正 —— 量对，不是"变了就算"。
    expect(arrivals.slice(0, wait! - 1)).toEqual(new Array(wait! - 1).fill(0));
    expect(arrivals[wait! - 1]).toBe(1);
  });

  it("SEAM-4 诚实边界：日节拍的等待期望 0.5 天在 tick=天 的引擎上不可整表示（留给 E4，不在此偷偷取整）", () => {
    const rows = deriveChainCadences(gen());
    const wait = cadenceWaitDaysOfNode(rows, "capacity.schedule");
    expect(wait).toBe(0.5);
    // PropagationRule.delayTicks 是 int ⇒ 直接塞会抛。这是真实缺口，不是本单偷偷 round 掉的地方。
    expect(() =>
      PropagationRuleSchema.parse({
        id: "pr-d1-frac", tenantId: "demo", key: "d1_frac", sourceTypeKey: "A", sourceStateVar: "v",
        viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "w", coefficient: 1, delayTicks: wait, status: "PUBLISHED",
      }),
    ).toThrow();
  });

  // ────────────────────────────────────────────────────────────────────────
  // ③ 诚实缺席（禁止静默兜底）
  // ────────────────────────────────────────────────────────────────────────

  it("D1-6 查不到证据的节点标 EMPTY + 机器可读 reason，消费口返回 null 而**不是 0**", () => {
    const rows = deriveChainCadences(gen());

    for (const id of ["order.review", "material.mrp", "order.settlement"]) {
      const r = rowOf(rows, id);
      expect(r.dataMode).toBe("EMPTY");
      expect(r.cadence).toBeUndefined();
      if (r.dataMode === "EMPTY") expect(r.reason).toBe("NO_CARRIER");
      // 消费口：null，不是 0（0 的语义是"随到随办"，那是编数）。
      expect(cadenceWaitDaysOfNode(rows, id)).toBeNull();
      expect(cadenceWaitDaysOfNode(rows, id)).not.toBe(0);
      expect(cadenceOfNode(rows, id)).toBeUndefined();
    }

    // 发运：有集合但哈希散布 ⇒ 不是 NO_CARRIER 而是 NON_UNIFORM（两种空因不同，修法不同）。
    const ship = rowOf(rows, "material.shipping");
    expect(ship.dataMode).toBe("EMPTY");
    if (ship.dataMode === "EMPTY") expect(ship.reason).toBe("NON_UNIFORM");
    expect(cadenceWaitDaysOfNode(rows, "material.shipping")).toBeNull();

    // EMPTY 节点不产占位环节（产一个 days:0 的段 = 下游会当成"这段不耗时"的真值）。
    const stepNodeIds = cadenceChainSteps(rows).map((s) => s.nodeId);
    for (const id of ["order.review", "material.mrp", "order.settlement", "material.shipping"]) expect(stepNodeIds).not.toContain(id);
  });

  it("D1-8 防假前置期：周期性停机是真周期但**不是**流闸门 ⇒ 推得出、留证据、不摊进链路", () => {
    const rows = deriveChainCadences(gen());
    const maint = rowOf(rows, "capacity.maint");

    // 它是真周期，必须被看见（不是偷偷丢掉）。
    expect(maint.dataMode).toBe("SYNTHETIC");
    expect(maint.cadence?.everyDays).toBe(77);
    expect(cadenceWaitDaysOfNode(rows, "capacity.maint")).toBe(38.5);

    // 但它不进 ChainStep —— 否则全链凭空多一段 38.5 天非增值，E1 会把它归因成 Top1 损失（假数字）。
    expect(maint.flowGate).toBe(false);
    expect(cadenceChainSteps(rows).map((s) => s.nodeId)).not.toContain("capacity.maint");
    // 反过来：所有真闸门都必须进链路，别把这个开关当成随手关掉节点的后门。
    for (const r of rows) {
      if (r.cadence !== undefined && r.flowGate) expect(cadenceChainSteps(rows).map((s) => s.nodeId)).toContain(r.nodeId);
    }
  });

  it("D1-7 变异反证（自动化版）：删掉某节点的 Cadence 证据 ⇒ 消费方拿到 EMPTY，绝不回落默认值", () => {
    const g = gen();
    const before = rowOf(deriveChainCadences(g), "demand.consensus");
    expect(before.dataMode).toBe("SYNTHETIC");
    const beforeWait = cadenceWaitDaysOfNode(deriveChainCadences(g), "demand.consensus");
    expect(beforeWait).toBe(7);

    // 把该节点的证据整个删掉（模拟"这个节点今天没有节拍"）。
    const stripped: GeneratedBattery = { ...g, sopVersionRows: [] };
    const rows = deriveChainCadences(stripped);
    const after = rowOf(rows, "demand.consensus");

    expect(after.dataMode).toBe("EMPTY");
    expect(after.cadence).toBeUndefined();
    if (after.dataMode === "EMPTY") expect(after.reason).toBe("NO_INTERVAL");
    // 关键三条：不是默认值、不是 0、不是上一次的值。
    expect(cadenceWaitDaysOfNode(rows, "demand.consensus")).toBeNull();
    expect(cadenceWaitDaysOfNode(rows, "demand.consensus")).not.toBe(0);
    expect(cadenceWaitDaysOfNode(rows, "demand.consensus")).not.toBe(beforeWait);
    // 其余节点不受牵连（删一个节点的证据不该把别人也弄空）。
    expect(rowOf(rows, "capacity.maint").dataMode).toBe("SYNTHETIC");
  });

  // ────────────────────────────────────────────────────────────────────────
  // ④ R6 确定性
  // ────────────────────────────────────────────────────────────────────────

  it("R6 同 (industry, scale, seed=42) 重跑字节一致", () => {
    const a = JSON.stringify(deriveChainCadences(generateBattery(42, "S")));
    const b = JSON.stringify(deriveChainCadences(generateBattery(42, "S")));
    expect(a).toBe(b);
    // 同一份种子重复推导亦字节一致（无隐藏状态）。
    const g = gen();
    expect(JSON.stringify(deriveChainCadences(g))).toBe(JSON.stringify(deriveChainCadences(g)));
  });
});
