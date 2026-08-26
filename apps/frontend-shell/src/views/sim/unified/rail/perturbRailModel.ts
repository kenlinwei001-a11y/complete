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

/** 不能提交时的原因码（屏上 `data-` 记号 + 一句人话）。 */
export type BlockReason =
  | "NO_SESSION"
  | "NO_STATE_VAR"
  | "NO_TARGET_OBJECT"
  | "NOT_IN_WORLD_STATE"
  | "STATE_VARS_UNKNOWN"
  | "BAD_MAGNITUDE"
  | "BAD_START_TICK"
  | "BAD_DURATION";

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  NO_SESSION: "没有可推演的世界 —— 先选一个 RUNNING 会话",
  NO_STATE_VAR: "还没选要扰哪个量",
  NO_TARGET_OBJECT: "还没选落点对象（写口要的是引擎给世界态编键的那个对象 id）",
  NOT_IN_WORLD_STATE:
    "这个量今天扰不动：它不在这个世界的状态变量清单里（view-config.stateVars），" +
    "而传导引擎 propagateTick 只读世界态 —— 发出去会「请求成功、下游一动不动」。",
  STATE_VARS_UNKNOWN:
    "**不知道**这个量在不在世界态里 —— view-config 这一跳还没回来或失败了。" +
    "这不是「它扰不动」，是「现在判断不了」，所以先不发（不猜、不兜底）。",
  BAD_MAGNITUDE: "幅度必须是一个有限的数",
  // 契约 `PerturbationSchema.startTick` 是 `int().min(0)` —— 这里按契约拦，
  // 而不是让后端回一个 400 再把技术错误原样甩到屏上。
  BAD_START_TICK: "起始拍必须是 ≥ 0 的整数",
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
  opts: { readonly hasSession: boolean; readonly liveStateVars: ReadonlySet<string> | null },
): BuildResult {
  if (!opts.hasSession) return { ok: false, reason: "NO_SESSION" };
  if (draft.targetStateVar === "") return { ok: false, reason: "NO_STATE_VAR" };
  const liveness = livenessOf(draft.targetStateVar, opts.liveStateVars);
  if (liveness === "unknown") return { ok: false, reason: "STATE_VARS_UNKNOWN" };
  if (liveness === "not-in-world-state") return { ok: false, reason: "NOT_IN_WORLD_STATE" };
  if (draft.targetObjectId === "") return { ok: false, reason: "NO_TARGET_OBJECT" };
  if (!Number.isFinite(draft.magnitude)) return { ok: false, reason: "BAD_MAGNITUDE" };
  if (!(Number.isInteger(draft.startTick) && draft.startTick >= 0)) return { ok: false, reason: "BAD_START_TICK" };
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
