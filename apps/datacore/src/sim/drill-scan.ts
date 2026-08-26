/**
 * WO-SIM-DRILL-P12 · G-DRILL-2 **卡点扫描器**（PRD-sim-drill-parallel-world §4.4）。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前实测）═══════════════════════════════════════
 * **X（今天）**：沙盘推完 tick 只得到一张 `TickState`（对象 × 状态变量的裸数值矩阵，
 *   实测 demo 世界 11,348 对象 × 36 变量 = 408,528 格）。屏上把它铺成节点色块，
 *   **没有任何东西回答「哪里卡住了」** —— 用户要自己从四十万个数里找异常。
 * **Y（应该）**：现算出三类结论：**卡点**（已越线）· **堵点**（结构上的必经咽喉）·
 *   **脆弱点**（快要越线），每条带阈值出处与原始读数，可下钻。
 *
 * ══ 阈值：A 方案（仓主已拍板）—— 取该变量在**本世界**里的分位数，零配置 ═════════
 * ⛔ 不许改成「配置红线」。理由不只是仓主定了，还有 R14：写死「利用率 > 85% 算紧张」
 * 是应用层业务常数，换行业即错；而「该变量最高的 5%」是**统计口径**，与行业无关。
 *
 * 三类的判据互斥（**由构造保证不重叠**，不是靠事后去重）：
 *   · **卡点**   value >  P95(该变量)          ——「已经越线了」
 *   · **脆弱点** P90 < value ≤ P95(该变量)     ——「还没越线，但在警戒带里」
 *   · **堵点**   与数值无关，是**结构**属性     ——「传导图上的咽喉」`when = null`
 *
 * ══ severity 一律用**百分位秩 × 100**（0–100，与 `tightness` 同口径）═══════════
 * 为什么不用原始值：状态变量的量纲各不相同（压力 0–100、天数、件数…），
 * 直接拿数值当严重度等于把不同量纲的数排在一张榜上比大小 —— 那是本仓
 * 「拿一个看起来相关的数字当判据」那个病的标准形态。百分位秩是**无量纲**的，
 * 且恰好就是 A 方案要的那个口径（「它在本变量的分布里有多极端」）。
 * 原始读数与阈值原样进 `provenance`，可下钻（R13），一个字节都不丢。
 *
 * ══ R6 确定性 ═══════════════════════════════════════════════════════════════
 * 纯函数：无 `Date.now`、无随机、无 IO。全部排序给出**全序**（值排完再按 key 字典序）。
 */
import {
  DRILL_CHOKE_QUANTILE,
  DRILL_FRAGILE_QUANTILE,
  compareDrillFindings,
  type DrillFinding,
  type PropagationRule,
  type TickState,
} from "@platform/contracts";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 输入（由 app.ts 读好后注入；本模块保持纯函数）
// ══════════════════════════════════════════════════════════════════════════

export interface DrillScanInput {
  /** 世界态（`objectId → { stateVar: number }`）。 */
  state: TickState;
  /** 生效的传导规则（= 本会话 active 那一份，已减去 `disabledRuleKeys`）。 */
  rules: readonly PropagationRule[];
  /** `objectId → typeKey`（堵点要按类型对齐规则的 `sourceTypeKey`）。 */
  typeOf: ReadonlyMap<string, string>;
  /** 状态变量人话名；查不到回落裸键（**不臆造中文名**）。 */
  stateVarLabel: (stateVar: string) => string;
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 分位数（唯一实现 —— 卡点/脆弱点/未来任何分位判据都走它）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 线性插值分位数（与 numpy 默认 `linear` 口径一致）。
 * 入参**必须已升序**；空数组返回 `null`（「算不出阈值」不是「阈值为 0」）。
 */
export function quantileSorted(sortedAsc: readonly number[], q: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0]!;
  const pos = Math.min(Math.max(q, 0), 1) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

/**
 * `value` 在**已升序**样本里的百分位秩（0–1）。
 * 口径 = 「严格小于它的样本数 + 并列的一半」/ 总数（中点法，避免并列时秩跳变）。
 */
export function percentileRank(sortedAsc: readonly number[], value: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
    else break; // 已升序 ⇒ 后面不可能再有更小/相等的
  }
  return (below + equal / 2) / n;
}

/** 浮点定精（R6：跨平台字节级一致）。 */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** 有限数才算一个样本（`undefined`/`NaN`/`Infinity` 一律不进分布 —— 补 0 会把分位拉偏）。 */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 堵点：传导图的传递闭包（结构性，与数值无关）
// ══════════════════════════════════════════════════════════════════════════

/** 传导图上的一个格：`typeKey|stateVar`（两段都可能含奇怪字符，用 NUL 分隔）。 */
const CELL_SEP = "\u0000";
const cellKey = (typeKey: string, stateVar: string): string => `${typeKey}${CELL_SEP}${stateVar}`;

/**
 * 每个 `(typeKey, stateVar)` 格的**传递闭包大小** —— 「动了它，下游最终有多少格会跟着动」。
 *
 * 这就是「堵点 = 必经节点」的可计算定义：闭包越大，越是咽喉。
 * ⚠ 刻意**不用出度**：出度只看一跳，会把「直连 3 个但那 3 个都是叶子」排在
 * 「直连 1 个但那 1 个再散出 40 个」前面 —— 与「必经」的语义正好相反。
 *
 * BFS 逐格展开，`seen` 去重 ⇒ 环不会死循环（传导图允许成环）。
 */
export function transitiveClosureSizes(rules: readonly PropagationRule[]): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const r of rules) {
    const from = cellKey(r.sourceTypeKey, r.sourceStateVar);
    const to = cellKey(r.targetTypeKey, r.targetStateVar);
    const arr = out.get(from);
    if (arr) arr.push(to);
    else out.set(from, [to]);
  }
  // 全序：邻接表排序 ⇒ BFS 展开序确定（R6）
  for (const arr of out.values()) arr.sort();

  const sizes = new Map<string, number>();
  const roots = [...out.keys()].sort();
  for (const root of roots) {
    const seen = new Set<string>([root]);
    let frontier = [root];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of out.get(cur) ?? []) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          next.push(nb);
        }
      }
      frontier = next.sort();
    }
    seen.delete(root); // 闭包不含自己
    sizes.set(root, seen.size);
  }
  return sizes;
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 扫描主入口
// ══════════════════════════════════════════════════════════════════════════

/**
 * 扫出三类结论。
 *
 * 传导引擎算出来的结论，诚实位一律 **`LIVE`** —— 这不是网开一面：
 * `propagateTick` 读的是**这个世界真实的 `TickState`**，没有任何回落/占位/合成分支
 * （对比 `bottleneck_matrix` 实测回 `MOCK`，那是它内部真有回落）。
 * 谁写的数据谁盖章，不靠下游猜。
 */
export function scanDrillFindings(input: DrillScanInput): DrillFinding[] {
  const { state, rules, typeOf, stateVarLabel } = input;
  const findings: DrillFinding[] = [];

  // ── ① 按状态变量归集样本（跨对象），一次排序供分位与秩共用 ──────────────────
  const samples = new Map<string, number[]>();
  for (const objectId of Object.keys(state)) {
    const row = state[objectId];
    if (!row) continue;
    for (const sv of Object.keys(row)) {
      const v = finite(row[sv]);
      if (v === null) continue;
      const arr = samples.get(sv);
      if (arr) arr.push(v);
      else samples.set(sv, [v]);
    }
  }
  for (const arr of samples.values()) arr.sort((a, b) => a - b);

  // ── ② 卡点 / 脆弱点：逐格与本变量的 P90/P95 比 ────────────────────────────
  //    对象序、变量序都排过 ⇒ 遍历序确定（R6）。
  for (const objectId of Object.keys(state).sort()) {
    const row = state[objectId];
    if (!row) continue;
    for (const sv of Object.keys(row).sort()) {
      const v = finite(row[sv]);
      if (v === null) continue;
      const dist = samples.get(sv);
      if (!dist || dist.length < 2) continue; // 单样本无分布可言，不硬判（「算不出」不冒充「没事」）
      const p90 = quantileSorted(dist, DRILL_CHOKE_QUANTILE);
      const p95 = quantileSorted(dist, DRILL_FRAGILE_QUANTILE);
      if (p90 === null || p95 === null) continue;

      const isChoke = v > p95;
      const isFragile = !isChoke && v > p90;
      if (!isChoke && !isFragile) continue;

      const severity = round6(Math.min(100, Math.max(0, percentileRank(dist, v) * 100)));
      const svLabel = stateVarLabel(sv);
      findings.push({
        key: `propagation::${isChoke ? "choke" : "fragile"}::${objectId}::${sv}`,
        kind: isChoke ? "卡点" : "脆弱点",
        severity,
        where: {
          objectType: typeOf.get(objectId) ?? "",
          objectId,
          label: `${objectId}·${svLabel}`,
        },
        // 传导引擎的结论是**当前这一格世界态**的读数，不含"第几天越线"这个维度
        // （逐日越线点由 `risk_timeline.cards[].crossDay` 提供）。诚实留 null，不编一个天数。
        when: null,
        why: isChoke
          ? `${svLabel} 现值 ${round6(v)} 已越过本世界该变量的 P95 分位（${round6(p95)}）`
          : `${svLabel} 现值 ${round6(v)} 落在警戒带 P90(${round6(p90)}) ~ P95(${round6(p95)})，尚未越线`,
        source: {
          solverKey: "propagation",
          dataMode: "LIVE",
          provenance: {
            basis: "A 方案·阈值取该变量在本世界的分位数（零配置）",
            stateVar: sv,
            value: round6(v),
            p90: round6(p90),
            p95: round6(p95),
            sampleCount: dist.length,
            severityBasis: "百分位秩 × 100（无量纲·与 tightness 同口径）",
          },
        },
        reconciled: null,
        evidence: { objectId, stateVar: sv, value: v },
      });
    }
  }

  // ── ③ 堵点：结构性咽喉（与数值无关 ⇒ `when: null`）──────────────────────────
  const closure = transitiveClosureSizes(rules);
  // 分母 = 传导图里**所有**格（源 ∪ 目标）—— 只数源会让分母偏小、占比虚高。
  const allCells = new Set<string>();
  for (const r of rules) {
    allCells.add(cellKey(r.sourceTypeKey, r.sourceStateVar));
    allCells.add(cellKey(r.targetTypeKey, r.targetStateVar));
  }
  const denom = Math.max(1, allCells.size);
  for (const [ck, size] of [...closure.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (size <= 0) continue; // 闭包为空 = 叶子，不是咽喉
    const [typeKey = "", sv = ""] = ck.split(CELL_SEP);
    const svLabel = stateVarLabel(sv);
    findings.push({
      key: `propagation::block::${typeKey}::${sv}`,
      kind: "堵点",
      severity: round6(Math.min(100, (size / denom) * 100)),
      where: { objectType: typeKey, objectId: `${typeKey}.${sv}`, label: `${typeKey}·${svLabel}` },
      when: null, // 结构性：改哪天都一样堵
      why: `传导图上动这一格会牵动下游 ${size}/${denom} 格（传递闭包），是必经咽喉`,
      source: {
        solverKey: "propagation",
        dataMode: "LIVE",
        provenance: {
          basis: "传导图现算传递闭包（不手工登记层级）",
          closureSize: size,
          totalCells: denom,
          ruleCount: rules.length,
        },
      },
      reconciled: null,
      evidence: { typeKey, stateVar: sv, closureSize: size },
    });
  }

  return findings.sort(compareDrillFindings);
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 状态变量三层重排（根源 / 枢纽 / 末端）—— 层级**现算**，不手工登记
// ══════════════════════════════════════════════════════════════════════════

export type DrillLayer = "根源" | "枢纽" | "末端";

/**
 * 按传导图的**入度/出度**现算每个状态变量的层级（PRD §4 「层级由传导图入度出度现算」）。
 *
 *  · **根源** 入度 0 且出度 > 0 —— 没人喂它，它喂别人 ⇒ 真正的源头，扰它才有意义；
 *  · **末端** 出度 0 且入度 > 0 —— 它只承接，不外传 ⇒ 结果，不是输入；
 *  · **枢纽** 两头都有 —— 传导中继（仓主判定库存类属这一层，实测数据支持：见 PRD §7.2）。
 *
 * ⚠ 度数按 **stateVar 跨类型合并**计（同一个变量名在多个类型上出现时算同一层）——
 * 与 `SandboxViewConfig.stateVars` 的去重口径**逐字相同**，否则屏上分层与列表对不上。
 * 两头都是 0（孤立变量）不下发任何层级：`null` = 「这个变量不在传导图里」，
 * 与「它是末端」是两个不同的命题，不许合并。
 */
export function layerOfStateVars(rules: readonly PropagationRule[]): Map<string, DrillLayer> {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const r of rules) {
    bump(outDeg, r.sourceStateVar);
    bump(inDeg, r.targetStateVar);
  }
  const out = new Map<string, DrillLayer>();
  for (const sv of [...new Set([...inDeg.keys(), ...outDeg.keys()])].sort()) {
    const i = inDeg.get(sv) ?? 0;
    const o = outDeg.get(sv) ?? 0;
    if (i === 0 && o > 0) out.set(sv, "根源");
    else if (o === 0 && i > 0) out.set(sv, "末端");
    else if (i > 0 && o > 0) out.set(sv, "枢纽");
    // i===0 && o===0 不可能出现在这个循环里（能进来说明至少有一条边）
  }
  return out;
}
