import { validationError } from "../errors.js";

/**
 * WO-SILENT-WRONG-ANSWER-3 · 求解器**入参键名**归一 —— 单一出处（治 `G-SOLVER-ARG-KEY-DRIFT`）。
 *
 * ── 病是什么（实测·非推理，seed 42·真 `generateBattery` ctx·经 REST `/a/v1/solvers/{key}/invoke`）──
 *   ① `capacity_forecast` 只读 `args.base`，而**目录 `argHints` 里根本没有 `base` 这个键**
 *      （`catalog.ts` 声明 `{modelId, qty, weeks}`），兄弟求解器（`bottleneck_matrix` / `risk_timeline` /
 *      `affected_orders` / `base_capacity_outlook`）声明的又全是 `baseId`。于是照目录/照直觉传 `baseId`：
 *        `{modelId:"4680-NCM",qty:100,weeks:6,baseId:"changzhou"}` → capWanP50 **12.3016** · `scope:"ALL"` · 4 个基地
 *        `{modelId:"4680-NCM",qty:100,weeks:6,base  :"changzhou"}` → capWanP50 **5.5176**   · `scope:"BASE"` · 1 个基地
 *      前者与**完全不传基地**的输出**逐字节相同** —— 用户问「常州的产能预测」，拿到的是全网数字，页面不报错。
 *   ② `risk_timeline` 同病更重：目录 `argHints` 写的是 `{baseId, days}`，而求解器读的是 `{base, factor, horizon}`
 *      —— **两个声明键一个都不被读**。实测 `{baseId:"zaozhuang"}` 返回 8 张卡
 *      `[jiangmen,handan,zigong,xinyang,changzhou,chengdu,jinhua,hefei]`，**枣庄一张都不在里面**，
 *      且与不传任何参数的输出逐字节相同；`{days:7}` 与 `{}` 同样逐字节相同（窗口仍是 30 天）。
 *
 * ── 三态定性（铁律 0.5·三种"不工作"修法完全不同，混了必修错地方）──
 *   **不是**「没接线」：`base` 作用域在 `capacity.ts:424` / `risk.ts:575` 真接了、真收窄、真出 `scope:"BASE"`；
 *   **不是**「接了线没数据」：13 行 `Base` 全在 `SolverContext` 里，给 `base` 就真算出不同的数；
 *   **是**「**接了线接错地方**」—— 归一入口挂在**一个具体键名**上，而调用方（目录 argHints / 兄弟求解器惯例 /
 *   路由 `*ArgsFrom`）用的是**另一个键名**，多出来的键被 `Record<string,unknown>` 静默吞掉。
 *
 * ── 为什么是「治单源」而不是「每个消费方各加一个 `??`」──
 *   仓里已经有**三份手写的键名兜底**（各自只覆盖自己那一个求解器，且互不知道对方存在）：
 *     · `extended.ts` `carbon_footprint`：`str(args.baseName)!=="" ? args.baseName : args.base`
 *     · `extended.ts` `mitigation_select`：同形的 `baseName ?? base`
 *     · `service.ts`  `affected_orders`：靠 `args.baseId` 有无切分支（这条是**模式开关**，不是别名，故本表不收）
 *   再加第四份 = 把「一个概念两个名字」的债散成 N 份。本文件是**唯一**一份实现：
 *   一张表声明「这个求解器的这个维度，规范键是谁、历史别名有哪些」，在**唯一的派发点**
 *   （`SolverService.compute()`）统一归一，所有下游（REST invoke / runWithParams / 校准重放 / 规则 payload）
 *   拿到的都是规范键。
 *
 * ── 诚实位（本文件最要紧的一条）──
 *   同一维度**同时**给了规范键与别名、而且值不同 → **抛 `VALIDATION_ERROR`**，绝不"挑一个用"。
 *   静默挑一个 = 把本条要治的病换个地方犯（用户以为传了 A，系统按 B 算，屏上看不出来）。
 *
 * ── R6 确定性 ──
 *   纯函数、无时钟/无随机；未登记的求解器**原样返回同一个引用**（逐字节不变·加性可回退）；
 *   已登记但未命中任何别名时同样原样返回同一个引用。
 */

/**
 * `solverKey → { 规范键: [历史别名…] }`。
 *
 * 收录判据（别乱加）：**该别名今天真的会被调用方传进来，而求解器不读它** —— 即真实存在的静默丢参。
 * 反例（**故意不收**）：`affected_orders` 的 `baseId`/`base` —— 那是**模式开关**
 * （`service.ts:4519` `if (!args.baseId)` 走跨基地聚合分支 `affectedOrdersAggregate`，它自己读 `args.base`），
 * 两个键各有语义、都被读，归一反而会把「聚合表」变成「单基地明细」，是**改语义**不是**治丢参**。
 */
export const SOLVER_ARG_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  // 症①：目录声明 modelId/qty/weeks，`base` 连声明都没有；调用方照兄弟求解器惯例传 `baseId` → 静默全网。
  capacity_forecast: { base: ["baseId", "baseName"] },
  // 症②：目录声明 `{baseId, days}`，求解器读 `{base, factor, horizon}` —— 两个声明键一个都不被读。
  risk_timeline: { base: ["baseId", "baseName"], horizon: ["days"] },
  // 既有手写兜底收编到本表（`extended.ts` 那两处 `baseName ?? base` 因此删得掉）。
  carbon_footprint: { baseName: ["base", "baseId"] },
  mitigation_select: { baseName: ["base", "baseId"] },
  // ③ 派生意图（S08 齐套分析）：引擎半本单补了 base 作用域，键名同样两写法都认。
  kit_readiness: { base: ["baseId", "baseName"] },
};

/** 「这个键算不算给了」的唯一判据 —— `undefined`/`null`/空串（S20 卡片的中性默认就是 `""`）一律算**没给**。 */
function provided(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/** 值等价判据（对象 ref 也要能比）——只用于「两个键给了同一个东西吗」，不参与业务解析。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 松散 `args` → 规范键 `args`（**唯一入口**·在 `SolverService.compute()` 派发前调用一次）。
 *
 * 语义：
 *   · 未登记求解器 / 无别名命中 → **原样返回入参同一引用**（R6 逐字节加性）；
 *   · 只给了别名 → 值搬到规范键、**删掉别名键**（否则 `deriveExtendedArgs` 的 `...args` 会把它再拼回输出，
 *     变成"输出里既有 base 又有 baseName"的自相矛盾）；
 *   · 规范键与别名都给了且**值相同** → 删别名、留规范键（幂等·可重复调用）；
 *   · 规范键与别名都给了且**值不同** → **抛 400**（诚实缺席 > 静默挑一个）。
 */
export function normalizeSolverArgs(
  solverKey: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const spec = SOLVER_ARG_ALIASES[solverKey];
  if (!spec) return args;

  let out: Record<string, unknown> | undefined; // 惰性克隆：没命中就返回原引用
  for (const [canonical, aliases] of Object.entries(spec)) {
    const hitAliases = aliases.filter((a) => provided(args[a]));
    if (hitAliases.length === 0) continue;

    const canonicalGiven = provided(args[canonical]);
    // 多个别名互相打架（如同时给 baseId 与 baseName 且值不同）→ 同样是"传了两个不同的东西"，一并诚实拒绝。
    const refKey = canonicalGiven ? canonical : hitAliases[0]!;
    const refVal = args[refKey];
    for (const a of hitAliases) {
      if (!sameValue(args[a], refVal)) {
        throw validationError(
          `求解器 ${solverKey} 的「${canonical}」维度收到了互相冲突的两个键：` +
            `${refKey}=${JSON.stringify(refVal)} 与 ${a}=${JSON.stringify(args[a])}——` +
            `拒绝静默挑一个用（挑错了就是「用户以为传了 A、系统按 B 算」的静默错答）。` +
            `请只传其中一个；${canonical} 是本求解器的规范键，${aliases.join(" / ")} 是历史别名。`,
        );
      }
    }

    out ??= { ...args };
    if (!canonicalGiven) out[canonical] = refVal;
    for (const a of hitAliases) delete out[a];
  }
  return out ?? args;
}

/** 某求解器某规范键的别名集（供门脚本 / 目录 argHints 自检复用同一份表·不许另抄）。 */
export function aliasesOf(solverKey: string, canonical: string): readonly string[] {
  return SOLVER_ARG_ALIASES[solverKey]?.[canonical] ?? [];
}

/** 该求解器所有被本表认识的键（规范键 ∪ 别名）——门脚本用它判「目录声明的键到不到得了求解器」。 */
export function knownArgKeys(solverKey: string): Set<string> {
  const spec = SOLVER_ARG_ALIASES[solverKey];
  const s = new Set<string>();
  if (!spec) return s;
  for (const [canonical, aliases] of Object.entries(spec)) {
    s.add(canonical);
    for (const a of aliases) s.add(a);
  }
  return s;
}
