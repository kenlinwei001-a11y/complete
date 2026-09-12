/**
 * ══ WO-STATEVAR-DISPLAYNAME · 推演状态变量的**唯一**消费路径 ═══════════════════════════
 *
 * 病灶（三分法判为**没接线**，不是「接了线没数据」）：推演四处屏（沙盘 KPI 逐变量读数 ·
 * 扰动落点下拉 · 传导边开关面板 · 对照差异表）一律显示裸键 `loadIndex` / `demandLoad`。
 * 追调用链后确认（**2026-08-17 接线前排查**，WO-STATEVAR-DISPLAYNAME ① `82d505700` 的基线上）：
 * 本体里这批名字**根本不是属性** —— `grep -rl "负载指数" apps/datacore/src/synthetic/` 当日零命中
 * （金丝雀：同一条命令换成 `costPressure` 当日命中 ⇒ 检索工具是好的），
 * 契约里**没有任何字段**承载它们的名字 —— 缺的是真值源与线，
 * 不是「有字段但没填」。故本单补的是：后端单源表 → 两条读时投影 → 本文件这一条消费路径。
 * ⚠ 保质期：本单落地后 `STATE_VAR_DISPLAY_NAMES` 就站在 `apps/datacore/src/synthetic/battery.ts` 里 ——
 *   今天再跑同一条 grep **必然命中它自己**；要复验「接线前是什么样」请在 `82d505700^` 上跑。
 *
 * ⛔ **前端一个中文名都不许写在这里**（造第二套真相源是本仓治过多次的病）。
 *    本文件只做一件事：把后端下发的 `stateVarNames` 字典**如实**翻成屏上标签，查不到就回落裸键。
 *    真值源在 `apps/datacore/src/synthetic/battery.ts` 的 `STATE_VAR_DISPLAY_NAMES`，
 *    改那张表里的一个词，屏上那个词就跟着变 —— 这正是本单接缝测试断言的那件事。
 *
 * ── 回落必须**看得出是回落**（诚实 > 好看）────────────────────────────────────────
 * 后端**只下发登记过的键**（未登记的键压根不在字典里，而不是填裸键或空串）。于是前端能分清
 * 「有名字」与「没名字」两种态，并把后者如实标出来：
 *   · 有名字 ⇒ 屏上显中文，`title` 带上接线名（`loadIndex`），`named = true`；
 *   · 没名字 ⇒ 屏上**显裸键本身**（不编名字、不留空白），`named = false`。
 * 判据 `named` 一并回出去，让调用方可以打 `data-` 记号 —— 回落态因此是**可断言的**，
 * 不是"看上去差不多"。若后端改成回落时填 `loadIndex: "loadIndex"`，这里就再也分不出两种态了，
 * 那正是契约注释里点名不许那么做的原因。
 */

/** 一个状态变量在屏上的标签解析结果。 */
export interface StateVarLabel {
  /** 屏上显示的那一串：中文业务名，或**回落时的裸键本身**（绝不为空串）。 */
  text: string;
  /** 是否真的查到了名字。`false` = 屏上那串是接线名，不是业务名。 */
  named: boolean;
  /** 接线名（`loadIndex`）——始终是原始键，供 `title` / 第二级 mono 行 / testid 用。 */
  key: string;
}

/**
 * 解析单个状态变量的屏上标签。
 *
 * `names` 缺省 `undefined`（老响应 / 未接该字段的租户）⇒ 逐条回落裸键，
 * 与本字段引入前**逐字节同屏**（additive 可回退）。
 */
export function stateVarLabel(stateVar: string, names?: Readonly<Record<string, string>>): StateVarLabel {
  const zh = names?.[stateVar];
  // 空串按"没名字"处理：后端不该下发空串，真下发了也不能让屏上出现一个看不见的标签。
  return zh ? { text: zh, named: true, key: stateVar } : { text: stateVar, named: false, key: stateVar };
}

/** 便捷版：只要屏上那一串（`中文名 ?? 裸键`）。 */
export function stateVarText(stateVar: string, names?: Readonly<Record<string, string>>): string {
  return stateVarLabel(stateVar, names).text;
}

/**
 * `类型.状态变量` 两段都翻成人话（传导边面板第一级用）。
 *
 * 两段各自独立回落：类型名查不到就显类型 key，变量名查不到就显变量 key ——
 * 不因为一段缺名就把整条退回裸键（那会把已有的信息也一起扔掉）。
 */
export function qualifiedStateVarText(
  typeKey: string,
  stateVar: string,
  typeNames?: ReadonlyMap<string, string>,
  names?: Readonly<Record<string, string>>,
): string {
  return `${typeNames?.get(typeKey) ?? typeKey} · ${stateVarText(stateVar, names)}`;
}
