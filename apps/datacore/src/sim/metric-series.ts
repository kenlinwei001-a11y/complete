import {
  chainNodeDef,
  isPerturbationActiveAt,
  SIM_METRIC_SERIES_DEFAULT_LIMIT,
  SIM_METRIC_SERIES_MAX_LIMIT,
  type DelayedContribution,
  type Perturbation,
  type PropagationRule,
  type PropagationTrace,
  type SimMetricSegment,
  type SimMetricSeriesItem,
  type SimMetricSeriesOrder,
  type SimMetricSeriesResponse,
  type TickState,
} from "@platform/contracts";
import { stateVarDisplayName } from "../synthetic/battery.js";
import {
  propagateTick,
  type CadenceGateLookup,
  type PairWeightLookup,
  type PerturbationInTick,
  type PropagationGraph,
  type RuleParamLookup,
} from "./propagation.js";

/**
 * 指标时序（WO-SIM-BE-SERIES）—— `GET /a/v1/sim/sessions/:id/metric-series` 的**模型层**。
 * 契约与"为什么基线不是另起会话"的论证见 `packages/contracts/src/sim.ts` §指标时序，此处不复述。
 *
 * ── 本模块只做一件事：把**同一个世界**跑两遍，两遍之间只差「扰动集」──────────────────
 * 这与 `POST …/counterfactual` 是**同一条纪律的两个投影**（`app.ts` 头注原文：
 * 「对照要成立，两版就必须是**同一套算法在两组规则上跑**。抄一份出来，两边任何一处漂移…
 * 都会被算进『关掉这条边的影响』里，而那部分差异根本不是边造成的 —— 那就是把噪声当结论」）。
 * 那边的变量是规则集，这边的变量是扰动集，其余**全部**共用：
 *   同一份 tick0 种子 · 同一张图/参数/闸门（`buildPropagationInputs` 唯一装配处）·
 *   同一个 `propagateTick` · 同一份 `isPerturbationActiveAt` 生效判据。
 *
 * ⛔ **为什么不复用 `app.ts` 的 `simAdvanceTicks`**（问过这个问题的人不止一个，写在这里省一次追查）：
 * 它从 `s.curTick` 的**当前态**起跑、且自己去库里读扰动，两条都与本单相反 ——
 * 本单要的是**从 tick0 回放整条世界线**，且要能把扰动集换成空集。
 * 它俩共用的是**下面这一层**（`propagateTick` + 装配处），不是彼此。
 *
 * ⛔ **本模块一个字节都不写库**：没有 `putTickState` / `putSession` / `emit`。
 * 「看一眼历史曲线」必须是零副作用的 —— 同 `counterfactual` 的 `persist:false` 那条约束。
 */

/** 传导相入参（由 `buildPropagationInputs` 唯一装配处给，本模块**不自己拼**）。 */
export interface MetricSeriesEngine {
  graph: PropagationGraph;
  ruleParams: RuleParamLookup;
  cadenceGates: CadenceGateLookup;
  /**
   * 逐实例分摊权重表（WO-COEF-FROM-BOM）。**必须与 `POST …/tick` 那一跑同源**：
   * 曲线是"同一个世界的另一种画法"，少喂一样输入，屏上的曲线就与真 tick 的数对不上
   * （本仓治过的「两处输入不同源 = 第二套真相源」）。无规则声明 `weightRef` ⇒ `{}`，逐字节同旧。
   */
  pairWeights: PairWeightLookup;
}

/** 一条回放出来的世界线。`states[i]` = tick `i` 的世界态；`traces[i]` = **产出**那一格时的轨迹。 */
export interface ReplayedLine {
  states: TickState[];
  /** `traces[0]` 恒 `null` —— tick0 是**种子**，不是算出来的，给它编一份轨迹就是凭空造溯源。 */
  traces: (PropagationTrace[] | null)[];
}

const cloneState = (s: TickState): TickState => JSON.parse(JSON.stringify(s)) as TickState;

/**
 * 从 tick0 种子回放到 `toTick`，逐格留下世界态与轨迹。
 *
 * 回放循环**逐行对齐** `app.ts` 的 `simAdvanceTicks`（那是生产 tick 路），差异只有两处，都在下面点名：
 *  ① 起点是 tick0 种子而非 `s.curTick` 当前态（本单要的就是整条线）；
 *  ② 扰动集由调用方给（这正是两条线唯一的变量），而不是自己去库里查。
 */
export function replayWorldLine(args: {
  /** tick0 世界态 —— 必须是**本会话自己**的 tick0 行。传新会话的 `baseSnapshot` = 假分叉（见契约）。 */
  seed: TickState;
  engine: MetricSeriesEngine;
  /** 本会话**真正参与推演**的规则（= 已发布 − `disabledRuleKeys`），与 `POST …/tick` 同一集合。 */
  rules: PropagationRule[];
  /** 扰动集，顺序 = `listPerturbations` 的 `startTick↑ → 建单先后`。**绝不重排**：顺序即语义。 */
  perturbations: readonly Perturbation[];
  toTick: number;
}): ReplayedLine {
  const { seed, engine, rules, perturbations, toTick } = args;
  const states: TickState[] = [cloneState(seed)];
  const traces: (PropagationTrace[] | null)[] = [null];

  // 与 tick 路同一判据：有规则才传导；**有扰动没规则也要走引擎**，否则「限时停机」到期不回退，
  // 悄悄变成永久生效（`app.ts` 的 `engineTick` 原文注释）。
  const propagate = rules.length > 0;
  const engineTick = propagate || perturbations.length > 0;

  /**
   * 「落地前值」= 该扰动 `startTick` **前一格**上目标变量的值（`startTick===0` 取种子）。
   * 只有 `set` 与 `scale(0)` 到期时用得上（其余两种模式的逆是减/除，可解析求出）。
   *
   * ⚠ 与 `app.ts` 的同名闭包有一处**刻意的**不同：那边 `startTick===0` 读 `s.baseSnapshot`，
   * 这里读**本条线自己的 tick0 种子**。理由是两条线各有各的历史 —— 基线那条线上这个扰动
   * 根本不存在，拿另一条线的落地前值去回退它，回退出来的就是另一个世界的数。
   * 在 tick0 未被 `/act` 直写过的世界里，两者**逐字节相同**（种子就是 `baseSnapshot` 的拷贝）。
   */
  const preValueOf = (p: Perturbation, line: TickState[]): number | undefined => {
    const snap = p.startTick === 0 ? line[0] : line[p.startTick - 1];
    const v = snap?.[p.targetObjectId]?.[p.targetStateVar];
    return typeof v === "number" ? v : undefined;
  };

  /** 本格（= 产出的那一格 `producedTick`）**相关**的扰动：生效期内的 + 刚到期的（回退要用它）。 */
  const perturbationsForTick = (producedTick: number, line: TickState[]): PerturbationInTick[] => {
    const out: PerturbationInTick[] = [];
    for (const p of perturbations) {
      const now = isPerturbationActiveAt(p, producedTick);
      const prev = isPerturbationActiveAt(p, producedTick - 1);
      if (!now && !prev) continue; // 与本格无关
      if (!now && (p.mode === "set" || (p.mode === "scale" && p.magnitude === 0))) {
        out.push({ ...p, preValue: preValueOf(p, line) });
        continue;
      }
      out.push(p);
    }
    return out;
  };

  let state = states[0]!;
  let pending: DelayedContribution[] = []; // tick0 行的 pending 恒 `[]`（`POST /sessions` 建的就是空的）
  for (let tick = 0; tick < toTick; tick++) {
    if (engineTick) {
      const out = propagateTick(
        engine.graph, state, rules, pending, tick, engine.ruleParams, engine.cadenceGates,
        perturbationsForTick(tick + 1, states),
        engine.pairWeights,
      );
      state = out.next;
      pending = out.pending;
      // 无传导规则的世界：本格若没有任何扰动动作，轨迹保持 `null`（与 tick 路逐字节相同）。
      traces.push(propagate || out.trace.length > 0 ? out.trace : null);
    } else {
      // 无规则、无扰动：恒等桩进位（状态原样，确定性 R6）。
      state = cloneState(state);
      pending = [];
      traces.push(null);
    }
    states.push(cloneState(state));
  }
  return { states, traces };
}

/** 一个环节的身份（`nodeId` + 人话名 + 它是**怎么算出来的**）。 */
interface NodeIdentity {
  nodeId: string;
  label: string;
  source: SimMetricSegment["source"];
}

/**
 * 一条传导规则归属哪个环节。**只读规则上已有的两个字段，不猜、不按类型硬派。**
 *
 * 优先 `cadenceNodeId`（建模方**显式绑定**的全链节点），回落 `domainKey`（规则落域）。
 * 两个取值域不同，故 `source` 必须随之下发 —— 混成一个裸 `nodeId` 就是一个字段盖住两个事实。
 * 两个都空 ⇒ `null` = **这条边确实没有环节归属**（诚实留白），调用方据此留空档，不许塞给邻居。
 */
export function ruleNodeIdentity(rule: PropagationRule): NodeIdentity | null {
  // `!= null` 而不是 `!== null`：`repo/pg.ts` 读回是裸 cast 不过 zod，老行的缺省是 `undefined`
  // 而非 `null`（同 `propagation.ts` 闸门那一处踩过的坑，判据必须一致）。
  if (rule.cadenceNodeId != null && rule.cadenceNodeId !== "") {
    return { nodeId: rule.cadenceNodeId, label: chainNodeDef(rule.cadenceNodeId)?.label ?? rule.cadenceNodeId, source: "cadence" };
  }
  if (rule.domainKey != null && rule.domainKey !== "") {
    return { nodeId: rule.domainKey, label: rule.domainName ?? rule.domainKey, source: "domain" };
  }
  return null;
}

/** 指标身份：`${objectId}.${stateVar}`。前端不必解析字符串——`objectId`/`stateVar` 也照样下发。 */
const metricKey = (objectId: string, stateVar: string): string => `${objectId}.${stateVar}`;

export interface MetricSeriesArgs {
  sessionId: string;
  /**
   * **本会话自己的 tick0 行**（`getTickState(tenant, sid, 0)?.state`，缺则退回 `baseSnapshot`）。
   * 🔴 传别的会话的快照 = 契约里禁掉的那种基线；分叉点会提前到 tick 0。
   */
  seed: TickState;
  engine: MetricSeriesEngine;
  /**
   * **已发布的全部规则** = 指标目录的口径来源（`sourceStateVar ∪ targetStateVar`，
   * 与 `SandboxViewConfig.stateVars` 同一去重）。
   * ⚠ 刻意**不用**过滤后的 `activeRules`：`app.ts` 已立下判据「目录不过滤 ——
   * 关掉的边要可见地降级，不是从图上消失」。用过滤集当目录，会让用户拨一下开关，
   * 屏上那条指标曲线**整条消失**，而世界里它明明还在。
   */
  publishedRules: PropagationRule[];
  /** 引擎真正吃的规则集（= 已发布 − 本会话 `disabledRuleKeys`），与 `POST …/tick` 同一集合。 */
  activeRules: PropagationRule[];
  /** 本会话扰动（`listPerturbations` 序）。 */
  perturbations: readonly Perturbation[];
  /** 世界线终点（会话 `curTick`）—— 窗口上界，**不外推**。 */
  curTick: number;
  /**
   * 一格 tick 等于几天（= `SimSession.tickDays`，WO-SIM-DRILL-P12）。
   *
   * 随回包下发，让下游甘特能把横轴从裸 tick 序号换算成天 —— 消费方
   * （`views/sim/console/MetricGantt.tsx`）手上只有这一个响应，不给它口径就只能渲染裸序号。
   * 缺省 `1` ⇒ 老调用方逐字节同旧（additive）。
   */
  tickDays?: number;
  from?: number;
  to?: number;
  // ── 规模闸（WO-SIM-SERIES-SCALE）—— 三条入参，语义写死在契约里，此处只记"为什么在模型层" ──
  /**
   * 条数上限。**不给 ⇒ 默认值，绝不回全量**（这条就是本单的核心：任何调用方都打不爆服务）。
   * 超硬上限 ⇒ 压到硬上限。生效值经 `appliedLimit` 回执。
   */
  limit?: number;
  /** 排序档，不给 ⇒ `magnitude`（变化幅度降序）。 */
  order?: SimMetricSeriesOrder;
  /** 对象白名单（下钻用）。给了就只有名单里的对象进目录。 */
  objectIds?: readonly string[];
  /** 状态变量白名单（下钻用）。给了就只有名单里的变量进目录。 */
  stateVars?: readonly string[];
}

/**
 * 组装 `GET …/metric-series` 的响应。**纯函数**（R6）：同入参逐字节同出参，回包里零 wall-clock 字段。
 *
 * ── 规模闸的**执行顺序**（WO-SIM-SERIES-SCALE·这段顺序本身就是修复，别重排）────────────
 * 病灶实测：生产量级世界（11,348 对象 × 36 状态变量）下本函数原先产出 **408,528 条 /
 * 116,859,540 字节 / 21.8 秒**。⚠ **代价的大头不在 JSON 序列化，在 `segmentsFor`** ——
 * 它对**每一条**指标都要 `ticks × trace` 地反查主导规则，408,528 × 那一坨就是那 21 秒。
 * 所以「先全量算完再截断」等于没修：只把回包变小，服务器照样算 20 秒。
 *
 * 故顺序必须是：**目录 → 白名单 → 幅度（只读数，不碰 trace）→ 排序 → 截断 → 才算 `segments`**。
 * 截断之后参与分段的只剩 `appliedLimit` 条（默认 12），贵的那一步从 40 万次降到 12 次。
 */
export function buildMetricSeries(args: MetricSeriesArgs): SimMetricSeriesResponse {
  const { sessionId, seed, engine, publishedRules, activeRules, perturbations, curTick } = args;

  // ── 窗口收敛：不预测未来（`to > curTick` 截到 curTick 并把 `clamped` 亮出来，不补 null 格）──
  const requestedTo = args.to ?? curTick;
  const clamped = requestedTo > curTick;
  const toTick = Math.max(0, Math.min(requestedTo, curTick));
  const fromTick = Math.max(0, Math.min(args.from ?? 0, toTick));
  const ticks: number[] = [];
  for (let t = fromTick; t <= toTick; t++) ticks.push(t);

  // ── 两条线：同一种子、同一套 activeRules、同一引擎，**只差扰动集** ─────────────────────
  const actualLine = replayWorldLine({ seed, engine, rules: activeRules, perturbations, toTick });
  const baselineLine = replayWorldLine({ seed, engine, rules: activeRules, perturbations: [], toTick });

  // ── 指标目录：口径复用既有定义（已发布规则的 source/target stateVar），本单不新造指标名 ──
  // 白名单（`objectIds`/`stateVars`）在**进目录时**就筛掉，不是先收全再过滤 ——
  // 目录本身在生产量级世界里就有 40 万条，先收全再筛等于把要省的那一步先做一遍。
  const knownStateVars = new Set(publishedRules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
  const objectAllow = args.objectIds === undefined ? null : new Set(args.objectIds);
  const stateVarAllow = args.stateVars === undefined ? null : new Set(args.stateVars);
  const keys = new Map<string, { objectId: string; stateVar: string }>();
  for (const t of ticks) {
    for (const line of [actualLine.states[t], baselineLine.states[t]]) {
      for (const [objectId, bucket] of Object.entries(line ?? {})) {
        if (objectAllow !== null && !objectAllow.has(objectId)) continue;
        for (const [stateVar, v] of Object.entries(bucket)) {
          if (typeof v !== "number" || !knownStateVars.has(stateVar)) continue;
          if (stateVarAllow !== null && !stateVarAllow.has(stateVar)) continue;
          keys.set(metricKey(objectId, stateVar), { objectId, stateVar });
        }
      }
    }
  }

  const ruleByKey = new Map(publishedRules.map((r) => [r.key, r] as const));

  /**
   * 逐格读数。**缺格 = `null`，绝不插值、绝不补 0。**
   * 插出来的点会被读成实测值（屏上和真值长得一模一样）；补 0 则把
   * 「这个世界里没有这一格」说成「这一格是 0」—— 契约 `SimStateDiffCell` 已为这条分辨立过账。
   */
  const readAt = (line: ReplayedLine, t: number, objectId: string, stateVar: string): number | null => {
    const v = line.states[t]?.[objectId]?.[stateVar];
    return typeof v === "number" ? v : null;
  };

  /**
   * 本格里**主导**产出该指标的规则 key。
   *
   * 判据：按 `|amount|` 之和取最大，并列取 key 字典序小者（全序 ⇒ R6 确定性）。
   * ⚠ 为什么是"主导"而不是"随便挑一条"：一格可能有多条边同时写同一个 (对象,变量)，
   * 此时"归属哪个环节"本就有歧义 —— 报**贡献最大**的那条是可解释的，随便挑一条则不可解释。
   * 主导者若没有环节归属 ⇒ 本格**不产生分段**（而不是退而求其次去报一条次要边的环节：
   * 那会让屏上显示一个并不主导这一格的环节，比留白更糟）。
   */
  const dominantRuleAt = (t: number, objectId: string, stateVar: string): string | null => {
    const trace = actualLine.traces[t];
    if (!trace) return null;
    const weight = new Map<string, number>();
    for (const row of trace) {
      const rule = ruleByKey.get(row.ruleKey); // `perturbation:*` 前缀的行查不到 ⇒ 自动排除（扰动不是环节）
      if (!rule || row.toObjectId !== objectId || rule.targetStateVar !== stateVar) continue;
      weight.set(row.ruleKey, (weight.get(row.ruleKey) ?? 0) + Math.abs(row.amount));
    }
    let best: string | null = null;
    let bestW = -1;
    for (const k of [...weight.keys()].sort()) {
      const w = weight.get(k)!;
      if (w > bestW) { best = k; bestW = w; }
    }
    return best;
  };

  /** 逐格算归属，再把**连续同环节**的格合并成段；无归属的格是空档，段在那里断开。 */
  const segmentsFor = (objectId: string, stateVar: string): SimMetricSegment[] => {
    const out: SimMetricSegment[] = [];
    let cur: (SimMetricSegment & { rules: Set<string> }) | null = null;
    const flush = () => {
      if (!cur) return;
      out.push({ fromTick: cur.fromTick, toTick: cur.toTick, nodeId: cur.nodeId, label: cur.label, source: cur.source, ruleKeys: [...cur.rules].sort() });
      cur = null;
    };
    for (const t of ticks) {
      const ruleKey = dominantRuleAt(t, objectId, stateVar);
      const node = ruleKey === null ? null : ruleNodeIdentity(ruleByKey.get(ruleKey)!);
      if (node === null) { flush(); continue; } // 诚实留白：这一格没有环节归属
      if (cur && cur.nodeId === node.nodeId && cur.source === node.source && cur.toTick === t - 1) {
        cur.toTick = t;
        cur.rules.add(ruleKey!);
        continue;
      }
      flush();
      cur = { fromTick: t, toTick: t, nodeId: node.nodeId, label: node.label, source: node.source, ruleKeys: [], rules: new Set([ruleKey!]) };
    }
    flush();
    return out;
  };

  // ══ 规模闸 ═══════════════════════════════════════════════════════════════════
  // `totalMetrics` = **白名单之后、limit 之前**的全量条数。这个数是本单的诚实位：
  // 没有它，「我没给你剩下的」与「一共就这么多」在回包里长得一模一样。
  const totalMetrics = keys.size;
  const appliedOrder: SimMetricSeriesOrder = args.order ?? "magnitude";
  const appliedLimit = Math.max(
    1,
    Math.min(args.limit ?? SIM_METRIC_SERIES_DEFAULT_LIMIT, SIM_METRIC_SERIES_MAX_LIMIT),
  );

  /**
   * 一条指标的**变化幅度** = `|actual 末个有效读数 − baseline 首个有效读数|`。
   *
   * 这两个数**正是屏上那两列**（甘特的「基线」列取 `baseline` 首个有效读数、「扰动后」列取
   * `actual` 末个有效读数，见 `useMetricSeries.ts` 的 `firstReading`/`lastReading`）⇒
   * 排出来的就是「屏上这两个数差得最多的那 N 行」，而不是另编一个只有后端知道的内部指标。
   *
   * 任一端缺格（整列全 `null`）⇒ 记 **0**：那一行屏上是 `—`，最不值得占版面。
   * ⚠ 0 同时也是「真的没变」的幅度 —— 两者都排在最后，且都由 `key` 升序做稳定 tiebreaker，
   *   故 R6 仍然成立（全序，不靠 `Array.sort` 的稳定性兜底）。
   * ⚠ 本函数**只读世界态、不碰 trace** —— 贵的 `segmentsFor` 必须留到截断之后。
   */
  const magnitudeOf = (objectId: string, stateVar: string): number => {
    let first: number | null = null;
    for (const t of ticks) {
      const v = readAt(baselineLine, t, objectId, stateVar);
      if (v !== null) { first = v; break; }
    }
    let last: number | null = null;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const v = readAt(actualLine, ticks[i]!, objectId, stateVar);
      if (v !== null) { last = v; break; }
    }
    return first === null || last === null ? 0 : Math.abs(last - first);
  };

  // 先按 `key` 升序（历史行为 = `order:"key"` 档，也是另一档的 tiebreaker），再按档位重排。
  const ranked = [...keys.keys()].sort();
  if (appliedOrder === "magnitude") {
    const mag = new Map(ranked.map((k) => {
      const { objectId, stateVar } = keys.get(k)!;
      return [k, magnitudeOf(objectId, stateVar)] as const;
    }));
    // 幅度降序；并列时保持上面那份 `key` 升序 ⇒ 全序，同世界两次刷新行序不会跳。
    ranked.sort((a, b) => (mag.get(b)! - mag.get(a)!) || (a < b ? -1 : a > b ? 1 : 0));
  }
  const page = ranked.slice(0, appliedLimit);

  const metrics: SimMetricSeriesItem[] = page.map((key) => {
    const { objectId, stateVar } = keys.get(key)!;
    // 人话名走后端单源表（`STATE_VAR_DISPLAY_NAMES`）；未登记 ⇒ 回落裸键 + 亮 `labelIsFallback`，
    // 让屏上分得出「名字恰好等于键」与「压根没登记名字」。
    const zh = stateVarDisplayName(stateVar);
    return {
      key, objectId, stateVar,
      label: zh ?? stateVar,
      labelIsFallback: zh === undefined,
      // 恒 null：全仓没有"状态变量 → 单位"的登记册，编一个就是新造口径（详见契约注释）。
      unit: null,
      baseline: ticks.map((t) => readAt(baselineLine, t, objectId, stateVar)),
      actual: ticks.map((t) => readAt(actualLine, t, objectId, stateVar)),
      segments: segmentsFor(objectId, stateVar),
    };
  });

  return {
    sessionId,
    fromTick,
    toTick,
    ticks,
    // 时间轴刻度单位随轴一起下发（见 `MetricSeriesArgs.tickDays`）。实测增量恒 13 字节·O(1)。
    tickDays: Math.max(1, Math.floor(args.tickDays ?? 1)),
    metrics,
    // ── 诚实位：**不许静默截断** ──────────────────────────────────────────────
    totalMetrics,
    truncated: metrics.length < totalMetrics,
    appliedLimit,
    appliedOrder,
    // 基线出处摊在回包里：`sessionId` 必须等于本会话 —— 不等 = 基线来自另一个世界。
    baselineOrigin: {
      sessionId,
      seedTick: 0,
      excludedPerturbationIds: perturbations.map((p) => p.id).sort(),
    },
    clamped,
  };
}
