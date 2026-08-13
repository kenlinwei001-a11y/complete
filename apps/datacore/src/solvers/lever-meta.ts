/**
 * WO-LEVER-FACTOR-I18N + WO-LEVER-UNIT · 杠杆属性 → {中文显示名·单位·值类}**单一真值**（治本单源：
 * `discoverLevers` 下发 `factor`/`unit`/`valueKind`·前端只格式化不内联·灭"前后端各存一份标签/单位"漂移·R14 非内联）。
 * 键 = `对象类型.属性`（与 LEVER_FACTOR_PROPS 值域对齐·缺项 → 下游诚实兜底不臆造）。
 * `kind` 决定前端格式化：ratio=比率（0–1 存储自动×100 显示 %）；days/hours/count/qty=整数+单位后缀。
 * 单位真值随电池合成口径核定（utilization/oee/yield/attendance/coverage/outsourceRatio 存 0–1 → %；
 * leadTime/etaDay 存天；shifts 存班；shiftHours 存小时；changeoverMin 存分钟；onHand 整数库存·单位随物料不臆造）。
 *
 * ── 为什么它住在这个文件里（WO-SANDBOX-S3 迁出，**内容逐字未改**）────────────────
 * 原址是 `solvers/service.ts`。S3 的候选枚举器（`impediment-options.ts`）也要用这份标签与单位，
 * 而 `service.ts → chain-impediment.ts → impediment-options.ts` 已是一条单向依赖链 ——
 * 让枚举器回头 import `service.ts` 会成环，环里 `const` 的求值顺序不可靠（拿到 `undefined` 的那种）。
 * 故把它降到叶模块，`service.ts` 原地 re-export 保持对外符号不变（`test/schema-display-name.seam.test.ts`
 * 仍从 `service.js` 取它，一个字节不用改）。**只搬家，不改口径** —— 这份表仍是杠杆标签/单位的唯一真值。
 */
export type LeverValueKind = "ratio" | "days" | "count" | "hours" | "minutes" | "qty";

export const LEVER_PROP_META: Record<string, { label: string; unit: string; kind: LeverValueKind }> = {
  "Equipment.oee_current": { label: "设备·OEE", unit: "%", kind: "ratio" }, // debattery-allow
  "Line.utilization": { label: "产线·利用率", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.yield_baseline": { label: "工序·良率基线", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.attendance": { label: "工序·出勤率", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.shifts": { label: "工序·班次数", unit: "班", kind: "count" }, // debattery-allow
  "Process.shiftHours": { label: "工序·班次工时", unit: "小时", kind: "hours" }, // debattery-allow
  "MaterialBalance.coverage": { label: "物料齐套·覆盖率", unit: "%", kind: "ratio" }, // debattery-allow
  "Material.onHand": { label: "物料·现货库存", unit: "", kind: "qty" }, // debattery-allow
  "Material.leadTime": { label: "物料·到货周期", unit: "天", kind: "days" }, // debattery-allow
  "Order.outsourceRatio": { label: "订单·外协比例", unit: "%", kind: "ratio" }, // debattery-allow
  "ChangeoverMatrix.minutes": { label: "换型·时长", unit: "分钟", kind: "minutes" }, // debattery-allow（WO-ENGINE-2：真属性名 minutes·旧 changeoverMin 在对象上不存在）
  "Shipment.etaDay": { label: "在途·到货天", unit: "天", kind: "days" }, // debattery-allow
};
