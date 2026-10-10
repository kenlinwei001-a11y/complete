/**
 * WO-LEVER-FACTOR-I18N + WO-LEVER-UNIT · 杠杆属性 → {中文显示名·单位·值类}**单一真值**（治本单源：
 * `discoverLevers` 下发 `factor`/`unit`/`valueKind`·前端只格式化不内联·灭"前后端各存一份标签/单位"漂移·R14 非内联）。
 * 键 = `对象类型.属性`（与 LEVER_FACTOR_PROPS 值域对齐·缺项 → 下游诚实兜底不臆造）。
 * `kind` 决定前端格式化：ratio=比率（0–1 存储自动×100 显示 %）；days/hours/count/qty=整数+单位后缀。
 * 单位真值随电池合成口径核定（utilization/oee/yield/attendance/coverage/outsourceRatio 存 0–1 → %；
 * leadTime/etaDay 存天；shifts 存班；shiftHours 存小时；changeoverMin 存分钟；onHand 整数库存·单位随物料不臆造）。
 *
 * ── 为什么它住在这个文件里（WO-SANDBOX-S3 迁出）──────────────────────────────
 * 原址是 `solvers/service.ts`。S3 的候选枚举器（`impediment-options.ts`）也要用这份标签与单位，
 * 而 `service.ts → chain-impediment.ts → impediment-options.ts` 已是一条单向依赖链 ——
 * 让枚举器回头 import `service.ts` 会成环，环里 `const` 的求值顺序不可靠（拿到 `undefined` 的那种）。
 * 故把它降到叶模块，`service.ts` 原地 re-export 保持对外符号不变（`test/schema-display-name.seam.test.ts`
 * 仍从 `service.js` 取它，一个字节不用改）。
 *
 * ── WO-FIX-SCHEMA-DISPLAY-NAME · 属性中文名**不在本文件**（2026-08-22）────────────
 * 本表原先把标签整串写死（`label: "设备·OEE"`），于是属性的中文名在全仓有**两份**：
 * 这里一份、`synthetic/battery.ts PROP_DISPLAY_NAMES` 一份。两份同时存在 ⇒ 改任一侧即分叉，
 * 实测已经分叉过：仓主裁决 C（WO-OEE-UNIFY）把 `Equipment.oee_current` 的中文名改成
 * 「OEE（综合·事实表7日均值）」并只改了 `PROP_DISPLAY_NAMES` 那一侧，本表留在「设备·OEE」
 * —— 屏上出现同一个属性两个中文名（属性表一个、杠杆条一个），`schema-display-name.seam.test.ts` ③b 报红。
 *
 * 现在的机制不是"两侧抄一样"，是**只有一份**：
 *   `label` = `TYPE_ABBR[类型]` + `·` + **`propDisplayName(类型, 属性)`（PROP_DISPLAY_NAMES 唯一真值）**
 * 本文件只留"类型简称"这半段（它不是属性名，本体里没有对应真值），属性中文名一个字都不存。
 * 改中文名只需改 `PROP_DISPLAY_NAMES`，杠杆标签自动跟随，**结构上不可能再分叉**。
 *
 * ⚠ 依赖方向已核（`battery.ts` 的传递依赖闭包 = contracts/domain/prng/features/view-manifest/
 * errors/sandbox-console/graphmeta，**零条通向 `solvers/`**）⇒ 本 import 不成环，
 * 上面那条"环里 const 求值顺序不可靠"的坑不适用。
 */
import { propDisplayName } from "../synthetic/battery.js";

/**
 * WO-DIM-LABEL-3 ③ · `ratio` 与 `percent` 是**两种存储口径**，不是两种显示口径。
 *
 * ── 为什么必须拆成两个成员 ──────────────────────────────────────────────────
 * 本仓同一个概念「利用率」有两套存储：`Line.utilization` 存 **0–100 百分点**
 * （时序 `util:line` base mean 92 · `battery.ts` 的 `TS_SERIES` 表；实测取值 89.77~94.13），
 * 而 `Process.utilization` / `Process.attendance` 存 **0–1 比率**（实测 0.88~1.00）。
 * 二者此前 `kind` **同为 `ratio`**，于是「该不该 ×100」在下发的元数据里**根本没有答案** ——
 * 前端只能拿取值范围猜（`v <= 1 ? v*100 : v`）。
 *
 * 猜能work只是因为今天两套值域恰好不重叠。一旦某条线利用率真的掉到 1 以下（停机/调试线
 * 完全可能），那个 `0.8` 就会被当成比率画成 `80%`，而它其实是 **0.8%**——
 * 数量级差 100 倍，且**不会报错**。这正是 `ab50ccff` 在驾驶舱那条路上删掉的同一种猜法
 * （`Base.util` 70~88 百分点 vs `Line.schedule_attainment` 0.879~0.949 比率，同声明 `unit:"%"`，
 * 屏上把 91.1% 画成「0.91%」）。
 *
 * 判据：**量纲由下发方声明，不许按取值范围猜。**
 *   · `ratio`   —— 存 0–1，显示 ×100 加 %（0.92 → 92%）
 *   · `percent` —— 存 0–100，**显示原样**加 %（95.89 → 96%）
 */
export type LeverValueKind = "ratio" | "percent" | "days" | "count" | "hours" | "minutes" | "qty";

/** 杠杆标签的分隔符：`类型简称` + 本符 + `属性中文名`。 */
const LEVER_LABEL_SEP = "·";

/**
 * 类型简称 = 标签的**前**半段（本体类型的口语名，非属性名）。
 * 后半段一律取自 `PROP_DISPLAY_NAMES`，本文件不存第二份属性中文名。
 */
const TYPE_ABBR: Record<string, string> = {
  Equipment: "设备", Line: "产线", Process: "工序", MaterialBalance: "物料齐套", // debattery-allow
  Material: "物料", Order: "订单", ChangeoverMatrix: "换型", Shipment: "在途", // debattery-allow
};

/**
 * 杠杆落点的**非名字**部分（单位 + 值类）。中文名不在这里 —— 见文件头。
 * 键形 `Type.prop`，`scripts/check-lever-landing-exists.mjs` 按此形状抽源码键与 dist 交叉核对，
 * 别改成拼接/展开写法（抽出 0 个键会被该门判「抽取式失配」）。
 */
const LEVER_PROP_SPECS: Record<string, { unit: string; kind: LeverValueKind }> = {
  "Equipment.oee_current": { unit: "%", kind: "ratio" }, // 存 0–1（A×P×Q 派生）
  // WO-DIM-LABEL-3 ③：**存 0–100 百分点**，不是 0–1 —— 出处是时序物化而非播种：
  // `battery.ts` 的 `TS_SERIES` 里 `util:line` 是 `base:{mean:92,noise:1.2}`，
  // 经 `line_util_daily` 物化落到 `Line.utilization`（`lines.push` 处根本不写这个字段）。
  // 实测真跑 `chain_impediments`：金华分切线 95.8912、自贡分容线 95.358。
  // 故 kind 是 `percent` 不是 `ratio`；写成 ratio 就是把「该不该 ×100」这个答案从元数据里抹掉。
  "Line.utilization": { unit: "%", kind: "percent" },
  "Process.yield_baseline": { unit: "%", kind: "ratio" }, // 存 0–1（实测 0.9397~0.948）
  "Process.attendance": { unit: "%", kind: "ratio" }, // 存 0–1（实测 0.927~0.956）
  // WO-DIM-LABEL-3 ③：本条**此前根本没登记**，而它今天真的会被枚举成候选杠杆
  // （实测 `chain_impediments` 12 条候选里它占 2 条）⇒ 下发 `unit:""` + `valueKind:undefined`
  // ⇒ 前端走「无元数据」兜底 `String(v)` ⇒ 屏上显示裸 `0.916`，
  // 而紧挨着的 `Line.utilization` 显示 `96%` —— 同一张列表、同一个「利用率」，两种写法。
  // 存 0–1（实测 0.916 / 0.922，播种在 `battery.ts` 串行工序 `0.88+rng*0.08`）。
  "Process.utilization": { unit: "%", kind: "ratio" },
  "Process.shifts": { unit: "班", kind: "count" }, // debattery-allow
  "Process.shiftHours": { unit: "小时", kind: "hours" }, // debattery-allow
  "MaterialBalance.coverage": { unit: "%", kind: "ratio" },
  "Material.onHand": { unit: "", kind: "qty" },
  "Material.leadTime": { unit: "天", kind: "days" }, // debattery-allow
  "Order.outsourceRatio": { unit: "%", kind: "ratio" },
  "ChangeoverMatrix.minutes": { unit: "分钟", kind: "minutes" }, // debattery-allow（WO-ENGINE-2：真属性名 minutes·旧 changeoverMin 在对象上不存在）
  "Shipment.etaDay": { unit: "天", kind: "days" }, // debattery-allow
};

/**
 * 拼标签：类型简称 + `·` + 属性中文名。
 * 两侧都**诚实回落裸键**（同 `PROP_DISPLAY_NAMES` 的留白纪律：宁可让界面显裸键，也不臆造中文名，
 * 更不吐 `undefined`）—— 回落形如 `设备·oee_current`，一眼能看出是哪条没登记。
 */
function leverLabel(key: string): string {
  const i = key.indexOf(".");
  const typeKey = key.slice(0, i);
  const prop = key.slice(i + 1);
  return `${TYPE_ABBR[typeKey] ?? typeKey}${LEVER_LABEL_SEP}${propDisplayName(typeKey, prop) ?? prop}`;
}

export const LEVER_PROP_META: Record<string, { label: string; unit: string; kind: LeverValueKind }> = {};
for (const [key, spec] of Object.entries(LEVER_PROP_SPECS)) {
  LEVER_PROP_META[key] = { label: leverLabel(key), unit: spec.unit, kind: spec.kind };
}
