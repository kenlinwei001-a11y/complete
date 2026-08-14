/**
 * WO-SANDBOX-S3 · **阻滞点 → 候选方案枚举器**（闭 `G-IMPEDIMENT-OPTION-NOJOIN` 的枚举那一半）。
 *
 * ══ 这个文件解决什么 ═══════════════════════════════════════════════════════════
 * 沙盘已经能**找到**阻滞点（`chain-impediment.ts`，卡点/堵点/断点三类真产出），但**找到之后没有下一步**：
 * 全仓唯一的方案候选来源是 `solvers/service.ts decisionPlay` 里那个**三条字面量数组**
 * （备份供应商认证 / 长协条款 / 上游自采矿），绑死"正极供应缺口"一个场景 —— 换任何别的阻滞点进来它给不出候选。
 *
 * **本文件造的是枚举器，不是引擎。** `G-DECISION`（决策推演引擎）早已闭合，`decision_play` 真跑真算；
 * 逐候选试算所需的确定性算力（`computeByProcessModel` / `patchCapacityContext` / 规则求值）也全都在仓里跑着。
 * 缺的只有一件：**把「阻滞点」和「可动杠杆」焊起来的那条 join，以及沿着它枚举出档位与效果的那段代码。**
 *
 * ⚠ **上面第 6 行那句「全仓唯一的方案候选来源是那个三条字面量数组」于 2026-08-14 起过期**
 * （WO-DECISION-PLAY-OPTIONS，照铁律 0.6 就地回写而不是留着骗后人）：本枚举器现在**有两个调用方** ——
 * `chain-impediment.ts:1101`（沙盘）与 `solvers/service.ts` 的 `decisionImpedimentPlays`（决策路）。
 * 那三条战略方案也不再无条件下发：它们的 `provenance` 依据对象必须能在本次归因树的落点集里核对到。
 * 本文件**只读不改**，此处仅订正过期陈述。
 *
 * ══ 三条铁律（违反即返工）═════════════════════════════════════════════════════
 *
 * **① 不许有任何"阻滞点 → 方案"的人工映射表。**
 * 编一张「看着合理」的映射比诚实报缺更坏 —— 本仓刚坐实过一次：一条死映射让 24 张单里 12 张被静默标错，
 * 界面完全看不出来。故 join 只走**数据自己有的维度**（见 §2）：
 *   · 落点对象自己承载可拨动因子（`CapacityFactorBinding.objectType === locus.objectType`）；
 *   · 沿**一等关系行**（`links` 表）一跳可达；
 *   · 判据规则码 == 因子拨动闸（`evidence.ruleKey === binding.ruleGate`），实例再由**值键相等**收窄。
 * 三条都够不着 ⇒ **诚实缺席**（`noCandidateReason` 写清缺哪一维），不凑数。
 *
 * **② 零业务常数、零步长常数（R14 / RL5）。**
 * 档位（`toValue`）只取两种**数据里真实存在**的值：规则阈值本身，或同侪对象上的真实最优取值。
 * 不存在 "ratio→0.05 / days→1" 这类"看着合理的一步" —— 那是编的。
 *
 * **③ 族别是"量"出来的，不是 switch 出来的。**
 * `effectKind`（METRIC_SELF / METRIC_DERIVED / DOWNSTREAM_ONLY）由**拨完重算的结果**判定：
 * 判据读数动了就是前两者，只有下游产能动了就是第三者，**什么都没动就丢弃**
 * （照抄 `discoverLevers` 的「`sensitivity===0` → 无下游影响 → 非有效杠杆（诚实空，不臆造）」）。
 * 三类阻滞点的候选族之所以不同，是因为**它们的 locus 与 ruleKey 不同 ⇒ join 出来的杠杆集不同**，
 * 不是因为代码里按 `kind` 分了三个分支。本文件**没有**任何 `switch (im.kind)`。
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；候选 id 由输入派生；排序走 contracts 冻结的全序比较器
 * `compareSolutionCandidate`；探针预算与锚点上限是**固定上界 + 显式截断标注**（不静默截断）。
 */
import {
  CANDIDATE_JOIN_RANK,
  CAPACITY_FACTOR_BINDINGS,
  SolutionCandidateSchema,
  compareSolutionCandidate,
  firstDuplicateCandidatePair,
  readProcessHardCapacity,
  solutionCandidateId,
  type CandidateDim,
  type CandidateEffectKind,
  type CandidateJoinKind,
  type CandidateRungKind,
  type CapacityFactorBinding,
  type ChainImpediment,
  type DerivedDataMode,
  type NoCandidateKind,
  type SolutionCandidate,
} from "@platform/contracts";
import type { LinkInstance, ObjectInstance } from "../domain.js";
import { round } from "../prng.js";
import { resolveField } from "../ruledsl.js";
import { computeByProcessModel, patchCapacityContext } from "./capacity.js";
import {
  breachAmount,
  readBaseContention,
  readRuleThreshold,
  CONTENTION_LOCUS_TYPE,
  type ImpedimentRuleBinding,
  type RuleSnapshot,
} from "./chain-impediment.js";
import { LEVER_PROP_META } from "./lever-meta.js";
import type { SolverContext } from "./types.js";

type RuleForThreshold = Pick<RuleSnapshot, "key" | "expression" | "params">;

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 上界与预算（**固定上界 + 显式截断**，不静默）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 每个阻滞点最多探几个杠杆锚点。上界的存在理由是"本体是平的、图遍历走内存"
 * （`PRD-sandbox-redesign.md` §7.2③：遍历必须限深限量，超限**显式标注截断**）。
 * 锚点先按确定性键排序再截断 ⇒ 截哪几个是可预期的，不靠遍历顺序（R6）。
 */
export const MAX_ANCHORS_PER_IMPEDIMENT = 12;
/** 每个阻滞点最多下发几个候选（`PRD-sandbox-redesign.md` §4.1 G3「2–4 个」的上界）。 */
export const MAX_CANDIDATES_PER_IMPEDIMENT = 4;
/**
 * 构成"多方案"的下界。低于它 ⇒ `candidates: []` + `noCandidateReason` 写清只找到几个、为什么不够
 * （`PRD-sandbox-multiplan.md` §3.2「若有效候选 < 2，诚实报 candidates:[] + noCandidateReason，不凑数」）。
 */
export const MIN_CANDIDATES_PER_IMPEDIMENT = 2;
/** 全扫描的产能探针预算（每次探针 = 一遍 `computeByProcessModel`）。超预算 → 显式 `truncated`。 */
export const CANDIDATE_PROBE_BUDGET = 400;

/** 本枚举器的 provenance solverKey —— 与判定器同一个 key（候选是阻滞点的一部分，不新增 solver key）。 */
export const IMPEDIMENT_OPTION_SOLVER_KEY = "chain_impediments";

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 对象索引与 join
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `SolverContext` 的类型化数组 → `(typeKey, 数组)` 投影。
 *
 * 这**不是**业务映射，是取数管道（同族既有实现：`service.ts discoverCapacityLevers` 的 `arrayOf`）。
 * 只收 `CAPACITY_FACTOR_BINDINGS` 会落到的类型 + 阻滞点 locus 用得到的类型；ctx 里没有的返回空数组
 * （诚实空 → 该类型的杠杆自然不出现，而不是臆造一个）。
 */
function contextArrays(c: SolverContext, materialBalances: readonly ObjectInstance[]): Map<string, readonly ObjectInstance[]> {
  return new Map<string, readonly ObjectInstance[]>([
    ["Base", c.bases],
    ["Line", c.lines],
    ["Process", c.processes],
    ["Equipment", c.equipment],
    ["MaintPlan", c.maintPlans],
    ["Order", c.orders],
    ["Shipment", c.shipments],
    ["Material", c.materials ?? []],
    ["MaterialBatch", c.materialBatches ?? []],
    ["ChangeoverMatrix", c.changeoverMatrix ?? []],
    ["DataSourceHealth", c.dataHealth],
    ["MaterialBalance", materialBalances],
  ]);
}

interface ObjIndexEntry {
  typeKey: string;
  obj: ObjectInstance;
}

/** `o.id` → {类型, 实例}。`links` 的 `fromId`/`toId` 就是 `o.id`，故一跳可达全靠这张索引。 */
function buildObjIndex(arrays: Map<string, readonly ObjectInstance[]>): Map<string, ObjIndexEntry> {
  const idx = new Map<string, ObjIndexEntry>();
  for (const [typeKey, objs] of arrays) for (const obj of objs) idx.set(obj.id, { typeKey, obj });
  return idx;
}

/**
 * 某类型里「**字符串**取值全不同且全非空」的属性集合 = 该类型的**候选主键**（值键相等 join 用）。
 *
 * ⚠ **只认字符串**，不认数值：8 行物料里 `onHand` 恰好也是"全不同"，一个 `netDemandTon === onHand`
 * 的数值巧合就会造出一条假引用边 —— 那正是本文件铁律①禁的「看着合理的编造」。
 * 标识符在本体里都是字符串（`matId`/`name`/`materialCode`/`lineId`…），砍掉数值不损失真边。
 */
function uniqueKeyProps(objs: readonly ObjectInstance[]): string[] {
  if (objs.length === 0) return [];
  const propNames = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o.props)) propNames.add(k);
  const keys: string[] = [];
  for (const k of [...propNames].sort()) {
    const seen = new Set<string>();
    let ok = true;
    for (const o of objs) {
      const v = o.props[k];
      if (typeof v !== "string" || v.length === 0) { ok = false; break; }
      if (seen.has(v)) { ok = false; break; }
      seen.add(v);
    }
    if (ok) keys.push(k);
  }
  return keys;
}

/** 可拨动因子绑定（`writable` 单源自 `CAPACITY_FACTOR_BINDINGS`，本文件不另立候选杠杆册）。 */
const writableBindings = (): CapacityFactorBinding[] => CAPACITY_FACTOR_BINDINGS.filter((b) => b.writable);

export interface LeverAnchor {
  binding: CapacityFactorBinding;
  /** 杠杆落在哪个真对象实例上（`o.id`，patch 用）。 */
  objId: string;
  /** 业务可读 id（对象上的键属性，展示与 provenance 用；取不到则回落 `o.id`）。 */
  objectRef: string;
  obj: ObjectInstance;
  currentValue: number;
  joinKind: CandidateJoinKind;
  joinPath: string;
}

/** join 够不着时的诚实缺席行（进 `noCandidateReason`，不是丢掉）。 */
export interface AnchorGap {
  reason: string;
}

const anchorKey = (a: LeverAnchor): string => `${a.binding.objectType}|${a.objId}|${a.binding.prop}`;
/** 锚点确定性排序键：join 强度 → 类型 → 属性 → 对象 id（R6：截断截掉哪几个是可预期的）。 */
const anchorSortKey = (a: LeverAnchor): string =>
  `${CANDIDATE_JOIN_RANK[a.joinKind]}|${a.binding.objectType}|${a.binding.prop}|${a.objId}`;

/**
 * **join 的唯一实现**（`G-IMPEDIMENT-OPTION-NOJOIN`）：阻滞点 → 可动杠杆锚点集。
 *
 * 三条路都只用数据自己有的维度，每条都把走过的**真路径原文**记进 `joinPath`（R13：连
 * "凭什么把这根杠杆算作它的解法"都要能回答）。一条都走不通 ⇒ 返回空锚点 + `gaps` 说明缺哪一维。
 */
export function resolveLeverAnchors(args: {
  im: ChainImpediment;
  locusObj: ObjectInstance;
  arrays: Map<string, readonly ObjectInstance[]>;
  objIndex: Map<string, ObjIndexEntry>;
  linksByObj: Map<string, readonly LinkInstance[]>;
  /** 业务可读 id 属性的缓存（唯一键现算一次即可，全扫描共享；不传则本次调用内自建）。 */
  refMemo?: BusinessRefMemo;
}): { anchors: LeverAnchor[]; gaps: AnchorGap[] } {
  const { im, locusObj, arrays, objIndex, linksByObj } = args;
  const refMemo = args.refMemo ?? new Map<string, string | null>();
  const found = new Map<string, LeverAnchor>();
  const gaps: AnchorGap[] = [];
  const bindings = writableBindings();

  const push = (b: CapacityFactorBinding, entry: ObjIndexEntry, joinKind: CandidateJoinKind, joinPath: string): void => {
    const raw = entry.obj.props[b.prop];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return; // 该实例没承载这个量 → 不是杠杆
    const a: LeverAnchor = {
      binding: b,
      objId: entry.obj.id,
      objectRef: businessRef(entry.typeKey, entry.obj, arrays, refMemo),
      obj: entry.obj,
      currentValue: raw,
      joinKind,
      joinPath,
    };
    const k = anchorKey(a);
    const prev = found.get(k);
    // 同一 (对象,属性) 被多路命中 → 取 join 最强那条（显式全序，不靠遍历顺序·R6）。
    if (!prev || CANDIDATE_JOIN_RANK[joinKind] < CANDIDATE_JOIN_RANK[prev.joinKind]) found.set(k, a);
  };

  // ── ① LOCUS_PROP：落点对象自己就承载可拨动因子 ──────────────────────────────
  for (const b of bindings.filter((x) => x.objectType === im.locus.objectType)) {
    push(b, { typeKey: im.locus.objectType, obj: locusObj }, "LOCUS_PROP", `${im.locus.objectType}(locus) 自身承载 ${b.objectType}.${b.prop}（因子${b.mark} ${b.factorName}）`);
  }
  if (bindings.every((x) => x.objectType !== im.locus.objectType)) {
    gaps.push({ reason: `LOCUS_PROP 够不着：对象类型 ${im.locus.objectType} 在 CAPACITY_FACTOR_BINDINGS 上没有任何可拨动落点` });
  }

  // ── ② LINK_HOP：沿一等关系行一跳可达 ────────────────────────────────────────
  const hops = linksByObj.get(locusObj.id) ?? [];
  const beforeHop = found.size;
  if (hops.length === 0) {
    gaps.push({ reason: `LINK_HOP 够不着：落点对象 ${im.locus.objectType}/${im.locus.objectId} 在 links 表上没有任何一等关系行（本体上它是孤点）` });
  }
  for (const l of hops) {
    const otherId = l.fromId === locusObj.id ? l.toId : l.fromId;
    const entry = objIndex.get(otherId);
    if (!entry) continue; // 一跳到的类型不在 ctx 里 → 拿不到属性，诚实跳过
    for (const b of bindings.filter((x) => x.objectType === entry.typeKey)) {
      push(b, entry, "LINK_HOP", `${l.type}: ${im.locus.objectType}→${entry.typeKey}（因子${b.mark} ${b.factorName}）`);
    }
  }
  const hopYield = found.size - beforeHop;
  if (hops.length > 0 && hopYield === 0) {
    gaps.push({
      reason:
        `LINK_HOP 空手：落点对象 ${im.locus.objectType}/${im.locus.objectId} 有 ${hops.length} 条一等关系行，` +
        `但一跳可达的类型上没有任何可拨动因子落点（真杠杆在两跳外 —— 本单只走一跳，不擅自加深）`,
    });
  }

  // ── ③ KEY_JOIN：值键相等发现的引用边（给一跳够不着真杠杆的对象类型留的真路径）────
  // 判据是「**一跳产出了几个锚点**」而不是「有没有 link 行」：`MaterialBalance` 实测**有** link 行
  // （`exc_sourced_from` 之类），但一跳到的类型上一个可拨动落点都没有 —— 按"有 link 就不走 KEY_JOIN"
  // 会让整类断点永远拿不到候选。有真关系且真能撬动时以关系为准，撬不动才退到值键相等。
  if (hopYield === 0) {
    const targetTypes = [...new Set(bindings.map((b) => b.objectType))].sort();
    for (const tt of targetTypes) {
      if (tt === im.locus.objectType) continue; // 自己已由 LOCUS_PROP 覆盖
      const narrowed = narrowByKeyJoin(locusObj, im.locus.objectType, tt, arrays.get(tt) ?? []);
      if (!narrowed) continue;
      for (const b of bindings.filter((x) => x.objectType === tt)) {
        push(b, { typeKey: tt, obj: narrowed.obj }, "KEY_JOIN", `值键相等 ${narrowed.path}（因子${b.mark} ${b.factorName}）`);
      }
    }
  }

  // ── ④ RULE_GATE：判据规则码 == 因子拨动闸；实例由值键相等收窄 ────────────────
  const gated = im.evidence.ruleKey ? bindings.filter((x) => x.ruleGate === im.evidence.ruleKey) : [];
  if (im.evidence.ruleKey && gated.length === 0) {
    gaps.push({ reason: `RULE_GATE 够不着：规则 ${im.evidence.ruleKey} 不是任何可拨动因子的 ruleGate（该判据与产能因子册今天没有共同的规则码）` });
  }
  for (const b of gated) {
    const targets = arrays.get(b.objectType) ?? [];
    const narrowed = narrowByKeyJoin(locusObj, im.locus.objectType, b.objectType, targets);
    if (!narrowed) {
      gaps.push({
        reason:
          `RULE_GATE 收窄不了：规则 ${im.evidence.ruleKey} 闸住 ${b.objectType}.${b.prop}，但 ${im.locus.objectType}/${im.locus.objectId} ` +
          `与 ${b.objectType} 之间找不到值键相等的引用边 —— 拒绝广播到整个 ${b.objectType} 类型冒充"找到了"（R-ARG-FIDELITY 同族纪律）`,
      });
      continue;
    }
    push(b, { typeKey: b.objectType, obj: narrowed.obj }, "RULE_GATE", `规则闸 ${im.evidence.ruleKey} + 值键相等 ${narrowed.path}（因子${b.mark} ${b.factorName}）`);
  }

  const sorted = [...found.values()].sort((x, y) => (anchorSortKey(x) < anchorSortKey(y) ? -1 : anchorSortKey(x) > anchorSortKey(y) ? 1 : 0));
  return { anchors: interleaveByLever(sorted), gaps };
}

/**
 * 锚点按 `对象类型.属性`（= **一根杠杆**）分组后**轮转**取，而不是一组取完再取下一组。
 *
 * 为什么必须这样（实测踩到的）：一条产线一跳可达 5 道工序，纯字典序会把 12 个名额全喂给
 * `Process.attendance` 的 5 个实例 + `Process.channels` 的几个实例，于是候选卡片变成
 * 「把 A 工序出勤提到 1 / 把 B 工序出勤提到 1 / 把 C 工序出勤提到 1」——**三张卡是同一个主意**。
 * 用户要的是"有哪几种解法"，不是"同一种解法可以拨哪几台设备"。轮转后名额优先给到**不同的杠杆**。
 * 组内仍按 `anchorSortKey` 全序（R6：截断截掉哪个是可预期的）。
 */
function interleaveByLever(sortedAnchors: readonly LeverAnchor[]): LeverAnchor[] {
  const groups = new Map<string, LeverAnchor[]>();
  for (const a of sortedAnchors) {
    const k = `${a.binding.objectType}.${a.binding.prop}`;
    const g = groups.get(k);
    if (g) g.push(a);
    else groups.set(k, [a]);
  }
  const keys = [...groups.keys()].sort();
  const out: LeverAnchor[] = [];
  const depth = Math.max(0, ...keys.map((k) => groups.get(k)!.length));
  for (let i = 0; i < depth; i++) for (const k of keys) {
    const a = groups.get(k)![i];
    if (a) out.push(a);
  }
  return out;
}

/**
 * **值键相等收窄**：locus 对象的某个属性值 == 目标类型某个**唯一键**属性的值 ⇒ 找到唯一那一行。
 * 唯一键由数据现算（`uniqueKeyProps`），不是代码里声明的外键表 —— 改种子即改可达面。
 * 匹配不到 / 匹配到多行 ⇒ 返回 `null`（诚实缺席，绝不"取第一行"）。
 */
function narrowByKeyJoin(
  locusObj: ObjectInstance,
  locusType: string,
  targetType: string,
  targets: readonly ObjectInstance[],
): { obj: ObjectInstance; path: string } | null {
  if (targets.length === 0) return null;
  const keys = uniqueKeyProps(targets);
  const locusProps = Object.keys(locusObj.props).sort();
  for (const j of keys) {
    const byVal = new Map<string, ObjectInstance>();
    for (const t of targets) byVal.set(String(t.props[j]), t);
    for (const k of locusProps) {
      const v = locusObj.props[k];
      if (typeof v !== "string" && typeof v !== "number") continue;
      const hit = byVal.get(String(v));
      if (hit) return { obj: hit, path: `${locusType}.${k} = ${targetType}.${j} = ${String(v)}` };
    }
  }
  return null;
}

/**
 * 该类型的**业务可读 id 属性**：从 `uniqueKeyProps`（数据现算的唯一键）里挑，优先 `*Id`。
 *
 * ⚠ **为什么必须走唯一键，而不是"第一个以 Id 结尾的属性"**（实测踩到的，2026-08-10）：
 * 属性名排序后 `baseId` 排在 `processId`/`lineId` 前面 ⇒ 老写法给 650 道工序**全部**返回 `jinhua`
 * 这类**基地 id**。两处当场坏掉：① `lever.objectId` 是要给人看"拨哪个对象"的，返回基地等于没说；
 * ② 候选 id 由它拼（`solutionCandidateId`），同基地同属性同档位的两个实例会**撞成同一个 id**。
 * `uniqueKeyProps` 要求该类型全部实例上取值互异 ⇒ `baseId` 天然被排除、`processId` 留下，
 * 唯一键 ⇒ id 唯一，这是**由数据保证**的，不是靠命名约定碰巧。
 */
type BusinessRefMemo = Map<string, string | null>;

function businessRefPropOf(typeKey: string, arrays: Map<string, readonly ObjectInstance[]>, memo: BusinessRefMemo): string | null {
  const hit = memo.get(typeKey);
  if (hit !== undefined) return hit;
  const keys = uniqueKeyProps(arrays.get(typeKey) ?? []);
  const pick = keys.find((k) => /Id$/.test(k)) ?? keys[0] ?? null;
  memo.set(typeKey, pick);
  return pick;
}

/** 对象的业务可读 id（该类型唯一键上的取值；类型没有唯一键时诚实回落内部 `o.id`，不硬凑一个）。 */
function businessRef(typeKey: string, o: ObjectInstance, arrays: Map<string, readonly ObjectInstance[]>, memo: BusinessRefMemo): string {
  const k = businessRefPropOf(typeKey, arrays, memo);
  if (k !== null) {
    const v = o.props[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return o.id;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 档位（`toValue`）—— 只取数据里真实存在的值
// ══════════════════════════════════════════════════════════════════════════════

export interface Rung {
  kind: CandidateRungKind;
  toValue: number;
  source: string;
}

/**
 * 该锚点的候选档位集。**三种，全是数据里真实存在的值，零步长常数**：
 *  · `THRESHOLD` —— 仅当这根杠杆**就是判据的量测属性**时可得：拨到规则阈值本身（恰好回到线内）。
 *  · `PEER_NEXT` —— 同侪里**紧邻当前值的下一个真实取值**（上下各一个）：先迈一小步。
 *  · `PEER_BEST` —— 同侪对象上该属性的**真实极值**（上下各一个）：同类里已经有人做到这个数。
 *
 * 上下两个方向**都**生成，**哪个方向算改善由重算说了算** —— 本函数不预设"库存越多越好/交期越短越好"
 * 这类业务方向（那是内联业务知识）。方向错的那些会在试算后因"无一维改善"被丢弃。
 * 三种都取不到（阈值与当前值同 / 同侪全等）⇒ 空数组，调用方记原因，**不拍一个步长**。
 */
export function rungsFor(args: {
  anchor: LeverAnchor;
  im: ChainImpediment;
  metricPath: string;
  peers: readonly ObjectInstance[];
}): { rungs: Rung[]; gaps: AnchorGap[] } {
  const { anchor, im, metricPath, peers } = args;
  const rungs: Rung[] = [];
  const gaps: AnchorGap[] = [];
  const propKey = `${anchor.binding.objectType}.${anchor.binding.prop}`;

  // ① 阈值档：只有"杠杆 == 判据量测属性"时才成立（否则拨到阈值毫无语义）。
  if (propKey === metricPath && im.evidence.threshold !== anchor.currentValue) {
    rungs.push({
      kind: "THRESHOLD",
      toValue: im.evidence.threshold,
      source: `规则 ${im.evidence.ruleKey ?? "?"} 阈值 ${im.evidence.threshold}${im.evidence.unit}（judgeOne 读回的真值·非本文件的常数）`,
    });
  }

  // ② 同侪档：同基地同类对象上该属性的真实极值。
  const locusBase = typeof anchor.obj.props.baseId === "string" ? anchor.obj.props.baseId : undefined;
  const sameBase = locusBase === undefined ? [] : peers.filter((p) => p.props.baseId === locusBase);
  const pool = sameBase.length > 1 ? sameBase : peers;
  const scopeNote = sameBase.length > 1 ? `同基地 ${locusBase}` : "全类型（同基地同侪不足 2 个）";
  const vals = pool
    .map((p) => p.props[anchor.binding.prop])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) {
    gaps.push({ reason: `PEER_BEST 取不到：${propKey} 在同侪对象上无有限数值（${scopeNote}，${pool.length} 个对象）` });
  } else {
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    const lo = uniq[0]!;
    const hi = uniq[uniq.length - 1]!;
    const nextUp = uniq.find((v) => v > anchor.currentValue);
    const nextDown = [...uniq].reverse().find((v) => v < anchor.currentValue);
    const add = (kind: CandidateRungKind, v: number | undefined, note: string): void => {
      if (v === undefined || v === anchor.currentValue) return;
      if (rungs.some((r) => r.toValue === v)) return; // 同一个目标值不重复出档（极值恰好也是相邻值时）
      rungs.push({ kind, toValue: v, source: `同侪 ${propKey} ${note} ${v}（${scopeNote}·${uniq.length} 个不同取值·当前 ${anchor.currentValue}）` });
    };
    // 顺序即优先序：先"迈一小步"，再"做到同类最好"。上下两向都出，方向对不对由试算裁。
    add("PEER_NEXT", nextUp, "紧邻上一档真实取值");
    add("PEER_NEXT", nextDown, "紧邻下一档真实取值");
    add("PEER_BEST", hi, "真实极值（最大）");
    add("PEER_BEST", lo, "真实极值（最小）");
    if (uniq.length === 1 && uniq[0] === anchor.currentValue) {
      gaps.push({ reason: `同侪无档位：${propKey} 在同侪里取值全等于当前值 ${anchor.currentValue}（${scopeNote}）—— 拒绝拍一个步长` });
    }
  }
  return { rungs, gaps };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 逐候选真试算（**效果是量出来的**）
// ══════════════════════════════════════════════════════════════════════════════

/** 产能目标：Σ over 认证型号 of Σ p50（可按基地收窄，同尺度才谈得上偏差）。 */
function capacityObjective(c: SolverContext, baseFilter?: string): number | null {
  const models = [...c.certByModel.keys()].sort();
  if (models.length === 0) return null;
  let total = 0;
  let rows = 0;
  for (const m of models) {
    for (const r of computeByProcessModel(c, m, CAPACITY_FACTOR_BINDINGS, baseFilter)) {
      total += r.p50;
      rows++;
    }
  }
  if (rows === 0) return null; // 诚实空：该作用域无逐工序格，不返回 0 冒充"产能为 0"
  return round(total, 4);
}

/** 判据读数与超阈幅度（在给定 ctx 上重算 —— 与 `judgeOne` 同一套阈值读回 + 同一个比较符）。 */
function judgeOnCtx(args: {
  ruleExpression: RuleForThreshold;
  binding: ImpedimentRuleBinding;
  locusObjId: string;
  arraysOf: (typeKey: string) => readonly ObjectInstance[];
}): { metric: number; breach: number } | null {
  const { ruleExpression, binding, locusObjId, arraysOf } = args;
  const obj = arraysOf(binding.locusObjectType).find((o) => o.id === locusObjId);
  if (!obj) return null;
  const extra: Record<string, unknown> = {};
  if (binding.locusObjectType === "Process") {
    const reading = readProcessHardCapacity(obj.props);
    if (reading.status === "OK") {
      extra.parallelThroughput = reading.capacityPerDay;
      extra.capacityUnitKind = reading.unitKind;
      extra.units = reading.units;
    }
  }
  if (binding.locusObjectType === CONTENTION_LOCUS_TYPE) {
    // WO-A6-CONTENTION：争用读数与判定器**共用同一份实现**（`readBaseContention`）。
    // 上面那段 Process 的写法是"判定器算一遍、枚举器再算一遍"的先例（两处调同一个 `readProcessHardCapacity`）；
    // 争用这一路刻意照它，但**连组装都不复制**——否则拨动产线产能后，枚举器算出的"施策后读数"
    // 会与判定器的口径悄悄分叉，候选的效果就成了另一套账（本仓 metric-aware 反复炸的根）。
    const reading = readBaseContention(obj, arraysOf("Order"), arraysOf("Line"));
    if (reading.status === "OK") {
      extra.segClaims = reading.segClaims;
      extra.claimedDailyRate = reading.claimedDailyRate;
      extra.capacityDailyPacks = reading.capacityDailyPacks;
    }
  }
  const prefix = binding.metricPath.split(".")[0] as string;
  const payload: Record<string, unknown> = { [prefix]: { ...obj.props, ...extra } };
  const metricRaw = resolveField(payload, binding.metricPath.split("."));
  if (typeof metricRaw !== "number" || !Number.isFinite(metricRaw)) return null;
  const th = readRuleThreshold(ruleExpression, binding.metricPath, payload);
  if (th.status !== "OK") return null;
  return { metric: metricRaw, breach: round(breachAmount(metricRaw, th.value, th.op, th.metricOnLeft), 6) };
}

/** severity 口径必须与 `judgeOne` 同一份：`超阈幅度 / 规模基准` × 100，clamp 0–100。 */
function severityOf(breach: number, denom: number): number | null {
  if (!(denom > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((breach / denom) * 100)));
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 枚举器主体
// ══════════════════════════════════════════════════════════════════════════════

export interface OptionEnumInput {
  c: SolverContext;
  materialBalances: readonly ObjectInstance[];
  links: readonly LinkInstance[];
  /** 阻滞点 → (产它的判据, 它落在哪个真对象实例上)。由 `detectChainImpediments` 一路带下来，不重新猜。 */
  originOf: (im: ChainImpediment) => { binding: ImpedimentRuleBinding; obj: ObjectInstance } | undefined;
  /** 已发布规则快照（阈值读回的唯一来源，与判定器同源）。 */
  rules?: SolverContext["rules"];
  probeBudget?: number;
}

export interface OptionEnumStat {
  impedimentId: string;
  anchors: number;
  probes: number;
  effective: number;
  emitted: number;
  /** 诚实缺席：为什么没有（更多）候选。 */
  gaps: string[];
  /**
   * WO-SANDBOX-S3-ENUM · 空候选的**机器可读**定性（`undefined` = 有候选）。
   * `NONE` 算过了真没有 · `UNAVAILABLE` 压根没算出来 —— 见 contracts `NO_CANDIDATE_KINDS`。
   */
  noCandidateKind?: NoCandidateKind;
}

export interface OptionEnumResult {
  /** impedimentId → 候选（已全序、已去重、已截 N）。 */
  byImpediment: Map<string, { candidates: SolutionCandidate[]; noCandidateReason?: string; noCandidateKind?: NoCandidateKind }>;
  stats: OptionEnumStat[];
  /** 探针预算耗尽 → 显式标注（不静默截断）。 */
  truncated: boolean;
  probesUsed: number;
}

/**
 * 枚举所有阻滞点的候选方案。**纯函数**：同 (ctx, links, impediments) 重跑字节一致（R6）。
 */
export function enumerateImpedimentOptions(
  impediments: readonly ChainImpediment[],
  input: OptionEnumInput,
): OptionEnumResult {
  const { c, materialBalances, links, originOf } = input;
  const budget = input.probeBudget ?? CANDIDATE_PROBE_BUDGET;
  const arrays = contextArrays(c, materialBalances);
  const objIndex = buildObjIndex(arrays);
  const arraysOf = (typeKey: string): readonly ObjectInstance[] => arrays.get(typeKey) ?? [];

  const linksByObj = new Map<string, LinkInstance[]>();
  const attach = (id: string, l: LinkInstance): void => {
    const list = linksByObj.get(id);
    if (list) list.push(l);
    else linksByObj.set(id, [l]);
  };
  for (const l of links) {
    attach(l.fromId, l);
    if (l.toId !== l.fromId) attach(l.toId, l);
  }
  // 一跳集合按 link id 全序（R6：可达面的遍历顺序不许依赖插入顺序）。
  for (const [, list] of linksByObj) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 产能探针缓存：同一个 (作用域, 对象, 属性, 值) 的 patch 结果与阻滞点无关 ⇒ 全扫描共享一份。
  const capCache = new Map<string, number | null>();
  let probes = 0;
  let truncated = false;
  const capacityFor = (baseFilter: string | undefined, patch?: { typeKey: string; objId: string; prop: string; value: number }): number | null => {
    const key = `${baseFilter ?? "*"}|${patch ? `${patch.typeKey}.${patch.objId}.${patch.prop}=${patch.value}` : "BASE"}`;
    const hit = capCache.get(key);
    if (hit !== undefined) return hit;
    if (probes >= budget) {
      truncated = true;
      return null;
    }
    probes++;
    const ctx = patch ? patchCapacityContext(c, patch.typeKey, patch.objId, patch.prop, patch.value) : c;
    const v = capacityObjective(ctx, baseFilter);
    capCache.set(key, v);
    return v;
  };

  const byImpediment = new Map<string, { candidates: SolutionCandidate[]; noCandidateReason?: string; noCandidateKind?: NoCandidateKind }>();
  const stats: OptionEnumStat[] = [];
  /** 唯一键现算一次、全扫描共享（650 工序 × 全属性 逐阻滞点重算一遍是纯浪费）。 */
  const refMemo: BusinessRefMemo = new Map<string, string | null>();

  for (const im of impediments) {
    const gaps: string[] = [];
    const origin = originOf(im);
    if (!origin) {
      // **算不了**，不是"没有对策"：判定器没把判据与落点对象带下来，枚举连起点都没有。
      // 这一条若塌进 NONE，读者会以为"这个阻滞点确实无解"，而真相是一条接线缺口 —— 修法完全相反。
      byImpediment.set(im.impedimentId, {
        candidates: [],
        noCandidateReason: "枚举器拿不到该阻滞点的判据与落点对象（判定器未回传 origin）—— 属接线缺口，不是无候选",
        noCandidateKind: "UNAVAILABLE",
      });
      stats.push({ impedimentId: im.impedimentId, anchors: 0, probes: 0, effective: 0, emitted: 0, gaps: ["origin 缺失"], noCandidateKind: "UNAVAILABLE" });
      continue;
    }
    const { binding, obj: locusObj } = origin;
    const rule = input.rules?.[binding.ruleKey];
    // 本轮开始时预算是否已经耗尽 / 本轮是否把它耗尽 —— 决定「空集」到底是 NONE 还是 UNAVAILABLE。
    const truncatedBefore = truncated;
    const { anchors: allAnchors, gaps: joinGaps } = resolveLeverAnchors({ im, locusObj, arrays, objIndex, linksByObj, refMemo });
    for (const g of joinGaps) gaps.push(g.reason);
    const anchors = allAnchors.slice(0, MAX_ANCHORS_PER_IMPEDIMENT);
    if (allAnchors.length > anchors.length) {
      gaps.push(`锚点截断：join 出 ${allAnchors.length} 个杠杆锚点，按确定性序只探前 ${anchors.length} 个（上界 MAX_ANCHORS_PER_IMPEDIMENT）`);
    }

    // 基线（不施策）：判据读数 + 产能。二者都在**未 patch** 的 ctx 上算，与候选同口径。
    const baseJudge = rule ? judgeOnCtx({ ruleExpression: rule, binding, locusObjId: locusObj.id, arraysOf }) : null;
    const locusBase = typeof locusObj.props.baseId === "string" ? locusObj.props.baseId : undefined;
    const baseCap = capacityFor(locusBase);
    // severity 的规模基准（与 judgeOne 同一份口径：阈值绝对值，为 0 时换 magnitudePath）。
    let denom = Math.abs(im.evidence.threshold);
    if (!(denom > 0) && binding.magnitudePath) {
      const prefix = binding.magnitudePath.split(".")[0] as string;
      const magRaw = resolveField({ [prefix]: locusObj.props }, binding.magnitudePath.split("."));
      if (typeof magRaw === "number" && Number.isFinite(magRaw) && Math.abs(magRaw) > 0) denom = Math.abs(magRaw);
    }
    const baseSeverity = baseJudge ? severityOf(baseJudge.breach, denom) : im.severity;

    const effective: SolutionCandidate[] = [];
    let probesHere = 0;
    for (const anchor of anchors) {
      const peers = arraysOf(anchor.binding.objectType);
      const { rungs, gaps: rungGaps } = rungsFor({ anchor, im, metricPath: binding.metricPath, peers });
      for (const g of rungGaps) gaps.push(g.reason);
      if (rungs.length === 0) continue;

      for (const rung of rungs) {
        const patched = patchCapacityContext(c, anchor.binding.objectType, anchor.objId, anchor.binding.prop, rung.toValue);
        const patchApplied = arraysOfPatched(patched, arrays, anchor.binding.objectType).some(
          (o) => o.id === anchor.objId && o.props[anchor.binding.prop] === rung.toValue,
        );
        if (!patchApplied) {
          gaps.push(
            `${anchor.binding.objectType}.${anchor.binding.prop} 拨不动：patchCapacityContext 不认对象类型 ${anchor.binding.objectType}（override 会被静默丢弃）—— ` +
              `属"接了线接错地方"，补该类型的克隆分支即可`,
          );
          continue;
        }
        const afterJudge = rule ? judgeOnCtx({ ruleExpression: rule, binding, locusObjId: locusObj.id, arraysOf: (t) => arraysOfPatched(patched, arrays, t) }) : null;
        const afterCap = capacityFor(locusBase, { typeKey: anchor.binding.objectType, objId: anchor.objId, prop: anchor.binding.prop, value: rung.toValue });
        probesHere++;

        const breachMoved = baseJudge !== null && afterJudge !== null && afterJudge.breach !== baseJudge.breach;
        const capMoved = baseCap !== null && afterCap !== null && afterCap !== baseCap;
        if (!breachMoved && !capMoved) continue; // 拨了什么都没动 → 非有效杠杆（诚实丢弃，照抄 discoverLevers）
        // 「动了」还不够，还得**往好里动**：全维不改善（甚至全维变差）的拨法不是方案，是反面教材。
        // 判据走 contracts 的 `candidateDimImprovement`（betterWhen 是维自己声明的，不在这里猜方向）。
        const breachImproves = breachMoved && afterJudge!.breach < baseJudge!.breach;
        const capImproves = capMoved && afterCap! > baseCap!;
        if (!breachImproves && !capImproves) continue;

        // ── effectKind 是**量出来的**，不是按 kind switch 出来的 ──
        const isMetricProp = `${anchor.binding.objectType}.${anchor.binding.prop}` === binding.metricPath;
        const effectKind: CandidateEffectKind = breachMoved ? (isMetricProp ? "METRIC_SELF" : "METRIC_DERIVED") : "DOWNSTREAM_ONLY";

        const afterSeverity = afterJudge ? severityOf(afterJudge.breach, denom) : null;
        const meta = LEVER_PROP_META[`${anchor.binding.objectType}.${anchor.binding.prop}`];
        const unit = meta?.unit ?? "";
        const dims: CandidateDim[] = [
          {
            key: "breach",
            label: `超阈幅度（${binding.metricPath}）`,
            value: afterJudge ? afterJudge.breach : null,
            baseline: baseJudge ? baseJudge.breach : null,
            unit: im.evidence.unit,
            betterWhen: "lower",
            dataMode: afterJudge && baseJudge ? im.dataMode : ("EMPTY" as DerivedDataMode),
            ...(afterJudge && baseJudge ? {} : { reason: rule ? "判据读数在该对象上取不回来（阈值或指标缺承载）" : `规则 ${binding.ruleKey} 快照缺失，判据读数无从重算` }),
          },
          {
            key: "severity",
            label: "严重度",
            value: afterSeverity,
            baseline: baseSeverity,
            unit: "",
            betterWhen: "lower",
            dataMode: afterSeverity !== null && baseSeverity !== null ? im.dataMode : ("EMPTY" as DerivedDataMode),
            ...(afterSeverity !== null && baseSeverity !== null ? {} : { reason: "超阈幅度或规模基准算不出来 ⇒ severity 拒绝拍一个数" }),
          },
          {
            key: "capacityP50",
            label: `产能 p50 合计${locusBase ? `（基地 ${locusBase}）` : "（全域）"}`,
            value: afterCap,
            baseline: baseCap,
            unit: "套/天",
            betterWhen: "higher",
            dataMode: afterCap !== null && baseCap !== null ? "SYNTHETIC" : ("EMPTY" as DerivedDataMode),
            ...(afterCap !== null && baseCap !== null ? {} : { reason: truncated ? "探针预算耗尽（结果已标 truncated）" : "该作用域无逐工序格 ⇒ 产能维诚实缺席，不返回 0" }),
          },
        ];

        const toValue = round(rung.toValue, 6);
        const dir = rung.toValue > anchor.currentValue ? "↑" : "↓";
        // 标签**不拼单位**：存储口径与显示口径不一致（`Line.utilization` 存 0–100 / `Process.attendance` 存 0–1，
        // 两者 LEVER_PROP_META.kind 同为 ratio），后端拼上去就会出现「出勤率 ↑ 1%」这种错读数。
        // 单位与值类随 `lever.unit`/`lever.valueKind` 下发，格式化归前端一处做。
        const label = `${meta?.label ?? `${anchor.binding.objectType}.${anchor.binding.prop}`} ${dir} ${rung.toValue}（${anchor.binding.factorName}·${anchor.objectRef}）`;
        // id 的拼法**只在 contracts 一处**（`solutionCandidateId`）—— 本文件不许再出现模板串。
        // 入参全部取自候选自身的公开字段 ⇒ 消费方能拿候选反算出同一个 id（SEAM 的 S3-ID 咬的就是这条）。
        const candidateId = solutionCandidateId({
          impedimentId: im.impedimentId,
          objectType: anchor.binding.objectType,
          leverObjectId: anchor.objectRef,
          prop: anchor.binding.prop,
          rungKind: rung.kind,
          toValue,
        });
        const parsed = SolutionCandidateSchema.safeParse({
          candidateId,
          impedimentId: im.impedimentId,
          label,
          lever: {
            objectType: anchor.binding.objectType,
            objectId: anchor.objectRef,
            prop: anchor.binding.prop,
            factorName: anchor.binding.factorName,
            factorMark: anchor.binding.mark,
            grain: anchor.binding.grain,
            unit,
            ...(meta?.kind === undefined ? {} : { valueKind: meta.kind }),
          },
          fromValue: round(anchor.currentValue, 6),
          toValue,
          join: { kind: anchor.joinKind, path: anchor.joinPath },
          rungKind: rung.kind,
          rungSource: rung.source,
          effectKind,
          dims,
          provenance: {
            solverKey: IMPEDIMENT_OPTION_SOLVER_KEY,
            formula:
              `patchCapacityContext(${anchor.binding.objectType}/${anchor.objectRef}.${anchor.binding.prop}: ${round(anchor.currentValue, 4)}→${round(rung.toValue, 4)}) ` +
              `→ 判据 ${binding.ruleKey}(${binding.metricPath}) 重算 + Σ computeByProcessModel.p50 重算`,
            inputs: [`${anchor.binding.objectType}.${anchor.binding.prop}`, binding.metricPath, `rule:${binding.ruleKey}`],
          },
          dataMode: im.dataMode,
        });
        if (!parsed.success) {
          // schema 抛 = 该候选与基线逐维相同（A4 硬约束）→ 记原因，不下发（绝不放行一个"看着有方案"的空方案）
          gaps.push(`候选被契约拒收（${candidateId}）：${parsed.error.issues.map((i) => i.message).join("；")}`);
          continue;
        }
        effective.push(parsed.data);
      }
    }

    // ── 全序 → 每根杠杆只留最好的一个实例 → 去重（效果雷同的算重复）→ 截 N ──
    const sorted = effective.slice().sort(compareSolutionCandidate);
    const kept: SolutionCandidate[] = [];
    const leverTaken = new Set<string>();
    for (const cand of sorted) {
      if (kept.length >= MAX_CANDIDATES_PER_IMPEDIMENT) break;
      // ① 同一根杠杆（对象类型.属性 × 档位种类）只留效果最好的那个实例 —— 照抄 `discoverLevers`
      //    「每根杠杆取 scope 内真对象实例…按 |敏感度| 取 best」的口径：候选卡片要回答"有哪几种解法"，
      //    不是"同一种解法可以拨哪几台设备"。
      const leverKey = `${cand.lever.objectType}.${cand.lever.prop}|${cand.rungKind}`;
      if (leverTaken.has(leverKey)) continue;
      // ② 「两个候选算出完全一样的结果 ⇒ 要么杠杆没接线，要么候选重复」（PRD §5.3-3）——判据走 contracts 单源。
      if (kept.some((k) => firstDuplicateCandidatePair([k, cand]) !== null)) {
        gaps.push(`候选 ${cand.candidateId} 与已选候选效果雷同（KPI 逐维相同）→ 判为重复丢弃`);
        continue;
      }
      leverTaken.add(leverKey);
      kept.push(cand);
    }

    if (kept.length < MIN_CANDIDATES_PER_IMPEDIMENT) {
      // ── 「空集」的两种形态必须当场分开（contracts `NO_CANDIDATE_KINDS`）──────────────
      // `UNAVAILABLE` = 这一轮**没算完**：探针预算在本轮（或本轮之前）耗尽，或判据规则快照缺失
      //   ⇒ 逐候选试算根本没跑全，"没有候选"是**缺答**，不是答。
      // `NONE`        = 这一轮**算完了**：join 走到了、档位取到了、逐候选真试算过了，结论就是没有。
      const budgetGone = truncated; // 含 truncatedBefore：预算是全扫描共享的，之前耗尽就轮不到本轮算
      const kind: NoCandidateKind = budgetGone || rule === undefined ? "UNAVAILABLE" : "NONE";
      if (budgetGone) {
        gaps.push(
          truncatedBefore
            ? `探针预算在本阻滞点开始前即已耗尽（上界 ${budget}）⇒ 本点的逐候选试算没跑，属"算不了"不是"没有"`
            : `探针预算在本阻滞点处理中耗尽（上界 ${budget}）⇒ 后续档位没试算完，属"算不了"不是"没有"`,
        );
      }
      if (rule === undefined) {
        gaps.push(`判据规则 ${binding.ruleKey} 的已发布快照缺失 ⇒ 判据读数无从重算，候选效果算不出来（"算不了"不是"没有"）`);
      }
      const why =
        (kind === "UNAVAILABLE"
          ? `枚举**未能算完**（算不了 ≠ 没有对策）：有效候选 ${kept.length} 个`
          : `枚举已跑完，有效候选 ${kept.length} 个`) +
        `（探了 ${anchors.length} 个杠杆锚点 / ${probesHere} 次试算），不足 ${MIN_CANDIDATES_PER_IMPEDIMENT} 个 ⇒ 构不成多方案对比，诚实不下发。` +
        (kept.length > 0 ? `唯一有效候选：${kept.map((k) => k.label).join("、")}。` : "") +
        (gaps.length > 0 ? `缺口：${gaps.slice(0, 4).join(" | ")}` : "");
      byImpediment.set(im.impedimentId, { candidates: [], noCandidateReason: why, noCandidateKind: kind });
      stats.push({ impedimentId: im.impedimentId, anchors: anchors.length, probes: probesHere, effective: effective.length, emitted: kept.length, gaps, noCandidateKind: kind });
    } else {
      byImpediment.set(im.impedimentId, { candidates: kept });
      stats.push({ impedimentId: im.impedimentId, anchors: anchors.length, probes: probesHere, effective: effective.length, emitted: kept.length, gaps });
    }
  }

  return { byImpediment, stats, truncated, probesUsed: probes };
}

/**
 * patch 后的 ctx 里取某类型数组。`patchCapacityContext` **只克隆产能链四类**（Process/Equipment/Line/Material），
 * 其余类型原样返回 —— 故其余类型必须回落到**原始索引**取。
 *
 * ⚠ 这个回落不是可有可无的防御：`MaterialBalance` 压根不在 `SolverContext` 上（由调用方注入），
 * 少了它，断点（C06，locus=MaterialBalance）的候选会全部拿到 `breach: null` ——
 * 一个"看着有方案、KPI 却全是 —"的假面板。实测踩到过（首版逐条打出 `breach:492→null`）。
 */
function arraysOfPatched(
  c: SolverContext,
  base: Map<string, readonly ObjectInstance[]>,
  typeKey: string,
): readonly ObjectInstance[] {
  switch (typeKey) {
    case "Process": return c.processes;
    case "Equipment": return c.equipment;
    case "Line": return c.lines;
    case "Material": return c.materials ?? [];
    default: return base.get(typeKey) ?? [];
  }
}
