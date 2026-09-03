/**
 * WO-SIM-PARETO-MODEL-EXIT · **帕累托模型装配器** —— 从租户已发布本体装出一份可解的优化模型。
 *
 * ══ 今天的行为是 X，应该是 Y（开工第一件事读出来的原文）══════════════════════
 *
 * **X（实测）**：模型装配能力后端**有**，但**没有任何出口**。
 *   · `opt-binding.ts` 的 `bindToSolverArgs` / `bindCrossObjectOccupancy` 会把 role→本体映射
 *     翻成求解器 args —— 但它要一份**现成的 `OntologyBinding`**，而全仓没有任何一处
 *     "从本体自动写出这份绑定"的代码可被外部调用。
 *   · `service.ts` 的 `assembleBaselineFromSelection` 会自动写绑定（A13 词库 + 结构信号），
 *     但它 `private`、只在 `optimize_whatif` 的 `autoBind` 分支里走，**且只回 Δ目标不回 args**。
 *     实测原文（本机 4471 内存态，demo 租户）：
 *     ```
 *     POST /a/v1/solvers/optimize_whatif/invoke {"args":{"family":"facility_location","autoBind":true,…}}
 *     → 200 {"data":{"applicable":false,"missingRoles":["facility（Base 在选中范围内无实例）"],
 *              "baselineObjective":null,…}}      ← 通篇没有一格叫 args
 *     ```
 *   · 且它只认 `facility_location` / `min_cost_flow` 两族（第三族起直接
 *     `family '<x>' selection 自动装配暂未支持`），而这两族在内存态一律
 *     `400 未接入最优化引擎` ——**能装配的解不了，解得了的装配不出**。
 *   于是页4「方案寻优」的前沿图只能永远显示规格占位。
 *
 * **Y（本文件）**：把「从本体装配一份可解模型」做成**一等能力**并给它出口 ——
 *   输入只有「要优化什么范围」，输出是一份**可直接 POST 到 `/a/v1/sim/optimize-pareto`
 *   的完整 `ParetoRequest`**（族 + args + 两个真目标 + 杠杆网格），或一句诚实的「装配不出 + 缺哪格」。
 *
 * ══ 零业务常数（R14）：本文件不认识任何行业实体名 ══════════════════════════════
 * 角色→本体的映射**全部现推**，判据只有三类，且三类都与行业无关：
 *   ① **命名词库** `field-role-lexicon.ts`（配置化，A13/`assembleBaselineFromSelection` 同一份，
 *      不在本文件另抄一套正则）；
 *   ② **结构信号**：数值字段 / 主键 / ref 指向谁 / 有几行实例；
 *   ③ **目标接地度**：能把更多**真目标**接上地的候选优先（落点是下文 `groundsCost` 那一档排序）。
 * 换个租户换套本体 ⇒ 这里推出来的类型/字段全变，**代码一行不动**（这正是 R14 要的那件事）。
 *
 * ══ 诚实红线（不许兜假模型）═══════════════════════════════════════════════════
 * 帕累托前沿要**两个真目标**才成立。本装配器只声明**接得到地的**目标：
 *   · `revenue` ← 订单侧营收字段（必需，接不到就整单报缺）
 *   · `penalty` ← 订单侧成本/违约字段（可选，接不到就**不声明这个目标**）
 *   · `cost`    ← 占用成本（可选，来自显式可产对的成本字段，或每线一个标量占用成本）
 * 真目标 < 2 ⇒ `applicable:false`，**绝不**补一个恒为 0 的第二目标 ——
 * 那样屏上会出现一条"前沿"，而它是假的：所有点在那一维上并列，支配关系全由另一维决定，
 * 用户看到的"权衡"根本不存在。
 *
 * ══ 确定性 R6 ═══════════════════════════════════════════════════════════════
 * 无 `Date` / 无 `Math.random`；每一次候选挑选都有**全序** tiebreaker（末位一律 `key` 字典序）；
 * 档位去重 + 升序；`bindCrossObjectOccupancy` 自身按 id 稳定排序。
 * ⇒ 同租户同范围重跑，`JSON.stringify(request)` 逐字节一致。
 */
import type {
  ParetoAssembleRequest,
  ParetoAssembleResult,
  ParetoAssembleRole,
  ParetoLeverGrid,
  ParetoObjective,
  ParetoObjectiveGap,
  ParetoRequest,
} from "@platform/contracts";
import { ParetoRequestSchema } from "@platform/contracts";
import type { OntologyBinding } from "@platform/contracts";
import type { ObjectInstance, ObjectTypeDef, PropertyDef } from "../domain.js";
import { CURRENCY_BASE_UNIT, CURRENCY_SCALE, lexiconHit } from "./field-role-lexicon.js";
import { bindCrossObjectOccupancy, type BindingOntologyView } from "./opt-binding.js";

/**
 * 装配侧的笛卡尔积保险丝。
 *
 * 与 `opt-pareto.ts` 的 `PARETO_MAX_ITERATIONS`（4096）**不是一回事**：那条是「调用方自己写的
 * 网格最大能多大」的硬上限；这条是「**我替调用方挑几根杠杆**」时的自我约束 ——
 * 装配器有权少挑几根，没权替用户等 4096 次求解。取 64 的理由是它够放下
 * 「3 档 × 3 根杠杆 = 27」这种典型网格，而在贪心求解（每次 O(订单×产线)）下仍是亚秒级。
 * ⚠ 这是**保险丝不是业务常数**：它只决定"挑几根"，不进任何一个系数。
 */
export const ASSEMBLE_MAX_CANDIDATES = 64;

/** 本文件今天能装配的族。写成数组而不是散在 if 里，是为了报缺时能把"能装哪些"原文说出来。 */
export const ASSEMBLABLE_FAMILIES = ["cross_object_occupancy"] as const;

const QUANT = 1e6;
const q = (x: number): number => Math.round(x * QUANT) / QUANT;

const numProps = (t: ObjectTypeDef): PropertyDef[] => t.properties.filter((p) => p.dataType === "number" && !p.isPrimaryKey);
const pkOf = (t: ObjectTypeDef): string | undefined => t.properties.find((p) => p.isPrimaryKey)?.propKey;
/** 命中某词库的数值字段，**按属性声明序**（与 `assembleBaselineFromSelection` 的 `.find` 同一口径）。 */
const hits = (t: ObjectTypeDef, role: Parameters<typeof lexiconHit>[1]): string[] =>
  numProps(t).map((p) => p.propKey).filter((k) => lexiconHit(k, role));
const refsTo = (t: ObjectTypeDef, typeKey: string): string[] =>
  t.properties.filter((p) => p.refToTypeKey === typeKey).map((p) => p.propKey).sort();

/** 一次装配用到的全部读本体入口（与绑定层同一个视图接口，不另造一套）。 */
export interface AssembleDeps {
  listTypes(tenantId: string): Promise<ObjectTypeDef[]>;
  listByType(tenantId: string, typeKey: string): Promise<ObjectInstance[]>;
}

const miss = (missingRoles: string[], note: string): ParetoAssembleResult => ({ applicable: false, missingRoles, note });

/**
 * 装配入口。**纯读**：不写任何仓储、不发任何事件、不落真值（R4）。
 *
 * @param deps    读本体（调用方注入 repos，本文件不认识 Repos）
 * @param tenantId R2：全程只读本租户，别租户一行都摸不到
 * @param input   「要优化什么范围」
 */
export async function assembleParetoModel(
  deps: AssembleDeps,
  tenantId: string,
  input: ParetoAssembleRequest,
): Promise<ParetoAssembleResult> {
  const family = input.family ?? ASSEMBLABLE_FAMILIES[0];
  if (!(ASSEMBLABLE_FAMILIES as readonly string[]).includes(family)) {
    return miss(
      [`family '${family}'`],
      `模板族 '${family}' 今天没有自动装配器（能装的：${ASSEMBLABLE_FAMILIES.join("、")}）。` +
        `⛔ 不替你猜一份 —— 猜出来的模型会算出一条看着正常、口径却是客户端另造的前沿。`,
    );
  }

  const types = (await deps.listTypes(tenantId)).filter((t) => t.status === "ACTIVE");
  if (types.length === 0) return miss(["ontology"], "本租户没有已发布（ACTIVE）的对象类型 —— 装配无从谈起（不造本体，DF.8）。");

  // ── 范围收窄：selection 点名哪个类型，就只让那些 id 参与 ────────────────────
  // 收窄的语义**由调用方给的类型决定**，本文件不替它判「你是想收窄订单还是收窄产能」。
  // 这一格是「产能真的不够用」得以发生的唯一开关：不收窄 ⇒ 全租户产能通常远大于总需求 ⇒
  // 所有订单恒获排 ⇒ 营收维恒定（那不是装配错了，是这个世界确实有余量，如实算出来即可）。
  const selByType = new Map<string, Set<string>>();
  for (const s of input.selection ?? []) {
    (selByType.get(s.objectType) ?? selByType.set(s.objectType, new Set()).get(s.objectType)!).add(s.objectId);
  }
  const pkByType = new Map(types.map((t) => [t.key, pkOf(t)]));
  const view: BindingOntologyView = {
    listTypes: (tid) => deps.listTypes(tid),
    listByType: async (tid, typeKey) => {
      const objs = await deps.listByType(tid, typeKey);
      const want = selByType.get(typeKey);
      if (!want || want.size === 0) return objs;
      const pk = pkByType.get(typeKey);
      return objs.filter((o) => want.has(o.id) || (pk ? want.has(String((o.props as Record<string, unknown>)[pk])) : false));
    },
  };
  /** 收窄**之后**的行数（= 真正会喂给求解器的那批行，不是全库计数）。 */
  const counts = new Map<string, number>();
  const rowCount = async (typeKey: string): Promise<number> => {
    const c = counts.get(typeKey);
    if (c !== undefined) return c;
    const n = (await view.listByType(tenantId, typeKey)).length;
    counts.set(typeKey, n);
    return n;
  };

  // ── ① 需求侧（order 角色）───────────────────────────────────────────────
  // 判据三条，缺一不可：名字像敞口叶层（leaf 词库）· 有"量"的数值字段 · 有"价"的数值字段。
  // 只靠名字会挑中一个没有任何系数的空壳类型，装配"成功"而求解器抛无关错误
  // （`WO-OPT-WHATIF-CLOSE` 记过的那个 `MaintenanceOrder` 坑：名字像、零实例、报错与病因无关）。
  const leafTypes = types.filter((t) => lexiconHit(t.key, "leaf"));
  const orderShaped = leafTypes.filter((t) => hits(t, "demand").length > 0 && hits(t, "revenue").length > 0);
  if (orderShaped.length === 0) {
    return miss(
      [`order（无「命中订单/客户词库 且 同时带 量(demand) + 价(revenue) 数值字段」的对象类型）`],
      leafTypes.length === 0
        ? "本体里没有命中订单/客户词库的对象类型。"
        : `命中词库的有 ${leafTypes.map((t) => t.key).sort().join("、")}，但它们身上凑不齐「量 + 价」两个数值字段 ——` +
          `缺哪个就编哪个的话，营收维会变成假的。`,
    );
  }
  const orderCounts = new Map<string, number>();
  for (const t of orderShaped) orderCounts.set(t.key, await rowCount(t.key));
  const orderNonEmpty = orderShaped.filter((t) => (orderCounts.get(t.key) ?? 0) > 0);
  if (orderNonEmpty.length === 0) {
    return miss(
      [`order（形状对得上的类型在选中范围内一行都没有：${orderShaped.map((t) => t.key).sort().join("、")}）`],
      "早报缺好过让求解器抛「需 orders[]」—— 那句报错与真实病因（这个类型是空的）无关。",
    );
  }
  // 全序：行多者优先（数据更实） → key 字典序。
  const orderT = [...orderNonEmpty].sort((a, b) => (orderCounts.get(b.key) ?? 0) - (orderCounts.get(a.key) ?? 0) || a.key.localeCompare(b.key))[0]!;
  const revProp = hits(orderT, "revenue")[0]!;
  const qtyProp = hits(orderT, "demand")[0]!;
  /**
   * 违约/罚金（可选）：订单侧命中**成本**词库、且不是营收那一格的数值字段。绑不到 ⇒ 不声明 penalty 目标。
   *
   * ⚠ WO-UNITCOST-LAND 加的第二个判据 `!lexiconHit(k, "unitRate")`——**没有它就是一处静默错绑**：
   * 新增的 `OrderLine.unitCost` 同时命中 `cost` 词库（含 "cost"）与 `unitRate` 词库
   * （该词库原文已含 `单位成本|unitcost|unit_cost`），而本行原本只排除 `revProp` ⇒
   * `unitCost` 会被抓去当 **penalty**（违约金）。后果不报错：罚金轴上出现一个 540–633 的
   * "每件料工费"，屏上完全正常，只是那根轴从此答非所问。
   * 判据本身是原理性的：**penalty 是总量（一单赔多少），强度量当不了总量**。
   * 今日实测本租户 `hits(OrderLine,"cost")` 加这一格前是**空**（penProp 本就 undefined），
   * 故这条守卫对既有行为逐字节无影响 —— 它守的是**新加的这一格不许走错门**。
   */
  const penProp = hits(orderT, "cost").find((k) => k !== revProp && !lexiconHit(k, "unitRate"));
  /**
   * WO-UNITCOST-LAND · **按件履约成本**这一格（可选）：订单侧命中 `cost` 词库**且**是强度量
   * （`unitRate`）、且不是营收那一格。绑到 ⇒ 声明 role `unit_cost`，绑定层据此把
   * `unitCost × qty` 加进 `eligibility[].cost`，成本侧与营收侧从此**同阶**。
   *
   * 绑不到 ⇒ 不声明该 role，成本仍只有按指派那一笔（既有行为逐字节不变）——
   * 这正是上一单在毛利轴注释里写下的那句「今天没有这一格」的**现算版本**，不是永久结论。
   */
  const unitCostProp = hits(orderT, "cost").find((k) => k !== revProp && lexiconHit(k, "unitRate"));
  /**
   * WO-MARGIN-AXIS：营收这一格是**强度量（单价）**还是**总量（金额）**？
   *
   * 判据只有命名（`ROLE_LEXICON.unitRate`）—— 数值上单价与金额长得一模一样，分不出。
   * 本租户实测命中：`OrderLine.unitPrice`（元/件）⇒ 强度量 ⇒ 必须 × `OrderLine.qty` 才是营收。
   * 不命中（如某租户绑的是 `lineAmount` / `营收额`）⇒ 按总量直取，行为与本单之前逐字节一致。
   */
  const revIsUnitRate = lexiconHit(revProp, "unitRate");

  // ── ② 资源侧（line 角色）───────────────────────────────────────────────
  // 候选 = 带"产能/上限"数值字段且在范围内有实例的类型（订单类型自己除外）。
  // **排序判据的第一档是「能把 cost 这个真目标接上地吗」** —— 这不是审美偏好：
  // 接不上 ⇒ 只剩一个真目标 ⇒ 整单报缺。让"能装出真前沿"的候选优先，是本装配器
  // 唯一一处带目的性的排序，写在这里而不是散在下面，是为了它可被一眼读到、可被变异。
  const lineShaped = types.filter((t) => t.key !== orderT.key && hits(t, "capacity").length > 0);
  const lineCounts = new Map<string, number>();
  for (const t of lineShaped) lineCounts.set(t.key, await rowCount(t.key));
  const lineNonEmpty = lineShaped.filter((t) => (lineCounts.get(t.key) ?? 0) > 0);
  if (lineNonEmpty.length === 0) {
    return miss(
      [`line（无「带产能/上限数值字段 且 在选中范围内有实例」的对象类型）`],
      lineShaped.length === 0
        ? "本体里没有带产能/上限数值字段的对象类型 —— 没有被占用的资源，「跨对象占用」这件事就不存在。"
        : `形状对得上的有 ${lineShaped.map((t) => t.key).sort().join("、")}，但在选中范围内都没有实例。`,
    );
  }
  const groundsCost = (t: ObjectTypeDef): number => (hits(t, "cost").length > 0 ? 0 : 1); // 0 排前
  const lineT = [...lineNonEmpty].sort(
    (a, b) => groundsCost(a) - groundsCost(b) || (lineCounts.get(b.key) ?? 0) - (lineCounts.get(a.key) ?? 0) || a.key.localeCompare(b.key),
  )[0]!;
  const capProp = hits(lineT, "capacity")[0]!;
  /**
   * 每线占用成本：**照搬同仓 `facility_location` 的 `open_cost` / `assign_cost` 二分**
   * （`opt-binding.ts` 第 128–129 行：第一个成本字段是"固定开设成本"，**第二个**才是"每次指派成本"）。
   * 只有一个成本字段时它就是指派成本。⛔ 不新发明一套口径 —— 两处口径不同，同一个本体
   * 在选址页和寻优页会算出两套成本，那正是 R13 点名的漂移源。
   */
  const lineCosts = hits(lineT, "cost");
  const assignCostProp = lineCosts.length >= 2 ? lineCosts[1]! : lineCosts[0];

  // ── ③ 可产对（eligibility 角色·可选）────────────────────────────────────
  // 结构判据：一个既 ref 订单类型、又 ref 资源类型的类型 = 显式"这单能不能上这条线"。
  // 找不到 ⇒ 交给绑定层走 defaulted（全资格全通）并把 `eligibilityDefaulted` 举起来。
  const eligShaped = types.filter((t) => t.key !== orderT.key && t.key !== lineT.key && refsTo(t, orderT.key).length > 0 && refsTo(t, lineT.key).length > 0);
  const eligCounts = new Map<string, number>();
  for (const t of eligShaped) eligCounts.set(t.key, await rowCount(t.key));
  const eligT = [...eligShaped.filter((t) => (eligCounts.get(t.key) ?? 0) > 0)].sort(
    (a, b) => (eligCounts.get(b.key) ?? 0) - (eligCounts.get(a.key) ?? 0) || a.key.localeCompare(b.key),
  )[0];
  const eligCostProp = eligT ? hits(eligT, "cost")[0] : undefined;

  // ── ④ 写绑定 → 交给既有绑定层装 args（DF.8 接地在那里做，本文件不另写一份校验）──
  const roleBindings: OntologyBinding["roleBindings"] = [
    { role: "order", bind: { kind: "objectType", ref: orderT.key } },
    { role: "line", bind: { kind: "objectType", ref: lineT.key } },
    // WO-MARGIN-AXIS：**单价**（强度量）与**金额**（总量）绑不同的 role —— 判据是词库，
    // 不是猜。绑错的后果不报错、只静默算错（见 `revIsUnitRate` 那一段）。
    { role: revIsUnitRate ? "unit_revenue" : "revenue", bind: { kind: "property", ref: `${orderT.key}.${revProp}` } },
    { role: "qty", bind: { kind: "property", ref: `${orderT.key}.${qtyProp}` } },
    { role: "line_capacity", bind: { kind: "property", ref: `${lineT.key}.${capProp}` } },
    ...(penProp ? [{ role: "penalty", bind: { kind: "property" as const, ref: `${orderT.key}.${penProp}` } }] : []),
    // WO-UNITCOST-LAND：按件履约成本（强度量）与按指派成本（总量）绑不同的 role，判据是词库不是猜 ——
    // 与上面 `unit_revenue` / `revenue` 那一对完全对称。绑错同样不报错、只静默算错。
    ...(unitCostProp ? [{ role: "unit_cost", bind: { kind: "property" as const, ref: `${orderT.key}.${unitCostProp}` } }] : []),
    // 每线标量占用成本：绑定层的优先级是 `elig_cost` > `line_assign_cost` > 0，
    // 故这一格**无条件**绑上去（有可产对成本时它自动让位），少一个分支少一处漂移。
    ...(assignCostProp ? [{ role: "line_assign_cost", bind: { kind: "property" as const, ref: `${lineT.key}.${assignCostProp}` } }] : []),
    ...(eligT
      ? [
          { role: "eligibility", bind: { kind: "objectType" as const, ref: eligT.key } },
          { role: "elig_order", bind: { kind: "property" as const, ref: `${eligT.key}.${refsTo(eligT, orderT.key)[0]!}` } },
          { role: "elig_line", bind: { kind: "property" as const, ref: `${eligT.key}.${refsTo(eligT, lineT.key)[0]!}` } },
          ...(eligCostProp ? [{ role: "elig_cost", bind: { kind: "property" as const, ref: `${eligT.key}.${eligCostProp}` } }] : []),
        ]
      : []),
  ];
  const binding: OntologyBinding = {
    id: `pareto_autobind_${tenantId}_${family}`,
    tenantId,
    templateKey: family,
    scope: { selection: (input.selection ?? []).map((s) => `${s.objectType}:${s.objectId}`).sort() },
    roleBindings,
    coeffSource: "property",
    status: "PUBLISHED",
  };
  // WO-MARGIN-AXIS：`alignCurrency` 把营收/罚金/成本折到同一个基准货币单位（`元`）——
  // 毛利轴的前置。折不动时绑定层回 `currencyAligned:false`，下面据此报缺而不硬算。
  const args = await bindCrossObjectOccupancy(view, binding, { seed: input.seed, alignCurrency: true });
  const lines = (args.lines as { id: string; capacity: number }[]) ?? [];
  const orders = (args.orders as { id: string }[]) ?? [];
  const assignCostBound = args.assignCostBound === true;

  if (orders.length === 0 || lines.length === 0) {
    return miss(
      [orders.length === 0 ? `order（${orderT.key} 装配后 0 行）` : `line（${lineT.key} 装配后 0 行）`],
      "绑定层装出来是空的 —— 通常是 selection 把范围收窄到了空集。",
    );
  }

  // ── ⑤ 目标：只声明**接得到地的**（真目标 < 2 ⇒ 整单报缺，不补假目标）──────────
  // 键名 `revenue`/`penalty`/`cost` 来自**引擎回包**（`objectiveValues`），是求解器契约不是行业词。
  //
  // ══ WO-PARETO-AXES · 今天的行为是 X，应该是 Y（开工实测，本机 4531 内存态 demo 租户）══
  //
  // **X**：本装配器只声明 `revenue`（← `OrderLine.unitPrice`）与 `cost`（← `Base.serveCost`）
  //   两根轴。屏上那条前沿于是在权衡「**单价** vs **单位需求点履约成本**」——
  //   而这两样都不是经营者要权衡的东西，更要命的是**它们各自都不是一个总量**（下面 ⚠ 段）。
  // **Y**：把「**交付**」这一维接上（它一直被真算着、只是从没投影出来），
  //   并把「毛利 / 现金」两根**今天接不上地**的轴**显式点名报缺**，而不是留白。
  //
  // ══ WO-MARGIN-AXIS · 毛利轴：从「报缺」变成「真轴」（本段替换上一单的两条阻断）══
  //
  // 上一单（WO-PARETO-AXES）在这里写下两条阻断，判定「今天没有任何一种减法能得到毛利」。
  // 本单把两条都拆了 —— **两条阻断的原文与它们各自的死因**：
  //
  //   ① **量纲不同**（原文：`unitPrice` 元 vs `serveCost` 万元，直接相减差 10⁴ 倍）。
  //      死因：这从来不是「算不出」，是「**没折算**」。「万元 = 10⁴ 元」是单位定义不是业务常数，
  //      折算表 `CURRENCY_SCALE` 现落在词库文件里，绑定层按本体声明的 `unit` 现折
  //      （`alignCurrency`），折不动就回 `currencyAligned:false` —— 那时本段仍报缺。
  //      ⇒ 这一条**按本体现算**，不是永久结论。
  //
  //   ② **两边都缺"用量"**（原文：一行 4,343 件与一行 417 件贡献同一份"营收"）。
  //      死因：**只有营收侧是错的，成本侧不是**。这一条把两件不同的事写成了一句 ——
  //      · **营收侧确实错**：绑的是 `unitPrice`（元/**件**，强度量），求和前必须 × `qty`。
  //        实测同型号 `SO-900030-L2`(qty 722) 与 `SO-900215-L1`(qty 7220) 各贡献同一个 21,626。
  //        修法 = 新 role `unit_revenue`（判据是词库 `unitRate`，不是猜）。
  //      · **成本侧不该乘 qty**：`serveCost` 在本体上自述「万元/**需求点**·年」——
  //        它按**指派**计价，不按件计价。同仓 `facility_location` 的 `assign_cost` 是同一口径
  //        （`optimizer-client.ts` 那句「把需求点指派到开着的设施(assignCost)，min Σ开设+Σ指派」），
  //        `opt-binding.ts` 的 `line_assign_cost` 注释也明写是照搬它。
  //        ⇒ 给它乘 `qty` 会**凭空造出一个本体从未声明的「万元/件」口径**。
  //        ⛔ 这正是下面那条红线的同族：补一根**算得出但算错**的轴，比补一根恒为 0 的更危险 ——
  //        恒为 0 的一眼看得出是假的，算错的那根看起来完全正常。故**不乘**。
  //
  // ══ WO-UNITCOST-LAND · 上一段末尾那句「今天没有这一格」**已过期，此处按 0.6 回写** ══
  //
  // 上一单在这里留下的原话是：「毛利轴今天答的是『这批单赚多少』，不是『单位经济学上哪个方案
  // 更划算』—— 后者要本体先给出**按件计价的履约成本**（`万元/件` 或 `元/件`），今天没有这一格。」
  // 它当时是对的，**今天不再成立**：本体已给出这一格 —— `OrderLine.unitCost`（元/电芯，
  // 由该型号当期 BOM 现算：Σ quantity ×(1+lossRate)× Material.unitPrice），
  // 装配器命中 `cost ∩ unitRate` 即绑 role `unit_cost`，绑定层把 `unitCost × qty`
  // **加进** `eligibility[].cost`（加性叠加，不替换按指派那一笔 —— 料工费与占线费是两笔钱）。
  //
  // ⚠ **上一段那条「不该乘 qty」的红线仍然完全有效，且正是本单的做法**：
  //   被乘 `qty` 的是**新的那一格**（本体自述按件计价的强度量），
  //   `serveCost`（万元/需求点·年）**依旧不乘** —— 它仍按指派计价。
  //   两笔钱各按各的口径计价，谁都没有被凭空改口径。
  //
  // ⚠ 仍须如实说出口的性质：成本占毛利的比重由此从**0.331% 升到 3.272%**（实测，同一批单），
  //   毛利轴与营收轴**不再是强同向**（实测前沿 19 → 22，被支配 8 → 5）。
  //   但按件成本今天只含**物料**（BOM 口径），不含人工/制造费用/物流 ——
  //   ⛔ 这一句不许省：它决定了这根轴答的是「料成本口径的单位经济学」，不是完全成本。
  const revUnit = orderT.properties.find((p) => p.propKey === revProp)?.unit;
  const costOwner = eligT && eligCostProp ? eligT : lineT;
  const costPropKey = eligT && eligCostProp ? eligCostProp : assignCostProp;
  // WO-UNITCOST-LAND：按指派那一格没绑、只绑了按件那一格时，成本轴的单位取后者 ——
  // 否则会回一个 `undefined` 单位，而那时成本轴明明有真数据（读数无量纲 = 又一种静默失真）。
  const costUnit = costPropKey
    ? costOwner.properties.find((p) => p.propKey === costPropKey)?.unit
    : unitCostProp
      ? orderT.properties.find((p) => p.propKey === unitCostProp)?.unit
      : undefined;
  /**
   * 毛利轴的**准入证**（三样缺一不可，判据全部现算，一个都不是写死的）：
   *   ① 绑定层确认两侧已折到同一基准货币单位（`currencyAligned`，它自己也是现算的）；
   *   ② 成本这一维**有真数据**（`assignCostBound` —— 没绑时 cost 恒 0，
   *      `revenue − 0` 只是营收的复制品，那是一根**冗余轴**不是毛利）；
   *   ③ 营收侧刻度取得到（`revScale`）—— 取不到说明那一格声明了非货币单位。
   * 任何一样不成立 ⇒ 毛利仍进 `unavailableObjectives` 报缺，**不硬算**。
   */
  const currencyAligned = args.currencyAligned === true;
  const marginAvailable = currencyAligned && assignCostBound;
  /**
   * 对外报的单位：折齐了就是基准货币单位，**没折齐就各报各在本体上原样声明的那个**。
   *
   * ⛔ 两根轴必须**各算各的**，不许共用一个变量 —— 共用时「没折齐」这一支会把营收侧的单位
   * 抄给成本轴（实测本租户那对：营收「元」、成本「万元」），屏上于是印出一个
   * **单位是元、数值却是万元**的成本读数。这比不标单位更坏：不标时用户知道自己不知道。
   */
  const moneyUnitOf = (declared: string | undefined): string | undefined => (currencyAligned ? CURRENCY_BASE_UNIT : declared);
  const revMoneyUnit = moneyUnitOf(revUnit);
  const costMoneyUnit = moneyUnitOf(costUnit);
  /** 营收轴的人读式：单价路要把 `× 用量` 写出来，否则屏上仍读作"单价"。 */
  const revenueLabel = revIsUnitRate ? `${orderT.key}.${revProp} × ${orderT.key}.${qtyProp}` : `${orderT.key}.${revProp}`;
  /**
   * 成本轴的人读式。WO-UNITCOST-LAND：按件那一笔绑上了就**必须写进来** ——
   * 只印按指派那一格，屏上会把一个已含料工费的数读成"占线成本"，
   * 与营收轴当初不写 `× 用量` 时被读成"单价"是同一个病（见 `revenueLabel`）。
   */
  const assignCostLabel = eligT && eligCostProp ? `${eligT.key}.${eligCostProp}` : `${lineT.key}.${assignCostProp}`;
  const costLabel = unitCostProp
    ? `${assignCostLabel} + ${orderT.key}.${unitCostProp} × ${orderT.key}.${qtyProp}`
    : assignCostLabel;
  /**
   * 成本轴放进**减法**里时要带括号 —— 实测踩到过：成本轴自己是两项相加时，
   * 毛利标签渲染成 `营收 − A + B×qty`，按四则运算读**恰好把成本的第二项加成了收益**，
   * 与真实算法（`margin = revenue − cost`，cost 是那两项之和）相反。
   * 数是对的、**字是错的**，而用户只看得到字 —— 同 `revenueLabel` 不写 `× 用量` 那个病。
   */
  const costLabelInSubtraction = unitCostProp ? `(${costLabel})` : costLabel;

  /**
   * **接得到本体字段的**真目标 —— 「真目标 < 2 ⇒ 整单报缺」这条红线**只数这一批**。
   *
   * ⚠ 下面那根 `serviceRate`（交付）**刻意不在这个数组里**，理由见它自己的注释段：
   *   它是引擎的结构读数，不是从本体字段接出来的，**不许拿它去凑够两个**。
   */
  const groundedObjectives: ParetoObjective[] = [
    { key: "revenue", dir: "max", label: revenueLabel, ...(revMoneyUnit ? { unit: revMoneyUnit } : {}) },
    ...(penProp ? [{ key: "penalty", dir: "min" as const, label: `${orderT.key}.${penProp}` }] : []),
    ...(assignCostBound
      ? [{ key: "cost", dir: "min" as const, label: costLabel, ...(costMoneyUnit ? { unit: costMoneyUnit } : {}) }]
      : []),
  ];

  // ── ⑤b 要不到的轴：**点名 + 说清最近的落点**（留白会被读成"这一维没问题"）─────
  const cashProps = hits(orderT, "cashCycle");
  // ⚠ 下面两条 `reason` 是**上屏的正文**，不是源码注释 —— 一律写成纯文本。
  //   本仓注释里的 `**强调**` 是给读代码的人看的 Markdown；原样丢进 `<div>` 只会
  //   在用户屏上印出四个星号（2026-09-03 真浏览器实测就是这么翻车的：
  //   屏上出现「**没有时间维**」）。屏上没有 Markdown 渲染器，就不许用 Markdown 语法。
  const unavailableObjectives: ParetoObjectiveGap[] = [
    // 毛利：**接得上就不进这份清单**（它此时是一根在册的真轴，见 `marginAvailable`）。
    // 接不上才报缺，且必须说清**卡在哪一格** —— 两个死因的修法完全不同，混成一句就没人知道去补什么。
    ...(marginAvailable
      ? []
      : [{
          key: "margin",
          label: "毛利",
          reason:
            `今天算不出：营收侧 ${orderT.key}.${revProp}（单位 ${revUnit ?? "未声明"}）与成本侧 ` +
            `${costPropKey ? `${costOwner.key}.${costPropKey}` : "未绑定"}（单位 ${costUnit ?? "未声明"}）` +
            (assignCostBound
              ? `量纲折不到同一个货币单位（可折的：${Object.keys(CURRENCY_SCALE).join("、")}），两个数直接相减没有意义。`
              : `成本这一维在本租户没有真数据（没有可产对成本字段，产线上也没有命中成本词库的数值字段）——` +
                `此时"毛利"等于营收的复制品，是一根冗余轴不是毛利。`) +
            `要补齐需先在本体上把这一格的单位声明成可折算的货币单位，并给出真实的占用成本字段。`,
        }]),
    {
      key: "cash",
      label: "现金",
      reason:
        `今天算不出：本族（${family}）是订单×产线×合同的指派问题，没有时间维 —— ` +
        `一个解里没有任何一单带着收付款发生在哪一天，现金周期无从起算。` +
        (cashProps.length > 0
          ? `${orderT.key} 上离它最近的字段是 ${cashProps.map((k) => `${orderT.key}.${k}`).join("、")}，但它是存量比率不是账期天数。`
          : `${orderT.key} 上没有任何命中账期/回款/现金词库的数值字段。`) +
        `要补齐需先在本体上给出账期天数（或收款日）并让求解族携带时间维。`,
    },
  ];
  if (groundedObjectives.length < 2) {
    return miss(
      [
        ...(penProp ? [] : [`penalty（${orderT.key} 上没有命中成本/违约词库的数值字段）`]),
        ...(assignCostBound
          ? []
          : [
              eligT
                ? `cost（可产对类型 ${eligT.key} 上没有命中成本词库的数值字段）`
                : `cost（没有「既引用 ${orderT.key} 又引用 ${lineT.key}」的可产对类型，且 ${lineT.key} 上没有命中成本词库的数值字段）`,
            ]),
      ],
      `只接地到 1 个真目标（revenue ← ${orderT.key}.${revProp}）。帕累托前沿要两个真目标才成立，` +
        `⛔ 这里**不补**一个恒为 0 的第二目标 —— 那样屏上会出现一条假前沿：所有点在那一维并列，` +
        `"权衡"根本不存在。请在本体上补齐上面点名的那一格。` +
        // ⚠ 这一句是给下一个读到这里的人的：交付（获排率）确实是一根真会动的轴，
        //   但它**不算**在这两个里 —— 它与 revenue 天然同向（服务得越多、营收越高），
        //   拿它凑数会得到一条所有点都单调排开的"前沿"，与"补一个恒为 0 的目标"是同一种假。
        `（交付/获排率不计入这两个：它由引擎结构读数派生、且与营收同向，凑不出真权衡。）`,
    );
  }

  // ── 交付这一维：一直被真算着，只是从没被投影成 metrics（三分法第二态）──────────
  // `cross_object_occupancy` 的回包里 `servedCount`/`orderCount` 与 `occupancy[]`/`displaced[]`
  // 出自同一次装入循环；`opt-pareto.ts` 的 `DERIVED_METRICS` 把它们折成 `serviceRate ∈ [0,1]`。
  // 修法是**补投影**，不是造字段 —— 这个数一天都没缺过，只是没人把它端上来。
  /**
   * ── 毛利这一维（WO-MARGIN-AXIS）──────────────────────────────────────────────
   * `margin = revenue − cost`，两侧已折到同一基准货币单位（准入证见 `marginAvailable`）。
   * 由 `opt-pareto.ts` 的 `DERIVED_METRICS` **逐解**现算 ⇒ 每个解一个值，随杠杆真变。
   *
   * ⚠ **它不是「白加一维」**：本仓明令禁止把 `GrossMarginBridge` 那种季度聚合当轴 ——
   * 那是 segment 级、period 固定、**不随解变化**的常量，在支配比较里永远打平。
   * 这一根不同：`revenue` 与 `cost` 都随杠杆网格变，`margin` 因此逐解不同
   * （本单实测前沿 12 个解上 12 个互不相同的毛利读数）。
   *
   * ⚠ **加它不会把前沿撑大**（这一条是数学性质，不是巧合，写下来免得下一个人担心）：
   * `margin` 在支配序上是 (`revenue`↑, `cost`↓) 的**单调函数** ——
   * 若 A 在 revenue 上不劣、在 cost 上不劣，则 `revA − costA ≥ revB − costB` 必然成立。
   * ⇒ 加这一维**不改变任何一对解的支配关系**，`frontier`/`dominated` 的划分逐条不变；
   * 它改变的是**加权名次**（权重面板多一根真滑杆）与屏上多一根可读的轴。
   */
  const marginObjective: ParetoObjective[] = marginAvailable
    // 毛利只在**折齐了**的分支里存在（`marginAvailable` 含 `currencyAligned`），
    // 故这里的单位恒是基准货币单位 —— 用 `revMoneyUnit` 而不是本体原样单位。
    ? [{ key: "margin", dir: "max", label: `毛利（${revenueLabel} − ${costLabelInSubtraction}）`, ...(revMoneyUnit ? { unit: revMoneyUnit } : {}) }]
    : [];

  /**
   * 完整轴集 = **毛利 · 交付** 打头，其后才是它们的构成项（营收 / 成本 / 违约）。
   *
   * ⚠ **顺序是有后果的，不是审美**：前端散点图取 `objectives` 的**前两根**当 X/Y
   * （`useParetoFrontier.ts` 的 `projectPareto`：`const [ax0, ax1] = axes`），
   * 雷达取前 6、候选卡取前 4。把毛利与交付放在前两位 ⇒ 屏上默认权衡的就是
   * 「赚多少 × 服务多少单」，而不是「单价 × 单位履约成本」那对谁都不看的组合。
   * 支配比较本身与顺序无关（`dominates` 遍历全集），故这一改**不动前沿**。
   *
   * ⚠ 交付叫**获排率**不叫**准时率**：本族是「订单×产线×合同」的指派问题，**没有时间维** ——
   *   一个解里没有任何一单带着"哪天交"，所以答不了准时。叫错名字就是把一个
   *   今天答不了的问题假装答了。
   */
  const objectives: ParetoObjective[] = [
    ...marginObjective,
    { key: "serviceRate", dir: "max", label: "获排率（获排单数 ÷ 总单数）", unit: "" },
    ...groundedObjectives,
  ];

  // ── ⑥ 杠杆：档位取自**实测取值的次序统计量**（最小/中位/最大），一个数都不编 ─────
  const capValues = [...new Set(lines.map((l) => q(l.capacity)))].sort((a, b) => a - b);
  if (capValues.length < 2) {
    return miss(
      [`lever（${lineT.key}.${capProp} 在选中范围内只有 ${capValues.length} 个不同取值）`],
      `杠杆需要至少两档才谈得上"网格"；只有一档 ⇒ 笛卡尔积只有 1 个候选，那不是前沿是一个点。` +
        `⛔ 不编第二档 —— 编出来的档位不是这个租户跑过的产能。`,
    );
  }
  /** 三档：最小 / 中位 / 最大。全是**这个租户真实存在过的产能读数**，非插值、非等分。 */
  const gridValues = [...new Set([capValues[0]!, capValues[(capValues.length - 1) >> 1]!, capValues[capValues.length - 1]!])].sort((a, b) => a - b);
  // 挑哪几条线当杠杆：**占用成本低者优先**（求解器优先占用它们 ⇒ 它们的档位才真的改变解），
  // 无成本维时退回产能小者优先（小的先成为瓶颈）；末位一律 id 字典序（全序·R6）。
  // 每条线的占用成本代表值 = 该线在 eligibility 里的**最小**成本（可产对形态下一条线可能
  // 对不同订单有不同成本；取 min 是"用它最便宜的那一格代表它"，全序且无随机）。
  const costOf = new Map<string, number>();
  if (assignCostBound) {
    for (const e of (args.eligibility as { line: string; cost: number }[]) ?? []) {
      const cur = costOf.get(e.line);
      if (cur === undefined || e.cost < cur) costOf.set(e.line, e.cost);
    }
  }
  const ranked = [...lines].sort(
    (a, b) => (costOf.get(a.id) ?? 0) - (costOf.get(b.id) ?? 0) || a.capacity - b.capacity || a.id.localeCompare(b.id),
  );
  let k = 0;
  while (k < ranked.length && Math.pow(gridValues.length, k + 1) <= ASSEMBLE_MAX_CANDIDATES) k += 1;
  const levers: ParetoLeverGrid[] = ranked.slice(0, k).map((l) => ({
    // target 语法与 `optimize_whatif` 的 DF.8 接地同一套（`opt-whatif.ts` 的 `resolveTarget`）：
    // `<集合>.<id>.<字段>`，且 id 必须真在 `args.lines` 里 —— 这里的 id 就是从 args 里取的。
    key: `lines.${l.id}.capacity`,
    label: l.id,
    values: gridValues,
  }));

  const request: ParetoRequest = ParetoRequestSchema.parse({
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    family,
    args,
    objectives,
    levers,
    unavailableObjectives,
    // ⛔ 不给 `constraints`：契约原话「不给 ⇒ 该解 bindings 为空数组，**不是**「没有约束」的断言」。
    //    上限是调用方声明的东西，装配器编一个出来就是在替用户定"什么算越界"。
    // ⛔ 也**不给 `weights`**：权重是**读者当场的偏好**，不是本体能装配出来的东西。
    //    装配器替用户预设一组权重 ⇒ 屏上那个"推荐方案"会显得像模型算出来的结论，
    //    而它其实只是装配器随手挑的一组系数。不给 ⇒ 求解侧等权，屏上滑杆全在中位。
  });

  const roles: ParetoAssembleRole[] = roleBindings
    .map((rb) => ({ role: rb.role, kind: rb.bind.kind, ref: rb.bind.ref }))
    .sort((a, b) => a.role.localeCompare(b.role));
  const unboundRoles = [
    ...(penProp ? [] : ["penalty"]),
    ...(eligT ? [] : ["eligibility"]),
    ...(args.contractBound === true ? [] : ["contract"]),
  ].sort();

  return {
    applicable: true,
    request,
    roles,
    unboundRoles,
    note:
      `装配自本租户已发布本体：${orderT.key}(${orders.length} 行) × ${lineT.key}(${lines.length} 行)；` +
      `目标 ${objectives.map((o) => `${o.key}←${o.label}`).join("、")}；` +
      `杠杆 ${levers.length} 根 × ${gridValues.length} 档 = ${Math.pow(gridValues.length, levers.length)} 个候选；` +
      `未绑定（诚实缺席，不伪造）：${unboundRoles.length ? unboundRoles.join("、") : "无"}；` +
      // 这一句与上面那句是**两件不同的事**，不许合并：`unboundRoles` 说的是「模型的某个角色没绑上」，
      // 这一句说的是「决策者点名要的某根**轴**今天接不上地」。前者影响解算，后者影响屏上少哪一列。
      `要不到的轴（已在屏上标注，不填编造值）：${unavailableObjectives.map((g) => g.label).join("、")}。`,
  };
}
