/**
 * WO-MEMSIM-OPTIMIZER · 内存模式确定性优化兜底（无 Python CP-SAT sidecar 也能出可行解）。
 *
 * 病根（真实症状·断在接缝）：内存模式启动（`node apps/datacore/dist/server.js`·无 `OPTIMIZER_BASE_URL`）下
 * app.ts 只在配了 `OPTIMIZER_BASE_URL` 时才装 `HttpOptimizerClient`——未配 → `optimizer` 为 undefined →
 * portfolio（全局联合推演）走 `service.ts:2019` 的 `!this.optimizer?.solvePortfolio` 守卫抛「未接入」→
 * 前端「发起联合求解」看不到结果。引擎（CP-SAT）与前端接线都是真的，唯独内存态接缝空（绿测试≠能用）。
 *
 * 本兜底：内存模式装 `InProcOptimizerClient`——用**确定性贪心**（R6：稳定 sort·无 `Date.now()`/`Math.random()`·
 * 同输入字节一致）产出**尊重共享产能守恒**（Σ_i qty_i·x[i,b,t] ≤ cap[b,t]）的**可行解**。
 *
 * 诚实红线（KILL-MOCK-RED）：贪心**不能证明最优** → 恒返 `status:"FEASIBLE", optimal:false`。前端徽标
 * `d.optimal ? "✓ 可证最优" : d.status` 因此自动显示「FEASIBLE」而非「可证最优」——不撒谎。docker 模式仍走
 * `HttpOptimizerClient` → CP-SAT 可证最优，行为不变。
 *
 * 范围：本单只兜底 `portfolio`（P0）。其余最优化模型（selection/assignment/sequencing/packing/job_shop/
 * facility_location/min_cost_flow/set_cover/independent_set/combinatorial_auction/multi_objective/
 * cross_object_occupancy）**不实现**——`OptimizerClient` 上它们是 optional，未实现 → 调用方（service.ts 的
 * `!this.optimizer?.solveXxx` 守卫）仍显式「未接入」，**不返回编造解让对应面板假装能用**（follow-up：
 * WO-MEMSIM-OPTIMIZER-2 内存态 multiobj/crossobj）。
 */
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  PortfolioRequest,
  PortfolioResult,
} from "./optimizer-client.js";

export class InProcOptimizerClient implements OptimizerClient {
  /**
   * selection（背包）本单不兜底——`solve` 是 `OptimizerClient` 必实现方法（非 optional），故此处实现为**显式报错**，
   * 保「未接入」语义（service.ts:2586 selection_optimize 守卫查 `!this.optimizer` 整体·InProc 存在时会进到这里）。
   * 不返回启发式假解（KILL-MOCK-RED）。
   */
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    throw new Error("selection_optimize 未接入最优化引擎（内存模式仅 portfolio 兜底；设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
  }

  /**
   * portfolio 内存态确定性贪心（R6）：把需求项按 (大单先·id tie-break) 稳定序装入剩余容量的 (base,窗口)——
   * 按主目标选格（`max_ontime` 取最按期格·`min_*` 取代价最小格），逐格扣减剩余产能（Σqty·x ≤ cap 恒守恒）；
   * `objectiveValues`（ontime/delay/changeover/cost 四项）从选中格 + 未排罚**真算**；`displaced` = 未获排项；
   * `values[served_<id>]` = 该项是否获排。
   *
   * 与测试桩 `MockPortfolio` 的**唯一差异**：返回 `status:"FEASIBLE", optimal:false`（mock 省事返 OPTIMAL/true·
   * 那是测试桩；生产贪心不能证最优）；且**不加** mock 的 `cost += primary.length` 造差异 hack（那是测试专用·
   * 生产按主目标不同选格本就真漂移·`max_ontime` 与 `min_cost` 分配/各目标值天然不同）。
   */
  async solvePortfolio(req: PortfolioRequest): Promise<PortfolioResult> {
    const primary = req.objectives?.[0]?.key ?? "ontime";
    const remain = new Map(req.capacity.map((c) => [`${c.base}|${c.window}`, c.cap]));
    const qty = new Map(req.items.map((i) => [i.id, i.qty]));
    const byItem = new Map<string, PortfolioRequest["cells"]>();
    for (const c of req.cells) {
      (byItem.get(c.item) ?? byItem.set(c.item, []).get(c.item)!).push(c);
    }
    // min_fg_inventory 方案（objectives 含 fgInventory）→ 贪心也须真最小化提前压库：以 fgHoldUnits 作首排序键。
    const wantsFg = (req.objectives ?? []).some((o) => o.key === "fgInventory");
    const occupancy: { item: string; base: string; window: number }[] = [];
    const served = new Set<string>();
    // 稳定序装入（大单先·id tie-break·确定性 R6）。
    for (const id of [...byItem.keys()].sort((a, b) => (qty.get(b) ?? 0) - (qty.get(a) ?? 0) || a.localeCompare(b))) {
      const cells = [...byItem.get(id)!];
      // 方案选格：min_fg_inventory 取最少提前持有格（fgHold→cost→贴近交期）；max_ontime 取最按期格（ontime→window→cost）；
      //          其余 min_* 取代价最小格（cost→ontime→window）。
      cells.sort((a, b) =>
        wantsFg
          ? a.fgHoldUnits - b.fgHoldUnits || a.cost - b.cost || b.ontime - a.ontime || b.window - a.window
          : primary === "ontime"
            ? b.ontime - a.ontime || a.window - b.window || a.cost - b.cost
            : a.cost - b.cost || b.ontime - a.ontime || a.window - b.window,
      );
      const need = qty.get(id) ?? 0;
      for (const c of cells) {
        const k = `${c.base}|${c.window}`;
        if ((remain.get(k) ?? 0) >= need) {
          remain.set(k, (remain.get(k) ?? 0) - need); // 逐格扣减 → Σqty·x ≤ cap 守恒
          occupancy.push({ item: c.item, base: c.base, window: c.window });
          served.add(id);
          break;
        }
      }
    }
    occupancy.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
    const displaced = req.items.map((i) => i.id).filter((id) => !served.has(id)).sort();
    // objectiveValues 从选中格真算（4 项恒计·供方案对比）。
    const cellByKey = new Map(req.cells.map((c) => [`${c.item}|${c.base}|${c.window}`, c]));
    let ontime = 0,
      delay = 0,
      changeover = 0,
      fgInventory = 0,
      cost = 0;
    for (const o of occupancy) {
      const c = cellByKey.get(`${o.item}|${o.base}|${o.window}`)!;
      ontime += c.ontime;
      delay += c.delayUnits;
      changeover += c.changeUnits;
      fgInventory += c.fgHoldUnits; // 成品持有恒计（度量一致·诚实·无论哪个方案都回填）
      cost += c.cost;
    }
    const unservedPen = req.items
      .filter((i) => displaced.includes(i.id))
      .reduce((s, i) => s + (i.unservedPenalty ?? 0), 0);
    cost += unservedPen;
    const values: Record<string, number> = {};
    for (const i of req.items) values[`served_${i.id}`] = served.has(i.id) ? 1 : 0;
    // 诚实红线：贪心可行解·不可证最优。
    return {
      status: "FEASIBLE",
      optimal: false,
      values,
      objectiveValues: { ontime, delay, changeover, fgInventory, cost },
      occupancy,
      displaced,
      method: req.method ?? "weighted",
    };
  }
}
