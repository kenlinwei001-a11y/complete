import { pairWeightNormalizeOf, type PairWeightNormalize, type PropagationRule } from "@platform/contracts";
import { bomRowCost, selectEffectiveBom } from "../bom.js";
import type { ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { num, str } from "../solvers/types.js";
import { pairWeightKey, type PairWeightLookup, type PropagationGraph } from "./propagation.js";

/**
 * **逐实例分摊权重的算处**（WO-COEF-FROM-BOM · 契约 `PropagationRule.weightRef`）。
 *
 * ⚠ **本模块承载两个不同的病，别合并成一个**（第二个由 WO-EDGE-MONEY-WEIGHT 补）：
 *  ① `bom_cost_share` 治的是「一条边一个常数 ⇒ **用量**没进公式」（贵重料与边角料同额）；
 *  ② `source_value_relative` 治的是「多源汇一目标时逐源同额 ⇒ **金额**没进公式」
 *     （压 10 亿的客户与压 5.78 亿的客户读数逐字节相同 ⇒ 按条数排序）。
 *  两者的修法**不同**：① 换的是"一条边内部怎么分"，② 换的是"多条边之间谁更重"，
 *  且 ② 的分母必须是**全域**基数（组内归一会把金额约掉，读数原样退回按条数）。
 *
 * ── 今天是 X / 应该是 Y（本单的病灶，实测·demo 租户 seed 42）─────────────────────
 * **今天的行为是**：`propagation.ts` 把系数解析成**整条规则一个标量**，对该源的**每一个**目标
 * 落同一个额；公式 `coeff × sourceVal × factor` 里**没有用量项**。于是磷酸铁锂正极
 * （占 方形-LFP 的 BOM 成本 **17.815%**）与铝箔（**0.920%**）各涨 15%，
 * 给出**逐字节相同**的 `Model.costPressure = 29.25`。
 * **应该是**：贵重且用量大的物料涨价，对该型号成本的推动**按它在这张 BOM 里的成本占比**放大，
 * 边角料涨价只推动一点点 —— 即 `amount = 强度 × 该对权重 × 源态`。
 *
 * ── 分工（为什么算在这里、不算在引擎里）────────────────────────────────────────
 * 引擎 `propagation.ts` 是「不认识任何行业的纯函数」（R14 零业务常数），它只吃一张
 * `ruleKey → "src\u0000tgt" → 权重` 的纯数值表。BOM 怎么遍历、订单数量怎么归集这类行业知识
 * 全在本模块 —— 与 `buildCadenceGates` 立下的分工完全一致（引擎认结构，DataCore 认行业）。
 *
 * ── 性能判据：**没有规则声明 `weightRef` ⇒ 一次对象读都不发**─────────────────────
 * 与 `buildPropagationInputs` 「无传导规则的租户零本体读」那条既有特征同款。
 * 各口径**只读自己要的类型**，也不做跨口径的公共预取。
 *
 * ── 可披露（仓主 2026-08-28 硬要求）────────────────────────────────────────────
 * 「**推演过程必须可披露**：每一条边的权重必须能被追问出处。」
 * 故本模块除权重表外，**同时**产出 `PairWeightReport`：逐对给出分子/分母/用的哪张 BOM/
 * 由哪几个字段算出来，以及这一跳的耗时。判据是「一个看不到代码的人，读完能自己判断
 * **这个数是算的还是拍的**」——所以 `formula` 写的是**代入了真实数字**的式子，不是符号式。
 */

/** 一条边（一对源/目标实例）的权重出处 —— 可披露的最小单位。 */
export interface PairWeightExplain {
  ruleKey: string;
  basis: string;
  sourceObjectId: string;
  targetObjectId: string;
  weight: number;
  /** 分子（该对的"计量值"）与分母（归一用的那个量）。两者都给，读者才能自己除一遍。 */
  numerator: number;
  denominator: number;
  /**
   * 归一方式：`IN_EDGES` = Σ=1（加权平均）；`IN_EDGES_MEAN` = 组内均值=1（保总量）；
   * `IN_EDGES_GLOBAL_MEAN` = **全域**均值=1（保总量且跨目标可比 —— 金额敞口口径）。
   */
  normalize: PairWeightNormalize;
  /** **代入真实数字**的算式（不是符号式）——「这个数是算的还是拍的」靠它自证。 */
  formula: string;
  /** 用的哪些字段（含对象类型前缀），逐个列出，供审计核对口径。 */
  fields: string[];
  /** 用的哪一份 BOM（`bomId`）；与 BOM 无关的口径 ⇒ `null`。 */
  bomId: string | null;
}

/** 一次权重装配的**诚实回执** + 可披露出处。 */
export interface PairWeightReport {
  /** 逐规则：铺了多少对、多少对权重为 0、这一跳算了多久（毫秒）。 */
  pairs: {
    ruleKey: string;
    basis: string;
    normalize: PairWeightNormalize;
    pairs: number;
    zeroPairs: number;
    elapsedMs: number;
    /**
     * **系数来源**（仓主要求③：「今天 42 条边走 `coefficientRef` 的是 0 条，全部内联 —— 改完要能看出哪些变了」）。
     * `CONFIG_REF` = 强度来自 `coefficientRef` 指向的可编辑规则参数；`INLINE` = 用的是内联 `coefficient`。
     * 与权重是否派生**正交**：本字段说的是「强度打哪来」，`basis` 说的是「强度怎么分摊」。
     */
    coefficientSource: "CONFIG_REF" | "INLINE";
    coefficient: number;
  }[];
  /**
   * 算不出整张表的规则（本体数据缺失/未物化，或口径不在册）。
   * 引擎拿不到表 ⇒ 该规则本 tick **不传导**并显式报缺 —— 绝不退回「逐目标同额」。
   */
  unresolved: { ruleKey: string; basis: string; reason: string }[];
  /**
   * 逐对出处。**按 (ruleKey, targetId, sourceId) 升序**，R6 稳定。
   * 可能很长（本仓 demo 租户 `order_for_model` 一条边就 500 对），故调用方按需截断下发；
   * 这里**不预先截断** —— 截断策略属于展示层，塞进算处就成了"审计看不到全量"的暗坑。
   */
  explain: PairWeightExplain[];
}

const props = (o: ObjectInstance): Record<string, unknown> => o.props;
const live = (rows: ObjectInstance[]): ObjectInstance[] => rows.filter((o) => !o.mergedInto);

/** 一对源/目标的计量值 + 它的出处片段（供 explain 拼装）。 */
interface Measure {
  sourceId: string;
  measure: number;
  formula: string;
  fields: string[];
  bomId: string | null;
}

/**
 * 把 `(targetId → [Measure])` 归一成权重表片段 + 逐对出处。
 *
 * **三种归一，选哪种看目标量纲**（判据表见契约 `PairWeightNormalize` 上方）：
 *  · `IN_EDGES`             —— 除以 `denomOf` 给的分母。Σ=1 ⇒ **加权平均**，配**强度**型目标。
 *  · `IN_EDGES_MEAN`        —— 除以**组内**均值。均值=1、Σ=N ⇒ **保总量**，配**广延**型目标。
 *  · `IN_EDGES_GLOBAL_MEAN` —— 除以**全域**均值（`denomOf` 直接给全域基数，**不再除以 rows.length**）。
 *    ⇒ 保总量**且跨目标可比**，配**敞口**（金额）型目标。
 *
 * ⚠ 后两者的差别只在分母的一次除法上，却是「按金额算」与「按条数算」的分野：
 *   组内均值下 Σ权重 ≡ 组的条数 n（金额被组内归一**约掉了**）⇒ 读数退回按条数；
 *   全域均值下 Σ权重 = 该组金额 ÷ 全域均值 ∝ **金额敞口**。
 *   实测账见契约 `PairWeightNormalize` 上方 WO-EDGE-MONEY-WEIGHT 段。
 *
 * @param denomOf 分母。**故意可与「图里现有入边之和」不同**：`bom_cost_share` 拿**整份 BOM** 当分母，
 *                `source_value_relative` 拿**全租户该类型全部实例的均值**当分母 ——
 *                这样占比/倍率是可审计的绝对量；按现有入边重新归一会让「加一条链路」悄悄改掉其它每一条的权重。
 */
function normalizeInEdges(
  ruleKey: string,
  basis: string,
  normalize: PairWeightNormalize,
  measures: Map<string, Measure[]>,
  denomOf: (targetId: string, rows: Measure[]) => number,
): { table: Record<string, number>; zeroPairs: number; explain: PairWeightExplain[] } {
  const table: Record<string, number> = {};
  const explain: PairWeightExplain[] = [];
  let zeroPairs = 0;
  // R6：按 target id 升序、组内按 source id 升序 —— 浮点除法本身与序无关，
  // 但插入序会影响对象键序，而键序会被 JSON 快照咬到（本仓多处逐字节断言）。
  for (const targetId of [...measures.keys()].sort((a, b) => a.localeCompare(b))) {
    const rows = (measures.get(targetId) ?? []).slice().sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const base = denomOf(targetId, rows);
    // MEAN：分母 = **组内**均值（= 该组总量 ÷ 该组条数）。条数恒 ≥1（这一组是由边建出来的）。
    // GLOBAL_MEAN：`denomOf` 给的**已经是**全域均值 —— 这里**绝不**再除以 rows.length，
    //   再除一次就把它变回组内口径，读数当场退回「按条数算」（本单要治的那个病）。
    const denominator = normalize === "IN_EDGES_MEAN" ? base / rows.length : base;
    for (const r of rows) {
      // 分母 ≤ 0（该目标的计量口径整体拿不到数）⇒ 该目标的全部入边权重 0：
      // 「算得出来是 0」与「算不出来」在这里必须分清 —— 后者由调用方整表报缺，不落到这里。
      const w = denominator > 0 ? r.measure / denominator : 0;
      if (w === 0) zeroPairs += 1;
      table[pairWeightKey(r.sourceId, targetId)] = w;
      explain.push({
        ruleKey, basis, sourceObjectId: r.sourceId, targetObjectId: targetId,
        weight: w, numerator: r.measure, denominator, normalize,
        formula:
          `${r.formula} = ${r.measure} ；权重 = ${r.measure} ÷ ${denominator} = ${w}` +
          (normalize === "IN_EDGES_MEAN"
            ? `（分母是**组内均值** ${base} ÷ ${rows.length} —— 均值=1、保总量，配"广延"型目标）`
            : normalize === "IN_EDGES_GLOBAL_MEAN"
              ? `（分母是**全域均值** ${denominator} —— 全租户该类型全部实例的均值，**不是**这一组的均值；` +
                `均值=1、保总量，且权重与"挂在谁名下"无关 ⇒ 跨目标可比，配"敞口"型目标）`
              : `（分母是**该组总量**，Σ权重=1 —— 加权平均，配"强度"型目标）`),
        fields: r.fields,
        bomId: r.bomId,
      });
    }
  }
  return { table, zeroPairs, explain };
}

/**
 * 装配本次传导所需的全部逐实例权重表。
 *
 * @param rules 本租户的 PUBLISHED 规则（调用方已查好，不在这里再查一遍）。
 * @param graph **已按范围裁剪**的传导图 —— 权重必须只铺范围内的对，否则局部推演会拿到
 *              一张按全域算出来的表（范围裁剪就白做了）。
 * @param now   可注入时钟（**默认不注入 = 生产真实时钟**）。耗时是可披露的一部分，
 *              但它同时是**唯一的非确定性来源** —— 故它只进 `report`，**绝不进 `weights`**：
 *              世界态永远只由 `weights` 决定，R6 逐字节一致不受耗时影响。
 */
export async function buildPairWeights(
  repos: Repos,
  tenantId: string,
  rules: readonly PropagationRule[],
  graph: PropagationGraph,
  now: () => number = () => Date.now(),
): Promise<{ weights: PairWeightLookup; report: PairWeightReport }> {
  // `!= null` 而**不是** `!== null`：这里必须把 `undefined` 也算作"没声明分摊口径"。
  // ⚠ 这一行是被 `sandbox-e4-cadence-propagation.seam.test.ts` 的 E4-8 **当场报红逼出来的**，
  // 不是设计时想到的 —— 而那道门的注释里早就把病因写清楚了：
  // `repo/pg.ts` 读回是 `row.doc as PropagationRule`（**裸 cast、不过 zod parse**），
  // 所以契约上的 `.default(null)` 在读回路上不生效，本字段引入前落库的老规则读回来是
  // `undefined` 而非 `null`。用 `!== null` 会把每一条老规则都判成"声明了口径"，
  // 随后 `rule.weightRef!.basis` 当场 TypeError ⇒ **整个 tick 端点 500**。
  // 契约 `weightRef` 承诺"缺省 ⇒ 与本字段引入前逐字节相同（additive·可回退 RL9）"，
  // 那这条承诺就必须对 `undefined` 同样成立 —— 与 E4 给 `cadenceNodeId` 立的判据逐字相同。
  const weighted = rules.filter((r) => r.weightRef != null);
  const report: PairWeightReport = { pairs: [], unresolved: [], explain: [] };
  // ★ 零声明 ⇒ 零读：与「无传导规则的租户零本体读」同款性能特征。
  if (weighted.length === 0) return { weights: {}, report };

  const typeOf = new Map<string, string>();
  for (const o of graph.objects) typeOf.set(o.id, o.typeKey);
  const edgesOf = (rule: PropagationRule): { fromId: string; toId: string }[] =>
    graph.links.filter(
      (l) =>
        l.linkKey === rule.viaLinkKey &&
        typeOf.get(l.fromId) === rule.sourceTypeKey &&
        typeOf.get(l.toId) === rule.targetTypeKey,
    );

  /** 各类型对象**按需**加载一次（同一 tick 内多条规则共用；没人要的类型一次都不读）。 */
  const cache = new Map<string, ObjectInstance[]>();
  const byType = async (typeKey: string): Promise<ObjectInstance[]> => {
    const hit = cache.get(typeKey);
    if (hit) return hit;
    const rows = live(await repos.objects.listByType(tenantId, typeKey));
    cache.set(typeKey, rows);
    return rows;
  };

  const weights: PairWeightLookup = {};
  // 规则按 key 稳定排序（R6：装配序不引入新的不确定来源）。
  for (const rule of [...weighted].sort((a, b) => a.key.localeCompare(b.key))) {
    const basis = rule.weightRef!.basis;
    const startedAt = now();
    const fail = (reason: string): void => {
      report.unresolved.push({ ruleKey: rule.key, basis, reason });
    };
    const normalize = pairWeightNormalizeOf(basis);
    // 口径不在册（契约 refine 只在**经 zod 解析的写入路**生效；`repo/pg.ts` 读回是裸 cast，
    // 不过 parse —— 这正是 E4 给 `cadenceNodeId` 写 `!= null` 时踩到的同一条接缝）。
    if (normalize === null) {
      fail(`口径「${basis}」不在 PAIR_WEIGHT_BASIS_REGISTRY 中 ⇒ 算不出权重（不猜一个近似口径）`);
      continue;
    }
    /** 系数来源：`coefficientRef` 指得到值 ⇒ 配置来源；否则用的是内联 `coefficient`。 */
    const coefficientSource: "CONFIG_REF" | "INLINE" = rule.coefficientRef ? "CONFIG_REF" : "INLINE";
    const done = (pairs: number, zeroPairs: number): void => {
      report.pairs.push({
        ruleKey: rule.key, basis, normalize, pairs, zeroPairs,
        elapsedMs: now() - startedAt, coefficientSource, coefficient: rule.coefficient,
      });
    };

    const edges = edgesOf(rule);
    if (edges.length === 0) {
      // 边为 0 与「算不出权重」不同：没有边就没有要分摊的对，铺一张空表让引擎照常跑
      // （引擎那一侧「表在但某对查不到 ⇒ 0」的分支自然接住，且不误报缺）。
      weights[rule.key] = {};
      done(0, 0);
      continue;
    }

    if (basis === "bom_cost_share") {
      // ── 该 (物料, 型号) 占该型号生效 BOM 成本的比例 ────────────────────────────
      // BOM 选取与成本式子全部走 `../bom.ts` 那一支（`quote_margin` 同源）——
      // 另抄一份就是第二套真相源：「接单毛利算 V1.0 那份、推演按 V2.0 那份」。
      const [sources, targets, headers, details] = await Promise.all([
        byType(rule.sourceTypeKey), byType(rule.targetTypeKey), byType("BOMHeader"), byType("BOMDetail"),
      ]);
      if (headers.length === 0 || details.length === 0) {
        fail(
          `本租户 BOMHeader ${headers.length} 份 / BOMDetail ${details.length} 行 ⇒ 算不出 BOM 成本占比。` +
            `本条流不传导——退回「逐目标同额」等于挂着"已按用量分摊"的名义跑修前的错行为。`,
        );
        continue;
      }
      const matKeyOf = new Map(sources.map((o) => [o.id, str(o.props.matId) || str(o.objectKey)]));
      const priceByMatKey = new Map(sources.map((o) => [str(o.props.matId) || str(o.objectKey), num(o.props.unitPrice)]));
      const modelKeyOf = new Map(targets.map((o) => [o.id, str(o.props.modelId) || str(o.objectKey)]));
      const hdrProps = headers.map(props);
      const dtlProps = details.map(props);
      /** 型号对象 id → (物料主键 → {成本, 用量, 损耗}) + 整份 BOM 的成本合计 + bomId。 */
      const bomOf = new Map<string, { row: Map<string, { cost: number; qty: number; loss: number }>; total: number; bomId: string | null }>();
      const bomFor = (modelObjId: string) => {
        const hit = bomOf.get(modelObjId);
        if (hit) return hit;
        const { header, rows } = selectEffectiveBom(hdrProps, dtlProps, modelKeyOf.get(modelObjId) ?? "");
        const row = new Map<string, { cost: number; qty: number; loss: number }>();
        let total = 0;
        for (const r of rows) {
          const c = bomRowCost(r, (mk) => priceByMatKey.get(mk) ?? 0);
          const k = str(r.materialId);
          const prev = row.get(k);
          row.set(k, { cost: (prev?.cost ?? 0) + c, qty: num(r.quantity), loss: num(r.lossRate) });
          total += c;
        }
        const built = { row, total, bomId: header ? str(header.bomId) : null };
        bomOf.set(modelObjId, built);
        return built;
      };
      const measures = new Map<string, Measure[]>();
      for (const e of edges) {
        const bom = bomFor(e.toId);
        const matKey = matKeyOf.get(e.fromId) ?? "";
        // 链路说「这个料用在这个型号上」而 BOM 里没有这一行 ⇒ 占比 **0**（算得出来的真值：
        // 不在 BOM 里就是占该型号 BOM 成本 0%）。**不是**报缺 —— 报缺会让整条规则停摆。
        const hitRow = bom.row.get(matKey);
        const price = priceByMatKey.get(matKey) ?? 0;
        (measures.get(e.toId) ?? measures.set(e.toId, []).get(e.toId)!).push({
          sourceId: e.fromId,
          measure: hitRow?.cost ?? 0,
          formula: hitRow
            ? `单台用量 ${hitRow.qty} × 单价 ${price} × (1 + 损耗率 ${hitRow.loss})`
            : `该物料在 BOM ${bom.bomId ?? "（无生效 BOM）"} 中**没有明细行** ⇒ 计量值 0`,
          fields: ["BOMDetail.quantity(单台用量)", "Material.unitPrice", "BOMDetail.lossRate", "BOMHeader.bomId"],
          bomId: bom.bomId,
        });
      }
      // 分母 = **整份 BOM 的成本合计**，不是图里现有入边之和（见 `normalizeInEdges` 注释）。
      const r = normalizeInEdges(rule.key, basis, normalize, measures, (targetId) => bomFor(targetId).total);
      weights[rule.key] = r.table;
      report.explain.push(...r.explain);
      done(edges.length, r.zeroPairs);
      continue;
    }

    if (basis === "source_qty_relative") {
      // ── 源实例数量**相对于同组均值**的倍率（均值=1、Σ=N ⇒ 保总量）──────────────
      // 用于**广延**型目标（`Model.demandLoad`「需求负载」）：单越多负荷越大这个信号必须留着，
      // 而大单要比小单权重高。用 Σ=1 会把 83 张单塌缩成一张的平均 —— 那是把负载改成了均值。
      const sources = await byType(rule.sourceTypeKey);
      const qtyOf = new Map(sources.map((o) => [o.id, num(o.props.qty)]));
      const measures = new Map<string, Measure[]>();
      for (const e of edges) {
        const q = Math.max(0, qtyOf.get(e.fromId) ?? 0); // 负数量不是权重，按 0 计（不翻转方向）
        (measures.get(e.toId) ?? measures.set(e.toId, []).get(e.toId)!).push({
          sourceId: e.fromId, measure: q,
          formula: `源数量 qty ${q}`,
          fields: [`${rule.sourceTypeKey}.qty`],
          bomId: null,
        });
      }
      const r = normalizeInEdges(rule.key, basis, normalize, measures, (_t, rows) => rows.reduce((s, x) => s + x.measure, 0));
      weights[rule.key] = r.table;
      report.explain.push(...r.explain);
      done(edges.length, r.zeroPairs);
      continue;
    }

    if (basis === "source_value_relative") {
      // ── 源实例**金额**相对于**全域基数**的倍率（WO-EDGE-MONEY-WEIGHT）───────────────
      //
      // 病灶（修前实测·真后端 SEED_DEMO=1·seed 42·三元正极 +15%·tick×4）：
      // `Order→Customer` 应收边 `weightRef: null` ⇒ 每张单落同一个额 ⇒ 客户读数按**条数**走。
      // 东风(10.02亿/4单) · 深蓝(8.32亿/7单) · 上汽通用五菱(7.19亿/7单) · 零跑(5.78亿/8单)
      // **四家拿到逐字节相同的 15.137334**。按它排「先催谁的款」= 按单数排。
      //
      // ⚠ **分母是全域基数，不是承载集** —— 这一行是本口径的全部要害。
      // 拿该客户名下那几张单的均值当分母，金额会被组内归一**约掉**，Σ权重恒等于条数，
      // 读数逐字节退回修前，却挂着"已按金额分摊"的名义（最难查的那种假绿）。
      // 判据同 `bom_cost_share` 拿整份 BOM 当分母那一条，逐字相同。
      const sources = await byType(rule.sourceTypeKey);
      /**
       * 一个源实例的金额。**优先读已物化的派生属性 `value`**（`Order.value`，本仓 500/500 都有），
       * 拿不到才回落 `qty × unitPrice` —— 与 `solvers/finance-world.ts` 的 `orderValue`
       * 及 `solvers/service.ts` 的 `orderValueYuan` **同一个式子**，不另起第二套金额口径。
       */
      const valueOf = (o: ObjectInstance): { v: number; how: string; fields: string[] } => {
        const direct = num(o.props.value);
        if (direct > 0) return { v: direct, how: `金额 value ${direct}`, fields: [`${rule.sourceTypeKey}.value`] };
        const q = num(o.props.qty), p = num(o.props.unitPrice);
        return {
          v: Math.max(0, q * p), // 负金额不是权重，按 0 计（不翻转方向）——与 source_qty_relative 同一条
          how: `数量 ${q} × 单价 ${p}`,
          fields: [`${rule.sourceTypeKey}.qty`, `${rule.sourceTypeKey}.unitPrice`],
        };
      };
      // 全域基数 = 本租户该类型**全部**实例（不只是图里有边的那些）的金额均值。
      // 用全部实例而不是 `edges` 的源：范围裁剪（LOCAL）时分母也不该跟着缩，
      // 否则「只推演这块」会把权重整体放大，局部与全域的读数不再可比。
      const totalValue = sources.reduce((s, o) => s + valueOf(o).v, 0);
      if (sources.length === 0 || totalValue <= 0) {
        fail(
          `本租户 ${rule.sourceTypeKey} ${sources.length} 个实例 / 金额合计 ${totalValue} ⇒ 算不出全域金额基数。` +
            `本条流不传导——退回「逐目标同额」等于挂着"已按金额分摊"的名义跑修前的按条数口径。`,
        );
        continue;
      }
      const globalMean = totalValue / sources.length;
      const valueById = new Map(sources.map((o) => [o.id, valueOf(o)]));
      const measures = new Map<string, Measure[]>();
      for (const e of edges) {
        const v = valueById.get(e.fromId);
        (measures.get(e.toId) ?? measures.set(e.toId, []).get(e.toId)!).push({
          sourceId: e.fromId,
          // 源实例不在对象库里（链路指向已删/未物化对象）⇒ 金额 0（算得出来的真值），不报缺。
          measure: v?.v ?? 0,
          formula: v ? v.how : `源实例不在对象库中 ⇒ 金额 0`,
          fields: v?.fields ?? [`${rule.sourceTypeKey}.value`],
          bomId: null,
        });
      }
      // 分母恒为**全域均值**，与 targetId / 该组条数都无关 —— 这正是"跨目标可比"的来源。
      const r = normalizeInEdges(rule.key, basis, normalize, measures, () => globalMean);
      weights[rule.key] = r.table;
      report.explain.push(...r.explain);
      done(edges.length, r.zeroPairs);
      continue;
    }
    if (basis === "actor_exposure_relative") {
      // ── 交易对手的**在手订单金额敞口**相对于本规则源池均值的倍率（WO-ADVERSARY-REACTION）──
      //
      // 用于**对抗方还手**：`Customer --customer_places_order--> Order` 是 **1:N 扇出**，
      // 每张订单只有一个客户入边 ⇒ 组内归一（`IN_EDGES` / `IN_EDGES_MEAN`）**恒等于 1**，
      // 权重整个失效。这正是「东风(10.02亿) 与 零跑(2.39亿) 同为 4 单、压力逐字节相同」的结构性根因
      // （判据表见契约 `SOURCE_POOL_MEAN` 上方那段）。故分母换成**跨 target 的源池均值**。
      //
      // 🔴 敞口**就从本规则自己的边上算**（Σ over 该客户名下订单），不另开一条取数路：
      //    权重与传导走同一批边 ⇒ 不可能出现「按 A 组边分摊、沿 B 组边传导」的错位。
      // 🔴 金额口径取 `qty × unitPrice`，与 `solvers/finance-world.ts` 的 `orderValue` **同一支**
      //    （那里是聚合权重的既有单源）。另立一个"订单金额"的算法就是第二套真相源。
      const targets = await byType(rule.targetTypeKey);
      const valueOf = new Map(targets.map((o) => [o.id, Math.max(0, num(o.props.qty) * num(o.props.unitPrice))]));
      /** 源实例 id → 其在手金额敞口（Σ 名下目标实例的 qty×unitPrice）。 */
      const exposure = new Map<string, number>();
      for (const e of edges) exposure.set(e.fromId, (exposure.get(e.fromId) ?? 0) + (valueOf.get(e.toId) ?? 0));
      // 源池均值：分母只统计**本规则真的有边的那些源**（没有在手订单的客户不进池，
      // 否则一批零敞口的客户会把均值压低、凭空放大所有人的还手力度）。
      const pool = [...exposure.keys()].sort((a, b) => a.localeCompare(b));
      const totalExposure = pool.reduce((s, k) => s + (exposure.get(k) ?? 0), 0);
      const meanExposure = pool.length > 0 ? totalExposure / pool.length : 0;
      if (!(meanExposure > 0)) {
        fail(
          `本规则源池 ${pool.length} 个 ${rule.sourceTypeKey} 的在手金额敞口合计为 ${totalExposure} ⇒ 算不出相对倍率。` +
            `本条流不传导——退回「逐目标同额」等于让所有对手方还手力度一样，正是本口径要治的那个错行为。`,
        );
        continue;
      }
      const table: Record<string, number> = {};
      let zeroPairs = 0;
      // R6：按 (源 id, 目标 id) 升序写入 —— 浮点除法与序无关，但键序会被逐字节快照咬到。
      for (const e of [...edges].sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId))) {
        const exp = exposure.get(e.fromId) ?? 0;
        const w = exp / meanExposure;
        if (w === 0) zeroPairs += 1;
        table[pairWeightKey(e.fromId, e.toId)] = w;
        report.explain.push({
          ruleKey: rule.key, basis, sourceObjectId: e.fromId, targetObjectId: e.toId,
          weight: w, numerator: exp, denominator: meanExposure, normalize,
          formula:
            `在手敞口 Σ(qty × unitPrice) = ${exp} ；权重 = ${exp} ÷ ${meanExposure} = ${w}` +
            `（分母是**源池均值** ${totalExposure} ÷ ${pool.length} —— 均值=1、无量纲，` +
            `保住不同对手方之间的**绝对金额比**；组内归一在 1:N 扇出上恒为 1、度量不了这件事）`,
          fields: [`${rule.targetTypeKey}.qty`, `${rule.targetTypeKey}.unitPrice`],
          bomId: null,
        });
      }
      weights[rule.key] = table;
      done(edges.length, zeroPairs);
      continue;
    }

    // 在册但本模块没实现 ⇒ 诚实报缺（而不是悄悄按某个"差不多"的口径算）。
    // 这一支是**登记册与实现之间的接缝守卫**：往契约里加一个口径却忘了在这里实现，
    // 引擎会当场报缺，而不是给出一批看着合理的错数。
    fail(`口径「${basis}」已登记但 DataCore 侧尚未实现算法 ⇒ 算不出权重`);
  }

  return { weights, report };
}
