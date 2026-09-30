/**
 * ══ 影子线（world drift）的**按拍备忘录** —— 让同一份计算只算一次 ══════════════
 *
 * ── 病（2026-09-29 实测，真后端 `SEED_DEMO=1`，会话 `curTick=16`）────────────────
 * `POST …/tick` 的一次回包里，服务端自己报的分段耗时是：
 *   `graph 3464 · shadow 4549 · engine 1690 · persist 250 · total 10491 ms`
 * **影子线一项占 43%**，而它每一跑都在做同一件事：
 * ```ts
 * driftState = simState(s.baseSnapshot);
 * for (let t = 0; t < s.curTick; t++) { …propagateTick… }   // 从 tick 0 重放 curTick 拍
 * ```
 * 一次控制台推演会打 8 次这类请求（metric-series 1 · tick 1 · counterfactual 2 ·
 * pricing 逐候选 ≤4），**每一次都从 tick 0 重放**；会话活得越久，每一跑越贵。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『每次请求都重算一遍』当作『这个计算必须每次做』的证据，
 * >   而前者并不度量后者 —— 它的输入根本没变。」**
 *
 * ── 为什么它是**可**复用的（三条前提，逐条都在源码里核过）──────────────────────
 * ① `propagateTick` 是纯函数：头注写明 `state`「**只读，不被改**」，
 *    返回的 `next` 是 `cloneState(effState)`（新对象）⇒ 算出来的影子态可以留下当输入再用。
 * ② 影子线**不读真实世界线的历史**：它从 `s.baseSnapshot` 出发，与 `putTickState` 落的那些
 *    逐拍真实态**无关** ⇒ 推演落盘/回滚/建扰动都**不会**让它过期（这条不显然，见 ②b）。
 * ②b 唯一会让它过期的是「**它读的那几个入参变了**」—— 逐条列在下面的指纹里，一个不漏。
 * ③ 影子线**本来就不落盘**（它是度量装置不是第二条世界线）⇒ 本备忘录只活在进程内存里，
 *    进程重启后自动为空、退化成今天的行为（**慢，但一定对**）。
 *
 * ── 指纹覆盖了什么（以及**它为什么可以不含 `baseSnapshot`**）──────────────────
 * 指纹 = 影子计算真正吃进去的每一个入参：
 *   `scope` · `graph`（对象 id + 链路）· `rules`（含系数/延迟/合并式/闸门/权重口径/params）·
 *   `ruleParams` · `cadenceGates` · `pairWeights`。
 * ⚠ 刻意**不含** `baseSnapshot`、也不含 `curTick`：前者在会话创建后**没有写点**
 *   （`putSession` 的四个调用点：状态变更 · tick 进位 · disabledRuleKeys · 回滚，
 *   没有一个动 `baseSnapshot`），后者是备忘录的**键**的一部分（按拍存）。
 *   ⛔ 将来若有人加了一个会改 `baseSnapshot` 的写点，**必须同时把换掉的旧世界赶出本备忘录** ——
 *   否则影子线会读到上一版世界，而屏上是一个**看不出来**的错数。
 *   ⚠ 这条不变量**没有运行期判据**（第一版有一个，恒假、已删 —— 病历见 `ShadowMemo` 的类头注），
 *   守着它的是 `shadow-memo.seam.test.ts` §4 的源码扫描断言。
 *
 * ── 复用**不许**改变的东西（改了就白做）──────────────────────────────────────
 * · 复用只是**省掉重放**，产出的影子态必须与重放**逐字节相同**（对照实验判据）。
 * · 「有没有扰动才跑影子线」（`wantDrift`）这个条件本身不许动。
 * · 影子态**一个字节都不许进** `putTickState`。
 */

import { createHash } from "node:crypto";
import type { DelayedContribution, TickState } from "@platform/contracts";
import type {
  CadenceGateLookup,
  PairWeightLookup,
  PropagationGraph,
  RuleParamLookup,
} from "./propagation.js";
import type { PropagationRule } from "@platform/contracts";
import { rulesFingerprint } from "./rules-fingerprint.js";

/** 影子线在某一拍上的**全部**状态（态 + 延迟队列）。两者必须成对，故合成一个值。 */
export interface ShadowSnapshot {
  readonly state: TickState;
  readonly pending: readonly DelayedContribution[];
}

/** 备忘录的一格。 */
interface Slot {
  readonly tick: number;
  readonly snap: ShadowSnapshot;
}

/**
 * 延迟队列的**逐条拷贝**。
 *
 * ⚠ 只 `[...pending]` 是**不够的**：那只换掉了数组，元素还是同一批对象引用 ——
 *   调用方（或将来某个改 pending 的引擎版本）就地改一个 `amount`，
 *   改的就是备忘录里那一格，下一次命中会拿到被改过的队列。实测：`got.pending[0].amount = 999`
 *   之后重取，读到的是 **999** 而不是原值（`shadow-memo.seam.test.ts` §4 咬死这一条）。
 *   今天 `propagateTick` 走 `pending.filter(...)` **不就地改元素**（所以这是个潜伏缺陷，不是已发作的错），
 *   但那是引擎的实现细节，不是本文件的契约 —— 拷贝一遍的成本是几个扁平对象，不值得赌。
 */
const clonePending = (p: readonly DelayedContribution[]): DelayedContribution[] => p.map((x) => ({ ...x }));

// ⚠ 分隔符的值是一个 NUL（U+0000）—— **必须写成转义**，不许写成字面 NUL 字节：
//   字面 NUL 会让 git 把本文件判成 binary（`git diff` 只剩一句「Binary files differ」）、
//   grep 也只回「Binary file matches」⇒ **这个文件的每一次改动都没人能看见**。
const SEP = "\u0000";

/**
 * 影子线的输入指纹 —— **只哈希影子计算真正读到的那些值**。
 *
 * 为什么不用 `epoch` / `snapshotVersion` 这类现成的版本号（它们看起来更省）：
 * 那两个量度量的是「**本体写过没有**」，而这里要度量的是「**影子线的入参变没变**」——
 * 两者在规则表（不是对象）、`disabledRuleKeys`（会话级规则裁剪）、scope 这三处并不重合。
 * 拿一个近似量当判据，本仓已经栽过多次（铁律 0.6 第 5 条）。哈希的是**入参本身**，没有近似。
 *
 * 成本：对象 12.5k + 链路 13.6k 条小串过一遍 sha256，实测**远小于**它换掉的那 4,549ms。
 */
export function shadowFingerprint(i: {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly scopeKey: string;
  readonly graph: PropagationGraph;
  readonly rules: readonly PropagationRule[];
  readonly ruleParams: RuleParamLookup;
  readonly cadenceGates: CadenceGateLookup;
  readonly pairWeights: PairWeightLookup;
}): string {
  const h = createHash("sha256");
  // 顺序即语义的一部分：图里对象的遍历序/规则顺序变了 ⇒ 当另一份输入对待（宁可多算，不可错复用）。
  h.update(`t${SEP}${i.tenantId}${SEP}s${SEP}${i.sessionId}${SEP}${i.scopeKey}${SEP}`);
  h.update(`g${i.graph.objects.length}${SEP}`);
  for (const o of i.graph.objects) h.update(`${o.id}${SEP}${o.typeKey}${SEP}`);
  h.update(`l${i.graph.links.length}${SEP}`);
  for (const l of i.graph.links) h.update(`${l.fromId}${SEP}${l.toId}${SEP}${l.linkKey}${SEP}`);
  // 规则集走**共用的**指纹实现（`rules-fingerprint.ts`）——与装配备忘录同一份。
  // 各写一份就是两套真相源：将来给 `PropagationRule` 加字段，改了这边漏了那边，
  // 漏的那侧会「规则变了却仍然命中」，而屏上看不出来。
  // ⚠ 它**不含** `r.params`：引擎侧的 `PropagationRule` 上不带它（那是 Rule 领域类型上的字段），
  //   规则参数是经 `ruleParams` 那张查找表喂进引擎的 —— 而那张表就在下面被哈希了。
  h.update(rulesFingerprint(i.rules));
  // 下面三张查找表按**键排序**后再哈希：它们的键集由上面的图与规则决定，
  // 排序只是消掉「同内容不同遍历序」这种假差异（这三张表都很小）。
  for (const k of Object.keys(i.ruleParams).sort()) {
    h.update(`p${k}${SEP}${JSON.stringify(i.ruleParams[k] ?? null)}${SEP}`);
  }
  for (const k of Object.keys(i.cadenceGates).sort()) {
    h.update(`c${k}${SEP}${JSON.stringify(i.cadenceGates[k] ?? null)}${SEP}`);
  }
  const ruleKeysOfWeights = Object.keys(i.pairWeights).sort();
  for (const rk of ruleKeysOfWeights) {
    const pairs = i.pairWeights[rk] ?? {};
    h.update(`w${rk}${SEP}`);
    for (const pk of Object.keys(pairs).sort()) h.update(`${pk}${SEP}${String(pairs[pk])}${SEP}`);
  }
  return h.digest("hex");
}

/**
 * 命中/未命中计数 —— **进程级**，给测试与自查用（生产不读它）。
 *
 * 为什么需要它：「复用真的发生了」这件事**不能靠毫秒数证明**（共享机负载会让 ms 抖到没法断言），
 * 而它恰恰是本单唯一的性能主张。计数是确定性的读数：命中一次 = 少重放 curTick 拍。
 * 调用方读的时候取**增量**（`after - before`），别读绝对值 —— 同进程里别的会话也在记。
 */
export const shadowMemoStats = { hits: 0, misses: 0 };

/**
 * 有界 LRU：`(租户, 会话, 指纹)` → 最近物化的那一拍。
 *
 * 为什么**只留最近一拍**而不是每一拍都留：一个世界态是「12,499 对象 × 若干格」，
 * 逐拍全留会在长会话里把一个进程的内存吃穿。控制台的实际访问形状是
 * 「在同一拍上连打几次，然后进一拍」，所以最近一拍的命中率就是主要收益；
 * 未命中只是**退化成今天的行为**（重放），不会算错。
 *
 * ── ⛔ 这里**没有**「baseSnapshot 换过没有」的运行期判据，这是实测改掉的（别加回去）──────
 * 第一版拿 `s.baseSnapshot` 的**对象引用**当判据（同引用=没换过）。实测**恒不成立**：
 * `getSession` 两个实现都是**每次读都深拷一份**（memory `repo/memory.ts` 的 `clone` = `structuredClone`，
 * pg 侧走 JSON 反序列化）⇒ 同一份 baseSnapshot 每次读回来都是**新的对象**。
 * 后果不是"偶尔不命中"，是**永远不命中**：备忘录退化成纯粹的哈希开销（每请求把 2.6 万条入参过一遍 sha256），
 * 而**一行收益都没有** —— 而它看起来完全正常（计数在动、代码在跑、测试若无「必须命中」那条断言照样绿）。
 * 形态（铁律 0.6 句式）：
 * > **「我用『我写了复用』当作『复用真的发生了』的证据，而前者并不度量后者
 * >   —— 判据恒假时，备忘录只是把成本加了一遍。」**
 * 抓住它的是 `shadow-memo.seam.test.ts` §2 里那句「A 那一跑没有命中 ⇒ 本用例根本没验到『复用』」。
 *
 * 那么这一格凭什么仍然是对的？靠**一条不变量**（不是靠这个判据）：
 * > 一个会话的 `baseSnapshot` **只在建会话那一刻写一次**，此后终生不变。
 *
 * 该不变量由 `shadow-memo.seam.test.ts` §4 的**源码扫描**守着（剥注释后咬 `.baseSnapshot =`
 * 这种**赋值**：现在全仓零处）。将来谁加了会换 baseSnapshot 的写点，那条断言会先说话，
 * 他必须同时把换掉的旧世界从备忘录里赶出去 —— 否则影子线会读到一个**看不出来**的错世界。
 */
export class ShadowMemo {
  private readonly slots = new Map<string, Slot>();

  constructor(private readonly cap: number = 4) {}

  get(key: string, tick: number): ShadowSnapshot | null {
    const s = this.slots.get(key);
    if (s === undefined) { shadowMemoStats.misses += 1; return null; }
    if (s.tick !== tick) { shadowMemoStats.misses += 1; return null; }
    // LRU：命中即提到最新。
    this.slots.delete(key);
    this.slots.set(key, s);
    shadowMemoStats.hits += 1;
    // 返回**值**不是内部那一格：状态对象本身逐拍重放时是新建的（`propagateTick` 返回 `cloneState`），
    // 但数组与元素都是共享引用，故两样都要拷（见 `clonePending` 的理由）。
    return { state: s.snap.state, pending: clonePending(s.snap.pending) };
  }

  put(key: string, tick: number, snap: ShadowSnapshot): void {
    this.slots.delete(key);
    this.slots.set(key, { tick, snap: { state: snap.state, pending: clonePending(snap.pending) } });
    while (this.slots.size > this.cap) {
      const oldest = this.slots.keys().next();
      if (oldest.done === true) break;
      this.slots.delete(oldest.value);
    }
  }

  /** 现住在内存里的条目数（测试与自查用；生产路径不读它）。 */
  get size(): number {
    return this.slots.size;
  }

  clear(): void {
    this.slots.clear();
  }
}
