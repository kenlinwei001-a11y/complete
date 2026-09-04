/**
 * WO-MEMSIM-OPTIMIZER · 内存模式确定性优化兜底（无 Python CP-SAT sidecar 也能出可行解）。
 *
 * 病根（真实症状·断在接缝）：内存模式启动（`node apps/datacore/dist/server.js`·无 `OPTIMIZER_BASE_URL`）下
 * app.ts 只在配了 `OPTIMIZER_BASE_URL` 时才装 `HttpOptimizerClient`——未配 → `optimizer` 为 undefined →
 * portfolio（全局项目推演）走 `service.ts:2019` 的 `!this.optimizer?.solvePortfolio` 守卫抛「未接入」→
 * 前端「发起联合求解」看不到结果。引擎（CP-SAT）与前端接线都是真的，唯独内存态接缝空（绿测试≠能用）。
 *
 * 本兜底：内存模式装 `InProcOptimizerClient`——用**确定性贪心**（R6：稳定 sort·无 `Date.now()`/`Math.random()`·
 * 同输入字节一致）产出**尊重共享产能守恒**（Σ_i qty_i·x[i,b,t] ≤ cap[b,t]）的**可行解**。
 *
 * 诚实红线（KILL-MOCK-RED）：贪心**不能证明最优** → 恒返 `status:"FEASIBLE", optimal:false`。前端徽标
 * `d.optimal ? "✓ 可证最优" : d.status` 因此自动显示「FEASIBLE」而非「可证最优」——不撒谎。docker 模式仍走
 * `HttpOptimizerClient` → CP-SAT 可证最优，行为不变。
 *
 * 范围：内存态兜底 `portfolio`（P0）+ `cross_object_occupancy`（WO-MEMORY-VIEW-RESILIENCE §4.5·加权贪心·尊重
 * 产线容量 + 合同额度·确定性 R6·恒返 FEASIBLE/optimal:false·不冒充 CP-SAT 可证最优）。其余最优化模型（selection/
 * assignment/sequencing/packing/job_shop/facility_location/min_cost_flow/set_cover/independent_set/
 * combinatorial_auction/**multi_objective**）**仍不实现**——`OptimizerClient` 上它们是 optional，未实现 → 调用方
 * （service.ts 的 `!this.optimizer?.solveXxx` 守卫）仍显式「未接入」，**不返回编造解让对应面板假装能用**。
 */
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  PortfolioRequest,
  PortfolioResult,
  CrossObjectOccupancyRequest,
  CrossObjectOccupancyResult,
} from "./optimizer-client.js";
// WO-D1 · 取消透传：内存态贪心是**我们自己**的循环 → 逐项检查取消令牌即可真停（不是"不再等它"）。
import { currentCancellationSignal, SolverCancelledError } from "./cancellation.js";

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

    // ⑤ G-VAR-3 · 多目标组合法（opt-in·req.multiObjective）：按 method(weighted/epsilon/lexicographic) 组合全目标择格。
    //   default（无 multiObjective）→ 走下方原「按首目标」口径（字节不变·护住既有全部 portfolio/scenario 测）。
    const combo = req.multiObjective === true;
    const objVal = (c: PortfolioRequest["cells"][number], key: string): number =>
      key === "ontime" ? c.ontime : key === "delay" ? c.delayUnits : key === "changeover" ? c.changeUnits : key === "fgInventory" ? c.fgHoldUnits : c.cost;
    // 权重（objectives[].weight·缺省 1）；ε 上界；字典序优先（priority·缺省 objectives 序）。
    const weightOf = new Map((req.objectives ?? []).map((o) => [o.key as string, o.weight ?? 1]));
    const epsBounds = req.epsilon ?? [];
    const priorityKeys = (req.priority && req.priority.length ? req.priority : (req.objectives ?? []).map((o) => o.key as string));
    // 组合法择格：epsilon 先滤越界格 → 主目标最优；lexicographic 按优先序逐层；weighted 归一加权和最小。
    const comboSort = (cells: PortfolioRequest["cells"]): PortfolioRequest["cells"] => {
      if (req.method === "lexicographic") {
        return [...cells].sort((a, b) => {
          for (const key of priorityKeys) {
            const d = key === "ontime" ? objVal(b, key) - objVal(a, key) : objVal(a, key) - objVal(b, key); // ontime 越大越好·其余越小越好
            if (d !== 0) return d;
          }
          return a.window - b.window || a.cost - b.cost;
        });
      }
      if (req.method === "epsilon") {
        const primaryKey = (req.objectives?.[0]?.key as string) ?? "ontime";
        const withinEps = cells.filter((c) => epsBounds.every((e) => objVal(c, e.key) <= e.bound + 1e-9)); // 次目标各不超 ε 上界
        const pool = withinEps.length ? withinEps : cells; // 全越界 → 退回全集（诚实：无可行则不凭空丢单）
        return [...pool].sort((a, b) =>
          (primaryKey === "ontime" ? objVal(b, primaryKey) - objVal(a, primaryKey) : objVal(a, primaryKey) - objVal(b, primaryKey))
          || a.cost - b.cost || a.window - b.window);
      }
      // weighted：对该 item 候选集逐目标 min-max 归一 → Σ w·(ontime 取 1−norm·其余取 norm) 最小（改权重 → 天平真偏移）。
      const keys = [...new Set([...(req.objectives ?? []).map((o) => o.key as string), ...weightOf.keys()])];
      const range = new Map<string, { lo: number; hi: number }>();
      for (const key of keys) { const vs = cells.map((c) => objVal(c, key)); range.set(key, { lo: Math.min(...vs), hi: Math.max(...vs) }); }
      const score = (c: PortfolioRequest["cells"][number]): number => {
        let s = 0;
        for (const key of keys) {
          const { lo, hi } = range.get(key)!;
          const norm = hi > lo ? (objVal(c, key) - lo) / (hi - lo) : 0;
          s += (weightOf.get(key) ?? 1) * (key === "ontime" ? 1 - norm : norm); // ontime 越高越好 → 代价 = 1−norm
        }
        return s;
      };
      return [...cells].sort((a, b) => score(a) - score(b) || a.cost - b.cost || a.window - b.window);
    };

    const occupancy: { item: string; base: string; window: number }[] = [];
    const served = new Set<string>();
    const cancel = currentCancellationSignal(); // WO-D1：逐项检查（无信号 → 恒 undefined·行为不变）
    // 稳定序装入（大单先·id tie-break·确定性 R6）。
    for (const id of [...byItem.keys()].sort((a, b) => (qty.get(b) ?? 0) - (qty.get(a) ?? 0) || a.localeCompare(b))) {
      if (cancel?.aborted) throw new SolverCancelledError("portfolio 内存态贪心装入循环");
      const raw = byItem.get(id)!;
      // 方案选格：combo → 按 method 组合全目标；否则 min_fg_inventory 取最少提前持有格（fgHold→cost→贴近交期）；
      //          max_ontime 取最按期格（ontime→window→cost）；其余 min_* 取代价最小格（cost→ontime→window）。
      const cells = combo
        ? comboSort(raw)
        : [...raw].sort((a, b) =>
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

  /**
   * cross_object_occupancy 内存态确定性加权贪心（WO-MEMORY-VIEW-RESILIENCE §4.5）。
   *
   * 订单×产线×合同三元互斥：一单占某线 = 同耗产线产能（Line.capacity）+ 合同额度（Contract.cap），同线互斥。
   *
   * ══ 今天的行为是 X，应该是 Y（WO-OBJECTIVE-SIGN·实测）═══════════════════════════
   *
   * **X（修前原文）**：装入优先序 = `wRev·revenue + wPen·penalty` 的**绝对值降序**。
   *   而约束资源是 `qty`（`lineRemain >= o.qty` → 扣 `o.qty`）—— 这是一个背包，
   *   排序却按**绝对价值**而非**单位资源价值**。因 `revenue = qty × unitPrice`、
   *   `penalty = qty × 优先级单价`，绝对分 `= qty × 密度` ⇒ **排序被 qty 支配**：
   *   把营收权重调大 = 优先塞**最大的单**（不是最赚的单），大单吃光产能 ⇒
   *   实测（真订单簿 50 单）营收权重 0→2：获排 **20→19→18→17→16 严格递减**，
   *   营收 39.35→39.31→**39.49**→39.26→**38.76 亿**，违约金 12.11→**16.87 亿**。
   *   即**调大「营收（越高越好）」的权重，营收反而跌、违约金反而涨** —— 与屏上承诺相反。
   *   ⚠️ 注意它**不是符号翻转**：符号翻转会给出严格单调曲线，而这条曲线在 w=1 处有内点极大值 ——
   *   那正是"按绝对值排的背包"的指纹（换一组权重就换一批大单，价值忽上忽下）。
   *
   * **Y（本实现）**：优先序 = **单位产能净价值密度** `(wRev·revenue + wPen·penalty − wCost·cost) / qty`
   *   降序。qty 是被消耗的那个资源，故除以它才是"每单位产能换来多少加权价值"——
   *   这也是背包贪心的标准形。三项的**方向**在此显式落地：营收与"避掉的违约金"是收益（`+`），
   *   指派代价是支出（`−`）。于是"我更在乎营收" ⇒ 优先高**单价**单 ⇒ 营收真的上升。
   *
   * 逐单择线：在资格(eligibility)内取剩余产线容量 ≥ qty 且（若绑合同）剩余合同额度 ≥ qty 的可行线中，
   * 选**代价最小**者（tie-break line id 升序），逐格扣减产线容量 + 合同额度 → 天然守恒不重复占用。
   * 未获排的订单 = displaced（被挤）。objectiveValues 从结果**真算**：revenue=Σ获排营收、penalty=Σ被挤违约金（未服务
   * 才计罚）、cost=Σ获排指派代价（与 sidecar/桩语义一致·供 what-if Δ 分解）。
   *
   * 诚实红线（KILL-MOCK-RED）：贪心**不能证明最优** → 恒返 `status:"FEASIBLE", optimal:false`（不冒充 CP-SAT 可证
   * 最优）；docker 模式仍走 HttpOptimizerClient → CP-SAT 可证最优，行为不变。无 `Date.now()`/`Math.random()`（R6）。
   */
  async solveCrossObjectOccupancy(req: CrossObjectOccupancyRequest): Promise<CrossObjectOccupancyResult> {
    const w = Object.fromEntries((req.objectives ?? []).map((o) => [o.key, o.weight ?? 1]));
    const wRev = w.revenue ?? 1;
    const wPen = w.penalty ?? 1;
    const wCost = w.cost ?? 1;
    const lineRemain = new Map(req.lines.map((l) => [l.id, l.capacity]));
    const contractRemain = new Map(req.contracts.map((c) => [c.id, c.cap]));
    // 每订单的资格候选线（cost 升序·line id 升序·确定性）。
    const eligByOrder = new Map<string, { line: string; cost: number }[]>();
    for (const e of req.eligibility) {
      (eligByOrder.get(e.order) ?? eligByOrder.set(e.order, []).get(e.order)!).push({ line: e.line, cost: e.cost });
    }
    // 择线只有一条判据：代价最小（tie-break line id 升序）。
    // ⚠️ 原文是 `wCost * a.cost - wCost * b.cost` —— 两边同乘一个非负标量**不可能改变次序**，
    // 那个 `wCost` factor 是装饰品；且 `wCost === 0` 时全部比较归零、静默退化成"按线名字母序挑线"
    // （而不是挑最便宜的线）—— 把权重调到 0 反而换掉了择线口径，这是与用户预期相反的行为。
    // wCost 真正该起作用的地方是**要不要服务这一单**（下面的密度），不是**挑哪条线**。
    for (const list of eligByOrder.values()) {
      list.sort((a, b) => a.cost - b.cost || a.line.localeCompare(b.line));
    }
    /** 服务该单会实际发生的指派代价 = 其可行线里最便宜的那条（择线正是按此挑的）。取不到 ⇒ 0。 */
    const costOf = (id: string): number => eligByOrder.get(id)?.[0]?.cost ?? 0;
    /**
     * **单位产能净价值密度**（本函数的心脏，理由见上"今天的行为是 X，应该是 Y"）。
     * 分母是被消耗的那个资源（qty）；`Math.max(1, qty)` 只为防 0 除，
     * 而 qty ≤ 0 的单在装入循环里本就永远占不到格（`lineRemain >= qty` 恒真但 occupancy 无意义），
     * 不会因此冒充高密度上位。
     */
    const density = (o: { id: string; revenue: number; penalty: number; qty: number }) =>
      (wRev * o.revenue + wPen * o.penalty - wCost * costOf(o.id)) / Math.max(1, o.qty);
    // 稳定降序装入（密度高者先·tie-break id 升序·R6："density+id"）。
    const ordered = [...req.orders].sort((a, b) => density(b) - density(a) || a.id.localeCompare(b.id));
    const occupancy: { order: string; line: string }[] = [];
    const served = new Set<string>();
    const cancel = currentCancellationSignal(); // WO-D1：同 portfolio，逐单检查取消
    for (const o of ordered) {
      if (cancel?.aborted) throw new SolverCancelledError("cross_object_occupancy 内存态贪心装入循环");
      const cid = o.contractId;
      // 合同额度约束仅当该合同有登记额度时生效（未登记 = 不伪造额度约束，honest·与 bindContract=false 对称）。
      const contractHas = cid !== undefined && contractRemain.has(cid);
      for (const cand of eligByOrder.get(o.id) ?? []) {
        const lineOk = (lineRemain.get(cand.line) ?? 0) >= o.qty;
        const contractOk = !contractHas || (contractRemain.get(cid!) ?? 0) >= o.qty;
        if (lineOk && contractOk) {
          lineRemain.set(cand.line, (lineRemain.get(cand.line) ?? 0) - o.qty);
          if (contractHas) contractRemain.set(cid!, (contractRemain.get(cid!) ?? 0) - o.qty);
          occupancy.push({ order: o.id, line: cand.line });
          served.add(o.id);
          break;
        }
      }
    }
    occupancy.sort((a, b) => a.order.localeCompare(b.order) || a.line.localeCompare(b.line));
    const displaced = req.orders.map((o) => o.id).filter((id) => !served.has(id)).sort();
    const costByOrderLine = new Map(req.eligibility.map((e) => [`${e.order}|${e.line}`, e.cost]));
    let revenue = 0;
    let cost = 0;
    for (const o of occupancy) {
      const ord = req.orders.find((x) => x.id === o.order)!;
      revenue += ord.revenue;
      cost += costByOrderLine.get(`${o.order}|${o.line}`) ?? 0;
    }
    const penalty = req.orders.filter((o) => displaced.includes(o.id)).reduce((s, o) => s + o.penalty, 0);
    const values: Record<string, number> = {};
    for (const o of req.orders) values[o.id] = served.has(o.id) ? 1 : 0;
    /**
     * 加权标量目标（按各目标声明的方向折成"越大越好"）：营收 `+`、违约金与代价 `−`。
     * 这是贪心**实际在最大化**的那个量的实现值 —— 回它出来，"改权重 → 目标值动"这条链才有落点。
     */
    const objective = wRev * revenue - wPen * penalty - wCost * cost;
    /**
     * 各目标的**密度极差**（`max − min` over 全体订单）。极差 0 ⇒ 该权重乘上常数不改变任何一对订单的
     * 先后 ⇒ 那根滑杆在这份数据上结构性失效，屏上据此置灰（判据由机器现算，非写死白名单）。
     */
    const spreadOf = (f: (o: (typeof req.orders)[number]) => number): number => {
      if (req.orders.length === 0) return 0;
      const vs = req.orders.map((o) => f(o) / Math.max(1, o.qty));
      return Math.max(...vs) - Math.min(...vs);
    };
    const objectiveSpread: Record<string, number> = {
      revenue: spreadOf((o) => o.revenue),
      penalty: spreadOf((o) => o.penalty),
      cost: spreadOf((o) => costOf(o.id)),
    };
    // 诚实红线：贪心可行解·不可证最优。
    return {
      status: "FEASIBLE",
      optimal: false,
      values,
      objectiveValues: { revenue, penalty, cost },
      occupancy,
      displaced,
      method: req.method ?? "weighted",
      objective,
      objectiveSpread,
      summary: `占用：${served.size}/${req.orders.length} 单获排`,
    };
  }
}
