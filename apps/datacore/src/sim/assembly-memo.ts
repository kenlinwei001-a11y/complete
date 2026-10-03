/**
 * ══ 传导相装配结果的**按世界修订号备忘录** —— 世界没变就不重装 ══════════════════
 *
 * ── 病（2026-09-29 实测，真后端 `SEED_DEMO=1`，会话 `curTick=17`）────────────────
 * 服务端自己报的分段耗时里，`graph` 那一段（= `buildPropagationInputs` 的全部内容）
 * 是 **1374ms / total 2058ms = 67%**，而它每一跑都在做同一件事：
 * 把 12,499 个对象 + 13,593 条链路从仓储里**重读一遍**，装配成一张图。
 * 一次控制台推演会打 8 次这类请求（metric-series 1 · tick 1 · counterfactual 2 ·
 * pricing 逐候选 ≤4），**每一次都从零重装**。
 *
 * 四段剖析（同一跑实测，`PROFILE_ASSEMBLY=1` 临时探针，诊断完已拆）：
 *   `objects=581~773ms (12499 个) · links=139~212ms (13593 条) · pairWeights=422~578ms`
 *   `ruleParams≈0 · scope≈0 · cadenceGates≈2ms`
 * ⇒ 90% 落在两处：**读全量对象** 与 **逐实例分摊权重**。
 *
 * 它们的共同成本不在算法而在**读**：`MemStore.list` 的契约是值语义，
 * 每回一条就 `structuredClone` 一条（`repo/memory.ts`）。对照实验（克隆关掉、其余不动）：
 * `graph 1374 → 284ms`、`total 2058 → 421ms`，**那一次对照还是在更高负载下跑的**。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『这一步每次都得算』当作『它的输入每次都变了』的证据，
 * >   而前者并不度量后者 —— 输入压根没变，是我每次重读了一遍。」**
 *
 * ── 为什么复用是**安全**的（三条，逐条都在源码里核过）────────────────────────
 * ① 装配是**纯读**：`buildPropagationInputs` 只从仓储读、不回写，产物是入参的纯函数。
 * ② 它**不依赖调用者身份**：函数体里对 `c` 的 5 处使用全部是 `c.tenantId`
 *    （行级过滤 A6 不在这条路上，它在 `ontology-core.ts::resolveSlice` 与 REST 投影层）
 *    ⇒ 缓存键**不需要**含用户身份，不存在「越权读到别人的图」。
 * ③ 消费方**都只读**：`disclosure.ts`（countBy/长度）· `propagateTick`（`[...graph.objects].sort`
 *    是**先拷贝再排**）· `shadowFingerprint`（只哈希）。本模块另用 `deepFreeze` 把
 *    「只读」从**约定**升级成**机器先说话**：将来谁就地改它，当场 TypeError，而不是静默污染。
 *
 * ── 判据（为什么它**不会**给出旧世界）────────────────────────────────────────
 * 键里带**世界修订号**：`repos.{objects,links,ontologyTypes}.revision(tenantId)` ——
 * 任何一个仓写过一次就 +1。这三个仓的 `put/putMany/remove/removeWhere` 是**全部写入的漏斗**
 * （全仓 20+ 个调用点，包括 timeseries 聚合回写、derive 回写、Action 回写、connector 同步，
 * 全部经过它们）⇒ 在那里 +1 才是**全量**的。
 *
 * ⛔ 曾经想用 `epochs.current()`（现成的租户级单调序列）—— **实测不行，别改回去**：
 *   `repos.epochs.next()` 全仓只有 4 个调用点（`app.ts:7560/7654` · `ontology-core.ts:89` ·
 *   `ontology.ts:1583`），而 `repos.objects.put` 有 20+ 个 —— 两者**不重合**。
 *   拿 epoch 当判据 ⇒ 有些世界写（如 `simclock.ts` / `actions.ts` 那几条）**不会**让缓存失效
 *   ⇒ 引擎吃着一张旧图算数，而屏上**看不出来**。这正是本仓反复栽的静默错答。
 *   判据必须落在「**度量到的就是我要度量的那个东西**」上（铁律 0.6 判据）。
 *
 * ── 复用**不许**改变的东西（改了就白做）──────────────────────────────────────
 * · 复用只省掉**重装**，产出的 `PropagationInputs` 必须与重装**逐字节相同**（对照实验判据）。
 * · 未命中/拿不到修订号 ⇒ **退化成今天的行为**（重装），慢但一定对。
 * · 世界没变而结果变了，只能是我算错了 —— 键里没有的东西，一个都不许影响结果。
 */

/**
 * 命中/未命中/未启用计数 —— **进程级**，给测试与自查用（生产不读它）。
 *
 * 为什么需要它：「复用真的发生了」**不能靠毫秒数证明**（共享机负载会让 ms 抖到没法断言），
 * 而它恰恰是本模块唯一的性能主张。计数是确定性的读数：命中一次 = 少重装一遍全量本体。
 * ⚠ 读的时候取**增量**（`after - before`），别读绝对值 —— 同进程里别的会话也在记。
 * ⚠ `skipped` 是**未启用**的次数（`revision()` 回了 `null`，如 pg 模式）——
 *   它与 `misses` 分开记：一个是「本实现给不出全量判据，我诚实没缓存」，
 *   一个是「判据说世界变了，我重装」。
 */
export const assemblyMemoStats = { hits: 0, misses: 0, skipped: 0 };

interface Slot<V> {
  readonly rev: string;
  readonly value: V;
}

/**
 * 有界 LRU：`(租户, 范围)` → 最近一次装配的产物 + 它当时的**世界修订号**。
 *
 * 存的是修订号而不是「这个值多新」：命中判据是 `slot.rev === 现在的 rev`，
 * 世界一写，旧格**自动作废**（不需要任何失效通知 —— 那正是最容易漏一条的写法）。
 *
 * 容量取 4：一格装的是整张图（约 12.5k 对象行 + 13.6k 链路行，几 MB），
 * 控制台的实际形状是「少数几个范围来回打」，4 格足够。
 */
export class AssemblyMemo<V> {
  private readonly slots = new Map<string, Slot<V>>();

  constructor(private readonly cap: number = 4) {}

  get(key: string, rev: string): V | null {
    const s = this.slots.get(key);
    if (s === undefined) {
      assemblyMemoStats.misses += 1;
      return null;
    }
    if (s.rev !== rev) {
      // 世界写过 ⇒ 这一格作废。不删：下一次 put 会覆盖它（删了也只是同一件事）。
      assemblyMemoStats.misses += 1;
      return null;
    }
    // LRU：命中即提到最新。
    this.slots.delete(key);
    this.slots.set(key, s);
    assemblyMemoStats.hits += 1;
    return s.value;
  }

  put(key: string, rev: string, value: V): void {
    this.slots.delete(key);
    this.slots.set(key, { rev, value });
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

/**
 * 递归冻结（只走数组与普通对象；`Object.freeze` 是浅的，装配备忘录要的是**结构上**的只读）。
 *
 * 为什么要它：缓存命中的是**同一个对象实例**，多个请求共用。今天所有消费方都只读
 * （逐条核过，见文件头注 ③），但「今天是只读的」**不度量**「明天也是」——
 * 一个 `graph.objects.push(...)` 就会让**所有后续请求**读到一张被改过的图，而屏上正常。
 * 冻上之后这类改动当场抛 TypeError：把静默污染换成一次响亮的崩溃，值。
 */
export function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Object.isFrozen(v)) return v;
  Object.freeze(v);
  if (Array.isArray(v)) {
    for (const x of v) deepFreeze(x);
    return v;
  }
  for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  return v;
}

/**
 * 稳定序列化 —— 键序不影响结果。
 *
 * 为什么不用 `JSON.stringify` 裸调：`ResolvedSimScope` 是普通对象，键序取决于构造顺序；
 * 两个语义相同的范围若键序不同就会算出两个键 ⇒ **永远不命中**，而屏上一切正常
 * （这正是影子线第一版栽过的形态：判据恒假时，备忘录只是把成本加了一遍）。
 * 稳定化之后，命中不命中的原因只剩「世界/规则/范围真的变了没有」这一个。
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
