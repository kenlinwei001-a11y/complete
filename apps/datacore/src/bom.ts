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
 * ── 口径（三条，逐条都是既有行为，本模块只是搬家不是改规则）──────────────────
 *  ① **型号过滤**：`BOMHeader.modelId === modelId`（严格相等，不做模糊匹配）。
 *  ② **优先级**：`status === "量产"` 的优先；同级按 `bomId` 升序取首（R6 确定性：
 *     并列时必须有一个稳定的裁决键，否则同输入两跑可能取到不同 BOM）。
 *  ③ **明细排序**：`sequence` 升序，并列再按 `bomDetailId` 升序（同上，确定性）。
 *
 * ⚠ 本模块**不做任何回落**：型号没有 BOMHeader ⇒ `header: null` + `rows: []`，
 * 由调用方按各自的语义决定是报错还是记 0。绝不返回「随便一份 BOM」——
 * `extended.ts` 已经因为这种回落（`mats.slice(0,4)` 冒充型号 BOM）被治过一次。
 */
export interface EffectiveBom {
  /** 生效的 BOM 主表行（属性包）；该型号一份都没有 ⇒ `null`。 */
  header: Record<string, unknown> | null;
  /** 该 BOM 的明细行（已按 ② 的口径稳定排序）；无生效 BOM ⇒ `[]`。 */
  rows: Record<string, unknown>[];
  /** 该型号命中的 BOMHeader 总数 —— 供调用方在报错文案里说清「找到几份、明细几行」。 */
  headerCount: number;
}

const byBomId = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
  str(a.bomId) < str(b.bomId) ? -1 : str(a.bomId) > str(b.bomId) ? 1 : 0;

/**
 * 取某型号的生效 BOM。**纯函数**（同输入同输出，零时钟零随机·R6）。
 *
 * @param headers BOMHeader 的**属性包**数组（不是 ObjectInstance —— 让本模块与仓储/求解器上下文解耦，
 *                两个消费方各自把 `o.props` 摊平后传进来即可）。
 * @param details BOMDetail 的属性包数组。
 * @param modelId 型号主键（`Model.modelId`，不是对象 id）。
 */
export function selectEffectiveBom(
  headers: readonly Record<string, unknown>[],
  details: readonly Record<string, unknown>[],
  modelId: string,
): EffectiveBom {
  const mine = headers.filter((h) => str(h.modelId) === modelId);
  const header = mine.filter((h) => str(h.status) === "量产").sort(byBomId)[0] ?? mine.sort(byBomId)[0] ?? null;
  const rows = header
    ? details
        .filter((d) => str(d.bomId) === str(header.bomId))
        .sort((a, b) => num(a.sequence) - num(b.sequence) || (str(a.bomDetailId) < str(b.bomDetailId) ? -1 : 1))
    : [];
  return { header, rows, headerCount: mine.length };
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
