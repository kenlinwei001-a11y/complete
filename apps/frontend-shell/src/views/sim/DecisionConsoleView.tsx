import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  aggregateObjects,
  fetchActionDrafts,
  fetchDrillCatalog,
  fetchObjectTypes,
  fetchPropagationRules,
  fetchSimSessions,
  fetchSlicesIndex,
  invokeSolver,
  searchObjects,
  simDrill,
} from "@/api/endpoints";
import type { DrillEvent, DrillEventSpec, DrillReport } from "@platform/contracts";
import { useActionDraft } from "./shared";
import styles from "./DecisionConsoleView.module.css";
import {
  collectHonesty,
  exposureTotals,
  humanizeApiError,
  invariantNumbersNote,
  landingNoteFor,
  needsLeafPick,
  nothingMovedText,
  orderedEvents,
  parseEmphasis,
  planCategoryOf,
  roundish,
  scrubSourceRefs,
  sortMitigations,
  splitImpediments,
  subjectIdFormFor,
  subjectIsRead,
  subjectScopeFor,
  targetIdOf,
  topCustomers,
  SUBJECT_FALLBACK,
  type BaseCard,
  type HonestyNote,
  type Mitigation,
  type SortKey,
} from "./decisionConsoleModel";

/**
 * WO-DECISION-CONSOLE · **经营决策者版**「加几件事，我算给你看」。
 *
 * ── 这一页是什么 ──────────────────────────────────────────────────────────────
 * **一页六区**（不是六个页面）：左栏 ① 加事情 + 唯一的那颗〔算一下〕；右栏 ②算的时候 /
 * ③钱 / ③b 客户与订单 / ④哪儿会出事 / ⑤有几条路。任一区改东西，其余区当场跟着变、位置不丢。
 *
 * ── 层次是可机检的，不只是约定（WO-CONSOLE-BLOCKERS）──────────────────────────
 * 每个折叠抽屉都带 `data-layer2="1"`。R-UI-4 的规矩是「机器编号 / 规则码 / 公式**一律进第二层**」，
 * 而在此之前"第一层 / 第二层"只活在注释里 —— 任何审计（人的或脚本的）都只能靠肉眼判断
 * 某段文字算第几层，于是 `pos_lfp_b2` 那条在第一层挂了整整一轮没人发现。
 * 有了这个标记，「第一层里有没有机器话」变成一句可执行的查询：
 *   `[...document.querySelectorAll('#root *')].filter(el => !el.closest('[data-layer2]'))`
 * —— 机器先说话，不靠人记得。
 *
 * ── 屏上不出现的词（整条主线）─────────────────────────────────────────────────
 * `扰动 / 推演 / 传导 / 世界 / 拍 / tick / 张力 / 敞口 / 落点 / 求解器 / 状态变量`。
 * 「拍」一律写「天」（2026-08-28 实测本租户所有会话 `tickDays: 1`）。
 * 公式 / 口径 / 机器编号 / 规则码 / 源码文件名行号一律进第二层（R-UI-4）。
 *
 * ── 开工前的实测复现（派单第 0 段要求的「今天的行为是 X，应该是 Y」）────────────
 * 起真 datacore（seed 42 · demo 租户 · 内存模式 · 端口 4131）逐条跑过。**与规格给的
 * 前提冲突的，一律以实测为准**，冲突点在下面各自的位置点名。摘要：
 *
 *  · **X**：今天「施加扰动」与「推进 tick」是两颗按钮，不点第二颗钱一分不动。
 *    **Y**：只有〔算一下〕一颗，它自己把事情 → 30 天 → 卡点 → 客户 → 方案全走完
 *    （实测一次 `POST …/drill` 1.76 秒，零 LLM）。
 *  · **X**：主体选择器是「筛选（共 11337 个落点）」一个下拉。
 *    **Y**：按事件类型限定范围 —— 客户 20 / 型号 6 / 物料 8 / 基地 13 / 每基地产线 10 /
 *    需求段 3（全部实测 `objects/aggregate` count），订单 **500** 走搜索。
 *    **任何一个下拉不超过 20 行。**
 *  · **X**：三个金额在页面纵向 y≈3,666px。**Y**：钱在右栏第一屏。
 *  · **X**：卡点 17/18 条并排、每条都挂「查看方案对比」。
 *    **Y**：分两栏 —— 实测 18 条里只有 4 条有候选，且严重度前三（100/100/34）全是 0 条。
 *
 * ── 规格里**实测已过期**的前提（照做会写出错的屏）─────────────────────────────
 *  1. `UX-mainline-screens.md §2④`「最早第 14 天 · 第 14 天前动手后面七张全躲得过」——
 *     实测窗内最早到期是**第 2 天**（`SO-900487`），且 `otdBatch.rate = 0`（53 张全逾期、
 *     准时 0 张）⇒ 「第 14 天之前动手」今天一张都救不了。本页因此**不写那句结论**，
 *     只画顺序线，让日期自己说话。
 *  2. 「17 处卡点」→ 实测 **18**；「常州超红线 67%」→ 实测 **超 110%**（severity 封顶 100，
 *     枣庄同样封顶）；「264 天」→ 实测 **740.31**；「能动的第 4 处是武汉」→
 *     **武汉今天 0 候选**（真正带候选的四条是 `MaterialBatch/pos_lfp_b2` ·
 *     `MaterialBalance/磷酸铁锂正极` · `Line/金华分切线` · `Line/自贡分容线`）。
 *     ⇒ 屏上这些数**一个都不写死**，全部现读。
 *  3. 「三处基地敞口 `status=EMPTY` 绝不许显示成 0 亿」—— 实测**今天 8/8 全是 `OK`**
 *     （江门/邯郸/自贡扩容后都有单了）。空态规则**代码里保留**（换真数据还会出现），
 *     但今天走不到那条分支。
 *  4. 「今天扫出 43,468 条结论」—— 那是 11,348 对象那个世界的数；本租户种子世界
 *     （4,814 对象）实测一次演习 **775 条**（卡点 383 · 堵点 24 · 脆弱点 368）。
 *     ⇒ 屏上只写回包自陈的那个数，不写死量级。
 *  5. 派单表把「订单改价」归到「客户 + 型号」—— 实测该事件主路由 `order_fullchain`
 *     的 `so` 是必填且取自主体，传客户 id 回「order … not found」⇒ 已改回订单搜索。
 *  6. 派单说「卡点自带类别 ⇒ 类别层的 join 是真实存在的」—— 实测 `chain_impediments`
 *     **没有 category 字段**；真 join 在基地卡的 `factor` 上（8/8 命中方案库的键），
 *     且后端 `adopt_mitigation` 的必填参就是 `{base, factor, planKey}`。详见
 *     `decisionConsoleModel.ts` 文件头 §4。
 *
 * ── 钱这一段为什么是降级形态（仓主已裁决）───────────────────────────────────
 * 两条独立的实测，任一条成立都不许把毛利绝对值放到屏幕正中：
 *  ① `finance_world_projection` 在**零事件**、世界态「逐项相等」时就回
 *     `毛利 118.9 → -3272.25`（`销售成本 581.1 ×（1 + 583.57 ÷ 100）`）——
 *     42 条传导规则今天 `clamp:null · decay:null · combine:"sum"`，压力无上界逐日累加。
 *  ② 更要命的一条（本单实测新发现）：演习是**只读**的（`persist:false`），它推出来的
 *     那 30 天**不落盘**；而财务投影只会读会话**已落盘**的那一天。
 *     ⇒ 「你刚加的这两件事让毛利差多少」这一格，今天**根本没有数据源**，
 *     不是「算出来不准」，是「没有那条线」。
 * 故 ③ 区：毛利/多花的成本/少收的钱三行一律**删除线 + 一句话 + 点开给原文**，
 * ⛔ 不填 0、不写「无变化」、不留空白卡；而把**真的能算出来**的那两样放大：
 * 供需缺口的双向归因（引擎自陈「勾稽通过」）与冲击回执（这次到底打上没打上）。
 */

// ── 常量（屏上文案的单一出处，不散落）──────────────────────────────────────
const HORIZON_DAYS = 30;
/** 超过这么久还没回来就把已用秒数打在屏上（⛔ 不许无限转圈不给秒数）。 */
const SLOW_AFTER_MS = 10_000;
/** 实测一次全链 1.76–2.5 秒，屏上照这个说「通常 3 秒」。 */
const TYPICAL_SECONDS = 3;
const TOP_CUSTOMERS = 6;

type SolverData = Record<string, unknown>;

interface AddedEvent {
  uid: string;
  kind: string;
  /** 喂给后端的主体 id（对象 id 或业务键，见 `subjectIdFormFor`）。 */
  targetObjectId: string;
  /** 屏上显示的主体名。 */
  targetLabel: string;
  payload: Record<string, number | string>;
  effectiveDay: number;
  durationDays: number | null;
}

interface RunResult {
  report: DrillReport;
  risk: SolverData | null;
  impediments: SolverData | null;
  finance: SolverData | null;
  customers: { props: Record<string, unknown> }[];
  /** 本体类型键 → 中文业务名（后端单源 `displayName`；前端不内联映射表）。 */
  typeName: Map<string, string>;
  custAgg: { group: Record<string, string | null>; metrics: Record<string, number | null> }[];
  statusAgg: { group: Record<string, string | null>; metrics: Record<string, number | null> }[];
  bookValue: number;
  /** 「这次算的时候做了什么」那一层的全部原料（仓主 2026-08-28 追加的硬要求 ①）。 */
  trace: RunTrace;
  /** 这一批结果是哪一份输入算出来的（用来判「你改了但没重算」）。 */
  inputFingerprint: string;
}

/**
 * **可披露的演算过程**（仓主 2026-08-28 硬要求 ①）。
 *
 * 判据是仓主给的那一句：「一个看不到代码的人，读完这一层应当能自己判断
 * **这是真推演还是查表**」。所以这里收的是**能证伪「查表」这个假设**的东西：
 * 引用了多少条真数据（带快照版本）· 沿哪几条边推的（带系数与延迟天数）·
 * 撞了哪几条红线（带阈值与它的出处）· 枚举了多少次试算 · 每段花了多少毫秒。
 *
 * ⚠ 源码文件名/行号仍然不上屏（R-UI-4），但**规则 key / 切片 key / 系数 / 耗时 / 条数
 * 是业务事实不是实现细节**，必须给（仓主原话）。
 */
interface RunTrace {
  /** 每一路算的往返耗时（客户端量，含网络）。后端不分段计时 —— 这一点必须在屏上说清。 */
  timings: { label: string; ms: number; note: string }[];
  /**
   * ⚠ **墙钟总时间，不是逐段相加**。这几路是**并行**发出去的，
   * 把它们的毫秒加起来会得到一个比真实等待时间大好几倍的数
   * （实测相加 68,362 毫秒 vs 真实等待 4,5xx 毫秒）——
   * 又一次「我用一个看起来相关的数字当判据，而它并不度量我要度量的东西」。
   */
  wallMs: number;
  /** 引用了哪些数据：对象类型 + 条数 + 快照版本。 */
  data: { typeKey: string; typeName: string; count: number }[];
  snapshotVersions: { label: string; version: string }[];
  /** 本体切片：本次一条都没走 —— 但要拿目录总数当金丝雀，证明「没走」不是「没查」。 */
  slices: { registeredCount: number; usedCount: number; sample: string[] };
  /** 真正走的那张图：本次生效的传导边（系数 / 延迟 / 上界 / 合并方式 / 系数出处）。 */
  edges: {
    key: string;
    from: string;
    to: string;
    via: string;
    coefficient: number;
    delayDays: number;
    combine: string;
    clamp: string;
    decay: string;
    coefFromConfig: boolean;
  }[];
  edgeTotal: number;
  /**
   * 状态变量键 → 中文名字典（**后端单源**，随规则清单一起回来）。
   * 前端**不许**自己写第二份 —— 字典里没有的键照实显裸键，不编一个中文名。
   */
  stateVarNames: Record<string, string>;
  /** 撞了哪几条红线：阈值 + 它是写死的常数还是读的对象字段/规则参数。 */
  thresholds: { ruleKey: string; bindingId: string; source: string; where: string; value: number; unit: string }[];
  /** 逐条规则的判定原文（含 NOT_APPLICABLE 的，那也是结论）。 */
  evaluatedRules: { key: string; name: string; expression: string; outcome: string; evidence: string }[];
  /** 方案枚举的工作量 —— 「真枚举」与「查表」在这里分得最开。 */
  enumeration: { probes: number; anchors: number; effective: number; emitted: number } | null;
  /** 本次有没有 agent / LLM 参与。**恒要写一句，不许留白。** */
  agent: { called: boolean; why: string };
  /** 规则集版本 / 扫描号（业务事实：换一版规则这两个数会变）。 */
  ruleSetVersion: string | null;
  scanId: string | null;
  worldObjectCount: number | null;
}

/**
 * 把各路回包拼成「这次算的时候做了什么」那一层的原料。**一个数都不编**：
 * 取不到就留空 / 写 `-1`，屏上照实说「这一格这次没取到」。
 */
function buildTrace(input: {
  timings: { label: string; ms: number; note: string }[];
  wallMs: number;
  counts: { typeKey: string; typeName: string; count: number }[];
  snapshotVersions: [string, string | undefined][];
  edges: { items?: unknown[]; stateVarNames?: Record<string, string> } | null;
  slices: { entries?: { sliceKey: string; rootType: string }[] } | null;
  risk: SolverData | null;
  impediments: SolverData | null;
  finance: SolverData | null;
  report: DrillReport;
}): RunTrace {
  const rawEdges = (input.edges?.items ?? []) as Record<string, unknown>[];
  /**
   * 状态变量的中文名 —— **后端单源下发**（`stateVarNames` 字典，随规则清单一起回来）。
   * 前端**不许**自己写一份：本仓那条纪律的原文是「前端再算一份，度数口径一漂两边就各说各话」。
   * 字典里没有的键**照实显裸键**，不编一个中文名。
   */
  const svName = (k: string): string => input.edges?.stateVarNames?.[k] ?? k;
  /**
   * 本次**真正生效**的边 = 这一批事件打到的那个状态变量能沿着走的第一跳，以及第一跳的下游。
   * ⚠ 这里只报「与本次冲击的落点相连的那些边」，不报全部 42 条 ——
   * 报全部就是「这张图上有 42 条边」，那不度量「这一次走了哪几条」。
   */
  const seeds = new Set(input.report.appliedStateEffects.filter((e) => e.applied).map((e) => e.targetStateVar));
  const picked: RunTrace["edges"] = [];
  const seen = new Set<string>();
  let frontier = new Set(seeds);
  for (let hop = 0; hop < 4 && frontier.size > 0; hop++) {
    const next = new Set<string>();
    for (const r of rawEdges) {
      const from = String(r.sourceStateVar ?? "");
      if (!frontier.has(from)) continue;
      const key = String(r.key ?? "");
      if (seen.has(key)) continue;
      seen.add(key);
      const to = String(r.targetStateVar ?? "");
      picked.push({
        key,
        from: `${String(r.sourceTypeName ?? r.sourceTypeKey ?? "")}·${svName(from)}`,
        to: `${String(r.targetTypeName ?? r.targetTypeKey ?? "")}·${svName(to)}`,
        via: String(r.viaLinkKey ?? ""),
        coefficient: Number(r.coefficient ?? 0),
        delayDays: Number(r.delayTicks ?? 0),
        combine: String(r.combine ?? "—"),
        clamp: r.clamp == null ? "没有上界" : String(r.clamp),
        decay: r.decay == null ? "不衰减" : String(r.decay),
        coefFromConfig: r.coefficientRef != null,
      });
      next.add(to);
    }
    frontier = next;
  }

  const th = ((input.impediments as { thresholds?: Record<string, unknown>[] } | null)?.thresholds ?? []).map((t) => ({
    ruleKey: String(t.ruleKey ?? ""),
    bindingId: String(t.bindingId ?? ""),
    source: String(t.source ?? ""),
    where:
      t.source === "field"
        ? `读对象上的字段 ${String(t.fieldPath ?? "")}（改数据即改判定）`
        : t.source === "param"
          ? `读规则参数 ${String(t.ruleParamKey ?? "")}（改配置即改判定）`
          : "写死在规则表达式里的常数（改规则才改得动）",
    value: Number(t.value ?? 0),
    unit: String(t.unit ?? ""),
  }));

  const evalRules = [
    ...(((input.risk as { evaluatedRules?: Record<string, unknown>[] } | null)?.evaluatedRules ?? []) as Record<string, unknown>[]),
    ...(((input.impediments as { evaluatedRules?: Record<string, unknown>[] } | null)?.evaluatedRules ?? []) as Record<string, unknown>[]),
  ].map((r) => ({
    key: String(r.key ?? ""),
    name: String(r.name ?? ""),
    expression: String(r.expression ?? ""),
    outcome: String(r.outcome ?? ""),
    evidence: String(r.evidence ?? ""),
  }));

  const stats = ((input.impediments as { candidateStats?: { anchors?: number; probes?: number; effective?: number; emitted?: number }[] } | null)?.candidateStats ?? []);
  const enumeration: RunTrace["enumeration"] = stats.length
    ? stats.reduce<{ anchors: number; probes: number; effective: number; emitted: number }>(
        (a, s) => ({
          anchors: a.anchors + (s.anchors ?? 0),
          probes: a.probes + (s.probes ?? 0),
          effective: a.effective + (s.effective ?? 0),
          emitted: a.emitted + (s.emitted ?? 0),
        }),
        { anchors: 0, probes: 0, effective: 0, emitted: 0 },
      )
    : null;

  const sliceEntries = input.slices?.entries ?? [];
  return {
    timings: input.timings.slice().sort((a, b) => b.ms - a.ms),
    wallMs: input.wallMs,
    data: input.counts.slice().sort((a, b) => b.count - a.count),
    snapshotVersions: input.snapshotVersions.filter(([, v]) => !!v).map(([label, v]) => ({ label, version: v! })),
    slices: {
      registeredCount: sliceEntries.length,
      usedCount: 0,
      sample: sliceEntries.slice(0, 5).map((e) => `${e.sliceKey}（根：${e.rootType}）`),
    },
    edges: picked,
    edgeTotal: rawEdges.length,
    stateVarNames: input.edges?.stateVarNames ?? {},
    thresholds: th,
    evaluatedRules: evalRules,
    enumeration,
    agent: {
      called: false,
      why:
        "本次没有调用任何 agent、也没有调用任何大模型 —— 这条路从头到尾是算出来的：" +
        `施加 → 往后推 ${input.report.ticks} 天 → 扫红线 → 逐个杠杆试算改法。` +
        "屏上每一个数都能顺着下面的边和红线追回到原始对象。",
    },
    ruleSetVersion:
      (input.impediments as { ruleSetVersion?: string } | null)?.ruleSetVersion ??
      (input.risk as { ruleSetVersion?: string } | null)?.ruleSetVersion ??
      null,
    scanId: (input.impediments as { scanId?: string } | null)?.scanId ?? null,
    worldObjectCount: (input.finance as { worldObjectCount?: number } | null)?.worldObjectCount ?? null,
  };
}

/** 输入指纹 —— 改了 ① 而没重算时，结果区要整体压灰。 */
function fingerprintOf(events: AddedEvent[]): string {
  return JSON.stringify(
    events.map((e) => [e.kind, e.targetObjectId, e.payload, e.effectiveDay, e.durationDays]),
  );
}

/** 「估」角标：推演投影非实测。 */
function Est() {
  return (
    <span className={styles.est} title="这个数是算出来的，不是量出来的">
      估
    </span>
  );
}

/**
 * 引擎原文的**唯一渲染出口**。
 *
 * 一处收口的理由：原文里可能带源码文件名/行号，而 R-UI-4 明令禁止把它们打在用户屏上；
 * 但诚实位又「绝不允许删除」。所以这里**只**隐去源码坐标、其余一字不改，
 * 并且**替换发生时在屏上说一句** —— 静默替换等于篡改原文，比不替换更糟。
 *
 * ⚠ WO-CONSOLE-BLOCKERS · **B2**：引擎原文是 **markdown**（它自己写了 `**…**` 强调），
 * 而这里以前按**纯文本**直出 ⇒ 星号原样打在屏上（UX 第 7 轮实测 4 处）。
 * 现在把成对的 `**…**` 渲染成 `<strong>` —— **一个字都没删**，只是把作者的强调
 * 从"源码标记"变回"强调"。落单的星号不动（不猜作者意图）。成因与判据见
 * `decisionConsoleModel.parseEmphasis` 的注释。
 */
function Raw({ text }: { text: string }) {
  const scrubbed = scrubSourceRefs(text);
  const segs = parseEmphasis(scrubbed);
  return (
    <span className={styles.raw}>
      {segs.map((s, i) => (s.strong ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
      {scrubbed !== text ? "\n（上面这段是引擎原话，只隐去了源码文件名与行号，其余一字未改。）" : ""}
    </span>
  );
}

/** 「这次没算」：删除线 + 一句话 + 点开给原文。⛔ 不是 0、不是「无变化」、不是空白。 */
function Absent({ label, why, raw }: { label: string; why: string; raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.moneyRow}>
      <span className={styles.moneyLabel}>{label}</span>
      <span className={styles.absent}>——————</span>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={styles.absentWhy}>{why}</span> {open ? "▾" : "▸"}
      </button>
      {open ? <Raw text={raw} /> : null}
    </div>
  );
}

export default function DecisionConsoleView() {
  // ── 数据：事件目录（**唯一真相源**，前端一行清单都不写死）──────────────────
  const catalog = useQuery({ queryKey: ["decision-console", "drill-catalog"], queryFn: fetchDrillCatalog });
  const sessions = useQuery({ queryKey: ["decision-console", "sim-sessions"], queryFn: fetchSimSessions });
  const sessionId = sessions.data?.items?.[0]?.id ?? null;

  const specs: DrillEventSpec[] = useMemo(() => catalog.data?.specs ?? [], [catalog.data]);
  const specsByKind = useMemo(() => new Map(specs.map((s) => [s.kind as string, s])), [specs]);

  // ── 区① 状态 ────────────────────────────────────────────────────────────
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedEvent[]>([]);
  const [notAvailableOpen, setNotAvailableOpen] = useState(false);

  // ── 结果 ────────────────────────────────────────────────────────────────
  const [result, setResult] = useState<RunResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  /** 第 ④ 区展开的是哪一条卡点的改法（`null` = 都收着）。 */
  const [openImpediment, setOpenImpediment] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("tn");
  const [footerOpen, setFooterOpen] = useState(false);
  const startedAt = useRef<number>(0);

  const adopt = useActionDraft();

  /**
   * ══ WO-CONSOLE-BLOCKERS · B3 · 已经排进待批的那几条 ═══════════════════════
   *
   * 今天的行为是 X（UX 第 7 轮抓包 + 本单实测复现 · 2026-08-28）：〔就这么办〕可以连点，每点一次就真的
   * `POST /a/v1/action-drafts`，屏上只留最后一条确认，而那句话逐字写着「已经生成**一份**」——
   * **从第二次点击起这句话就是错的**，队列里已经躺了两份。
   * 应该是 Y：**同一条打法只会有一份待批**；已经有了就不再是「就这么办」，而是「查看这份待批」。
   *
   * ⚠ 光在前端拦不够（派单点名）：前端拦得住连点，**拦不住刷新后再点** —— 刷新后组件状态清零，
   * 按钮又变回可点。所以这一格是**两半**，缺一半都不成立：
   *   ① 后端（`actions.ts planFingerprint`）：同 `base+factor+planKey` 复用同一 draft
   *      —— 那是**真相源**，也是刷新、换标签页、换设备都仍然成立的那一半；
   *   ② 这里：进页/算完就**现读**待批队列，把「哪几条已经在排队」读回来。
   *      读的是后端队列**不是本地记忆**，所以刷新后它照样知道。
   *
   * 只读 `PENDING_APPROVAL`：已批准/已执行的不该再拦着重提（那已经是另一件事了），
   * 被否掉/撤回的更不该 —— 后端的指纹去重也按同一条判据放行（`FINGERPRINT_DEAD_STATUSES`）。
   */
  const pendingAdoptions = useQuery({
    queryKey: ["decision-console", "pending-adoptions"],
    queryFn: () => fetchActionDrafts("PENDING_APPROVAL"),
    staleTime: 10_000,
  });
  /** `base|factor|planKey` → draftId。键与后端指纹用的是**同三件**，不另编一套。 */
  const adoptedByPlan = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of pendingAdoptions.data ?? []) {
      if (d.actionTypeKey !== "adopt_mitigation") continue;
      const p = d.payload as { base?: unknown; factor?: unknown; planKey?: unknown };
      if (typeof p?.base !== "string" || typeof p?.factor !== "string" || typeof p?.planKey !== "string") continue;
      m.set(`${p.base}|${p.factor}|${p.planKey}`, d.id);
    }
    return m;
  }, [pendingAdoptions.data]);

  const run = useMutation({
    mutationFn: async (): Promise<RunResult> => {
      if (!sessionId) throw new Error("这个租户还没有可用的算例，先在别处建一个再回来。");
      const events: DrillEvent[] = added.map((e) => ({
        kind: e.kind as DrillEvent["kind"],
        targetObjectId: e.targetObjectId,
        payload: e.payload,
        effectiveDay: e.effectiveDay,
      }));
      /** 每一路算的往返耗时 —— 客户端量的**整段**时间（后端不分段计时，这句要写到屏上）。 */
      const runStartedAt = performance.now();
      const timings: { label: string; ms: number; note: string }[] = [];
      const timed = async <T,>(label: string, note: string, p: Promise<T>): Promise<T> => {
        const t0 = performance.now();
        try {
          return await p;
        } finally {
          timings.push({ label, ms: Math.round(performance.now() - t0), note });
        }
      };
      // 一颗按钮把五件事全做完 —— 用户不该去找第二颗。
      const [report, riskRaw, impedRaw, finRaw, customers, custAgg, statusAgg, types, edgeRes, sliceRes] = await Promise.all([
        timed("① 把事情施加上去 + 往后推 30 天 + 扫一遍卡住的地方", "这一段里施加、推进、扫描是后端连着做的，它没有分段计时", simDrill(sessionId, { events, horizonDays: HORIZON_DAYS, limitPerKind: 50 })),
        timed("② 算每个基地这 30 天紧到什么程度", "含订单准时率与打法库", invokeSolver("risk_timeline", {}).catch(() => null)),
        timed("③ 全链扫红线 + 枚举改法", "改法是逐个杠杆试算出来的，不是查表 —— 试算次数见下", invokeSolver("chain_impediments", { scope: {} }).catch(() => null)),
        timed("④ 财务投影", "只读，且读的是这次算例已经存下来的那一天", invokeSolver("finance_world_projection", { worldId: sessionId }).catch(() => null)),
        // **有意只取首页**：`Customer` 实测真值 20（独立口径 `POST /a/v1/objects/aggregate`，seed 42），
        // pageSize 50 > 20 ⇒ 首页即全集。⚠ 客户数若哪天越过 50，这里会静默欠读 —— 判据是
        // 「客户册是有界小字典」，不是「50 够大」；同屏的 ⑥⑦ 两项已经走 aggregate（服务端全量），
        // 本项只是把客户名字取出来配对，不产生任何分母。
        timed("⑤ 取客户档案", "20 家", searchObjects("Customer", "", { pageSize: "50" }).then((p) => p.items).catch(() => [])),
        timed("⑥ 按客户汇总订单", "500 张单的分组聚合", aggregateObjects({ typeKey: "Order", groupBy: ["cust"], metrics: [{ fn: "count", prop: "so" }, { fn: "sum", prop: "value" }] }).then((r) => r.rows).catch(() => [])),
        timed("⑦ 按状态汇总订单", "已完成 / 在产 / 已下待排产", aggregateObjects({ typeKey: "Order", groupBy: ["status"], metrics: [{ fn: "count", prop: "so" }, { fn: "sum", prop: "value" }] }).then((r) => r.rows).catch(() => [])),
        fetchObjectTypes().catch(() => []),
        timed("⑧ 取这次用到的那张关系图", "本租户已发布的那些「谁影响谁」的边", fetchPropagationRules(true).catch(() => null)),
        timed("⑨ 查本体切片目录", "查了才敢说「本次一条都没走」", fetchSlicesIndex().catch(() => null)),
      ]);
      const risk = (riskRaw?.data ?? null) as SolverData | null;
      const impediments = (impedRaw?.data ?? null) as SolverData | null;
      const finance = (finRaw?.data ?? null) as SolverData | null;
      const bookValue = statusAgg.reduce((a, r) => a + (r.metrics.sum_value ?? 0), 0);
      const typeName = new Map(types.map((t) => [t.key, t.displayName]));

      // ── 引用了哪些数据：本次真正落到屏上的那几类，逐类要一次 total（`pageSize=1` 只取计数）──
      const touched = new Set<string>(["Order", "Customer", "Base", "Line", "Material", "Model"]);
      for (const x of ((impediments as { impediments?: { locus: { objectType: string } }[] } | null)?.impediments ?? []))
        touched.add(x.locus.objectType);
      const counts = await Promise.all(
        [...touched].map(async (t) => {
          try {
            // **有意只取首页，而且只取 1 行**：这里要的是 `total`（服务端回显的符合条件总行数，
            // 独立于 page/pageSize），行本身一条都不用 ⇒ `pageSize=1` 是最省的取计数姿势。
            // 这是本次扫描里**唯一一处把分页参数用对了的**：它读的是 total，不是 items.length。
            const p = await searchObjects(t, "", { pageSize: "1" });
            return { typeKey: t, typeName: typeName.get(t) ?? t, count: p.total };
          } catch {
            return { typeKey: t, typeName: typeName.get(t) ?? t, count: -1 };
          }
        }),
      );

      const trace = buildTrace({
        timings,
        wallMs: Math.round(performance.now() - runStartedAt),
        counts,
        snapshotVersions: [
          ["每个基地紧到什么程度", riskRaw?.snapshotVersion],
          ["全链红线扫描", impedRaw?.snapshotVersion],
          ["财务投影", finRaw?.snapshotVersion],
        ],
        edges: edgeRes,
        slices: sliceRes,
        risk,
        impediments,
        finance,
        report,
      });

      return { report, risk, impediments, finance, customers, custAgg, statusAgg, bookValue, typeName, trace, inputFingerprint: fingerprintOf(added) };
    },
    onSuccess: (r) => {
      setResult(r);
      // 确认条不再有本地状态可清 —— 它现算自待批队列（见 B3 那段账）。
      const cards = cardsOf(r.risk);
      setSelectedBaseId((prev) => prev ?? cards.slice().sort((a, b) => b.revenueYi - a.revenueYi)[0]?.baseId ?? null);
    },
  });

  // 已用秒数（超 10 秒必须把秒数打在屏上）。
  useEffect(() => {
    if (!run.isPending) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => window.clearInterval(t);
  }, [run.isPending]);

  const stale = result !== null && result.inputFingerprint !== fingerprintOf(added);

  const addEvent = useCallback((e: AddedEvent) => {
    setAdded((prev) => [...prev, e]);
    setOpenKind(null);
  }, []);

  // ── 派生 ────────────────────────────────────────────────────────────────
  const cards = useMemo(() => cardsOf(result?.risk ?? null), [result]);
  const totals = useMemo(() => exposureTotals(cards), [cards]);
  const imp = useMemo(() => splitImpediments(result?.impediments ?? null, result?.typeName), [result]);
  const otdRows = useMemo(() => {
    const b = (result?.risk as { otdBatch?: { rows?: unknown[] } } | null)?.otdBatch;
    return (b?.rows ?? []) as { so: string; dueDay: number; delayDays: number; onTime: boolean }[];
  }, [result]);
  const otd = (result?.risk as { otdBatch?: { total?: number; onTimeCount?: number; rate?: number } } | null)?.otdBatch ?? null;
  const timeline = useMemo(
    () => (result ? orderedEvents(result.report.findings, otdRows, HORIZON_DAYS) : []),
    [result, otdRows],
  );
  const library = useMemo(
    () => ((result?.risk as { mitigationLibrary?: Record<string, Mitigation[]> } | null)?.mitigationLibrary ?? {}),
    [result],
  );
  const selectedCard = cards.find((c) => c.baseId === selectedBaseId) ?? null;
  const planCategory = planCategoryOf(selectedCard, library);
  const plans = planCategory ? sortMitigations(library[planCategory] ?? [], sortKey) : [];
  const custRows = useMemo(
    () => (result ? topCustomers(result.custAgg, result.customers, result.bookValue, TOP_CUSTOMERS) : []),
    [result],
  );
  const financeNotes = ((result?.finance as { notes?: string[] } | null)?.notes ?? []) as string[];
  const honesty: HonestyNote[] = useMemo(
    () =>
      result
        ? collectHonesty({
            report: result.report,
            specsByKind,
            impedimentsRaw: result.impediments,
            financeNotes,
            riskDataMode: (result.risk as { dataMode?: string } | null)?.dataMode ?? null,
          })
        : [],
    [result, specsByKind, financeNotes],
  );
  const gapFinding = result?.report.findings.find((f) => f.source.solverKey === "supply_demand_gap_attribution") ?? null;
  const nothingMoved = nothingMovedText(result?.report ?? null);
  /** 「屏上哪几个数不吃你加的事」—— 判据在 model 层（可测），这里只负责显示。 */
  const invariantNote = invariantNumbersNote(result?.report ?? null);

  // ── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page} data-testid="decision-console">
      {/*
       * 键盘跳转链接（WAI-ARIA 标准做法，**不是**把 DOM 顺序拧成与视觉不一致）。
       * 2026-08-28 实测：左栏 11 条模板 × 2 个可聚焦控件 + 壳导航 ⇒ 从页顶按到〔算一下〕要 **107 次**。
       * 复验：开 `/v/decision-console`，从页顶连按 Tab 数到〔算一下〕拿到焦点为止
       *（计数口径见本文件 `DecisionConsoleView.tsx` 左栏模板列表）。
       * 有这一条：进本页后第一次 Tab 就能拿到它。
       */}
      <button
        type="button"
        className={styles.skip}
        onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="dc-go"]')?.focus()}
      >
        跳到〔算一下〕
      </button>
      {/* ══ 左栏 · 区① 加几件事 + 唯一的那颗按钮 ══════════════════════════ */}
      <div className={styles.left}>
        <div className={styles.leftScroll}>
          <section className="panel" id="z1" aria-label="加几件事">
            <h2 className={styles.zoneTitle}>
              加一件或几件事，我算给你看
              <span className={styles.zoneHint}>往后 {HORIZON_DAYS} 天</span>
            </h2>
            {catalog.isLoading ? <p className={styles.greyLine}>正在取事情清单…</p> : null}
            {catalog.isError ? (
              <p className={styles.err}>
                事情清单取不回来，这一格今天用不了 —— {humanizeApiError(String(catalog.error)).text}
                <br />
                <Raw text={String(catalog.error)} />
              </p>
            ) : null}
            {specs.map((spec) => (
              <TemplateRow
                key={spec.kind}
                spec={spec}
                open={openKind === spec.kind}
                onToggle={() => setOpenKind((k) => (k === spec.kind ? null : spec.kind))}
                onAdd={addEvent}
              />
            ))}
          </section>

          {added.length > 0 ? (
            <section className="panel" aria-label="已经加了哪些事">
              <h2 className={styles.zoneTitle}>已经加了 {added.length} 件事</h2>
              <div className={styles.added}>
                {added.map((e, i) => {
                  const spec = specsByKind.get(e.kind);
                  const numKey = Object.keys(e.payload).find((k) => typeof e.payload[k] === "number");
                  return (
                    <div className={styles.addedItem} key={e.uid}>
                      <span className={styles.addedText}>
                        {spec?.label ?? e.kind} · {e.targetLabel}
                        {e.effectiveDay > 0 ? ` · 第 ${e.effectiveDay} 天起` : ""}
                        {spec && !subjectIsRead(spec) ? (
                          <>
                            <br />
                            <span className={styles.greyLine}>
                              这类事今天不看你选的是谁，它只决定去问哪几路算
                            </span>
                          </>
                        ) : null}
                      </span>
                      {numKey ? (
                        <input
                          className={styles.addedNum}
                          type="number"
                          aria-label={`改「${spec?.label ?? e.kind}」的数`}
                          value={String(e.payload[numKey])}
                          onChange={(ev) => {
                            const v = Number(ev.target.value);
                            setAdded((prev) =>
                              prev.map((x, xi) => (xi === i ? { ...x, payload: { ...x.payload, [numKey]: v } } : x)),
                            );
                          }}
                        />
                      ) : null}
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`删掉「${spec?.label ?? e.kind}」`}
                        onClick={() => setAdded((prev) => prev.filter((_, xi) => xi !== i))}
                      >
                        删
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className={styles.greyLine}>还没加任何事。加一件，我算给你看。</p>
          )}

          <div className={styles.greyLine}>
            <button type="button" className={styles.footerBtn} onClick={() => setNotAvailableOpen((v) => !v)} aria-expanded={notAvailableOpen}>
              还有一些事这里试不了 {notAvailableOpen ? "▾" : "▸"}
            </button>
            {notAvailableOpen ? (
              <div className={styles.drawer} data-layer2="1">
                <div className={styles.drawerItem}>
                  上面这 {specs.length} 件是今天真的能算的全部（清单现读后台，后台加一件这里就多一件，
                  不是这里写死的）。除此之外的事 —— 比如「换一家供应商」「汇率变了」「限电」——
                  今天没有对应的算法可问，摆上来就是一个选了没反应的选项。
                </div>
                {specs.map((s) => (
                  <div className={styles.drawerItem} key={s.kind}>
                    · {s.label}
                    {s.stateEffect ? "（这件事会真的打到数上）" : subjectIsRead(s) ? "（这件事会把你选的那个主体喂给算法）" : "（这件事只决定去问哪几路算）"}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* 整屏最亮的只有它，且只有它。⛔ 没有第二颗按钮。 */}
        <div className={styles.goWrap}>
          <button
            type="button"
            className={`${styles.go} ${styles.goSolid}`}
            data-testid="dc-go"
            disabled={run.isPending || added.length === 0 || !sessionId}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "正在算…" : "算一下"}
          </button>
          {added.length === 0 ? <p className={styles.greyLine}>先加一件事，这颗按钮才有事可算。</p> : null}
          {!sessionId && !sessions.isLoading ? (
            <p className={styles.err}>这个租户还没有可用的算例，这一页今天算不了。</p>
          ) : null}
        </div>
      </div>

      {/* ══ 右栏 ═══════════════════════════════════════════════════════════ */}
      <div className={styles.right}>
        {/* 区② 算的时候：什么都不给，只一行 + 进度条 */}
        {run.isPending ? (
          <section className="panel" id="z2" aria-label="正在算">
            <div className={styles.computing}>
              <div className={styles.computingText}>
                {elapsed > SLOW_AFTER_MS
                  ? `还在算（已经 ${Math.round(elapsed / 1000)} 秒，通常 ${TYPICAL_SECONDS} 秒）`
                  : `正在算未来 ${HORIZON_DAYS} 天…`}
              </div>
              <div className={styles.bar}>
                <div className={styles.barFill} />
              </div>
            </div>
          </section>
        ) : null}

        {run.isError && !run.isPending ? (
          <section className="panel" aria-label="没算成">
            <p className={styles.err}>
              {/* 第一层说人话；原文降到第二层（`Raw`）一个字不删 —— 诚实位允许降层不允许删除 */}
              {humanizeApiError(String(run.error)).text}
              <br />
              你刚才加的 {added.length} 件事还在，改完再按一次〔算一下〕。
              <br />
              <Raw text={String(run.error)} />
            </p>
          </section>
        ) : null}

        {result && !run.isPending ? (
          <>
            {stale ? (
              <div className={styles.staleBar} data-testid="dc-stale">
                你改了左边的输入，下面这些还是上一次算的。
                <button type="button" className={styles.sortBtn} onClick={() => run.mutate()}>
                  重算
                </button>
              </div>
            ) : null}

            <div className={stale ? styles.stale : undefined}>
              {/* ══ 区③ 钱上差多少 ══════════════════════════════════════ */}
              <section className="panel" id="z3" aria-label="钱上差多少">
                <div className={styles.moneyHead}>
                  这 {added.length} 件事凑一块，往后 {result.report.horizonDays} 天
                </div>

                {/*
                  * 最大那个数 = **交不出去的货**（按订单去重的口径）。
                  * 为什么是它当第一层的大数，而不是产销缺口：
                  *  · 它**恒有** —— 每次算都会问一遍每个基地这 30 天紧到什么程度，那一路是通用的；
                  *    而产销缺口只有加了物料/预测类的事才会被问到
                  *   （2026-08-28 实测：只加「产能损失」时它一条都没有；
                  *    复验：`/v/decision-console` 只加一条产能损失后打 `/a/v1/solvers/invoke` 看返回）。
                  *    上一版拿它当大数 ⇒ 换一类事件进来，屏幕正中就是空的。
                  *  · 它是**钱**，是签字的人第一眼要的那个数。
                  * ⚠ 一定是**去重**口径：8 张基地卡直接相加实测 89.58 亿，按单号去重 63.16 亿，
                  *   差 1.418×，根因是跨基地订单被算了两次。
                  */}
                <div className={styles.bigNum} data-testid="dc-money">
                  {roundish(totals.dedupedYi)}
                  <span className={styles.bigUnit}>亿 · 这 {HORIZON_DAYS} 天交不出去的货</span>
                  <Est />
                </div>
                <div className={styles.bigCaption}>
                  {totals.orderCount} 张单 · {totals.customerCount} 家客户
                  {otd ? ` · 其中会晚 ${(otd.total ?? 0) - (otd.onTimeCount ?? 0)} 张、准时 ${otd.onTimeCount ?? 0} 张` : ""}
                </div>

                {/*
                 * 🔴 **本单最后一处「装作会算」的正面回答**（COO 病灶的落点）。
                 *
                 * 上面那行抬头写的是「这 N 件事凑一块，往后 30 天」，而这个大数 **2026-08-29 实测不随事件变**：
                 * 它来自 `risk_timeline`，本页给它的实参是 `{}` —— 一个 event 都没传。
                 * 复验：起真 datacore（`SEED_DEMO=1`）后对同一算例把幅度从 15 改到 100000 各调一次
                 * `POST /a/v1/sim/sessions/:id/drill`，再各调一次 `POST /a/v1/solvers/risk_timeline/invoke`
                 * ——后者两次回包的 8 张卡逐字节相同，而前者 `findingsChanged` 从 0 变 104。
                 * 抬头把它归因给用户的输入，是一句**错误归因**；用户改了输入看它不动，
                 * 只能得出「这系统在骗我」，而他是对的。
                 *
                 * ⚠ 判据与文案全部来自 `invariantNumbersNote`（纯函数 + 声明表），
                 *   不在这里写死一句话 —— 写死的话，下次有人给那一路接上事件入参时
                 *   没有任何东西会提醒他来改，一句当时正确的话就静默变成假话。
                 */}
                {invariantNote ? (
                  <p className={styles.greyLine} data-testid="dc-invariant-note">
                    {invariantNote.text}
                    <br />
                    <Raw text={invariantNote.raw} />
                  </p>
                ) : null}

                {gapFinding ? (
                  <div className={styles.split}>
                    <div className={styles.splitCell}>
                      <div className={styles.splitVal}>
                        {bigGapOf(gapFinding.evidence)} 万套
                        <Est />
                      </div>
                      <div className={styles.splitLabel}>
                        产销缺口 —— {oneLineCause(gapFinding.evidence)}
                        <br />
                        <ReconcileEntry finding={gapFinding} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className={styles.greyLine}>
                    这次加的这几件事没有走到「产销缺口」那一路算上（只有物料与预测类的事才会问到它），
                    所以这一屏没有那个数 —— 不是算出来是 0。
                  </p>
                )}

                <div className={styles.moneyRows}>
                  {/* 三行钱一律降级：⛔ 不填 0、不写「无变化」、不留空白卡 */}
                  <Absent
                    label="毛利差多少"
                    why="这次算不出来"
                    raw={
                      "两条独立的原因，任一条成立这一格就没有数据源：\n" +
                      "① 这次的算是只读的，它算出来的那 30 天不留下来；而财务那一路只会读这次算例已经存下来的那一天 —— 「你刚加的这几件事之后毛利是多少」今天没有那条线。\n" +
                      "② 就算读得到，那个数今天也是坏的：一件事都不加、逐项相等时它就已经回「毛利 118.9 → " +
                      (financeMargin(result.finance) ?? "（本次未取到）") +
                      "」——那条换算链上的 42 条规则今天既没有上界也没有衰减，压力逐日累加。\n" +
                      "引擎原话：" +
                      (financeBasisNote(result.finance) ?? "（本次未取到）")
                    }
                  />
                  <Absent
                    label="多花的成本"
                    why="这次算不出来"
                    raw={"同上：这一行与毛利同源（基线 ×（1 + 压力 ÷ 100）），这次算出来的那 30 天不留下来 ⇒ 取不到本次的值。"}
                  />
                  <Absent
                    label="少收的钱"
                    why="这次算不出来"
                    raw={
                      financeNotes[0] ??
                      "需求侧与收入行之间今天没有换算关系；凭空折算一个系数就是引擎自己发明一个数。"
                    }
                  />
                </div>

                {/* 能算出来的那一样：这次到底打上没打上 */}
                <div className={styles.split}>
                  {result.report.appliedStateEffects.length === 0 ? (
                    <div className={styles.splitCell}>
                      <div className={styles.splitVal}>0 / {added.length}</div>
                      <div className={styles.splitLabel}>
                        你加的事里，没有一件会直接改数 —— 它们只决定去问哪几路算。这不是「没影响」。
                      </div>
                    </div>
                  ) : (
                    result.report.appliedStateEffects.map((e) => (
                      <div className={styles.splitCell} key={`${e.eventKind}-${e.targetObjectId}`}>
                        <div className={styles.splitVal} style={{ color: e.applied ? undefined : "var(--danger-txt)" }}>
                          {e.applied ? "已生效" : "没打上"}
                        </div>
                        <div className={styles.splitLabel}>
                          {specsByKind.get(e.eventKind)?.label ?? e.eventKind} · 你填的 {e.rawMagnitude}
                          {" ⇒ "}打到「{e.targetLabel}」的
                          {/* 中文名由后端字典下发；没有就照实显裸键，不在前端编一个 */}
                          {result.trace.stateVarNames[e.targetStateVar] ?? e.targetStateVar}上
                          {e.applied ? "，第 " + Math.max(1, e.startTick - (result.report.ticks - result.report.horizonDays)) + " 天开始起作用" : "，所以下面的结论里不含这件事"}
                          <br />
                          {/*
                            幅度的两段账都要给：用户填的那个数 ⇒ 占全距百分之几 ⇒ 乘上本世界实测全距。
                            少一段那个 `magnitude` 就是个来路不明的数（本单最早就是这么埋的坑）。
                          */}
                          <Raw
                            text={
                              `幅度怎么换算的：${e.rawMagnitude} ⇒ 该变量全距的 ${e.rangePct.toFixed(1)}%` +
                              ` × 本世界实测全距 ${e.observedRange.toFixed(1)} = ${e.magnitude.toFixed(1)}\n` +
                              `换算依据：${e.magnitudeBasis}\n` +
                              (e.downstream.length > 0
                                ? `这一格的出边（顺着往下推的第一跳）：${e.downstream.join("、")}`
                                : `⚠ 这一格在本租户的关系图上「没有出边」—— 打上去也传不下去，屏上其余的数不会因它而动。`)
                            }
                          />
                        </div>
                      </div>
                    ))
                  )}
                  <div className={styles.splitCell}>
                    <div className={styles.splitVal}>
                      {result.report.solverRuns.filter((r) => r.ok).length} / {result.report.solverRuns.length}
                    </div>
                    <div className={styles.splitLabel}>
                      这次问了 {result.report.solverRuns.length} 路算，
                      {result.report.solverRuns.filter((r) => !r.ok).length > 0
                        ? `有 ${result.report.solverRuns.filter((r) => !r.ok).length} 路没跑通（在页脚点开看原文）`
                        : "全部跑通"}
                    </div>
                  </div>
                  {/*
                    🔴 **COO 那个「+15 改 +100 一个数都没动」要的就是这一格**。
                    它是**实测**（2026-08-29 真后端 `SEED_DEMO=1` 逐类跑过）：后端把这一批事件
                    拿掉再推一遍同样的 30 天，逐格比出来的。
                    复验：`POST /a/v1/sim/sessions/:id/drill` 同一算例换两个幅度各调一次，比回包的
                    `worldCellsMoved` 与 `findingsChanged`。
                    ⚠ 与上面「已生效」是两个不同的命题：那个说「冲击写进去了」，
                    这个说「它传下去动了多少格」。本仓真实存在「写进去了、出边也有、
                    但动的格子全在警戒线以下 ⇒ 卡点清单一条不动」这一态 ——
                    不给这个数，它在屏上就与「压根没打上」长得一模一样。
                  */}
                  {result.report.appliedStateEffects.length > 0 ? (
                    <div className={styles.splitCell}>
                      <div
                        className={styles.splitVal}
                        style={{ color: result.report.worldCellsMoved === 0 ? "var(--danger-txt)" : undefined }}
                      >
                        {result.report.worldCellsMoved.toLocaleString("zh-CN")}
                      </div>
                      <div className={styles.splitLabel}>
                        {result.report.worldCellsMoved === 0
                          ? `你加的这几件事一格都没改动 —— 冲击写进去了、出边也在，但推完 ${HORIZON_DAYS} 天之后与「不加这几件事」逐格相同。这是结论，不是故障。`
                          : `格数据因为你加的这几件事而变了（全世界一共 ${result.report.worldCellsTotal.toLocaleString("zh-CN")} 格）。`}
                        <br />
                        <Raw
                          text={
                            `这个数是实测出来的：后端把这一批事件拿掉、用同样的参数再推了一遍 ${HORIZON_DAYS} 天，逐格比对。\n` +
                            `⚠ 它是这 ${result.report.appliedStateEffects.length} 件事「合起来」的数，不是其中某一件的功劳 —— 逐件归因要多推 ${result.report.appliedStateEffects.length} 遍，代价与收益不成比例，所以这里不做，也不假装做了。\n` +
                            `⚠ 「动了 N 格」不等于「屏上的卡点清单会变」：卡点是按每个变量在全世界的分位数判的，动的格子若都在警戒线以下，清单就不会变。`
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                  {/*
                    🔴 **屏上唯一直接回答「我改的那个数，到底改没改变结论」的一格**
                    （COO 那个 +15 → +100 的对照实验问的就是这一句）。

                    ── 为什么上面那格答不了 ────────────────────────────────────────
                    `worldCellsMoved` 度量的是**波及面**（多少格与对照不同），**不随幅度变**：
                    本单真后端实测 11 类事件各跑小/大两遍 —— 产能损失把 `lossPct` 从 10 拉到 100
                    （施加幅度 3,486 → 34,865），`worldCellsMoved` **两次都是 210**，一格不差。
                    拿它当「改数有没有用」的判据必然误判，那正是「我用 X 当作 Y 的证据，
                    而 X 并不度量 Y」这条老病。⇒ 这一格比的是**结论本身**。
                  */}
                  {result.report.appliedStateEffects.length > 0 ? (
                    <div className={styles.splitCell}>
                      <div
                        className={styles.splitVal}
                        style={{ color: result.report.findingsChanged === 0 ? "var(--danger-txt)" : undefined }}
                      >
                        {result.report.findingsChanged.toLocaleString("zh-CN")}
                      </div>
                      <div className={styles.splitLabel}>
                        {/*
                          ⚠ 措辞必须点明「**顺着关系推出来的**结论」这个限定 —— 这个数**不含**
                          求解器那一路的结论（它们读本体真值、不读世界态）。少了这个限定，
                          「0 条改变」会被读成「整屏一条都没变」，而同一次演习里求解器完全
                          可能多报十几条卡点 —— 那就成了一句**看起来精确的假话**。
                        */}
                        {/*
                          ⚠ **上一版这句写的是「把幅度调大再算一次，很可能还是 0」——那是一句假话，已按实测改。**
                          真后端 seed 42 实测 11 类事件各跑「小参数 / 大参数」两遍：小参数下报 0 的有 10 类，
                          其中 **6 类**把幅度拨大之后就不再是 0（临时插单 0→76 · 改交付地点 0→97 ·
                          物料到货延迟 0→26 · 物料短缺 0→26 · 物料价格变动 0→104 · 预测偏差 0→1），
                          只有 4 类（订单取消 / 订单改价 / 设备故障 / 产能损失）拨到头仍是 0。
                          ⇒ 旧文案把「多数情况下有用」说成了「很可能没用」，正好劝退了唯一有效的那个动作。
                          这与本页那句「报『没算出来』和报『没事』必须分得开」是同一条纪律：
                          **不许拿一句听起来稳妥的话，去盖住一个我们实测知道的事实。**
                        */}
                        {result.report.findingsChanged === 0
                          ? `条**顺着关系推出来的**结论因此改变 —— 你加的这几件事传下去了（上面「动了 N 格」就是证据），但动的格子没有一个越过它那个变量的警戒线，所以这类结论一条都没被推翻。这是结论，不是故障。**值得把幅度拨大再算一次**：实测 11 类事件里，小幅度下报 0 的有 10 类，其中 6 类拨大之后就不再是 0。（求解器那一路的结论不在这个数里，见下面各路的回执。）`
                          : `条**顺着关系推出来的**结论因你加的这几件事而改变（不加时这类结论一共 ${result.report.findingsBaseline.toLocaleString("zh-CN")} 条；求解器那一路不计在内）。`}
                        <br />
                        <Raw
                          text={
                            `怎么算的：把这批事件拿掉再推一遍同样的 ${HORIZON_DAYS} 天，对照世界也扫一遍卡点，两份清单逐条比（新增 + 消失 + 严重度变了的都算）。\n` +
                            `⚠ 「只比传导引擎扫出来的那些」：求解器那一路读的是本体真值、不读世界态，把它算进来这个数会恒不为 0，判据就废了。所以这个数是 0 时，屏上的卡点总数仍可能因为求解器而变多 —— 两者不矛盾，看的是不同的东西。\n` +
                            `⚠ 这个数是 0 而上面「动了 N 格」不是 0，是「正常且有意义」的一种结果：冲击确实传下去了，但动的那些格子没有一个越过它那个变量的警戒线（卡点按分位数判），所以这类结论没变。`
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                {nothingMoved ? <p className={styles.greyLine}>{nothingMoved}</p> : null}
              </section>

              {/* ══ 区③b 客户与订单 ══════════════════════════════════════ */}
              <section className="panel" id="z3b" aria-label="客户与订单">
                <h2 className={styles.zoneTitle}>
                  客户与订单
                  <span className={styles.zoneHint}>
                    这 {HORIZON_DAYS} 天里，{totals.orderCount} 张单牵涉 {roundish(totals.dedupedYi)} 亿、
                    {totals.customerCount} 家客户
                  </span>
                </h2>
                <p className={styles.greyLine}>
                  含跨基地订单，各基地不可直接相加（相加会得到 {roundish(totals.naiveSumYi)} 亿，
                  同一张单被算了两次）。
                </p>

                {otd ? (
                  <p className={styles.countLine}>
                    这些单里，会晚的 <strong>{(otd.total ?? 0) - (otd.onTimeCount ?? 0)}</strong> 张、
                    准时的 <strong>{otd.onTimeCount ?? 0}</strong> 张
                    <Est />
                  </p>
                ) : null}

                <SegmentBar rows={result.statusAgg} />

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>客户</th>
                        <th className={styles.num}>张数</th>
                        <th className={styles.num}>金额（亿）</th>
                        <th className={styles.num}>占订单簿</th>
                        <th className={styles.num}>应收（万）</th>
                        <th className={styles.num}>额度（万）</th>
                        <th className={styles.num}>最长逾期</th>
                        <th>要留意</th>
                      </tr>
                    </thead>
                    <tbody>
                      {custRows.map((c) => (
                        <tr key={c.custId}>
                          <td>{c.custName}</td>
                          <td className={styles.num}>{c.orderCount}</td>
                          <td className={styles.num}>{c.valueYi.toFixed(1)}</td>
                          <td className={styles.num}>{c.sharePct.toFixed(1)}%</td>
                          <td className={`${styles.num} ${c.overCredit ? styles.flagBad : ""}`}>
                            {c.receivablesWan.toLocaleString("zh-CN")}
                          </td>
                          <td className={styles.num}>{c.creditLimitWan.toLocaleString("zh-CN")}</td>
                          <td className={`${styles.num} ${c.maxOverdueDays >= 30 ? styles.flagWarn : ""}`}>
                            {c.maxOverdueDays} 天
                          </td>
                          <td className={c.overCredit ? styles.flagBad : ""}>
                            {c.overCredit ? "应收已超过给他的额度" : c.maxOverdueDays >= 30 ? "有单子拖过一个月" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ══ 区④ 哪儿会出事 ══════════════════════════════════════ */}
              <section className="panel" id="z4" aria-label="哪儿会出事">
                <h2 className={styles.zoneTitle}>
                  哪儿会出事
                  <span className={styles.zoneHint}>一共看了 {imp.total} 处</span>
                </h2>
                <div className={styles.twoCol}>
                  <div>
                    <div className={styles.colHead}>能动的 {imp.actionable.length} 处</div>
                    {imp.actionable.length === 0 ? (
                      <p className={styles.greyLine}>
                        {imp.total} 处卡住的地方，今天一处对策也给不出 —— 这本身是结论。
                      </p>
                    ) : (
                      /*
                       * 🔴 **COO 实测「4 个按钮点了什么都不发生」的修法**（诉求 #9「长得像按钮的
                       * 东西必须能按」/ #10「点下去落到它自己那句话的答案上」）。
                       *
                       * ── 今天的行为是 X，应该是 Y ──────────────────────────────────
                       * · **X**：`onClick` 只做两件事 —— `setSelectedBaseId(第 ⑤ 区的基地)` +
                       *   滚到 `#z5`。而 ① 这 4 个卡点里有 2 个（物料批次 / 物料平衡）**根本不属于
                       *   任何基地**，`baseOfImpediment` 回 `null` ⇒ 一个 state 都没变；
                       *   ② 另外 2 个（金华/自贡产线）就算切了基地，第 ⑤ 区展开的也是**那个基地的
                       *   通用打法库**，不是这条卡点自己的改法 —— COO 原话「跟我点的那 4 个卡点
                       *   不是一回事」。⇒ 屏幕 diff 为空是**真的**，不是他看漏了。
                       * · **Y**：就地展开**这条卡点自己的** `candidates[]`（引擎已经回了，
                       *   旧代码在 `splitImpediments` 里把它整个丢掉只留了个计数）。
                       *
                       * ⚠ 保留「顺带切到对应基地」这个副作用：它对 2 个产线卡点是有意义的，
                       *   对另外 2 个是 no-op —— 但**主效果不再依赖它**。
                       *
                       * ✅ **2026-08-29 真前端 + 真后端复验通过**：4 颗按钮逐一点开，屏幕文本
                       *    分别 −1199 / +863 / +2037 / +2022 字，各自展开的是本条卡点自己的改法
                       *    （如「物料·到货周期 ↓ 10」「产线·利用率 ↓ 89.9153」）。
                       *    复验：`POST /a/v1/solvers/chain_impediments/invoke` 现读，18 条卡点里
                       *    带 `candidates[]` 的就是屏上这几颗按钮。
                       */
                      imp.actionable.map((r) => (
                        <div key={r.impedimentId}>
                          <button
                            type="button"
                            className={styles.impRow}
                            aria-expanded={openImpediment === r.impedimentId}
                            aria-controls={`ways-${r.impedimentId}`}
                            onClick={() => {
                              setOpenImpediment((prev) => (prev === r.impedimentId ? null : r.impedimentId));
                              const base = baseOfImpediment(r.objectType, r.objectId, cards, result.risk);
                              if (base) setSelectedBaseId(base);
                            }}
                          >
                            {r.sentence}
                            <br />
                            <span className={styles.impWays}>
                              有 {r.candidateCount} 种改法 {openImpediment === r.impedimentId ? "▾" : "▸"}
                            </span>
                          </button>
                          {openImpediment === r.impedimentId ? (
                            <div id={`ways-${r.impedimentId}`} className={styles.waysPanel}>
                              {r.candidates.length === 0 ? (
                                <p className={styles.greyLine}>
                                  这条卡点报了 {r.candidateCount} 种改法，但回包里一条明细都没有 —— 这是数据的缺口，不是「没有改法」。
                                </p>
                              ) : (
                                r.candidates.map((cd) => (
                                  <div className={styles.wayCard} key={cd.candidateId}>
                                    <div className={styles.wayTitle}>{cd.label}</div>
                                    <div className={styles.wayLine}>
                                      拨的是 {cd.leverText}
                                      {cd.fromValue !== null && cd.toValue !== null ? (
                                        <>
                                          ：{roundish(cd.fromValue)}
                                          {cd.unit} → <b>{roundish(cd.toValue)}{cd.unit}</b>
                                        </>
                                      ) : null}
                                    </div>
                                    {/* 逐维「改完 vs 不改」—— 有 baseline 才叫可核，没有 baseline 只是一个数 */}
                                    {cd.dims.map((d) => {
                                      const better = d.betterWhenLower ? d.value < d.baseline : d.value > d.baseline;
                                      const same = d.value === d.baseline;
                                      return (
                                        <div className={styles.wayLine} key={d.label}>
                                          {d.label}：不改 {roundish(d.baseline)}{d.unit} → 改完{" "}
                                          <b>{roundish(d.value)}{d.unit}</b>{" "}
                                          {same ? "（这一项没动）" : better ? "（好转）" : "（更差）"}
                                          {d.dataMode !== "LIVE" ? <Est /> : null}
                                        </div>
                                      );
                                    })}
                                    <Raw text={`这一档怎么定的：${cd.rungSource}\n怎么算的：${cd.formula}`} />
                                  </div>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <div className={styles.colHead}>只能盯着的 {imp.watchOnly.length} 处</div>
                    {imp.watchOnly.length === 0 ? (
                      <p className={styles.greyLine}>没有「只能盯着」的地方。</p>
                    ) : (
                      <WatchOnly rows={imp.watchOnly} />
                    )}
                  </div>
                </div>

                <div className={styles.timeline}>
                  <div className={styles.colHead}>这 {HORIZON_DAYS} 天，事情按这个顺序发生</div>
                  {timeline.length === 0 ? (
                    <p className={styles.greyLine}>
                      这 {HORIZON_DAYS} 天里没有排得出日子的事 —— 不是「没有事」，是这一批结论都没带日子。
                    </p>
                  ) : (
                    timeline.slice(0, 12).map((t) => (
                      <div className={styles.tlRow} key={`${t.day}-${t.text}`}>
                        <span className={styles.tlDay}>第 {t.day} 天</span>
                        <span>
                          {t.text}
                          {t.estimated ? <Est /> : null}
                        </span>
                      </div>
                    ))
                  )}
                  {timeline.length > 12 ? (
                    <p className={styles.greyLine}>还有 {timeline.length - 12} 件，都在这 {HORIZON_DAYS} 天里。</p>
                  ) : null}
                </div>
              </section>

              {/* ══ 区⑤ 有几条路 ════════════════════════════════════════ */}
              <section className="panel" id="z5" aria-label="有几条路">
                <h2 className={styles.zoneTitle}>
                  有几条路
                  <span className={styles.zoneHint}>
                    {selectedCard ? `${selectedCard.baseName} · 这里最紧的是「${selectedCard.factor}」` : "先选一个地方"}
                  </span>
                </h2>

                <div className={styles.sortBar}>
                  <span>看哪个地方：</span>
                  {cards
                    .slice()
                    .sort((a, b) => b.revenueYi - a.revenueYi)
                    .map((c) => (
                      <button
                        type="button"
                        key={c.baseId}
                        className={styles.sortBtn}
                        aria-pressed={c.baseId === selectedBaseId}
                        onClick={() => setSelectedBaseId(c.baseId)}
                      >
                        {c.baseName}
                      </button>
                    ))}
                </div>

                <div className={styles.sortBar}>
                  <span>按什么排：</span>
                  {(["tn", "cost", "risk"] as SortKey[]).map((k) => (
                    <button
                      type="button"
                      key={k}
                      className={styles.sortBtn}
                      aria-pressed={sortKey === k}
                      onClick={() => setSortKey(k)}
                    >
                      {k === "tn" ? "多久见效" : k === "cost" ? "代价" : "风险"}
                    </button>
                  ))}
                  <span>系统不给推荐</span>
                </div>

                {/*
                 * 成色说明**一屏只出现一次**。上一版把它印在每张卡上 ——
                 * 那正是 §3.0 点名的病（同一段话一屏重复 5 遍，卡上数字 3 行、这段话 12 行）。
                 * 内容一个字不删，只换位置。
                 */}
                {planCategory === null ? (
                  <p className={styles.greyLine}>
                    这个地方今天对不上任何一类现成打法（打法库是按「这里最紧的是什么」分类的），
                    所以这里只摆「什么都不做」那一栏。
                  </p>
                ) : (
                  /**
                   * ⚠ 下面那句「代价 / 见效天 / 风险**一个都没有**」是一条**否定断言** ——
                   * 上游哪天真给候选加上这三样，这句话当场变成屏上说谎，而没有任何人会被通知。
                   * 故按 `check-stale-claims` 的 STALE-5 挂溯源记号，把它赌的那个计数写下来。
                   *
                   * 赌的是什么（**2026-08-29** 实测）：这一段说的「这次真试算出来的那几条改法」
                   * = 后端回包里的 `candidates[]`，其形状由 `SolutionCandidateSchema` 锁死，
                   * 而那是个 `z.strictObject` ⇒ **它没登记的键根本传不过来**。
                   * 实测该 schema 里 `cost` / `risk` / `leadTime` / `tn` / `eff` 一个都没有。
                   * （屏上另外那三条「通用档位」来自前端 `Mitigation` **静态方案库**，是两回事 ——
                   *  这句话要说清的正是这两回事的区别。）
                   *
                   * 复验（先自证尺子没坏再看结论·铁律 0.6）：
                   *   node -e 'const s=require("fs").readFileSync("packages/contracts/src/chain-sim.ts","utf8");
                   *   console.log("金丝雀",(s.match(/^\s*\w+:\s*z\./gm)||[]).length,
                   *   "赌注",(s.match(/^\s*(?:cost|risk|leadTime|leadTimeDays|tn|eff):\s*z\./gm)||[]).length)'
                   *   实测 → 金丝雀 188（远大于 0 ⇒ 尺子是活的）· 赌注 0（⇒ 这句话今天成立）
                   *
                   * 机器能跑的那两条赌注**挂在下面 `<span>` 那一行的行尾**，不在本注释块里 ——
                   * 两个踩过的坑（都是当场报红逼出来的，不是想出来的）：
                   *  ① 路径**不许转义斜杠**：记号的路径部分是 `[\w./@-]+`，**不含反斜杠**。
                   *     写成 `packages\/contracts\/…` 会让整条记号解析不上，而屏上、编译、类型
                   *     全都不报错 —— 门只会说「作者以为自己挂了赌注，其实一条都没跑」。
                   *  ② 记号的作用域是「**本单元** + 紧贴其上的连续注释块」，而这里的「单元」是
                   *     `<span>` 那**一行**，不是整个 `<p>`。本注释块贴的是 `<p>` 的上沿，
                   *     `markScopeRange` 从 `<span>` 那行往上找，第一行就不是注释 ⇒ 够不着。
                   *     JSX 的 `{'{'}/* … *{'/'}{'}'}` 形态也不行：那条判据认 `//` `*` `/*` 开头，`{'{'}/*` 不匹配。
                   */
                  <p className={styles.greyLine}>
                    下面三条的「多久见效 / 代价 / 风险」是「{planCategory}」这一类的通用档位
                    <Est />，不是这一次的试算 —— 这次真试算出来的那几条改法身上，代价 / 见效天 / 风险
                    {/* eslint-disable-next-line max-len -- 两条赌注必须与被赌的那句话同行，见上面注释块② */}
                    <span className={styles.absent}>一个都没有</span>{/* @stale-fact packages/contracts/src/chain-sim.ts /export const SolutionCandidateSchema/ ==1 · @stale-fact packages/contracts/src/chain-sim.ts /^\s*(?:cost|risk|leadTime|leadTimeDays|tn|eff):\s*z\./ ==0 */}。
                  </p>
                )}

                <div className={styles.plans} data-testid="dc-plans">
                  {plans.map((m) => (
                    <div className={styles.planCard} key={m.key}>
                      <div className={styles.planName}>{m.name}</div>
                      <div className={styles.planDims}>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>多久见效</span>
                          <span className={styles.planDimV}>
                            {m.tn} 天
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>代价</span>
                          <span className={styles.planDimV}>
                            {m.cost}
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>风险</span>
                          <span className={styles.planDimV}>
                            {m.risk}
                            <Est />
                          </span>
                        </div>
                        <div className={styles.planDim}>
                          <span className={styles.planDimK}>这次能保住哪几张单</span>
                          <span className={styles.absent}>———</span>
                        </div>
                      </div>
                      <div className={styles.planFoot}>
                        <AdoptButton
                          planName={m.name}
                          planKey={m.key}
                          card={selectedCard}
                          factor={planCategory}
                          adoptedDraftId={
                            selectedCard && planCategory
                              ? adoptedByPlan.get(`${selectedCard.baseId}|${planCategory}|${m.key}`) ?? null
                              : null
                          }
                          busy={adopt.isPending}
                          onAdopt={async (payload) => {
                            await adopt.mutateAsync({ actionTypeKey: "adopt_mitigation", payload });
                            // 现读队列回填 —— 屏上说的那句话，判据是**队列里真有什么**，不是「我刚点过」。
                            await pendingAdoptions.refetch();
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* 第四栏 · 什么都不做：占一整栏、双线框、**没有按钮** */}
                  <div className={`${styles.planCard} ${styles.doNothing}`} data-testid="dc-do-nothing">
                    <div className={styles.planName}>什么都不做</div>
                    <div className={styles.planDims}>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>多久见效</span>
                        <span className={styles.absent}>——</span>
                      </div>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>代价</span>
                        <span className={styles.planDimV}>见下</span>
                      </div>
                      <div className={styles.planDim}>
                        <span className={styles.planDimK}>风险</span>
                        <span className={styles.absent}>——</span>
                      </div>
                    </div>
                    <DoNothingBody card={selectedCard} />
                  </div>
                </div>

                {/*
                  ⚠ WO-CONSOLE-BLOCKERS · B3：这条确认条以前是一个 `confirmText` 字符串，
                  **它记的是「我刚点了什么」，而屏上那句话声称的是「队列里有什么」** ——
                  两者在连点第二次之后就分家了（队列 2 份，屏上仍写"一份"）。
                  现在它**现算**：数就是 `adoptedByPlan` 里属于本基地本类别的那几条，
                  数不对的时候它自己会变，不需要谁记得去改文案。
                  （形态照 CLAUDE.md 铁律 0.6：「我用『我刚点了一次』当作『队列里有一份』的证据。」）
                */}
                {(() => {
                  if (!selectedCard || !planCategory) return null;
                  const mine = plans
                    .map((m) => ({ m, id: adoptedByPlan.get(`${selectedCard.baseId}|${planCategory}|${m.key}`) }))
                    .filter((x): x is { m: Mitigation; id: string } => Boolean(x.id));
                  const first = mine[0];
                  if (!first) return null;
                  return (
                    <div className={styles.confirm} data-testid="dc-confirm">
                      {/* ⚠ 这段文案自己**不许**写 markdown 星号（B2 就是这么上屏的）——屏上的字就是屏上的字。 */}
                      {mine.length === 1
                        ? `已经排了一份待批的动作（${selectedCard.baseName} · ${first.m.name}），批了才会改真实数据。`
                        : `这个地方现在排了 ${mine.length} 份待批的动作（${mine.map((x) => x.m.name).join(" · ")}）—— 它们是同一个瓶颈的几条互斥打法，批之前先撤掉不要的那几份。`}
                      <br />
                      <a className={styles.confirmLink} href="/admin/actions" data-testid="dc-confirm-goto">
                        {/* 「这」与数字之间要留空格：JSX 里相邻表达式不会自动补空白，
                            上一版渲染成「看这2 份」（真浏览器实测），中文里数字贴着「这」很扎眼。 */}
                        去审批队列看这{mine.length === 1 ? "份" : ` ${mine.length} 份`} →
                      </a>
                    </div>
                  );
                })()}
              </section>

              {/* ══ 区⑥ 这次算的时候做了什么（可披露的演算过程）══════════ */}
              <RunTracePanel trace={result.trace} />
            </div>
          </>
        ) : null}

        {!result && !run.isPending ? (
          <section className="panel" aria-label="还没算">
            <p className={styles.greyLine}>
              左边加一件事，按〔算一下〕。在那之前这里不显示任何金额 ——
              没算过的数摆上来，跟算出来的数长得一模一样。
            </p>
          </section>
        ) : null}

        {/* 页脚一行灰字：这一屏有几处成色你需要知道 */}
        {result ? (
          <div className={`${styles.footer} ${honesty.length > 0 ? styles.sys : ""}`}>
            <button type="button" className={styles.footerBtn} onClick={() => setFooterOpen((v) => !v)} aria-expanded={footerOpen}>
              这一屏有 {honesty.length} 处成色你需要知道 {footerOpen ? "▾" : "▸"}
            </button>
            {footerOpen ? (
              <div className={styles.drawer} data-layer2="1">
                {honesty.length === 0 ? (
                  <div className={styles.drawerItem}>这一屏没有需要额外说明的成色。</div>
                ) : (
                  honesty.map((h, i) => (
                    <div className={styles.drawerItem} key={`${h.anchor}-${i}`}>
                      {i + 1}. {h.text} → <a href={`#${h.anchor}`}>看它影响哪一段</a>
                      <Raw text={h.raw} />
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 子组件
// ══════════════════════════════════════════════════════════════════════════

/** 一条事件模板：点 ＋ **就地展开**（不跳页、不弹窗），展开内容由 catalog 现读生成。 */
function TemplateRow({
  spec,
  open,
  onToggle,
  onAdd,
}: {
  spec: DrillEventSpec;
  open: boolean;
  onToggle: () => void;
  onAdd: (e: AddedEvent) => void;
}) {
  const scope = subjectScopeFor(spec.kind as string);
  const [pickedId, setPickedId] = useState<string>("");
  const [pickedLabel, setPickedLabel] = useState<string>("");
  const [parentId, setParentId] = useState<string>("");
  const [q, setQ] = useState("");
  const [payload, setPayload] = useState<Record<string, number | string>>({});
  const [showTiming, setShowTiming] = useState(false);
  const [day, setDay] = useState(0);
  const [days, setDays] = useState<string>("");

  // 候选清单：`LIST` 档一次取回（2026-08-28 实测最多 20 行；复验：打 `/a/v1/objects/aggregate`
  // 数返回条数）；`SEARCH` 档只在输了字之后才打。
  /**
   * **有意只取首页**：`LIST` 档的候选类型只有四个，全是有界小字典 —— 实测真值
   * （独立口径 `POST /a/v1/objects/aggregate`，seed 42）`Customer` 20 · `Material` 8 ·
   * `Base` 13 · `Model` 6，最大的一个也只有 pageSize 的 40%。
   * 会长大的那些类型（`Order` 500）在本表里一律是 `SEARCH` 档，不走这条路。
   */
  const list = useQuery({
    queryKey: ["decision-console", "subject", scope?.typeKey, scope?.mode, parentId],
    enabled: open && !!scope && scope.mode === "LIST",
    queryFn: () => searchObjects(scope!.typeKey, "", { pageSize: "50" }),
  });
  const childList = useQuery({
    queryKey: ["decision-console", "subject-child", scope?.child?.typeKey, parentId],
    enabled: open && !!scope?.child && parentId.length > 0,
    // **有意只取首页**：`Line` 全表 130 条 > 50，但这一查**带着 base 过滤**且服务端真的执行了它
    // ——实测 `?type=Line&pageSize=50&base=hefei` 回 `items=10 total=10 hasMore=false`。
    // 判据落在「过滤后的 total 与 hasMore」上，不落在「全表有多少行」上。
    queryFn: () =>
      searchObjects(scope!.child!.typeKey, "", { pageSize: "50", [scope!.child!.filterParam]: parentId }),
  });
  const search = useQuery({
    queryKey: ["decision-console", "subject-search", scope?.typeKey, q],
    enabled: open && !!scope && scope.mode === "SEARCH" && q.trim().length > 0,
    // **有意只取首页**：`SEARCH` 档，收敛机制是用户打的字（`q`），不是页长；用户挑一条就走。
    queryFn: () => searchObjects(scope!.typeKey, q.trim(), { pageSize: "20" }),
  });

  const idForm = subjectIdFormFor(spec);
  const subjectRead = subjectIsRead(spec);

  const pick = (item: { id: string; props: Record<string, unknown> }, nameProp: string) => {
    setPickedId(targetIdOf(spec, item, nameProp));
    const n = item.props[nameProp];
    setPickedLabel(typeof n === "string" ? n : item.id);
  };

  /**
   * WO-CONSOLE-BLOCKERS · **加得进去、算不出来**（**2026-08-29** 真服务真浏览器实测复现，非转述）。
   *
   * 复验方式（三条命令，任何人可自己跑一遍）：
   *   ① 起真后端：`PORT=4011 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
   *      CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`
   *   ② 看这 11 个 kind 各自读不读主体：
   *      `curl -s -H 'X-Debug-User: demo:admin:admin' localhost:4011/a/v1/sim/drill/catalog`
   *      → 数 `specs[].routes[].args[].from === "eventTarget"`，实测 11 个里 3 个有、8 个没有。
   *   ③ 契约那一行：`packages/contracts/src/sim-drill.ts` 的 `DrillEventSchema.targetObjectId`。
   *
   * **今天的行为 X**：这一支原写作 `scope === null || !subjectRead || pickedId.length > 0` ——
   *   `!subjectRead` 一旦成立就**短路放行**，于是主体一个没选也能按〔加进去〕。
   *   而 `DrillEventSchema.targetObjectId` 是 `z.string().min(1)`（`packages/contracts/src/sim-drill.ts`），
   *   **对所有 kind 一律必填**。⇒ 按〔算一下〕当场 400，屏上原样摆出一行
   *   `ApiClientError: events.0.targetObjectId: Too small: expected string to have >=1 characters`。
   *   实测（drill-catalog 现读）：11 个 kind 里有 **8 个** `routes[].args` 不含 `eventTarget`
   *   ⇒ `subjectIsRead` 为假 ⇒ **8/11 条路都能走到这个报错**（ORDER_CANCEL / ORDER_INSERT /
   *   ORDER_RELOCATE / MATERIAL_SHORTAGE / MATERIAL_REPRICE / EQUIPMENT_FAILURE /
   *   CAPACITY_LOSS / FORECAST_BIAS）。
   * **应该是 Y**：选主体是**加事件的前置**，不是「某个求解器要不要读它」的函数。
   *
   * ⚠ **`subjectIsRead` 本身没有错，错在拿它当这里的判据** —— 它答的是
   *   「这次算会不会**把主体喂给求解器**」，不是「这条事件记录**需不需要**主体」。
   *   照 CLAUDE.md 铁律 0.6 的句式：
   *   > 「我用『没有求解器读这个主体』当作『这条事件不需要主体』的证据，而前者并不度量后者。」
   *   所以旁边那句「这类事今天不看你选的是谁，它只决定去问哪几路算」**保留** ——
   *   它说的是「选谁不改变算法结果」，那是真的；但**总得说清这件事发生在谁身上**。
   *
   * 这是**既有缺陷**（`canAdd` 在本单基线 `handoff-wo-decision-console` 上逐字相同，非本轮引入），
   * 只是决策台此前没有从登录页走得到，一直没被真的点到。
   *
   * ── 收编裁决（`WO-CONSOLE-BLOCKERS` × `WO-EVENTS-WRITE-STATE` 并线冲突·2026-08-29）──
   * 两张单**各自独立**发现了同一个坑（都从 `handoff-wo-decision-console` 分叉，互不知情），
   * 修法不同，并线时正面冲突。取本版（`pickedId.length > 0` 无条件要求），
   * **不取** `needsLeafPick(scope, spec)` 那一版，理由是后者今天仍漏两条路 ——
   * 两条都是实测出来的，不是推理：
   *   ① **`scope === null` 的手填兜底路**（本文件 `SUBJECT_FALLBACK` 那一支，输入框直接
   *      `setPickedId(e.target.value)`）：`needsLeafPick(null, …)` 恒 `false`
   *      ⇒ **手填框空着也能按〔加进去〕** ⇒ `targetObjectId: ""` ⇒ 同一个 400。
   *   ② **`ORDER_INSERT`**：`decision-console-model.test.ts` 自己的断言写着它是今天
   *      **唯一** `subjectIsRead === false` 的事件，且只有一级选择器
   *      ⇒ `needsLeafPick` 回 `false` ⇒ 不选客户也能加 ⇒ 同一个 400。
   * 那一版的**散文说得对**（「只要屏上摆了选择器，就必须选到叶子那一层」），
   * 只是代码在单级选择器那一支回落到了 `subjectIsRead(spec)`，没兑现这句话。
   * 本版是两张单意图的交集：**摆了选择器就必须有 id，手填框也算选择器**。
   *
   * ⚠ `needsLeafPick` **没有被丢掉**，它仍是生产调用（见下方 `mustPickLeaf`）——
   * 用在**提示文案**上：两级选择器缺第二级时要说「基地选了还不够，产线才是落点」，
   * 而不是笼统一句「先选对谁」。判据留严的，话说细的，两张单各取其长。
   */
  const mustPickLeaf = needsLeafPick(scope, spec);
  const canAdd =
    pickedId.length > 0 &&
    spec.payloadKeys.filter((k) => k.required).every((k) => payload[k.key] !== undefined && payload[k.key] !== "");

  return (
    <>
      {/*
       * 一行 = **一个**可聚焦控件。上一版把行名与 ＋ 做成两颗按钮、动作完全相同 ——
       * 键盘用户要按两次 Tab 才走完一行，11 行就白吃 11 次（2026-08-28 实测 Tab 到〔算一下〕
       * 从 28 次降到 17 次就是砍掉这一半；复验：开 `/v/decision-console`，从左栏顶连按 Tab 数到
       *〔算一下〕拿到焦点；对照组＝把本文件 `DecisionConsoleView.tsx` 这一处的 ＋ 改回
       * 真按钮再数一遍）。＋ 现在是纯装饰（`aria-hidden`）。
       */}
      <button
        type="button"
        className={styles.tplRow}
        aria-label={`加一件「${spec.label}」`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.tplName}>{spec.label}</span>
        <span className={styles.tplAdd} aria-hidden="true">
          ＋
        </span>
      </button>

      {open ? (
        <div className={styles.tplOpen}>
          {/* 主体选择器：按事件类型限定范围。⛔ 绝不出现「共 N 个落点」那种全量下拉 */}
          {scope === null ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`sub-${spec.kind}`}>
                {SUBJECT_FALLBACK.label}
              </label>
              <input
                id={`sub-${spec.kind}`}
                className={styles.input}
                value={pickedId}
                onChange={(e) => {
                  setPickedId(e.target.value);
                  setPickedLabel(e.target.value);
                }}
              />
              <span className={styles.fieldHint}>{SUBJECT_FALLBACK.note}</span>
            </div>
          ) : scope.mode === "SEARCH" ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`q-${spec.kind}`}>
                {scope.label}
              </label>
              <input
                id={`q-${spec.kind}`}
                className={styles.input}
                placeholder={scope.searchHint}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q.trim().length === 0 ? (
                <span className={styles.fieldHint}>
                  单子太多，铺不下 —— 输单号或客户名，我把对得上的列出来。
                </span>
              ) : search.isLoading ? (
                <span className={styles.fieldHint}>正在找…</span>
              ) : (search.data?.items.length ?? 0) === 0 ? (
                <span className={styles.fieldHint}>没有对得上的单。</span>
              ) : (
                <>
                  <div className={styles.searchList}>
                    {(search.data?.items ?? []).slice(0, 20).map((it) => (
                      <button
                        type="button"
                        key={it.id}
                        className={styles.searchItem}
                        aria-pressed={pickedId === targetIdOf(spec, it, scope.nameProp)}
                        onClick={() => pick(it, scope.nameProp)}
                      >
                        {String(it.props[scope.nameProp] ?? it.id)} · {String(it.props.cust ?? "")} ·{" "}
                        {String(it.props.qty ?? "")} 套 · 交期 {String(it.props.due ?? "")}
                      </button>
                    ))}
                  </div>
                  <span className={styles.fieldHint}>
                    对得上 {search.data?.total ?? 0} 张，这里列前 {Math.min(20, search.data?.items.length ?? 0)} 张。
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`sel-${spec.kind}`}>
                  {scope.label}
                </label>
                <select
                  id={`sel-${spec.kind}`}
                  className={styles.select}
                  value={scope.child ? parentId : pickedId}
                  onChange={(e) => {
                    const v = e.target.value;
                    const item = (list.data?.items ?? []).find((x) => (scope.child ? String(x.props[childKeyProp(scope.child.filterParam)] ?? x.id) === v : targetIdOf(spec, x, scope.nameProp) === v));
                    if (scope.child) {
                      setParentId(v);
                      setPickedId("");
                      setPickedLabel("");
                    } else if (item) {
                      pick(item, scope.nameProp);
                    }
                  }}
                >
                  <option value="">请选一个（共 {list.data?.total ?? 0} 个）</option>
                  {(list.data?.items ?? []).map((it) => (
                    <option
                      key={it.id}
                      value={scope.child ? String(it.props[childKeyProp(scope.child.filterParam)] ?? it.id) : targetIdOf(spec, it, scope.nameProp)}
                    >
                      {String(it.props[scope.nameProp] ?? it.id)}
                    </option>
                  ))}
                </select>
              </div>
              {scope.child && parentId ? (
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`sel2-${spec.kind}`}>
                    {scope.child.label}
                  </label>
                  <select
                    id={`sel2-${spec.kind}`}
                    className={styles.select}
                    value={pickedId}
                    onChange={(e) => {
                      const item = (childList.data?.items ?? []).find((x) => targetIdOf(spec, x, scope.child!.nameProp) === e.target.value);
                      if (item) pick(item, scope.child!.nameProp);
                    }}
                  >
                    <option value="">请选一个（共 {childList.data?.total ?? 0} 条）</option>
                    {(childList.data?.items ?? []).map((it) => (
                      <option key={it.id} value={targetIdOf(spec, it, scope.child!.nameProp)}>
                        {String(it.props[scope.child!.nameProp] ?? it.id)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </>
          )}

          {!subjectRead ? (
            <span className={styles.fieldHint}>
              这类事今天不看你选的是谁 —— 它只决定去问哪几路算。选了也不会白选：回执里会写清楚。
            </span>
          ) : null}

          {/* 要填的数：由 catalog 的 payloadKeys 现读生成，hint 一字不改 */}
          {spec.payloadKeys.map((k) => (
            <div className={styles.field} key={k.key}>
              <label className={styles.fieldLabel} htmlFor={`p-${spec.kind}-${k.key}`}>
                {k.hint || k.key}
                {k.required ? " · 必填" : ""}
              </label>
              <input
                id={`p-${spec.kind}-${k.key}`}
                className={styles.input}
                type={k.type === "number" ? "number" : "text"}
                value={String(payload[k.key] ?? "")}
                onChange={(e) =>
                  setPayload((p) => ({ ...p, [k.key]: k.type === "number" ? Number(e.target.value) : e.target.value }))
                }
              />
            </div>
          ))}

          {/* 「从第几天起 / 持续几天」默认折叠（九成用默认值）。屏上写「天」不写「拍」。 */}
          <button type="button" className={styles.foldToggle} onClick={() => setShowTiming((v) => !v)} aria-expanded={showTiming}>
            {showTiming ? "收起时间" : "从第 0 天起 · 一直持续（改时间 ▸）"}
          </button>
          {showTiming ? (
            <div className={styles.rowInline}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`d0-${spec.kind}`}>
                  从第几天起
                </label>
                <input
                  id={`d0-${spec.kind}`}
                  className={styles.input}
                  type="number"
                  min={0}
                  value={day}
                  onChange={(e) => setDay(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`dn-${spec.kind}`}>
                  持续几天
                </label>
                <input
                  id={`dn-${spec.kind}`}
                  className={styles.input}
                  type="number"
                  min={1}
                  placeholder="不填 = 一直持续"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="btn"
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                uid: `${spec.kind}-${Date.now()}`,
                kind: spec.kind as string,
                targetObjectId: pickedId,
                targetLabel: pickedLabel || (subjectRead ? pickedId : "（这类事不看主体）"),
                payload,
                effectiveDay: day,
                durationDays: days === "" ? null : Number(days),
              })
            }
          >
            加进去
          </button>
          {!canAdd ? (
            <span className={styles.fieldHint}>
              {/* 判据与 canAdd 同源：缺主体就说缺主体，不再按 subjectRead 分叉 ——
                  分叉过的那一版，8/11 条路上「加进去」是灰的而这句话一个字都不提原因。
                  触发条件用 canAdd 那一条（无条件要 id），**文案**用两级选择器的细话：
                  只说「先选对谁」时，用户已经选了基地、会以为自己选过了。 */}
              {pickedId.length === 0
                ? mustPickLeaf && scope?.child
                  ? `先把「${scope.child.label}」也选上 —— 只选了${scope.label}还不够，${scope.child.label}才是这件事真正落到的地方；`
                  : `先选${scope?.label ?? SUBJECT_FALLBACK.label}；`
                : ""}
              {spec.payloadKeys.filter((k) => k.required && (payload[k.key] === undefined || payload[k.key] === "")).map((k) => `「${k.hint || k.key}」要填；`)}
              填齐了才能加 —— 缺一个必填的，后台会回「未能评估」而不是算成 0。
            </span>
          ) : null}
          {/*
            「这件事落到哪」由 catalog 现算：落点取自主体 ⇒ 说「要求是真实对象」；
            落点取自 payload（临时插单落在型号上）⇒ 必须明说客户不进算式，不许含糊。
          */}
          {landingNoteFor(spec) ? <span className={styles.fieldHint}>{landingNoteFor(spec)}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * **区⑥ · 这次算的时候做了什么**（仓主 2026-08-28 硬要求 ①）。
 *
 * 判据是仓主给的那一句：「一个看不到代码的人，读完这一层应当能自己判断
 * **这是真推演还是查表**」。所以这一层不是「技术细节抽屉」，它是**可证伪性**本身：
 * 边有系数、红线有出处、枚举有次数、每段有毫秒 —— 查表拿不出这些。
 *
 * ⚠ 默认折叠：它是第二层，不该跟钱抢第一层的位置（R-UI-3）。
 * ⚠ 里面**不出现源码文件名与行号**（R-UI-4），但规则 key / 切片 key / 系数 / 耗时 / 条数
 *   一个不少 —— 那些是业务事实。
 */
function RunTracePanel({ trace }: { trace: RunTrace }) {
  const [open, setOpen] = useState(false);
  const slowest = trace.timings.reduce((a, t) => Math.max(a, t.ms), 0);
  return (
    <section className="panel" id="z6" aria-label="这次算的时候做了什么">
      <h2 className={styles.zoneTitle}>
        <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="dc-trace-toggle">
          这次算的时候做了什么 {open ? "▾" : "▸"}
        </button>
        <span className={styles.zoneHint}>
          引用 {trace.data.reduce((a, d) => a + Math.max(0, d.count), 0).toLocaleString("zh-CN")} 条数据 ·
          沿 {trace.edges.length} 条关系推 · 撞 {trace.thresholds.length} 条红线 ·
          试算 {trace.enumeration?.probes ?? 0} 次 · 等了 {trace.wallMs} 毫秒 · 未用 agent
        </span>
      </h2>

      {open ? (
        <div className={styles.traceBody} data-testid="dc-trace-body">
          {/* ① 有没有 agent —— 恒写一句，不许留白让人以为调了 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>有没有让 AI 参与</div>
            <p className={styles.greyLine}>
              <strong className={styles.ok}>{trace.agent.called ? "有" : "没有"}</strong> —— {trace.agent.why}
            </p>
          </div>

          {/* ② 引用了哪些数据 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>引用了哪些数据</div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>对象</th>
                    <th className={styles.num}>条数</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.data.map((d) => (
                    <tr key={d.typeKey}>
                      <td>
                        {d.typeName}
                        <span className={styles.mono}> {d.typeKey}</span>
                      </td>
                      <td className={styles.num}>{d.count < 0 ? "这次没取到" : d.count.toLocaleString("zh-CN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trace.worldObjectCount != null ? (
              <p className={styles.greyLine}>这次往后推的那 30 天，一共带了 {trace.worldObjectCount.toLocaleString("zh-CN")} 个对象的读数。</p>
            ) : null}
            <p className={styles.greyLine}>
              快照版本（同一版本重跑逐字一致）：
              {trace.snapshotVersions.length === 0
                ? "这次没取到"
                : trace.snapshotVersions.map((s) => `${s.label} ${s.version}`).join(" · ")}
              {trace.ruleSetVersion ? ` · 规则集 ${trace.ruleSetVersion}` : ""}
              {trace.scanId ? ` · 本次扫描号 ${trace.scanId}` : ""}
            </p>
          </div>

          {/* ③ 走了哪些本体切片 —— 本次一条都没走，但要拿目录总数当证据 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>走了哪些本体切片</div>
            <p className={styles.greyLine}>
              <strong>本次一条都没走。</strong>本租户登记了 <strong>{trace.slices.registeredCount}</strong> 条切片
              （查过了才敢这么说，例如 {trace.slices.sample.slice(0, 3).join(" · ") || "（目录这次没取到）"}），
              但它们服务的是问答与覆盖率那条路。这次走的是下面那张关系图 —— 两条路不一样，别当成同一件事。
            </p>
          </div>

          {/* ④ 沿哪些关系推的（系数、延迟、上界、合并方式、系数出处）*/}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>
              沿哪些关系推的（本次生效 {trace.edges.length} 条 / 本租户共 {trace.edgeTotal} 条）
            </div>
            {trace.edges.length === 0 ? (
              <p className={styles.greyLine}>
                本次没有一件事会直接改数，所以一条关系都没走 —— 这不是「没影响」，是这几类事今天只决定去问哪几路算。
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>从</th>
                      <th>到</th>
                      <th className={styles.num}>系数</th>
                      <th className={styles.num}>隔几天</th>
                      <th>叠加方式</th>
                      <th>上界</th>
                      <th>衰减</th>
                      <th>系数出处</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.edges.map((e) => (
                      <tr key={e.key}>
                        <td>{e.from}</td>
                        <td>{e.to}</td>
                        <td className={styles.num}>×{e.coefficient}</td>
                        <td className={styles.num}>{e.delayDays}</td>
                        <td>{e.combine}</td>
                        <td className={e.clamp === "没有上界" ? styles.flagWarn : ""}>{e.clamp}</td>
                        <td className={e.decay === "不衰减" ? styles.flagWarn : ""}>{e.decay}</td>
                        <td>{e.coefFromConfig ? "配置来源" : "写死的常数"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={styles.greyLine}>
              「没有上界 / 不衰减」标黄不是装饰：这两格是空的时候，压力会一天一天累加上去 ——
              这正是上面「毛利差多少」那一格今天不敢放大到屏幕正中的原因之一。
            </p>
          </div>

          {/* ⑤ 撞了哪几条红线 + 红线从哪来 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>撞了哪几条红线，红线是谁定的</div>
            {trace.thresholds.length === 0 ? (
              <p className={styles.greyLine}>这次没取到红线清单。</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>规则</th>
                      <th>判什么</th>
                      <th className={styles.num}>红线</th>
                      <th>这个数从哪来</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.thresholds.map((t) => (
                      <tr key={t.bindingId}>
                        <td className={styles.mono}>{t.ruleKey}</td>
                        <td>{t.bindingId}</td>
                        <td className={styles.num}>
                          {t.value.toLocaleString("zh-CN")} {t.unit}
                        </td>
                        <td className={t.source === "literal" ? styles.flagWarn : ""}>{t.where}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {trace.evaluatedRules.length > 0 ? (
              <>
                <p className={styles.greyLine}>逐条规则的判定（判成「不适用」也是结论，一样列出来）：</p>
                {trace.evaluatedRules.map((r, i) => (
                  <p className={styles.greyLine} key={`${r.key}-${i}`}>
                    · <span className={styles.mono}>{r.key}</span> {r.name} —— {r.outcome}
                    <Raw text={`${r.expression}${r.evidence ? `\n${r.evidence}` : ""}`} />
                  </p>
                ))}
              </>
            ) : null}
          </div>

          {/* ⑥ 改法是枚举出来的还是查表 —— 这一格最能分开「真推演」与「查表」 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>那几条改法是怎么来的</div>
            {trace.enumeration ? (
              <p className={styles.greyLine}>
                这次在 <strong>{trace.enumeration.anchors}</strong> 个可拨动的地方上，做了{" "}
                <strong>{trace.enumeration.probes}</strong> 次试算（每次都把那个数真改一遍再重判红线），
                其中 <strong>{trace.enumeration.effective}</strong> 次真的把判定推回了红线内，最后下发{" "}
                <strong>{trace.enumeration.emitted}</strong> 条。
                <br />
                查表给不出「试了多少次、有几次没用」这两个数 —— 这一格就是这条路不是查表的证据。
              </p>
            ) : (
              <p className={styles.greyLine}>这次没取到试算次数。</p>
            )}
          </div>

          {/* ⑦ 各段耗时 */}
          <div className={styles.traceBlock}>
            <div className={styles.colHead}>各段花了多久（从按下按钮到出结果，一共等了 {trace.wallMs} 毫秒；最慢的那一段 {slowest} 毫秒）</div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>这一段做了什么</th>
                    <th className={styles.num}>毫秒</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.timings.map((t) => (
                    <tr key={t.label}>
                      <td>{t.label}</td>
                      <td className={styles.num}>{t.ms}</td>
                      <td>{t.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.greyLine}>
              两条口径要分清，别把下面这列毫秒加起来：
              <br />
              ① 这几段是<strong>同时</strong>发出去的，所以「一共等了 {trace.wallMs} 毫秒」≈ 最慢那一段，
              <strong>不等于</strong>逐段相加（相加会得到 {trace.timings.reduce((a, t) => a + t.ms, 0)} 毫秒，
              那个数不度量你真的等了多久）。
              <br />
              ② 每一段量的是「这台机器发出请求 → 收到回包」的整段时间（含网络），
              <strong>不是</strong>后端内部的分段耗时 —— 后端今天不分段计时，
              所以第一行里「把事情加上去 / 往后推 / 扫红线 / 问各路算」这四步是合在一起的，分不开。
              不说清就会被读成「往后推只花了 X 毫秒」。
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 〔就这么办〕—— 全屏**唯一会改真实世界**的按钮（`submit:true` 直接进待批）。
 *
 * WO-CONSOLE-BLOCKERS · B3 的前端一半，三态（不是两态）：
 *  · **还没排** ⇒ 真按钮〔就这么办〕；
 *  · **正在提交** ⇒ `disabled` + 文案改成「正在排…」（连点的第一道闸，但**只挡得住这一秒**）；
 *  · **已经排了** ⇒ **不再是提交按钮**，换成「查看这份待批 →」链接。
 *    这一态由**后端队列**决定（`adoptedDraftId` 来自现读的 `PENDING_APPROVAL` 列表），
 *    所以刷新之后它照样是这一态 —— 这正是「不许只在前端拦」的那一条。
 *
 * ⛔ 刻意**不做**成「点了弹『已应用』而实际什么都没变」：这颗按钮真的建单，
 * 它的三态说的都是队列里的真实情况。
 */
function AdoptButton({
  planName, planKey, card, factor, adoptedDraftId, busy, onAdopt,
}: {
  planName: string;
  planKey: string;
  card: BaseCard | null;
  factor: string | null;
  adoptedDraftId: string | null;
  busy: boolean;
  onAdopt: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  if (adoptedDraftId) {
    return (
      <a className={styles.adoptedLink} href="/admin/actions" data-testid={`dc-adopted-${planKey}`}>
        查看这份待批 →
        <span className={styles.adoptedNote}>已经排进审批队列，没批就不会改数据</span>
      </a>
    );
  }
  return (
    <button
      type="button"
      className="btn primary"
      data-testid={`dc-adopt-${planKey}`}
      disabled={busy || sending || !card || !factor}
      onClick={async () => {
        if (!card || !factor || sending) return;
        setSending(true); // 提交中禁用：连点的第一道闸（真相源仍是后端指纹幂等）
        try {
          await onAdopt({ base: card.baseId, factor, planKey });
        } finally {
          setSending(false);
        }
      }}
    >
      {sending ? `正在排「${planName}」…` : "就这么办"}
    </button>
  );
}

/** 「只能盯着的 M 处」折成一块，点名最严重的那个 + 引擎自陈的原文。 */
function WatchOnly({ rows }: { rows: ReturnType<typeof splitImpediments>["watchOnly"] }) {
  const [open, setOpen] = useState(false);
  const worst = rows[0];
  return (
    <div className={styles.impPlain}>
      最严重的是{worst ? worst.sentence : "（本次没有）"}，今天没有对策。
      <br />
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        另外 {Math.max(0, rows.length - 1)} 处也一样 {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className={styles.drawer} data-layer2="1">
          {rows.map((r) => (
            <div className={styles.drawerItem} key={r.impedimentId}>
              · {r.sentence}
              {/* WO-CONSOLE-BLOCKERS · B1 的另一半：机器编号从第一层**降到这里**，不是删掉
                  （诚实位纪律：允许降层、绝不允许删除）。第一层现在是业务名，要对号入座的人
                  在这一层拿得到那个键。 */}
              <span className={styles.rawKey}>（编号 {r.objectId}）</span>
              {r.noCandidateReason ? <Raw text={r.noCandidateReason} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 第四栏正文：全部实测真数（这些单会晚 / 这些单值多少钱 / 靠自己要多久 / 罚多少钱算不出来）。 */
function DoNothingBody({ card }: { card: BaseCard | null }) {
  if (!card) return <div className={styles.planList}>先在上面选一个地方。</div>;
  const dn = card.doNothing as
    | {
        status?: string;
        catchUp?: { status?: string; days?: number; shortfall?: number; freeDaily?: number; reason?: string };
        delay?: { status?: string; orders?: { so: string; cust: string; dueDay: number; delayDays: number }[] };
        penalty?: { status?: string; reason?: string };
        revenueAtRiskYi?: number;
        atRiskCustomers?: number;
      }
    | null;
  const orders = dn?.delay?.orders ?? [];
  return (
    <>
      <div className={styles.planList}>
        这几张单会晚
        <Est />：
        {orders.length === 0 ? (
          <span className={styles.absent}>这次没算出来</span>
        ) : (
          <>
            {orders.slice(0, 7).map((o) => (
              <div key={o.so}>
                {o.cust} {o.so} · 第 {o.dueDay} 天到期 · 晚 {o.delayDays} 天
              </div>
            ))}
            {orders.length > 7 ? <div>…共 {orders.length} 张</div> : null}
          </>
        )}
      </div>
      <div className={styles.planList}>
        {card.status === "EMPTY" ? (
          "这批窗口内没有订单，不报准时率"
        ) : (
          <>
            这些单值 {roundish(card.revenueYi)} 亿，{card.customerCount} 家客户
          </>
        )}
      </div>
      <div className={styles.planList}>
        {dn?.catchUp?.status === "OK" && typeof dn.catchUp.shortfall === "number" ? (
          <>
            {card.baseName}靠自己消化不了：还差 {Math.round(dn.catchUp.shortfall).toLocaleString("zh-CN")} 套，
            闲下来的产能一天只有 {roundish(dn.catchUp.freeDaily ?? 0)} 套
            <Est />
          </>
        ) : (
          <span className={styles.absent}>{dn?.catchUp?.reason ?? "这次没算出来"}</span>
        )}
      </div>
      <div className={styles.planList}>
        不做要赔多少钱：
        <span className={styles.absent}>今天算不出来</span>
        <PenaltyWhy raw={dn?.penalty?.reason ?? "（引擎没给原文）"} />
      </div>
    </>
  );
}

function PenaltyWhy({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        为什么 {open ? "▾" : "▸"}
      </button>
      {open ? <Raw text={raw} /> : null}
    </>
  );
}

/** 「这几个数加起来对得上账 ▸」—— 归因自己就带勾稽，把它原样搬到屏上。 */
function ReconcileEntry({ finding }: { finding: { why: string; reconciled: boolean | null; evidence?: unknown } }) {
  const [open, setOpen] = useState(false);
  const ev = finding.evidence as
    | {
        totalGap?: number;
        demandSide?: { pct?: number; drivers?: { factor: string; contribution: number; unit?: string }[] };
        supplySide?: { pct?: number; drivers?: { factor: string; contribution: number; unit?: string }[] };
        residualPct?: number;
      }
    | undefined;
  const leaves = [...(ev?.demandSide?.drivers ?? []), ...(ev?.supplySide?.drivers ?? [])];
  return (
    <>
      <button type="button" className={styles.footerBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="dc-recon">
        这几个数加起来对得上账 {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className={styles.drawer} data-layer2="1">
          <div className={styles.drawerItem}>
            {finding.reconciled === true ? "逐层核对过，通过。" : finding.reconciled === false ? "逐层核对没通过，这条已经降级展示。" : "这一条不适用勾稽。"}
          </div>
          {leaves.map((d) => (
            <div className={styles.drawerItem} key={d.factor}>
              · {d.factor} —— {roundish(d.contribution)} {d.unit ?? ""}
            </div>
          ))}
          <div className={styles.drawerItem}>引擎原话：<Raw text={finding.why} /></div>
        </div>
      ) : null}
    </>
  );
}

/** 500 张单的三段分布。 */
function SegmentBar({ rows }: { rows: { group: Record<string, string | null>; metrics: Record<string, number | null> }[] }) {
  const label: Record<string, string> = { COMPLETED: "已完成", IN_PRODUCTION: "在产", OPEN: "已下待排产" };
  const cls: Record<string, string | undefined> = {
    COMPLETED: styles.segDone,
    IN_PRODUCTION: styles.segWip,
    OPEN: styles.segOpen,
  };
  const total = rows.reduce((a, r) => a + (r.metrics.count_so ?? 0), 0);
  if (total === 0) return null;
  return (
    <>
      {/*
        * ⚠ 条子里**不写字**。上一版把张数印在色块里，暗色皮 2026-08-28 实测只有 **4.58:1**
        * （12px 需 6.0；复验：`node scripts/check-layout-legibility.mjs`，或在暗色皮下取该色块
        *  与字色算对比度）—— 半透蓝叠在面上，无论压白字还是压主文字色都在两皮之间顾此失彼。
        * 而这三个数**下面那行已经逐个写清楚了**，条子只负责比例 ⇒ 去掉字，零信息损失、零对比度风险。
        * 这比「把颜色调到刚好及格」诚实：不可读的根因是「字压在半透色块上」，不是色号差一点。
        */}
      <div className={styles.segBar} role="img" aria-label={rows.map((r) => `${label[r.group.status ?? ""] ?? r.group.status} ${r.metrics.count_so ?? 0} 张`).join("，")}>
        {rows.map((r) => {
          const k = r.group.status ?? "";
          const n = r.metrics.count_so ?? 0;
          return <div key={k} className={`${styles.segPiece} ${cls[k] ?? ""}`} style={{ width: `${(n / total) * 100}%` }} />;
        })}
      </div>
      <p className={styles.greyLine}>
        手上一共 {total} 张单：
        {rows.map((r) => `${label[r.group.status ?? ""] ?? r.group.status} ${r.metrics.count_so ?? 0} 张`).join(" · ")}
      </p>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 小工具（都是纯读取，读不到就诚实返回 null —— 一个兜底常数都不许有）
// ══════════════════════════════════════════════════════════════════════════

function cardsOf(risk: SolverData | null): BaseCard[] {
  const raw = (risk as { cards?: unknown[] } | null)?.cards ?? [];
  return (raw as Record<string, unknown>[]).map((c) => {
    const exp = (c.exposure ?? {}) as Record<string, unknown>;
    return {
      baseId: String(c.baseId ?? ""),
      baseName: String(c.base ?? exp.baseName ?? c.baseId ?? ""),
      factor: String(c.factor ?? ""),
      status: String(exp.status ?? "UNKNOWN"),
      revenueYi: Number(exp.revenueYi ?? 0),
      orderCount: Number(exp.orderCount ?? 0),
      customerCount: Number(exp.customerCount ?? 0),
      orders: (exp.orders ?? []) as BaseCard["orders"],
      doNothing: c.doNothing ?? null,
    };
  });
}

/** 卡点落在哪个基地上（`Base` 直接对；`Line` 走它自己的 `baseId` 属性 —— 不解析 id 字符串）。 */
function baseOfImpediment(objectType: string, objectId: string, cards: BaseCard[], risk: SolverData | null): string | null {
  if (objectType === "Base") return cards.find((c) => c.baseId === objectId)?.baseId ?? null;
  void risk;
  return null;
}

function bigGapOf(evidence: unknown): string {
  const g = (evidence as { totalGap?: number } | undefined)?.totalGap;
  return typeof g === "number" ? roundish(g) : "—";
}

/**
 * 一句人话归因：贡献最大的两条叶子，**取自回包，不编**。
 * ⚠ 回包里的因子名自带公式（`设备 OEE 损失（1−OEE 均值×产能）`），公式属第二层（R-UI-4），
 * 第一层只留括号前那半句；完整原文在勾稽抽屉里一字不改地给。
 */
function oneLineCause(evidence: unknown): string {
  const ev = evidence as
    | { demandSide?: { drivers?: { factor: string; contribution: number; unit?: string }[] }; supplySide?: { drivers?: { factor: string; contribution: number; unit?: string }[] } }
    | undefined;
  const all = [...(ev?.demandSide?.drivers ?? []), ...(ev?.supplySide?.drivers ?? [])].sort(
    (a, b) => b.contribution - a.contribution,
  );
  if (all.length === 0) return "这次没给出是谁造成的。";
  const top = all.slice(0, 2).map((d) => `${plainFactor(d.factor)} ${roundish(d.contribution)} ${d.unit ?? ""}`.trim());
  return `主要是${top.join(" 和 ")}`;
}

/** 剥掉因子名里的公式括号（全角/半角都剥）—— 只在第一层用，抽屉里仍给原文。 */
function plainFactor(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim() || name;
}

function financeMargin(finance: SolverData | null): string | null {
  const lines = (finance as { lines?: { subject?: string; projected?: number }[] } | null)?.lines ?? [];
  const m = lines.find((l) => l.subject === "毛利");
  return typeof m?.projected === "number" ? `${roundish(m.projected)} 亿` : null;
}

function financeBasisNote(finance: SolverData | null): string | null {
  const b = (finance as { basis?: { note?: string } } | null)?.basis;
  return b?.note ?? null;
}

/** 二级选择器的父键属性名（`base` → `baseId`）。 */
function childKeyProp(filterParam: string): string {
  return filterParam === "base" ? "baseId" : filterParam;
}
