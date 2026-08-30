/**
 * ══ WO-SIM-RAIL-FORMS · 左栏扰动子页的**纯模型**（组件只渲染，不做业务判断）════════
 *
 * 三张单里的第 ③：左栏那一批「下拉逐级收窄 → 选量 → 定幅度与时长 → 施加」的子页。
 * 本文件是它的模型层：**一个 `if` 里都没有行业名词，一张手抄对照表都没有。**
 *
 * ══ 开工前实测的四条前提（铁律 0.5：派单给的是线索不是结论）══════════════════════
 *
 * ① **子页不能按「物料/订单/设备/需求/产能/财务」六个名字硬分**（派单原文照 UX 稿要六个子页）
 *    · 今天的行为是 X：分片的**唯一依据**已经在数据里 —— `PropagationRule.domainKey` /
 *      `domainName`（`packages/contracts/src/sim.ts:108`，由 `seed.ts resolveRuleDomain` 现算后随边下发），
 *      而本体 §8 的 `G-GATE-ROSTER-HANDCOPIED` 明文禁止前端存任何「规则→域」对照表
 *      （`views/sim/edgeActiveModel.ts:110` 原话：「手抄名单里没有的规则**永远绿、永远漏**」）。
 *    · 而且那六个名字**今天分不动这批边**（2026-08-26 现算 `apps/datacore/src/seed.ts`，
 *      脚本见报告）：42 条边落在 D03/D04/D05/D06/D07/D08/D09/D10/D11 **九个**域 + 未归域，
 *      「需求」要同时吃 D03(demandPressure·Order) 与 D04(demandLoad·Model)，而 D03 又正是「订单」；
 *      「物料」的头号杠杆 `procurementDelay` 三条边的 target 是 `Material`，
 *      而 `Material` **不是任何流程的承载物** ⇒ 落在**未归域**，六片里一片都装不下它。
 *    · 应该是 Y：**子页 = 后端下发的域分片**，页签名字直取 `domainName`（人话名后端已给），
 *      `domainKey === null` 单列「未归域」并说明原因 —— 与 `edgeActiveModel.buildDomainSlices`
 *      同一条纪律、同一套措辞常量（本文件直接 import 那三个常量，不另写一份）。
 *      于是新增一条边、换一个行业、改一次域归属，屏上跟着变，**前端一行不动**。
 *
 * ② **层级不许前端算** · 今天的行为是 X：后端 `sim/drill-scan.ts:290 layerOfStateVars` 按入度/出度
 *    现算，经 `GET /a/v1/sim/drill/state-var-layers` 下发；`views/sim/DrillPanel.tsx:125`
 *    白纸黑字写着「前端再算一份，度数口径一漂两边就各说各话」。
 *    · 应该是 Y：**根源集合整个取自那份回包**（`layer === "根源"`），本文件零度数计算。
 *    · 这条今天就有活证据：UX 稿把 `demandPressure` 画成「根源」，而 `1e596eda`
 *      并线 `forecastBias → demandPressure` 之后它**已经掉成枢纽**。写死名单的那一版今天就是错的。
 *
 * ③ **`forecastBias` 已经并线了**（派单说「这条前提比我上一版新，先实测确认」）
 *    · 今天的行为是 X：`apps/datacore/src/seed.ts:1143` 有 `sourceStateVar: "forecastBias"` 的真边，
 *      `synthetic/battery.ts:2414` 有中文名「销售预测偏差（正=高估）」——**方向写进了名字里**。
 *      它没有任何入边 ⇒ 层级回包里是**根源**。
 *    · 应该是 Y：需求这一片的下拉里它**自动**排在根源组，前端不需要认识这个名字。
 *      屏上那句「正=高估」也是后端给的名字自带的，前端不补方向说明（补了就是第二套口径）。
 *
 * ④ **OEE 那批量今天扰不动，且这件事可以被机器盯住**
 *    · 今天的行为是 X：`oee_current`/`oeeP`/`oeeQ` 只是 `Equipment` 的**对象属性**
 *      （`synthetic/battery.ts:1088`），而引擎 `propagateTick(graph, state, rules, …)`
 *      （`sim/propagation.ts:442`）只读 `TickState`；`apps/datacore/src/sim/` 全目录 `oee` 零命中，
 *      42 条传导规则里也一条都不提它 ⇒ 选了它、POST 成功、下游一动不动（本仓点名的「静默错答」）。
 *    · 应该是 Y：**列出来、标明原因、不可选、提交前拦住**。
 *    · ⚠ 名单**不是手写的**（手写的名单会过期）：取 `CAPACITY_FACTOR_BINDINGS`（契约单源 20 条）
 *      与后端 `SandboxViewConfig.stateVars` 的**差集** —— 哪天谁把 `oee_current` 真接进传导图，
 *      它自动从「扰不动」里消失、变成可选项，**没有人需要记得回来改这里**（铁律 0.6：机器先说话）。
 *    · 🔴 **这个差集今天是 20/20，不是 3/20**（2026-08-26 现算，脚本 `scratchpad/wo-sim-rail-forms/blocked.mjs`；
 *      金丝雀：册长 20、状态变量 40，两者非 0 ⇒ 工具是好的）。派单只点名了 OEE 四个字段，
 *      而实测**整本 20 条产能因子册一条都不在世界态里** —— `ctSeconds`/`channels`/`utilization`/
 *      `yield_baseline`/`onHand`/`leadTime`/`qty` … 全是对象属性。
 *      这就是为什么本栏的**可选集取自传导图的 40 个状态变量**、而不是取自那本因子册：
 *      照册子渲染下拉，20 个选项个个都是「选了、请求成功、下游一动不动」。
 *      册子只出现在「今天扰不动」那一节里，带原因，不可提交。
 *
 * ══ 取数口（五条，全部既有，本单一个新端点都没造）═════════════════════════════════
 *   `fetchSimViewConfig`       → `stateVars`（可扰全集判据）· `stateVarNames`（中文名）· `nodeObjectIds`（落点）
 *   `fetchDrillStateVarLayers` → 层级（根源/枢纽/末端，后端现算）
 *   `fetchPropagationRules`    → `domainKey`/`domainName`（分片唯一依据）+ 变量挂在哪些对象类型上
 *   `fetchSimPerturbations`    → 已施加清单（收起态摘要）
 *   `createSimPerturbation`    → 写口（契约 `PerturbationSchema`）
 *
 * ⚠ 落点对象 id 取 `SandboxViewConfig.nodeObjectIds` 而**不是** `GET /a/v1/objects`：
 *   契约注释（`sim.ts:1012`）写明它「= tick 引擎 idsByType 同源（`repos.objects.listByType` 非
 *   `mergedInto`，稳定排序）」。写口要的是**引擎给世界态编键的那个 id** —— 从别的口径取一个
 *   长得像 id 的串，POST 会成功而世界不动，正是上面那条「静默错答」的另一个形态。
 *
 * ══ WO-SIM-TICK-GATE（2026-08-29）· 起始拍：把「静默不生效」改成「说得出为什么」════════
 *
 * ── 今天的行为是 X ────────────────────────────────────────────────────────────
 * 表单的起始拍**写死默认 `0`**，而种子世界建好时就已经在**第 3 拍**。
 * 于是默认那一发（起始拍 `0` + 持续拍数留空）POST 回 201、`appliedPerturbations` 里
 * **还带着它的 id**，而**本控制台卡墙上的数一个都不动** —— 实测与「一条扰动都不建」
 * **逐字节相同**（见下表第 `0 × null` 行）。
 *
 * 机制（实测追到底，不是从注释读来的）：卡墙读的是 `GET …/metric-series`，那条路
 * **从 tick0 回放整条世界线**（`apps/datacore/src/sim/metric-series.ts` 的 `replayWorldLine`），
 * 回放的第一格产出的是 `producedTick = 1`；而落地判据是
 * `entersAt(p, t) = active(p,t) && !active(p,t-1)`，等价于 `p.startTick === t`。
 * ⇒ `startTick === 0` 这一格**在回放窗口里根本不存在**，`entersAt` 永远为假，
 * 这条扰动在**卡墙**的口径里永不落地。
 *
 * ══ 实测取值域 · **二维**（起始拍 × 持续拍数），两条真相源分列 ═════════════════════
 *
 * ⚠ **2026-08-30 第三次实测·本表由一维扩成二维，并订正一处结论**。前一版只跑了
 *    起始拍一个维度，把 `0` 一栏写成「**彻底不生效**」—— **这半句是错的**：
 *    `0 × 持续拍数=null`（正是 UI 的默认组合）在**落盘世界线上当场就写**了
 *    （`3140.29 → 99999`），只是**卡墙不动**。两条真相源在同一个取值上给相反的答案，
 *    比「哪儿都不动」更危险 —— 而一维表把这件事整个盖住了。
 *    形态：**「我用『卡墙没动』当作『这条扰动没生效』的证据，而前者并不度量后者。」**
 *
 * 取证条件（每一格可复现）：真后端 `SEED_DEMO=1`、种子世界 `sims_demo_seed_world`
 * （`curTick = 3`）、**每个取值重启一次 datacore**（内存模式 ⇒ 世界字节级一致）、
 * 落点 `obj_model_4680-NCM.supplyRisk`、`mode:"set"` 幅度 `99999`、
 * 施加后 `POST …/tick {n:1}`（推到第 4 拍）。两列读数：
 *  · **落盘** = `GET …/world` 的 `state`（`views/sim/SandboxView` 与 `console/SandboxDetailRoute` 读这一份）
 *  · **卡墙** = `GET …/metric-series` 回放线**落点那一格**的末格 `actual`（本控制台读这一份）
 * 参照系：**一条扰动都不建**时 落盘 `6057.75` · 卡墙 `6057.75`（种子世界自带一条种子扰动，
 * 故卡墙 `actual − baseline` 恒有 `+280` 的底噪；「我这一发没生效」⇔ 读数落回这两个数）。
 *
 *   | 起始拍 | 持续拍数 | POST | 落盘@4      | 卡墙@4      | 判定 |
 *   |--------|----------|------|-------------|-------------|------|
 *   | −1     | null / 2 | **400** VALIDATION_ERROR（契约 `int().min(0)`） | 6057.75 | 6057.75 | 契约拦住 |
 *   | **0**  | **null** | 201  | **99999→102916.46** | **6057.75** | 🔴 **两源相反**：落盘涨 17 倍，卡墙纹丝不动 |
 *   | **0**  | **2**    | 201  | 6057.75     | **5807.15** | 🔴 **静默失效 ＋ 卡墙比参照还低**（未落地却被"到期回退"倒扣） |
 *   | 2      | null     | 201  | 102916.46   | 105756.15   | ⚠ 生效，但两源**对不上**（gap −2839.69） |
 *   | 2      | 2        | 201  | **3218.06** | **3218.06** | 🔴 **比参照低一半**（同一发倒扣，两源一致地错） |
 *   | 3(=cur)| null / 2 | 201  | 102916.46   | 104835.51   | ⚠ 生效，但两源**对不上**（gap −1919.05） |
 *   | **4(=cur+1)** | **null / 2** | 201 | **102916.46** | **102916.46** | ✅ **唯一两源相等（gap = 0）的取值** |
 *   | 6      | null / 2 | 201  | 6057.75     | 6057.75     | 入库但本次推不到 ⇒ 屏上与"没生效"同形 ⇒ **靠回执说清** |
 *   | 不发该字段 | —    | 201  | 与 `3` 同   | 与 `3` 同   | 后端默认 `body.startTick ?? s.curTick` = 3 |
 *
 * **读表的结论**：全部病态行的判据是同一个 —— **起始拍 < 当前拍**。
 * 三种病态各不相同、修法却相同（拦住）：① `0×null` 两源相反；② `0×2` 静默失效；
 * ③ `2×2` 未落地却被回退倒扣，读数比"什么都不做"还低。
 * ⇒ `startTickPhaseOf(...) === "past"` 一律拦，是**一条判据盖住三种病**，不是三条特例。
 *
 * ── 为什么默认取 `cur+1` 而不是派单书写的 `cur`：**派单自己的验收式只在 cur+1 成立** ──
 * 派单要求「Δ shortageRisk = Δ supplyRisk × 0.8，误差应为 0」。全精度实测
 * （卡墙口径，代表格两档同为 `obj_order_SO-3391.shortageRisk`，故比值有意义）：
 *   · `startTick = 4 (=cur+1)`：Δ supplyRisk **96,858.71** · Δ shortageRisk **77,486.968**
 *     ⇒ `Δ×0.8 = 77,486.968`，**误差 0，比值恰好 0.8** ✅
 *   · `startTick = 3 (=cur)`  ：Δ supplyRisk 98,777.76 · Δ shortageRisk 158,044.416
 *     ⇒ 比值 **1.6 = 0.8 × 2**（扰动多传导了一拍）❌ 不满足验收式
 * ⇒ 措辞与读数冲突时**以读数为准**（读数是实测，措辞是转述）。改回 `curTick` 只需改
 *   `defaultStartTick` 一行，全仓没有第二处算它 —— 但那会让派单自己的验收判据当场变红。
 *
 * ⚠ **本表两次被自己的工具骗过，故取证脚本必须先跑金丝雀**（铁律 0.6）：
 *  ① `kind` 写成 `"SUPPLY_SHOCK"`（契约取值域是小写 snake_case）⇒ 13 个 case **全部 400**，
 *     而世界读数当然一动不动 —— 差一点读成「起始拍怎么填都没用」。
 *  ② `metric-series` 回包的数组叫 **`metrics`** 不是 `items` ⇒ 卡墙那一列整列读成 0 条。
 *     报「卡墙没动」之前必须先证明卡墙**有数**（本表的参照系行就是那个金丝雀）。
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 *  ① 默认 = **下一拍**（`curTick + 1`）：唯一「两条真相源一致」的取值，
 *     且按钮上写的是「施加**并推演**」—— 推的正是这一拍，默认值与按钮的承诺对齐。
 *  ② **过去的拍一律拦住**（含 `0`）：`0` 是彻底不生效，`1..curTick-1` 是改写历史 ⇒
 *     指标时序按「它从第 1 拍就在」回放，而已落盘的世界线里那几拍根本没有它。
 *  ③ **不知道当前拍时不许发**（`CUR_TICK_UNKNOWN`）：沿用本文件已有的三态纪律 ——
 *     「我没查到」和「它不存在」是两个命题，不许拿 `0` 当兜底（`0` 恰恰就是那个静默坑）。
 *  ④ **未来的拍照样允许**（PRD §2.2② 的「第 5 天开始停机 72h」是真需求），
 *     但施加后必须给回执说清「本次推到第 M 拍，还没轮到它」。
 */
import { CAPACITY_FACTOR_BINDINGS, type PerturbationKind, type PropagationRule } from "@platform/contracts";
import { stateVarLabel, type StateVarLabel } from "../../stateVarLabel";
import {
  UNASSIGNED_DOMAIN_DETAIL,
  UNASSIGNED_DOMAIN_LABEL,
  UNASSIGNED_SLICE_ID,
} from "../../edgeActiveModel";

export { UNASSIGNED_DOMAIN_DETAIL, UNASSIGNED_DOMAIN_LABEL, UNASSIGNED_SLICE_ID };

/** 后端 `GET /a/v1/sim/drill/state-var-layers` 的一行（`api/endpoints.ts:838` 的回包元素）。 */
export interface StateVarLayerRow {
  readonly stateVar: string;
  readonly layer: string;
  readonly label: string;
}

/**
 * 后端层级回包里「根源」那一档的字面值。
 *
 * ⚠ 这不是前端定义的分类，是**后端 `DrillLayer` 枚举的三个字面值之一**
 * （`apps/datacore/src/sim/drill-scan.ts:276` `type DrillLayer = "根源" | "枢纽" | "末端"`）。
 * 契约包里没有这个枚举（层级是端点回包上的自由串），所以这里只能对字面值做**相等比较** ——
 * 但比较的对象是**回包里的值**，不是前端另存的一份名单：后端把「根源」改叫别的，
 * 这里一个都匹配不上 ⇒ 根源组当场空掉、屏上立刻看得见，而不是安静地给出旧答案。
 */
export const ROOT_LAYER = "根源";

/** 非根源那两档（枢纽/末端）在屏上的统一说明 —— 仓主要的那句话。 */
export const DOWNSTREAM_NOTE = "扰它等于从半路插入：这个量的上游那一段不会跟着动，读数只反映从这里往下的传导。";

/** 一个可扰的状态变量（下拉里的一项）。 */
export interface RailVarOption {
  readonly stateVar: string;
  /** 屏上标签：中文业务名，或**回落时的裸键本身**（`stateVarLabel` 的诚实位一并带出）。 */
  readonly label: StateVarLabel;
  /** 后端下发的层级；`null` = 层级回包里没有这一条（「不在传导图里」≠「是末端」，不合并）。 */
  readonly layer: string | null;
  /** 是否根源（**判据只有一个：回包里的 layer 等不等于「根源」**）。 */
  readonly isRoot: boolean;
  /** 本分片里承载这个变量的对象类型（去重全序）—— 落点对象的第一级下拉。 */
  readonly typeKeys: readonly string[];
}

/**
 * 这个量今天到底扰不扰得动 —— 三态，**不许合并成一个布尔**。
 *
 * 合并了就分不出「它不在世界态里」（真扰不动，得后端补一张单）与
 * 「我还不知道它在不在」（view-config 这一跳没回来），而这两件事的处置完全相反：
 * 前者要拦、要说明原因；后者只是还没到，拦是对的但**不能说成"这个量扰不动"**。
 */
export type LivenessState = "live" | "not-in-world-state" | "unknown";

/** 一个子页 = 一个业务域分片。 */
export interface RailSubpage {
  /** 选中态与 testid 用的稳定串（`domainKey` 或 `__unassigned__`）—— 同 `DomainSliceVM.sliceId` 的理由。 */
  readonly sliceId: string;
  readonly domainKey: string | null;
  /** 页签名：**后端下发的 `domainName`**；缺名显 key 原文；未归域用平台自有措辞。 */
  readonly name: string;
  /** 未归域那一片的说明（屏上真渲染）；业务域片为 `null`。 */
  readonly detail: string | null;
  /** 本片的边数（恒等于产出它的那批规则条数，不另存一个数）。 */
  readonly ruleCount: number;
  /** 根源档（排前、默认可选）。 */
  readonly roots: readonly RailVarOption[];
  /** 枢纽 + 末端（折起，带 `DOWNSTREAM_NOTE`）。 */
  readonly downstream: readonly RailVarOption[];
}

/**
 * 传导规则 → 子页（**只做 `groupBy`，一个业务判断都不做**）。
 *
 * 分组依据只有 `rule.domainKey` 一个，与 `edgeActiveModel.buildDomainSlices` 逐字同源。
 * 排序（R6 全序·同输入同屏）：域 key 升序，**未归域恒垫底**（它不是一个业务域）。
 *
 * 变量在片内的归属：一条边把 `sourceStateVar` 与 `targetStateVar` **两端**都算进本片 ——
 * 只算 target 会把六个根源量（`deliveryDelay`/`equipmentFailure`/`forecastBias`/`orderChurn`/
 * `priceShock`/`procurementDelay`，2026-08-26 现算）**整批漏掉**：它们按定义永不作 target，
 * 而它们恰恰是「根源优先」要优先的那一批。
 */
export function buildSubpages(
  rules: readonly PropagationRule[],
  layers: readonly StateVarLayerRow[] | null,
  stateVarNames?: Readonly<Record<string, string>>,
): RailSubpage[] {
  const layerOf = new Map<string, string>((layers ?? []).map((r) => [r.stateVar, r.layer] as const));

  interface Acc {
    domainKey: string | null;
    name: string;
    ruleCount: number;
    /** stateVar → 承载它的对象类型集合。 */
    types: Map<string, Set<string>>;
  }
  const bySlice = new Map<string, Acc>();
  const touch = (sliceId: string, domainKey: string | null, name: string): Acc => {
    const cur = bySlice.get(sliceId);
    if (cur !== undefined) return cur;
    const next: Acc = { domainKey, name, ruleCount: 0, types: new Map() };
    bySlice.set(sliceId, next);
    return next;
  };

  for (const r of rules) {
    const dk = r.domainKey ?? null;
    const sliceId = dk ?? UNASSIGNED_SLICE_ID;
    // 名字取这条边自带的那个；缺名就显 key 原文，**不编一个中文名**（诚实缺席）。
    const acc = touch(sliceId, dk, dk === null ? UNASSIGNED_DOMAIN_LABEL : (r.domainName ?? dk));
    acc.ruleCount += 1;
    for (const [sv, tk] of [
      [r.sourceStateVar, r.sourceTypeKey] as const,
      [r.targetStateVar, r.targetTypeKey] as const,
    ]) {
      const set = acc.types.get(sv);
      if (set === undefined) acc.types.set(sv, new Set([tk]));
      else set.add(tk);
    }
  }

  const toOption = (sv: string, types: Set<string>): RailVarOption => {
    const layer = layerOf.get(sv) ?? null;
    return {
      stateVar: sv,
      label: stateVarLabel(sv, stateVarNames),
      layer,
      isRoot: layer === ROOT_LAYER,
      typeKeys: [...types].sort((a, b) => a.localeCompare(b)),
    };
  };

  const pages: RailSubpage[] = [];
  for (const [sliceId, acc] of bySlice) {
    const opts = [...acc.types.entries()]
      .map(([sv, types]) => toOption(sv, types))
      .sort((a, b) => a.stateVar.localeCompare(b.stateVar));
    pages.push({
      sliceId,
      domainKey: acc.domainKey,
      name: acc.name,
      detail: acc.domainKey === null ? UNASSIGNED_DOMAIN_DETAIL : null,
      ruleCount: acc.ruleCount,
      roots: opts.filter((o) => o.isRoot),
      downstream: opts.filter((o) => !o.isRoot),
    });
  }
  return pages.sort((a, b) => {
    if (a.domainKey === null) return b.domainKey === null ? 0 : 1;
    if (b.domainKey === null) return -1;
    return a.sliceId.localeCompare(b.sliceId);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 「今天扰不动」的量 —— 名单由差集现算，不是手写的
// ══════════════════════════════════════════════════════════════════════════════

/** 一条今天扰不动的量（屏上要标明**是什么**与**为什么**）。 */
export interface BlockedFactor {
  /** `Equipment.oee_current` 这种两段串 —— 屏上第二级 mono 行与 testid 用。 */
  readonly key: string;
  readonly objectType: string;
  readonly prop: string;
  /** 因子名。取自契约单源 `CAPACITY_FACTOR_BINDINGS[].factorName`，**前端不内联中文名**。 */
  readonly factorName: string;
  /** 机器可读的缺席原因码（屏上 `data-` 记号；文案由 `BLOCKED_REASON_TEXT` 给）。 */
  readonly reason: "NOT_A_STATE_VAR";
}

/**
 * 缺席原因的**唯一**文案（组件不拼字符串）。
 * 一句话说清三件事：它是什么、引擎为什么读不到、要扰得先做什么。
 */
export const BLOCKED_REASON_TEXT =
  "这些量只登记在对象属性上，没有进入推演世界态（world.state），" +
  "而传导引擎 propagateTick 只读世界态 —— 放进下拉就会变成「选了、请求成功、下游一动不动」。" +
  "要扰它，得先由后端把这个属性投进状态层，不是在这里补一个兜底。";

/**
 * 「今天扰不动」的名单 = 契约因子册 **差** 后端下发的状态变量全集。
 *
 * ⛔ 不许改成手写数组：手写的名单在别人把某个属性接进传导图之后**不会自己失效**，
 * 屏上会一直挂着一句已经不成立的「扰不动」（本仓治过的「手抄名单永远绿、永远漏」的镜像形态）。
 * 差集写法让这件事**自动**发生：`stateVars` 里出现了它 ⇒ 它当场从本名单消失。
 */
export function buildBlockedFactors(stateVars: readonly string[]): BlockedFactor[] {
  const live = new Set(stateVars);
  return CAPACITY_FACTOR_BINDINGS.filter((b) => !live.has(b.prop))
    .map((b) => ({
      key: `${b.objectType}.${b.prop}`,
      objectType: b.objectType,
      prop: b.prop,
      factorName: b.factorName,
      reason: "NOT_A_STATE_VAR" as const,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 落点对象 —— 缺格必须**说得出为什么缺**，不许补一个假 id
// ══════════════════════════════════════════════════════════════════════════════

export interface ObjectChoice {
  readonly ids: readonly string[];
  /** `null` = 真有对象；非 `null` = 诚实缺席的原因（屏上原样渲染）。 */
  readonly absenceReason: string | null;
}

/**
 * 某个对象类型今天有哪些实例可作落点。
 *
 * 三种「没有」**分开报**（合并成一句"暂无数据"，用户与下一个 dev 都会走错方向）：
 *  · 回包压根没带这个字段（老响应/未接该投影）；
 *  · 带了字段但这个类型不在里面（本体里没有这个类型）；
 *  · 类型在、列表是空的（这个世界里一个实例都没物化）。
 */
export function objectChoices(
  nodeObjectIds: Readonly<Record<string, readonly string[]>> | undefined,
  typeKey: string | null,
): ObjectChoice {
  if (typeKey === null) return { ids: [], absenceReason: "还没选落点对象类型" };
  if (nodeObjectIds === undefined) {
    return { ids: [], absenceReason: "本次 view-config 回包没有带 nodeObjectIds —— 不知道有哪些实例（不是没有实例）" };
  }
  const ids = nodeObjectIds[typeKey];
  if (ids === undefined) {
    return { ids: [], absenceReason: `回包的 nodeObjectIds 里没有 ${typeKey} 这个类型 —— 本体里它没有物化实例清单` };
  }
  if (ids.length === 0) {
    return { ids: [], absenceReason: `${typeKey} 在这个世界里一个实例都没有物化 —— 没有可落点的对象（不是取不到）` };
  }
  return { ids, absenceReason: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 写口载荷 —— 形状由契约定，缺一个必填字段就不许发出去
// ══════════════════════════════════════════════════════════════════════════════

/** 表单当前的草稿（组件的受控状态；一个字段都不许在提交时"顺手补默认值"）。 */
export interface PerturbDraft {
  readonly kind: PerturbationKind;
  readonly targetObjectId: string;
  readonly targetStateVar: string;
  readonly magnitude: number;
  readonly mode: "set" | "delta" | "scale";
  readonly startTick: number;
  /** `null` = 永久（契约 `durationTicks` 的 `null` 语义，等价于旧 `/act`）。 */
  readonly durationTicks: number | null;
}

/** `createSimPerturbation` 的 body —— 字段与契约 `PerturbationSchema` 的写入子集逐字对应。 */
export interface PerturbBody {
  readonly kind: PerturbationKind;
  readonly targetObjectId: string;
  readonly targetStateVar: string;
  readonly magnitude: number;
  readonly label: string;
  readonly startTick: number;
  readonly durationTicks: number | null;
  readonly mode: "set" | "delta" | "scale";
}

/**
 * 幅度的读法记号 —— **与 `PerturbationTimeline.magnitudeText` 同一套写法**：
 * 只写数字，读者分不清「加 10 / 乘 10 / 设成 10」，那是三个完全不同的世界。
 */
export function magnitudeText(mode: PerturbDraft["mode"], magnitude: number): string {
  if (mode === "scale") return `×${magnitude}`;
  if (mode === "set") return `=${magnitude}`;
  return magnitude >= 0 ? `+${magnitude}` : `−${Math.abs(magnitude)}`;
}

/** 时长的读法（`null` = 永久，契约语义原文）。 */
export function durationText(startTick: number, durationTicks: number | null): string {
  return durationTicks === null
    ? `第 ${startTick} 拍起 · 永久`
    : `第 ${startTick} 拍起 · 持续 ${durationTicks} 拍`;
}

/**
 * `label` 的**唯一**出处（契约必填，`max(200)`）。
 * 用**屏上那一串**拼（中文名或回落裸键），于是台账里读到的字与用户点的时候看到的字是同一串。
 */
export function buildPerturbationLabel(label: StateVarLabel, draft: PerturbDraft): string {
  return `${label.text} ${magnitudeText(draft.mode, draft.magnitude)} · ${durationText(draft.startTick, draft.durationTicks)}`.slice(
    0,
    200,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4.5 · 起始拍 —— 相对**当前拍**的四个档（判据见本文件头注的实测取值域表）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 世界现在在第几拍。`null` = 会话清单这一跳还没回来 / 失败了 ⇒ **「不知道」，不是「第 0 拍」**。
 * 合并成一个数（拿 `0` 兜底）正是本单要修的那个静默坑，所以这里必须是可空的。
 */
export type CurTick = number | null;

/**
 * 起始拍落在哪一档。**四档各有不同的屏上行为，不许合并**：
 *  · `past`   —— 已经产出过的拍。`0` 在这一档里（它是「彻底不生效」那一种）；
 *                 `1..curTick-1` 会让回放与已落盘的世界线各说各话。**提交时拦住**。
 *  · `now`    —— 正好是当前拍。后端「不填 startTick」的默认语义（「现在就发生」）。
 *  · `next`   —— 当前拍 +1。「施加并推演」这一次推的就是这一拍 ⇒ 默认值取这一档。
 *  · `future` —— 更远的将来。合法（PRD §2.2② 的「第 5 天开始停机 72h」），
 *                 但本次推演到不了它 ⇒ 施加后必须给回执说清还差几拍。
 */
export type StartTickPhase = "past" | "now" | "next" | "future";

export function startTickPhaseOf(startTick: number, curTick: number): StartTickPhase {
  if (startTick < curTick) return "past";
  if (startTick === curTick) return "now";
  if (startTick === curTick + 1) return "next";
  return "future";
}

/**
 * 表单里起始拍的**默认值** = 下一拍。
 *
 * 为什么不是 `0`（改前那一版）：`0` 在卡墙口径里**永远不落地**（回放从 `producedTick=1` 起）。
 *
 * 为什么不是 `curTick`：那一档屏上确实会动，但在 `mode: "set"` 口径下
 * **落盘世界线与回放在同一拍上给两个数**（2026-08-29 复核实测，幅度 99999：
 * `GET …/world` = 102916.46，`metric-series` 回放 = 104835.51，gap **−1919.05**）。
 * 这不是纸面顾虑 —— 两条真相源**在本仓都有屏在读**：`views/sim/SandboxView.tsx` 与
 * `views/sim/console/SandboxDetailRoute.tsx` 读 `simWorld`（落盘那一份），
 * 而本控制台的卡墙读 `metric-series`（回放那一份）⇒ 两个屏会各说各话。
 * `curTick + 1` 是实测取值域里**唯一**「会动 **且** 两条真相源一致（gap = 0）」的取值。
 *
 * ⚠ **这条理由带一个前提：mode。** `delta` 口径下 1/2/3/4 四档两源全部一致 ——
 * 拿 `delta` 去复验会验不出任何 gap，进而误判「这个修法没有依据」。
 * 完整实测表与订正过程见本文件头注「实测取值域 · 复核订正」。
 *
 * ⚠ 派单书把这条写成「默认取当前拍」，但**它自己给的两个验收读数
 * （`52,917.46` / `102,916.46`）本次原样复现，且都落在起始拍 = 4 这一档上，而那个世界
 * `curTick = 3`** —— 即验收数本身就是 `curTick + 1` 那一档的数；派单要求的
 * 「Δ shortageRisk = Δ supplyRisk × 0.8 误差 0」也**只有这一档满足**（`curTick` 那一档是 1.6）。
 * 两处对不上时以**读数**为准（读数是实测，措辞是转述）。
 * 真要改回 `curTick`，只改本函数一行即可，全仓没有第二处算它 —— 但那会让验收判据当场变红。
 */
export function defaultStartTick(curTick: number): number {
  return curTick + 1;
}

/**
 * 起始拍落在过去时的那句人话（屏上原样渲染；具体第几拍由组件在旁边显式打出来）。
 *
 * ⚠ 措辞纪律：这句是**给用户看的**，只讲「会看到什么」，不讲回放窗口 / 首次生效判据
 * 这类实现口径（R-UI-4）。三种坏法**分开写**，因为它们在屏上长得完全不一样 ——
 * 合成一句「填过去的拍不生效」会让第 ① 种（屏上真的动了，只是两屏不一致）读起来像没发生。
 * 三种坏法的实测读数见本文件头注的二维取值域表。
 */
export const START_TICK_PAST_TEXT =
  "起始拍落在已经推过的拍上 —— 这一档不许提交。实测三种坏法各不相同：" +
  "① 填 0 且持续拍数留空：这一屏的指标卡一个都不会动，而沙盘那一屏的读数会当场跳到你填的值 —— 两屏各说各话；" +
  "② 填 0 且填了持续拍数：两屏都不动，这一次等于白按；" +
  "③ 填一个更早、非 0 的拍：读数会比「什么都不做」还低 —— 这一拍的效果没落上去，到期回退却照扣了一次。" +
  "把起始拍改成当前拍或更晚，这三种都不会发生。";

/** 不能提交时的原因码（屏上 `data-` 记号 + 一句人话）。 */
export type BlockReason =
  | "NO_SESSION"
  | "NO_STATE_VAR"
  | "NO_TARGET_OBJECT"
  | "NOT_IN_WORLD_STATE"
  | "STATE_VARS_UNKNOWN"
  | "CUR_TICK_UNKNOWN"
  | "BAD_MAGNITUDE"
  | "BAD_START_TICK"
  | "START_TICK_PAST"
  | "BAD_DURATION";

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  NO_SESSION: "没有可推演的世界 —— 先选一个 RUNNING 会话",
  NO_STATE_VAR: "还没选要扰哪个量",
  NO_TARGET_OBJECT: "还没选落点对象（写口要的是引擎给世界态编键的那个对象 id）",
  NOT_IN_WORLD_STATE:
    "这个量今天扰不动：它不在这个世界的状态变量清单里（view-config.stateVars），" +
    "而传导引擎 propagateTick 只读世界态 —— 发出去会「请求成功、下游一动不动」。",
  STATE_VARS_UNKNOWN:
    "不知道这个量在不在世界态里 —— view-config 这一跳还没回来或失败了。" +
    "这不是「它扰不动」，是「现在判断不了」，所以先不发（不猜、不兜底）。",
  // 与 `STATE_VARS_UNKNOWN` 同一条纪律：不知道就说不知道，**绝不拿 `0` 当兜底** ——
  // `0` 恰恰是那个「POST 201、屏上一个数不动」的静默坑（见本文件头注 WO-SIM-TICK-GATE）。
  CUR_TICK_UNKNOWN:
    "还不知道这个世界现在在第几拍 —— 会话清单这一跳没回来或失败了。" +
    "起始拍要拿它当基准，所以现在先不发（猜一个 0 就是那个「请求成功、屏上不动」的坑）。",
  BAD_MAGNITUDE: "幅度必须是一个有限的数",
  // 契约 `PerturbationSchema.startTick` 是 `int().min(0)` —— 这里按契约拦，
  // 而不是让后端回一个 400 再把技术错误原样甩到屏上。
  BAD_START_TICK: "起始拍必须是 ≥ 0 的整数",
  START_TICK_PAST: START_TICK_PAST_TEXT,
  BAD_DURATION: "持续拍数必须 ≥ 1（要永久就留空）",
};

export type BuildResult =
  | { readonly ok: true; readonly body: PerturbBody }
  | { readonly ok: false; readonly reason: BlockReason };

/**
 * 一个量今天在不在这个世界的状态层里（**唯一判据：后端 `view-config.stateVars`**）。
 *
 * `liveStateVars === null` = 那一跳还没回来/失败了 ⇒ `"unknown"`，**不许读作 `"not-in-world-state"`**：
 * 「我没查到」和「它不存在」是两个命题（铁律 0.6 那句话），处置也不同 —— 见 `LivenessState`。
 */
export function livenessOf(stateVar: string, liveStateVars: ReadonlySet<string> | null): LivenessState {
  if (liveStateVars === null) return "unknown";
  return liveStateVars.has(stateVar) ? "live" : "not-in-world-state";
}

/**
 * 草稿 → 写口载荷。**校验在这里一次做完**，组件不许绕过它直接 POST。
 *
 * `liveStateVars` 就是 `SandboxViewConfig.stateVars`（后端按已发布传导规则的
 * `sourceStateVar ∪ targetStateVar` 派生的那一份）—— 于是「屏上标了扰不动」与
 * 「提交时真的拦住」用的是**同一个判据**，不会出现"标了但还是发得出去"这种半拉子诚实。
 *
 * ⚠ 为什么这道拦是必要的而不是多余的：规则清单取的是 `fetchPropagationRules(true)`
 * （含草稿，与外壳共用缓存键），而 `stateVars` 只由**已发布**规则派生。于是下拉里**可能**
 * 出现一个只活在草稿边上的量 —— 它在世界态里没有格子，POST 会 200 而世界一动不动。
 */
export function buildPerturbBody(
  draft: PerturbDraft,
  label: StateVarLabel,
  opts: {
    readonly hasSession: boolean;
    readonly liveStateVars: ReadonlySet<string> | null;
    /** 世界现在在第几拍。`null` = 还不知道 ⇒ `CUR_TICK_UNKNOWN`，**不许拿 `0` 兜底**。 */
    readonly curTick: CurTick;
  },
): BuildResult {
  if (!opts.hasSession) return { ok: false, reason: "NO_SESSION" };
  if (draft.targetStateVar === "") return { ok: false, reason: "NO_STATE_VAR" };
  const liveness = livenessOf(draft.targetStateVar, opts.liveStateVars);
  if (liveness === "unknown") return { ok: false, reason: "STATE_VARS_UNKNOWN" };
  if (liveness === "not-in-world-state") return { ok: false, reason: "NOT_IN_WORLD_STATE" };
  if (draft.targetObjectId === "") return { ok: false, reason: "NO_TARGET_OBJECT" };
  if (!Number.isFinite(draft.magnitude)) return { ok: false, reason: "BAD_MAGNITUDE" };
  if (!(Number.isInteger(draft.startTick) && draft.startTick >= 0)) return { ok: false, reason: "BAD_START_TICK" };
  // 起始拍要拿当前拍当基准 ⇒ 不知道当前拍就判断不了，先不发（同 `STATE_VARS_UNKNOWN` 那条纪律）。
  if (opts.curTick === null) return { ok: false, reason: "CUR_TICK_UNKNOWN" };
  if (startTickPhaseOf(draft.startTick, opts.curTick) === "past") return { ok: false, reason: "START_TICK_PAST" };
  if (draft.durationTicks !== null && !(Number.isInteger(draft.durationTicks) && draft.durationTicks >= 1)) {
    return { ok: false, reason: "BAD_DURATION" };
  }
  return {
    ok: true,
    body: {
      kind: draft.kind,
      targetObjectId: draft.targetObjectId,
      targetStateVar: draft.targetStateVar,
      magnitude: draft.magnitude,
      label: buildPerturbationLabel(label, draft),
      startTick: draft.startTick,
      durationTicks: draft.durationTicks,
      mode: draft.mode,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 施加回执 —— 「按下去之后到底发生了什么」（WO-SIM-TICK-GATE 缺陷 ③）
// ══════════════════════════════════════════════════════════════════════════════
//
// ── 今天的行为是 X ────────────────────────────────────────────────────────────
// 点完「施加并推演」，屏上唯一的变化是左栏「已施加」多一行。**生效没生效、生效在第几拍、
// 影响了几个格，一个字都没有。** 于是「引擎没读我的输入」与「这条扰动排在未来还没轮到它」
// 在屏上长得一模一样 —— 本轮就是靠这一点被判成「引擎是死的」。
//
// ── 应该是 Y ─────────────────────────────────────────────────────────────────
// 施加后给一条回执，三件事各自有出处、**不许合并**：
//  ① **落在第几拍**（`startTick` + 本次推到第几拍）—— 确定性，算得出来，不用等观测；
//  ② **真动了没有**（目标那一格 施加前 → 推完后；以及全世界变了几个格）—— 实测，
//     两个数分别来自 `GET …/world`（施加前）与 `POST …/tick`（推完后）的世界态；
//  ③ **没动就说为什么** —— 只列**这一次真命中的**原因，一条都不许编。
//
// ⚠ 为什么不拿 tick 回包的 `appliedPerturbations` 当「生效了」的判据（这条实测踩过）：
//   它是「本拍**处于生效期**的扰动 id」，不是「本拍**落地了**」。实测 `startTick: 0`
//   那条完全没落地，而它的 id **就在** `appliedPerturbations` 里
//   （真后端回包原文：`appliedPerturbations=["simpert_107813tr28chdeqe","sims_demo_seed_world_p0"]`，
//   同一次的卡墙读数与不施加任何扰动**逐字节相同**）——
//   拿它当判据会得出一个恰好相反的回执（形态：「我用 X 当作 Y 的证据，而 X 并不度量 Y」）。
//   判据只能落在**世界态真的变了没有**上。
//
// ⚠ 措辞红线：本仓已知有 10 类扰动在小幅度下读数为 0、其中 6 类**调大幅度就不再是 0**。
//   所以「没动」的原因里，「幅度可能偏小 ⇒ 调大再算一次」是**唯一有效的动作**，
//   文案只许把它写成一条可执行的建议，**不许**写成「调大多半也还是 0」这种劝退话。

/** 世界态的形状（`GET …/world` 与 `POST …/tick` 的 `state` 同一形状）。 */
export type WorldCells = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** 一格读数；`null` = 这个世界里没有这一格（**不是 0**）。 */
export function readCell(state: WorldCells | null, objectId: string, stateVar: string): number | null {
  if (state === null) return null;
  const v = state[objectId]?.[stateVar];
  return typeof v === "number" ? v : null;
}

/**
 * 两份世界态之间**读数不同的格子数**。
 *
 * `null` = 有一边压根没拿到 ⇒ **「没法比」，不许读作「0 个格子变了」**
 * （那正是本仓最恨的那种把「我不知道」写成「没有」的合并）。
 * 遍历两边键的并集：只扫其中一边会漏掉「新长出来的格子」。
 */
export function countChangedCells(before: WorldCells | null, after: WorldCells | null): number | null {
  if (before === null || after === null) return null;
  let n = 0;
  for (const objectId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[objectId] ?? {};
    const a = after[objectId] ?? {};
    for (const stateVar of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (b[stateVar] !== a[stateVar]) n += 1;
    }
  }
  return n;
}

/** 回执模型（组件只渲染；一个业务判断都不做）。 */
export interface ApplyReceipt {
  /** 起始拍落在哪一档（屏上 `data-phase`）。 */
  readonly phase: StartTickPhase;
  readonly startTick: number;
  /** 施加前世界在第几拍。 */
  readonly tickBefore: number;
  /** 推完之后世界在第几拍。 */
  readonly tickAfter: number;
  /** 目标那一格：屏上那一串（中文名或回落裸键）。 */
  readonly targetText: string;
  /** 目标那一格 施加前 / 推完后 的读数（`null` = 没这一格，不是 0）。 */
  readonly before: number | null;
  readonly after: number | null;
  /** 全世界变了几个格；`null` = 没法比（有一边没拿到）。 */
  readonly changedCells: number | null;
  /** 目标那一格**真的动了**没有（`null` = 没法比）。 */
  readonly moved: boolean | null;
  /** 本次推演到底够不够得着 `startTick`（`startTick <= tickAfter`）。 */
  readonly reached: boolean;
  /** 屏上那一句（一行说清「生效没生效 / 在第几拍」）。 */
  readonly headline: string;
  /** 没动时的原因；**只列这一次真命中的那几条**，全部可执行、不劝退。 */
  readonly notes: readonly string[];
}

const cellNum = (v: number | null): string => (v === null ? "（这个世界里没有这一格）" : String(v));

export function buildApplyReceipt(args: {
  readonly body: PerturbBody;
  readonly targetText: string;
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly worldBefore: WorldCells | null;
  readonly worldAfter: WorldCells | null;
  /**
   * 这个量在**已发布的传导规则**里有没有出边。`null` = 规则清单没回来 ⇒ 这一条原因不许说。
   * 没有出边 ⇒ 扰它只改自己那一格，下游一个都不会跟着动 —— 这是个真实存在的形态，
   * 说清楚了用户才知道该换一个量扰，而不是以为「引擎坏了」。
   */
  readonly hasOutEdge: boolean | null;
}): ApplyReceipt {
  const { body, targetText, tickBefore, tickAfter, worldBefore, worldAfter, hasOutEdge } = args;
  const phase = startTickPhaseOf(body.startTick, tickBefore);
  const before = readCell(worldBefore, body.targetObjectId, body.targetStateVar);
  const after = readCell(worldAfter, body.targetObjectId, body.targetStateVar);
  const changedCells = countChangedCells(worldBefore, worldAfter);
  const moved = before === null && after === null ? null : before !== after;

  const reached = body.startTick <= tickAfter;
  const headline = reached
    ? `已落地在第 ${body.startTick} 拍 · 本次推到第 ${tickAfter} 拍`
    : `排在第 ${body.startTick} 拍 —— 本次只推到第 ${tickAfter} 拍，还没轮到它`;

  const notes: string[] = [];
  if (!reached) {
    const left = body.startTick - tickAfter;
    notes.push(
      `它不是没生效，是还没到时候：再点 ${left} 次「施加并推演」就会推到第 ${body.startTick} 拍、它就落地了。` +
        `要它立刻生效，把起始拍改成 ${tickBefore + 1}。`,
    );
  } else if (moved === false) {
    // 到点了、却一个数都没动。逐条列**真命中**的原因，不编。
    if (body.mode === "delta" && body.magnitude === 0) {
      notes.push("「增减 0」在数学上就是不动 —— 换一个非 0 的幅度。");
    }
    if (body.mode === "scale" && body.magnitude === 1) {
      notes.push("「乘以 1」在数学上就是不动 —— 换一个不等于 1 的倍数。");
    }
    if (body.durationTicks !== null && body.startTick + body.durationTicks <= tickAfter) {
      notes.push(
        `持续 ${body.durationTicks} 拍 ⇒ 它在第 ${body.startTick + body.durationTicks} 拍到期回退，` +
          `而本次已经推到第 ${tickAfter} 拍 —— 落地与回退发生在同一次推演里，净效果为 0。` +
          `把持续拍数调大，或留空（永久）。`,
      );
    }
    if (before !== null && before !== 0 && Math.abs(body.magnitude) < Math.abs(before) / 100) {
      notes.push(
        `幅度 ${body.magnitude} 相对这一格今天的读数 ${before} 偏小，变化落在看不见的小数位上 —— ` +
          `把幅度调大再算一次：本平台确有一批量要更大的幅度才推得动，调大是有效的。`,
      );
    }
    if (hasOutEdge === false) {
      notes.push(
        `「${targetText}」在已发布的传导规则里没有出边 ⇒ 扰它只改自己那一格，下游不会跟着动。` +
          `想看连锁反应，改扰一个有出边的量（下拉里「根源」那一组都有出边）。`,
      );
    }
    if (notes.length === 0) {
      notes.push(
        `这一格从 ${cellNum(before)} 到 ${cellNum(after)} 没有变化，而已知的几条原因一条都没命中 —— ` +
          `这是一个说不出原因的「没动」，请把这条扰动的落点与幅度报给平台方，不要当成"正常"。`,
      );
    }
  }

  return {
    phase, startTick: body.startTick, tickBefore, tickAfter, targetText,
    before, after, changedCells, moved, reached, headline, notes,
  };
}

/** 回执里「这一格变了多少」那一行的文案（`null` 与 `0` 分开说，不合并）。 */
export function receiptCellText(r: ApplyReceipt): string {
  if (r.moved === null) return `目标那一格（${r.targetText}）在这个世界里不存在 —— 无从比较（不是 0）`;
  const delta = r.before !== null && r.after !== null ? r.after - r.before : null;
  const deltaText = delta === null ? "" : `（${delta >= 0 ? "+" : "−"}${Math.abs(delta)}）`;
  return `${r.targetText}：第 ${r.tickBefore} 拍 ${cellNum(r.before)} → 第 ${r.tickAfter} 拍 ${cellNum(r.after)}${deltaText}`;
}

/** 回执里「全世界变了几个格」那一行（`null` = 没法比，不许写成 0）。 */
export function receiptCellsText(r: ApplyReceipt): string {
  if (r.changedCells === null) return "变了几个格：没法比 —— 施加前那一份世界态没拿到（不是 0 个）";
  return `推到第 ${r.tickAfter} 拍后，世界里共 ${r.changedCells} 个格子的读数变了（含世界自身的演化，不只是这一条扰动）`;
}
