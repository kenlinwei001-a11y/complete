import { num, str } from "./solvers/types.js";

/**
 * **「某型号当前生效的那份 BOM 是哪一份」—— 全仓唯一判据**（WO-COEF-FROM-BOM 提出）。
 *
 * ── 为什么必须提出来（不是为省行数）────────────────────────────────────────────
 * 这段选取逻辑原来只长在 `solvers/extended.ts` 的 `quote_margin` 里
 * （注释原文「真 BOM：BOMHeader(该 modelId·量产优先·bomId 升序取首) → BOMDetail × Material.unitPrice」）。
 * 传导侧要按 BOM 用量分摊系数时，若**另抄一份**同样的选取规则，本仓立刻多出**第二套真相源**：
 * 「接单毛利算的是 V1.0 那份 BOM、推演分摊按的是 V2.0 那份」——两处都绿、两个数对不上，
 * 正是本仓反复治的「绿测试≠能用·断在接缝」形态。故选取只留这一支，两个消费方共用。
 *
 * ── 口径（四条）────────────────────────────────────────────────────────────
 *  ① **型号过滤**：`BOMHeader.modelId === modelId`（严格相等，不做模糊匹配）。
 *  ② **生效期**（WO-BOM-EFFECTIVE-DATE 新增·见下「为什么日期是硬过滤」）：
 *     `effectiveDate ≤ asOfDate ≤ expireDate`。两端**空串 = 无界**
 *     （`expireDate: ""` 是种子里「尚未失效」的真实写法 —— `battery.ts` 的 `VERSION_DEFS`
 *     V2.0 就是空串；把空串当「1970 年失效」会把唯一当期的那份判死）。
 *  ③ **优先级**：**先生效期，后状态**。生效期内的候选里 `status === "量产"` 优先；
 *     同级按 `bomId` 升序取首（R6 确定性：并列时必须有稳定裁决键，否则同输入两跑可能取到不同 BOM）。
 *  ④ **明细排序**：`sequence` 升序，并列再按 `bomDetailId` 升序（同上，确定性）。
 *
 * ── 为什么「日期」是硬过滤而「状态」只是次级键（本单要求给理由，不许照抄原逻辑）──
 * 两个字段回答的是**两个不同的问题**：
 *   · `expireDate` 回答「**这一版还算不算数**」—— 时效性；
 *   · `status`（量产/试产）回答「**这一版成熟到什么程度**」—— 成熟度。
 * 报价与传导问的是「**今天这台车照哪份单子造、照哪份单子计价**」，那是**时效性问题**。
 * 把成熟度放在首位，会让一份**已经退役**的版本压过一份**当期在用**的版本 —— 这正是本单的病：
 * 选取式里写着「量产优先」，于是 2024-12-31 就失效的 V1.0 永远压住当期版本。
 * 反过来，成熟度并非无关：**在都当期的前提下**，量产版的成本数据是承诺过的、试产版是估的，
 * 所以 `status` 保留为**次级键**而不是删掉。
 * ⚠ 顺序反过来（状态优先）会得到另一套完全合法但不同的口径，**那是业务裁决不是实现细节**——
 * 本模块把两者的后果都做成可观测（见 `rule` / `stale` / `inEffectCount`），由上层裁决，不在这里替业务拍板。
 *
 * ── ⚠ `asOfDate` 省略时会怎样（**这不是默认值，是显式的"未按日期裁决"**）─────────
 * R6 禁 `Date.now()`：本模块是**纯函数**，自己**没有**也**不许有**时钟。基准日只能由调用方给
 * （本仓的确定性业务纪元是 `BATTERY_SOLVER_PARAMS.forecastStart`，`battery.ts` 里的常量，非时钟）。
 * 调用方**没给** ⇒ 本模块**不编一个日期**，而是跳过 ② 并把 `dateFilterApplied: false`
 * 写进返回值 —— 口径与本单之前**逐字节相同**。⛔ 这一条不许读成"默认按今天"：
 * 「没给基准日」与「给了基准日且都过期」是**两件不同的事**，混在一起就又是一次
 * 「拿 X 当 Y 的证据而 X 不度量 Y」。
 *
 * ⚠ 本模块**不做任何静默回落**：型号没有 BOMHeader ⇒ `header: null` + `rows: []`。
 * 候选**全部不在生效期**时（本仓实测 6/6 型号在 `forecastStart=2026-06-10` 都是这一档）
 * 仍返回一份 BOM 供调用方兜底，但**必须**带 `stale: true` + `rule: "stale-fallback:*"` ——
 * 回落本身不是错，**不说出来才是错**。调用方拿到 `stale` 就该在输出里挑明
 * 「本次计价基于一份已不当期的 BOM」，而不是把它当成正常报价。
 */

/** 本次裁决实际走的是哪一条 —— 门与调用方断言这个，**不许只看 `header` 非空就当正常**。 */
export type BomSelectionRule =
  /** 生效期内且量产 —— 唯一的"完全正常"档。 */
  | "in-effect:量产"
  /** 生效期内，但只有非量产（试产等）可选。 */
  | "in-effect:非量产"
  /** 候选全不在生效期 ⇒ 回落到量产 + bomId 升序（= 本单之前的行为），**已标记**。 */
  | "stale-fallback:量产"
  /** 候选全不在生效期且无量产 ⇒ 回落到 bomId 升序，**已标记**。 */
  | "stale-fallback:其他"
  /** 调用方未给基准日 ⇒ 未按日期裁决，口径同本单之前。 */
  | "no-date-filter"
  /** 该型号一份 BOMHeader 都没有。 */
  | "none";

export interface EffectiveBom {
  /** 生效的 BOM 主表行（属性包）；该型号一份都没有 ⇒ `null`。 */
  header: Record<string, unknown> | null;
  /** 该 BOM 的明细行（已按 ④ 的口径稳定排序）；无生效 BOM ⇒ `[]`。 */
  rows: Record<string, unknown>[];
  /** 该型号命中的 BOMHeader 总数 —— 供调用方在报错文案里说清「找到几份、明细几行」。 */
  headerCount: number;
  /** 本次裁决用的基准日；调用方没给 ⇒ `null`。 */
  asOf: string | null;
  /** 本次是否真的按生效期裁决过。`false` ⇒ 口径与本单之前逐字节相同。 */
  dateFilterApplied: boolean;
  /** 基准日当天处于生效期内的候选份数（`dateFilterApplied: false` 时恒 0，因为压根没算）。 */
  inEffectCount: number;
  /** 选中的这份在基准日**不当期**（已失效或尚未生效）。`true` ⇒ 调用方必须对外挑明。 */
  stale: boolean;
  /** 裁决路径，见 `BomSelectionRule`。 */
  rule: BomSelectionRule;
}

const byBomId = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
  str(a.bomId) < str(b.bomId) ? -1 : str(a.bomId) > str(b.bomId) ? 1 : 0;

/**
 * 一份 BOM 在基准日是否处于生效期内。
 *
 * **纯字符串比较，刻意不 `Date.parse`**：本仓的日期一律是 `YYYY-MM-DD`，该格式的字典序
 * **就是**时序，所以字符串比较零时区、零 `Invalid Date`、零本地化风险（R6 确定性）。
 * 一旦有人塞进别的格式，字典序会悄悄给出错答案 —— 故此处显式只认定长 10 位的 ISO 日期，
 * 认不出来的当作**无界**（不是当作"不生效"：把读不懂的值判死会把唯一候选灭掉，
 * 而把它判活最多是维持本单之前的行为，后者可诊断、前者是静默塌陷）。
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isBomInEffect(header: Record<string, unknown>, asOfDate: string): boolean {
  const from = str(header.effectiveDate);
  const to = str(header.expireDate);
  if (ISO_DATE.test(from) && asOfDate < from) return false; // 尚未生效
  if (ISO_DATE.test(to) && to < asOfDate) return false; // 已失效（空串/非法 ⇒ 无失效日 ⇒ 仍生效）
  return true;
}

/**
 * 取某型号的生效 BOM。**纯函数**（同输入同输出，零时钟零随机·R6）。
 *
 * @param headers BOMHeader 的**属性包**数组（不是 ObjectInstance —— 让本模块与仓储/求解器上下文解耦，
 *                两个消费方各自把 `o.props` 摊平后传进来即可）。
 * @param details BOMDetail 的属性包数组。
 * @param modelId 型号主键（`Model.modelId`，不是对象 id）。
 * @param asOfDate **业务基准日**（`YYYY-MM-DD`）。本模块**没有时钟**（R6），基准日只能由调用方给；
 *                 本仓的确定性纪元是 `BATTERY_SOLVER_PARAMS.forecastStart`（`SolverContext.params.forecastStart`）。
 *                 ⛔ **省略 ≠ 默认今天**：省略表示"本次不按生效期裁决"，返回值里 `dateFilterApplied: false` 会说出来。
 */
export function selectEffectiveBom(
  headers: readonly Record<string, unknown>[],
  details: readonly Record<string, unknown>[],
  modelId: string,
  asOfDate?: string,
): EffectiveBom {
  const mine = headers.filter((h) => str(h.modelId) === modelId);
  const asOf = ISO_DATE.test(String(asOfDate ?? "")) ? String(asOfDate) : null;
  // 量产优先 + bomId 升序 —— 在**给定候选集**内的稳定裁决键（口径 ③ 的后半段）。
  const pick = (cands: Record<string, unknown>[]): Record<string, unknown> | null =>
    cands.filter((h) => str(h.status) === "量产").sort(byBomId)[0] ?? cands.slice().sort(byBomId)[0] ?? null;

  let header: Record<string, unknown> | null;
  let rule: BomSelectionRule;
  let inEffectCount = 0;
  let stale = false;

  if (mine.length === 0) {
    header = null;
    rule = "none";
  } else if (asOf === null) {
    // 调用方没给基准日 ⇒ 不编日期、不裁决，维持本单之前的口径并**如实声明**。
    header = pick(mine);
    rule = "no-date-filter";
  } else {
    const inEffect = mine.filter((h) => isBomInEffect(h, asOf));
    inEffectCount = inEffect.length;
    if (inEffect.length > 0) {
      header = pick(inEffect);
      rule = str(header?.status) === "量产" ? "in-effect:量产" : "in-effect:非量产";
    } else {
      // 全不当期：**回落但标记**。⛔ 不许静默 —— `stale` 就是那句"必须说出来的话"。
      header = pick(mine);
      stale = true;
      rule = str(header?.status) === "量产" ? "stale-fallback:量产" : "stale-fallback:其他";
    }
  }

  const rows = header
    ? details
        .filter((d) => str(d.bomId) === str(header.bomId))
        .sort((a, b) => num(a.sequence) - num(b.sequence) || (str(a.bomDetailId) < str(b.bomDetailId) ? -1 : 1))
    : [];
  return { header, rows, headerCount: mine.length, asOf, dateFilterApplied: asOf !== null, inEffectCount, stale, rule };
}

/**
 * 一行 BOM 明细的**成本口径**：`单台用量 × 物料单价 × (1 + 损耗率)`。
 *
 * 这条式子**不是本模块发明的**，是 `quote_margin` 的既有口径（`extended.ts` 的 `realBom`：
 * `unit` = `BOMDetail.quantity`「单台用量」· `spotPrice` = `Material.unitPrice` ·
 * `processRate` = `BOMDetail.lossRate`「这张 BOM 自己说的损耗，不是求解器替它假设的」）。
 * 传导侧算「该物料占该型号 BOM 成本多少」时**必须用同一条式子** —— 换一条就又是两套真相源。
 *
 * @param unitPriceOf 物料主键 → 单价。查不到 ⇒ 调用方自己给 0（不在这里编价）。
 */
export function bomRowCost(row: Record<string, unknown>, unitPriceOf: (materialId: string) => number): number {
  return num(row.quantity) * unitPriceOf(str(row.materialId)) * (1 + num(row.lossRate));
}
