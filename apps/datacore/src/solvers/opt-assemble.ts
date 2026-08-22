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
  ParetoRequest,
} from "@platform/contracts";
import { ParetoRequestSchema } from "@platform/contracts";
import type { OntologyBinding } from "@platform/contracts";
import type { ObjectInstance, ObjectTypeDef, PropertyDef } from "../domain.js";
import { lexiconHit } from "./field-role-lexicon.js";
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
  // 违约/罚金（可选）：订单侧命中**成本**词库、且不是营收那一格的数值字段。绑不到 ⇒ 不声明 penalty 目标。
  const penProp = hits(orderT, "cost").find((k) => k !== revProp);

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
    { role: "revenue", bind: { kind: "property", ref: `${orderT.key}.${revProp}` } },
    { role: "qty", bind: { kind: "property", ref: `${orderT.key}.${qtyProp}` } },
    { role: "line_capacity", bind: { kind: "property", ref: `${lineT.key}.${capProp}` } },
    ...(penProp ? [{ role: "penalty", bind: { kind: "property" as const, ref: `${orderT.key}.${penProp}` } }] : []),
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
  const args = await bindCrossObjectOccupancy(view, binding, { seed: input.seed });
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
  const objectives: ParetoObjective[] = [
    { key: "revenue", dir: "max", label: `${orderT.key}.${revProp}` },
    ...(penProp ? [{ key: "penalty", dir: "min" as const, label: `${orderT.key}.${penProp}` }] : []),
    ...(assignCostBound
      ? [{ key: "cost", dir: "min" as const, label: eligT && eligCostProp ? `${eligT.key}.${eligCostProp}` : `${lineT.key}.${assignCostProp}` }]
      : []),
  ];
  if (objectives.length < 2) {
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
        `"权衡"根本不存在。请在本体上补齐上面点名的那一格。`,
    );
  }

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
    // ⛔ 不给 `constraints`：契约原话「不给 ⇒ 该解 bindings 为空数组，**不是**「没有约束」的断言」。
    //    上限是调用方声明的东西，装配器编一个出来就是在替用户定"什么算越界"。
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
      `未绑定（诚实缺席，不伪造）：${unboundRoles.length ? unboundRoles.join("、") : "无"}。`,
  };
}
