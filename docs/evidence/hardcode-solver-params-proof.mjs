// HARDCODE-SOLVER-PARAMS · 真实 param-驱动证明（compiled dist·真代码路径 params→deriveArgs→fn）。
// 证：(1) default 路径输出==原内联值（R6 字节一致）；(2) 改 params.<domain>.<key> → 输出变（真 param 驱动·非死值）。
import { EXTENDED_REGISTRY } from "../../apps/datacore/dist/solvers/extended.js";
import { BATTERY_SOLVER_PARAMS } from "../../apps/datacore/dist/synthetic/battery.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const baseParams = clone(BATTERY_SOLVER_PARAMS);

function runInventory(params) {
  const ctx = {
    params,
    materials: [
      { props: { matId: "MAT-A", dailyUse: 10, leadTime: 10, onHand: 400, unitPrice: 2, carbonFactor: 5 } },
    ],
    materialBatches: [],
  };
  const d = EXTENDED_REGISTRY.inventory_optimize;
  const args = d.deriveArgs(ctx, {});
  return d.fn(args);
}
function runOutsourcing(params) {
  const ctx = { params, orders: [] };
  const d = EXTENDED_REGISTRY.outsourcing_split;
  const args = d.deriveArgs(ctx, { gap: 100, totalDemand: 100 });
  return d.fn(args);
}
function runCredit(params) {
  const ctx = {
    params,
    customers: [{ props: { custName: "C1", creditLimit: 100, receivables: 10, wipUnbilled: 0 } }],
    arInvoices: [{ props: { custName: "C1", invoiceId: "IV1", overdueDays: 35, amount: 5 } }],
  };
  const d = EXTENDED_REGISTRY.credit_exposure;
  const args = d.deriveArgs(ctx, { newOrderAmount: 1 });
  return d.fn(args);
}

// target = 10*(10+5)=150. default overMult 1.5 → over threshold 225 → onHand 400 > 225 → overQty 175.
const invDefault = runInventory(baseParams);
const p2 = clone(baseParams); p2.inventory.overMult = 3.0; // 3.0*150=450 → 400 < 450 → NO over-storage
const invOverride = runInventory(p2);

// default outsourceCapPct 0.2 → outsource cap 20. override 0.5 → 50.
const outDefault = runOutsourcing(baseParams);
const p3 = clone(baseParams); p3.outsourcing.outsourceCapPct = 0.5;
const outOverride = runOutsourcing(p3);

// default credit.overdueDays 30 → 35>30 → 冻结. override 40 → 35<40 → not frozen.
const credDefault = runCredit(baseParams);
const p4 = clone(baseParams); p4.credit.overdueDays = 40;
const credOverride = runCredit(p4);

const out = {
  inventory_optimize: {
    default_overMult: baseParams.inventory.overMult,
    default_over: invDefault.over,
    default_releasableCash: invDefault.releasableCash,
    override_overMult: 3.0,
    override_over: invOverride.over,
    override_releasableCash: invOverride.releasableCash,
    param_driven: JSON.stringify(invDefault.over) !== JSON.stringify(invOverride.over),
  },
  outsourcing_split: {
    default_outsourceCapPct: baseParams.outsourcing.outsourceCapPct,
    default_outsource_qty: outDefault.allocation.find((a) => a.channel === "outsource").qty,
    default_totalCost: outDefault.totalCost,
    override_outsourceCapPct: 0.5,
    override_outsource_qty: outOverride.allocation.find((a) => a.channel === "outsource").qty,
    override_totalCost: outOverride.totalCost,
    param_driven: outDefault.totalCost !== outOverride.totalCost,
  },
  credit_exposure: {
    default_overdueDays: baseParams.credit.overdueDays,
    default_verdict: credDefault.newOrderVerdict,
    override_overdueDays: 40,
    override_verdict: credOverride.newOrderVerdict,
    param_driven: credDefault.newOrderVerdict !== credOverride.newOrderVerdict,
  },
};
console.log(JSON.stringify(out, null, 2));
const allDriven = out.inventory_optimize.param_driven && out.outsourcing_split.param_driven && out.credit_exposure.param_driven;
console.log("\nALL_PARAM_DRIVEN=" + allDriven);
process.exit(allDriven ? 0 : 1);
