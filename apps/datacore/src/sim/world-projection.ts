/**
 * 唯一投影入口 —— 声明域在**世界态写出边界**上的单点执行 + 单源记账。
 *
 * 🔴 病灶（实测定稿，证据见 `docs/evidence/WO-NEGSEED-P3-receipt-vs-world.txt` ·
 *    `WO-NEGSEED-P3-coverage.txt`，根因链见 `docs/evidence/WO-DUE-CHANGE-rootcause.md`）：
 *   写世界态的路有**三条**（播种 `seed-world.ts` / 传导核 `propagation.ts` / C2 合成
 *   `spec-base-synthesis.ts`），而域（`STATE_VAR_DOMAINS`）只在**第二条**上执行、且在核**之内**；
 *   核之后的 C2 合成层每拍把规格格覆写为 `cur + λ·(base − rest)` ⇒ 刚夹到 0 的值被换成 `λ·base`。
 *   结果同一拍里回执 `saturations[]` 报「已夹到 0」、落盘 `/world` 读 **−59.724650**，逐位矛盾。
 *
 * 形态（铁律 0.6 句式）：**「我用『域表里有这一条声明』当作『这个量被夹住了』的证据，
 *   而前者并不度量后者。」**
 *
 * 本模块只做一件事：把「域」从**某个消费者的实现细节**提升为**值进入世界态的入口不变量**。
 * 三条写路收敛到本函数，且**记账发生在三条路全部写完之后**（调用方在 `putTickState` 之前调它）
 * ⇒ 「回执说的」与「落盘的」在定义上是同一个数。
 *
 * ⛔ 三条不许（违反即返工）：
 *  1. 不许复制 `saturateToDomain` 的几何 —— 那是第二真相源，两次投影的分歧只是时间问题。
 *  2. 不许把记账留在核里（两处记账 ⇒ 矛盾从「回执 vs 世界态」变成「回执 vs 回执」）。
 *  3. 不许丢掉判据 ①（下面那条防暗流护栏）—— `saturateToDomain` 在合法域内**不是恒等、且不幂等**，
 *     每拍无差别重投影会造出一条**与动力学无关的暗流**（实测 SET 150 与 SET 200 推 12 拍后
 *     只差 0.0222，而一次性压缩本该差 2.0833）。
 */
import type { SaturationEvent, StateVarDomainLookup, TickState } from "@platform/contracts";
import { round12, saturateToDomain, type KernelStateVarReport, type StateVarDisclosure } from "./propagation.js";

/** 一次投影的**单源**账（饱和 + 未声明点名 + 声明清单）—— 回执三处读面共用这一份形状。 */
export interface WorldProjectionLedger {
  /** 本次参与传导、且**有**声明取值域的状态量（排序）。 */
  declaredStateVars: string[];
  /** 本次参与传导、但**没有**声明取值域的状态量（排序）—— 不夹不衰减，靠点名保持诚实。 */
  undeclaredStateVars: string[];
  /** 本拍真实发生的饱和（排序）。空 = 没有任何读数越界。 */
  saturations: SaturationEvent[];
}

/**
 * 投影一格世界（就地改写 `world`），并产出**单源**账。
 *
 * @param world     待投影的世界态（就地改写：越界格被保序压回域内）。
 * @param tickStart **本拍入口前的那一份**（扰动相之前、核之前的输入）—— 判据 ① 的基线。
 *   两条路的取法（都**不是** `world` 自己，也**不许**用 `undefined` 表示"没有上一拍"）：
 *   · 普通拍：调用方在 `state = out.next` **之前**抓住的入参（`app.ts` 主线/影子线、
 *     `metric-series.ts` 三处同一形状）；
 *   · tick0（播种）：传**投影之前的那份种子世界**（`seed-world.ts` 逐格复制的一份）。
 *   🔴 为什么 tick0 **不能**传 `undefined`（"每格都算新读数"）：`saturateToDomain` 在合法域内
 *      **不是恒等**（膝点之外要压缩）⇒ 逐格投影会把域内的铸造值整体改掉一次，那正是 E2 要抓的
 *      「修法变成全世界重写」，且会推翻 P1 已经验过的铸造取值。传"投影前的自己"才两边都对：
 *      域内的格 `unchanged && !outsideHardBound` ⇒ **一个字节不动**；越界格走判据 ② **当场收回**
 *      —— tick0 实收 360 格，与 A4 的期望同源。
 * @param domains   与 `propagateTick` 第 10 位**同一份** `stateVarDomains`（⛔ 不许各取一份）。
 */
export function projectWorldCells(
  world: TickState,
  tickStart: TickState,
  domains: StateVarDomainLookup,
): WorldProjectionLedger {
  // 判据 ① **只压缩「这一拍真的产生了的新读数」**（WO-SATURATE-EXOGENOUS，原样自核内迁出）：
  //  ①' **本拍没有任何相位改动过这一格** ⇒ 它存的是上一拍**已压缩过的披露值**，不是新读数 ⇒ 不碰。
  //     基线取 `tickStart`（扰动相**之前**的入参，`cloneState`/`applyPerturbationToState` 都是深拷贝，
  //     全程没人改过它）—— 故"改动"含扰动落地/回退、衰减、延迟到货、传导贡献**全部四类**。
  //  ②  **例外：存量真的在硬边界之外**（种子里就有超界真值 —— `Line.blockedPressure` 实测 27.72–182.73）
  //     ⇒ 必须收回域内，否则"声明了 [0,100]"就成了一句假话。
  //     这一条**不会**退化成 ①' 的无限循环：压缩输出恒在开区间内 ⇒ 下一拍 ② 不再成立 ⇒ **最多夹一次**。
  // tick0 与普通拍**走同一条判据**，差别只在基线怎么取（见函数头注）：基线 = 投影前的种子世界 ⇒
  // 域内的格逐字节不动，只有越界格被收回。⛔ 别为了"让 tick0 也全覆盖"而在这里对 in-domain 格放行：
  // `saturateToDomain` 在域内不是恒等，放行 = 把膝点外的铸造值整体压一次 = 全世界重写（E2）。
  const saturations: SaturationEvent[] = [];
  const declaredSeen = new Set<string>();
  const undeclaredSeen = new Set<string>();
  for (const objId of Object.keys(world).sort((a, b) => a.localeCompare(b))) {
    const bucket = world[objId]!;
    const startBucket = tickStart[objId];
    for (const stateVar of Object.keys(bucket).sort((a, b) => a.localeCompare(b))) {
      const d = domains[stateVar];
      if (d === undefined) { undeclaredSeen.add(stateVar); continue; }
      declaredSeen.add(stateVar);
      const raw = bucket[stateVar];
      if (typeof raw !== "number") continue;
      const before = startBucket?.[stateVar];
      const unchanged = typeof before === "number" && before === raw;
      const outsideHardBound = raw < d.min || (d.max !== null && raw > d.max);
      if (unchanged && !outsideHardBound) continue; // 判据 ①：没产生新读数 ⇒ 一个字节不动
      const sat = round12(saturateToDomain(raw, d.min, d.max, d.restPoint));
      if (sat === raw) continue; // 带内 ⇒ 一个字节不动
      bucket[stateVar] = sat;
      saturations.push({ objectId: objId, stateVar, raw, value: sat, bound: sat > raw ? "min" : "max" });
    }
  }
  return {
    declaredStateVars: [...declaredSeen].sort((a, b) => a.localeCompare(b)),
    undeclaredStateVars: [...undeclaredSeen].sort((a, b) => a.localeCompare(b)),
    // 饱和按 (objectId, stateVar) 稳定排序（R6：同输入同字节，含"谁顶到了"这份清单）。
    saturations: saturations.sort(
      (a, b) => a.objectId.localeCompare(b.objectId) || a.stateVar.localeCompare(b.stateVar),
    ),
  };
}

/**
 * 把核的账（衰减解析情况）与入口的账（声明/未声明/饱和）合成**回执那一份** `StateVarDisclosure`。
 *
 * ⛔ 这是回包的唯一装配点：核不再自报这三样（否则「回执 vs 世界态」的矛盾会变成「回执 vs 回执」）。
 */
export function mergeStateVarDisclosure(
  kernel: KernelStateVarReport,
  ledger: WorldProjectionLedger,
): StateVarDisclosure {
  return {
    declaredStateVars: ledger.declaredStateVars,
    undeclaredStateVars: ledger.undeclaredStateVars,
    decayUnresolved: kernel.decayUnresolved,
    saturations: ledger.saturations,
    decayApplied: kernel.decayApplied,
  };
}
