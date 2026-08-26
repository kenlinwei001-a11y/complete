/**
 * WO-SIM-FE-OPT · 「方案寻优」页的**唯一取数口 + 唯一坐标映射口**。
 *
 * ══ 为什么坐标映射也在这里 ═══════════════════════════════════════════════════
 * 本页的红线（派单硬约束 ①）是**几何**的：
 *   「两目标皆取最小 ⇒ 前沿是左下边界；被支配点只可能落在前沿**之上**。
 *     落在前沿下方等于『比最优解还优』，那是不存在的点，画出来就是撒谎。」
 * 一条几何红线要能被测试逐点咬住，映射函数就必须是**一个**纯函数、可单独调用，
 * 而不是散在 SVG 的 JSX 里。故 `normalize/scaleX/scaleY/frontierYAt` 全在本文件导出，
 * `ParetoChart.tsx` 只负责把它们的输出摆成图元 —— 变异反证（把 `scaleY` 的符号取反）
 * 因此能在**一个地方**改掉，并让 `sandbox-opt-pixel.test.tsx` ② 当场红。
 *
 * ══ 方向必须从 `objectives[].dir` 读，不许写死（派单硬约束 ②）════════════════
 * 契约 `ParetoObjectiveSchema` 的注释原话：「**必须显式声明**，不许由代码按目标名猜。
 * 把方向写死在代码里，下次新增一个『最大化准时率』就会被静默算反 —— 而算反的前沿
 * 看起来完全正常：它仍然是一条曲线，只是选出来的是最差的那批解。」
 * 本文件的做法：`normalize()` 把任意方向的目标折成 **0 = 最好 · 1 = 最差** 的同一把尺，
 * 于是「更好 = 更靠左下」在两种方向下都成立，前沿恒是左下边界，
 * 而 `dir` 一改，同一个数值映射出来的坐标当场翻面（用例 ④ 咬这一条）。
 *
 * ══ 数据接线现状（照实说，不许拿"接了线"盖住"只接了一半"）═══════════════════
 * | 屏上的东西 | 真出处 | 今天 |
 * |---|---|---|
 * | 候选方案列表 / 帕累托散点 / 方案详情 / 绑定约束 | `POST /a/v1/sim/optimize-pareto` | **已接**（`useParetoFrontier(req)`；宿主不给 `req` ⇒ 不发请求，落规格占位） |
 * | 执行对比甘特 | `GET /a/v1/sim/sessions/:id/metric-series` | **已接**（`useExecutionCompare(sessionId)`；无 sessionId ⇒ 落规格占位） |
 * | 参数版本 / 收敛残差的「小数残差」口径 | —— | **端点没有**：`ParetoResult.residual` 是**守恒残差计数**（整数），不是收敛精度；不编，见 `projectPareto()` 内注 |
 *
 * ⚠ **为什么 `req` 由宿主给而不是本文件拼**：`ParetoRequest` 要 `family` + 完整的
 * `args`（`multi_objective` 的 vars/constraints/objectives）+ 杠杆网格。这些是**建模产物**，
 * 前端凭空拼一份就是在客户端另造一套求解口径（本仓 R13/R14 反复点名的那种漂移源）。
 * 故与 `useMitigationCards(args?)` 同一姿势：**给了才发，不给就诚实占位**。
 *
 * ══ 占位数的出处 ════════════════════════════════════════════════════════════
 * 逐条取自规格 `docs/ux-spec/sandbox/sandbox-opt.html`，一个字节没改。
 * README §「已知的取舍」：四页的数字是**内部自洽的一套**，接真数据时**整套换掉**。
 * 本文件是这套占位数在本仓的唯一落点 —— 视图层零硬编码数据。
 */
import { useQuery } from "@tanstack/react-query";
import {
  BASE_REGISTRY,
  chainNodeDef,
  type ParetoBinding,
  type ParetoObjective,
  type ParetoRequest,
  type ParetoResult,
  type ParetoSolution,
  type SimMetricSeriesResponse,
} from "@platform/contracts";
import { api } from "@/api/apiClient";
// tick → 天 的换算与措辞：**同目录唯一一份**（它再往下转调契约的 `daysForTicks`）。
import { tickAxisLabels, tickDaysOf } from "./tickAxis";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 屏上的业务名词一律查契约冻结册（R14「应用层无业务常数」）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 环节名 ← `CHAIN_NODE_REGISTRY`；基地名 ← `BASE_REGISTRY`。两者都在 `@platform/contracts`，
 * 是这两类事实的**跨包唯一真相源**（`base-registry.ts` 原话：「所有消费端从 BASE_REGISTRY
 * 派生，改一处全局同步（DF.1/G-5/R14）」；后端 `synthetic/battery.ts` 对不在册的基地名直接抛）。
 *
 * 判据是「**换注册表 = 换租户**」：本页的占位方案卡、绑定约束、执行对比甘特里的环节与基地，
 * 改注册表就跟着改，视图零改动。写死在这里则换个行业整页都是错话。
 *
 * ⚠ 不在册即**抛**，不静默回退到手写串 —— 回退会让「注册表少一条」表现成屏上一切正常。
 */
function nodeLabel(nodeId: string): string {
  const def = chainNodeDef(nodeId);
  if (def === undefined) throw new Error(`不在 CHAIN_NODE_REGISTRY 里的环节：${nodeId}`);
  return def.label;
}

function baseName(baseId: string): string {
  const hit = BASE_REGISTRY.find((b) => b.baseId === baseId);
  if (hit === undefined) throw new Error(`不在 BASE_REGISTRY 里的基地：${baseId}`);
  return hit.name;
}

/**
 * 本页占位场景里的两个基地：主基地 + 承接基地。
 *
 * ⚠ **本单实测（2026-08-25）：规格占位用的「盐城」在 `BASE_REGISTRY` 13 个基地里一条都没有**
 *   （复验 `grep -rn 盐城 packages/contracts/src/` = 0；金丝雀「常州」同命令命中 5 文件 ⇒ 工具是好的）。
 *   即：此前这一页把一个**本系统并不存在的基地**写在方案名、绑定约束与甘特段上，
 *   而同名的东西拿去问后端会被 `synthetic/battery.ts` 的
 *   `基地「X」不在 BASE_REGISTRY 单一来源册` 当场抛掉。换成在册基地（扬州，与常州同属江苏）
 *   **不是改名，是把幻影基地换成真基地**。
 */
const HOME_BASE = "changzhou";
const PEER_BASE_A = "yangzhou";
const PEER_BASE_B = "hefei";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 几何（规格 `#pf` 段的 `X0/X1/Y0/Y1` 与两族网格线，逐值照抄）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 帕累托散点的画布几何。**规格第 253 行**：`X0=52,X1=612,Y0=24,Y1=238`，viewBox `0 0 640 280`。
 *
 * ── 为什么它带 `hardcoded-data-allow`（WO-SIM-HONEST-FALLBACK-A 逐张裁决）─────
 * 它是**画布坐标**，不是业务量：这几个数说的是"SVG 里哪一像素是轴的原点"，
 * 真数据模式与占位模式**走同一份**（`scaleX/scaleY/unscaleX/unscaleY/frontierYAt` 全吃它）。
 * 删掉它连真数据也画不出来。判据一句话：**它不描述这个租户的任何事实**
 * —— 同类还有 `TradeoffRadar.tsx` 的 `RADAR_GEOM`、`Waterfall.tsx` 的 `VB_W/X0/BASE_Y`。
 * 且它被 `sandbox-opt-pixel.test.tsx` 用例 ① 反向咬着（规格 HTML 里那行 `X0=…` 改了这里必须跟）。
 */
export const PARETO_GEOM = { // hardcoded-data-allow —— 画布坐标（呈现），非业务量
  vbW: 640,
  vbH: 280,
  X0: 52,
  X1: 612,
  Y0: 24,
  Y1: 238,
  /** 横向网格线条数（规格 `for(i=0;i<=6;i++)`）⇒ 7 条线 / 6 段。 */
  ySteps: 6,
  /** 纵向网格线条数（规格 `for(j=0;j<=7;j++)`）⇒ 8 条线 / 7 段。 */
  xSteps: 7,
} as const;

/** 一根轴：目标本身 + 该轴的取值域。`dir` **恒来自端点回显的 `objectives[]`**。 */
export interface OptAxis {
  key: string;
  label: string;
  unit: string;
  dir: "min" | "max";
  /** 取值域下界（数值意义上的小端，与"好/坏"无关）。 */
  min: number;
  /** 取值域上界。 */
  max: number;
}

/**
 * 把一个目标读数折成 **0 = 最好 · 1 = 最差**。
 *
 * 这是本页方向无关性的**唯一**来源：`dir:"min"` 时小值好，`dir:"max"` 时大值好，
 * 折完之后下游（`scaleX`/`scaleY`）再也不需要知道方向 —— 于是「前沿 = 左下边界」
 * 这句话在两种方向下都是同一句话，不存在"再排一遍"的分支。
 * 取值域退化（max === min）⇒ 回 0（全体并列最好），不除零。
 */
export function normalize(v: number, ax: Pick<OptAxis, "dir" | "min" | "max">): number {
  const span = ax.max - ax.min;
  if (span === 0) return 0;
  const t = ax.dir === "min" ? (v - ax.min) / span : (ax.max - v) / span;
  return t;
}

/** 逆变换（画刻度用）：屏幕 x → 该轴数值。 */
export function unscaleX(x: number, ax: Pick<OptAxis, "dir" | "min" | "max">): number {
  const t = (x - PARETO_GEOM.X0) / (PARETO_GEOM.X1 - PARETO_GEOM.X0);
  return ax.dir === "min" ? ax.min + t * (ax.max - ax.min) : ax.max - t * (ax.max - ax.min);
}

/** 逆变换（画刻度用）：屏幕 y → 该轴数值。 */
export function unscaleY(y: number, ax: Pick<OptAxis, "dir" | "min" | "max">): number {
  const t = (PARETO_GEOM.Y1 - y) / (PARETO_GEOM.Y1 - PARETO_GEOM.Y0);
  return ax.dir === "min" ? ax.min + t * (ax.max - ax.min) : ax.max - t * (ax.max - ax.min);
}

/** 屏幕 x：**越好越靠左**（`normalize` 已把方向折掉）。 */
export function scaleX(v: number, ax: Pick<OptAxis, "dir" | "min" | "max">): number {
  return PARETO_GEOM.X0 + normalize(v, ax) * (PARETO_GEOM.X1 - PARETO_GEOM.X0);
}

/**
 * 屏幕 y：**越好越靠下**（SVG 的 y 向下增长，故 `Y1 - t·(Y1−Y0)`）。
 *
 * ⚠ **这一行就是派单硬约束 ① 的落点**，也是变异反证（验收 ⑤）要取反的那个符号：
 * 改成 `Y0 + t·(Y1−Y0)` ⇒ 好解跑到上边、被支配点落到前沿**下方** ⇒
 * `sandbox-opt-pixel.test.tsx` ② 逐点断言当场红。
 */
export function scaleY(v: number, ax: Pick<OptAxis, "dir" | "min" | "max">): number {
  return PARETO_GEOM.Y1 - normalize(v, ax) * (PARETO_GEOM.Y1 - PARETO_GEOM.Y0);
}

/** 屏幕坐标点。 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * 前沿折线在横坐标 `x` 处的屏幕 y（线性内插；超出两端按端点水平延伸）。
 *
 * 为什么**折线**够用（而不是阶梯）：设前沿按 x 升序为 f₁…fₙ（互不支配 ⇒ 另一目标必单调变好），
 * 阶梯函数 F_step(x)=「x 左侧最好的那个 f 的读数」是被支配点的真正下界；
 * 而折线在每段内恒**不劣于**阶梯（它从 f_k 走向更好的 f_{k+1}）⇒ 折线更靠"好"的一侧。
 * 于是「真被支配 ⇒ 在阶梯之上 ⇒ 更在折线之上」——用折线断言只会**更严**，不会放过。
 */
export function frontierYAt(x: number, pts: readonly ScreenPoint[]): number {
  if (pts.length === 0) return PARETO_GEOM.Y1;
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const first = sorted[0] as ScreenPoint;
  const last = sorted[sorted.length - 1] as ScreenPoint;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k] as ScreenPoint;
    const b = sorted[k + 1] as ScreenPoint;
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 视图模型
// ══════════════════════════════════════════════════════════════════════════

export type OptSource = "endpoint" | "placeholder";

/** 卡片 `.r2` 的一格（规格：`非增值 18.4D` / `外协 ¥2,180万` / …）。 */
export interface OptMetricCell {
  caption: string;
  text: string;
  /** `g` 绿 / `r` 红 / `""` 常规（规格 `.pc .r2 u i.g|.r`）。 */
  tone: "g" | "r" | "";
}

/** 一个候选方案（前沿解或被支配解）。 */
export interface OptCandidate {
  id: string;
  label: string;
  metrics: Record<string, number>;
  bindings: readonly ParetoBinding[];
  feasible: boolean;
  /** 是否在 `frontier[]` 里。**端点已判好，前端不再排一遍**（派单硬约束 ①）。 */
  onFrontier: boolean;
  cells: readonly OptMetricCell[];
  /** 12 格条里亮几格（规格 `.pc .bars`）。 */
  barsK: number;
  /** 卡片右上角的 `P{n}`。 */
  rankLabel: string;
}

/** 详情面板一行（规格 `.kv`）。 */
export interface OptDetailRow {
  label: string;
  value: string;
  tone: "g" | "r" | "";
}

/** 绑定约束一行（规格 `.cst .r`）。 */
export interface OptConstraintRow {
  key: string;
  value: string;
  /** `紧` / `松`。 */
  slackLabel: string;
  /** 1–4，对应规格 `C=["#62be77","#4c90f0","#e8b54a","#e0626c"]`。 */
  level: 1 | 2 | 3 | 4;
}

/** 雷达（规格 `#rad`）。`values` 一律是 0–1 的"越大越好"归一读数。 */
export interface OptRadar {
  axes: readonly string[];
  baseLabel: string;
  base: readonly number[];
  selLabel: string;
  sel: readonly number[];
}

export interface OptModel {
  /** 端点原样回显（含 `dir`）。轴与下拉都由它派生，前端零猜测。 */
  objectives: readonly ParetoObjective[];
  /** 散点两轴 = `objectives[0]`（横）与 `objectives[1]`（纵）。 */
  axes: readonly [OptAxis, OptAxis];
  frontier: readonly OptCandidate[];
  dominated: readonly OptCandidate[];
  iterations: number;
  residual: number;
  /** 默认选中解（规格是 S-0042；真数据取前沿中位数那一个，见 `projectPareto`）。 */
  defaultSelectedId: string;
  /** 求解器族（详情面板「求解器」一行）。 */
  family: string;
  /** 参数版本 —— 端点**没有**这一格；占位模式给规格值，真数据模式为 `null`（诚实缺席）。 */
  paramVersion: string | null;
  radar: OptRadar;
  /**
   * 底部「执行对比」三个页签比的是哪三个方案。
   * 占位模式给规格那三个（`基线 vs S-0042 / S-0038 / S-0051`，规格第 318 行，
   * **不是按前沿顺序排的**，故不去"推导"它，照抄）；真数据模式 = 选中解 + 其后两个前沿解。
   */
  execTabIds: readonly string[];
  source: OptSource;
}

// ── 甘特（执行对比）─────────────────────────────────────────────────────────

export type OptSegTone = "b" | "a" | "r" | "g" | "o" | "c";

export interface OptSeg {
  startPct: number;
  widthPct: number;
  tone: OptSegTone;
  label: string;
}

export interface OptExecRow {
  /** 竖排组名（只在该组第一行给）。 */
  group?: string;
  name: string;
  baseline: string;
  actual: string;
  /** `up` 变差（红）· `dn` 变好（绿）· `""` 不变。 */
  direction: "up" | "dn" | "";
  segments: readonly OptSeg[];
}

export interface OptExecModel {
  rows: readonly OptExecRow[];
  /**
   * 轨道刻度文本。**两种数据模式口径不同，别合成一句**（`WO-SIM-CONSOLE-DAYS`）：
   *  · **占位模式** ⇒ 规格那套墙钟时刻 `EXEC_TICKS`（`00:00`…`28:00`），像素 1:1 咬着它；
   *  · **真端点模式** ⇒ 按**天**（`第 30 天`），由 `tickAxis.ts` 从回包 tick 序号换算；
   *    口径 `tickDays` 随回包下发（契约选的方案 A，见 `tickAxis.ts` 头注）。
   */
  ticks: readonly string[];
  /**
   * 这条轴的**刻度单位**：一格 tick 等于几天。真端点模式取回包的 `tickDays`（缺 ⇒ `1`）；
   * 占位模式**不给** —— 墙钟时刻那套压根不是按天的轴，给个数就是替它编一个口径。
   */
  tickDays?: number;
  playheadPct: number;
  source: OptSource;
  /**
   * 诚实位：两条泳道的分段是**同一份**还是各有各的。
   * 契约 `SimMetricSeriesResponse` 每个指标只下发**一份** `segments[]`（从真跑过的
   * trace 反查的环节归属），并没有「基线那条线的分段」。故真数据模式下两组共用同一份，
   * 值为 `"shared"` —— 不许给基线组编一套分段出来（那正是 README 警告的"换一半"）。
   */
  laneProvenance: "shared" | "placeholder";
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 规格占位数（**全仓唯一一份**，不许再抄第二处）
//
// ⛔ WO-SIM-HONEST-FALLBACK-A 到此为止 —— **本节整段没动，理由是硬约束不是懒**
// ══════════════════════════════════════════════════════════════════════════
//
// 本单的标的是「兜底占位不许编数」。归因台（`useLossAttribution.ts`）与应对策略卡
// （`StrategyCards.tsx`）都改成了诚实空态；**寻优台这一节改不动**，卡在一处**本单不许碰**
// 的测试上（`test/sandbox-opt-pixel.test.tsx`，范围边界写明只许新增一个测试文件）。
//
// 那份测试不是"顺带用了一下占位数"，它是**直接 import 这个模块的占位模型，再拿它去断言
// 屏上真渲染出来的圆点个数**。逐条列出（行号是 2026-08-25 现读，会漂，用断言原文定位）：
//
// | 测试里的断言 | 它要求的东西 | 换成诚实空态会怎样 |
// |---|---|---|
// | `expect(pd.length).toBeGreaterThan(0)`（用例 ②b） | `PLACEHOLDER_OPT_MODEL.dominated` 非空 | 当场红（它自己的注释写着「反『零元素也全过』」） |
// | `expect(doms.length).toBe(PLACEHOLDER_OPT_MODEL.dominated.length)`（②c） | 渲染 `<SandboxOpt />`（**不给 props** ⇒ 走占位）后屏上圆点数 == 占位被支配解数 | 空态 0 ≠ 16，红 |
// | `expect(opts.length).toBe(PLACEHOLDER_OPT_MODEL.objectives.length)`（④） | 目标下拉的 `<option>` 数 == 占位目标数，且逐个比 `data-dir` | 空态无目标 ⇒ 0 ≠ 3，红 |
// | `.cst .r` / `.gcell` / `.sg` 各 `toBeGreaterThan(0)`（①） | 绑定约束表 / 执行对比甘特 / 泳道段各至少一行 | 三处全红 |
//
// 即：**「屏上必须画着这套占位数」这件事，今天被一份不许改的测试钉死了。**
// 要消掉它得同时改那份测试（把它从"断言占位数上屏"改成"断言几何不变量"），
// 那是另一张单的事 —— 本单**不自行扩范围**（派单原话：判定做不完就顶回来，不许自己扩）。
//
// 与归因台的区别在哪：归因台的组件（`HeatMatrix.tsx`）本来就写好了「没格子就印 `—` + reason」
// 那条分支，空态是**复用**它；而寻优台的像素测**直接对占位数组的长度做断言**，
// 没有任何"空态也成立"的写法。两者不是同一种阻塞。
//
// ⚠ 因此本节的 `hardcoded-data-allow` 记号**一个都没加**：那会是"拿豁免压真业务数据换绿"，
// 派单点名禁止。门 `check-debattery` 对本文件仍会报 `PLACEHOLDER_RADAR` /
// `PLACEHOLDER_OPT_MODEL` 两处（原本三处，`PARETO_GEOM` 已按"呈现常量"归类并加记号）——
// **这两处红是照实的红**，不许用记号把它抹掉。

/** 规格 `.sel` 三个下拉项 ⇒ 三个目标（`dir` 由「最小 / 最大」字面反推，与端点回显同形）。 */
const PLACEHOLDER_OBJECTIVES: readonly ParetoObjective[] = [ // hardcoded-data-allow —— 规格占位
  { key: "nonvalue", dir: "min", label: "全链非增值", unit: "D" },
  { key: "outsource", dir: "min", label: "外协兜底成本", unit: "¥万" },
  { key: "ontime", dir: "max", label: "准时率", unit: "%" },
];

/** 规格 `#pf` 的 `D0=18.0,D1=22.2` 与 `C1=2400`（纵轴自 0 起）。 */
const PLACEHOLDER_AXES: readonly [OptAxis, OptAxis] = [
  { key: "nonvalue", label: "全链非增值", unit: "D", dir: "min", min: 18.0, max: 22.2 },
  { key: "outsource", label: "外协兜底成本", unit: "¥万", dir: "min", min: 0, max: 2400 },
];

/** 规格候选方案卡 `D[]`（第 227–233 行）：id / 文案 / 非增值 / 外协 / 准时 / 稼动 / 亮格数 / 前沿 / 选中。 */
const PLACEHOLDER_CARDS = [ // hardcoded-data-allow —— 规格占位
  ["S-0055", `跨基地借调 + 外协 · ${baseName(PEER_BASE_A)}`, 18.4, 2180, 94.1, 86.2, 12],
  ["S-0051", `外协兜底 · ${baseName(PEER_BASE_B)}`, 18.7, 1240, 93.0, 82.4, 10],
  ["S-0042", `跨基地借调 · ${baseName(PEER_BASE_A)}`, 19.1, 620, 92.4, 84.6, 9],
  ["S-0038", `缓冲释放 · ${baseName(HOME_BASE)}`, 20.2, 180, 90.1, 79.2, 6],
  ["S-0029", `缓冲释放 + 限产 · ${baseName(HOME_BASE)}`, 21.4, 60, 88.4, 74.8, 4],
] as const;

/** 规格 `.pc .r2` 四格的表头（这是**规格的显示简称**，不是第二套目标名）。 */
const PLACEHOLDER_CELL_CAPTIONS = ["非增值", "外协", "准时", "稼动"] as const;

/** 规格 `#cst` 的 `D[]`（第 328–330 行）：约束名 / 取值 / 松紧 / 色阶。 */
const PLACEHOLDER_CONSTRAINTS: readonly OptConstraintRow[] = [ // hardcoded-data-allow —— 规格占位
  { key: `${baseName(PEER_BASE_A)}日产上限`, value: (4200).toLocaleString(), slackLabel: "紧", level: 4 },
  { key: `${baseName(HOME_BASE)}检修窗`, value: "3", slackLabel: "松", level: 1 },
  { key: "LFP-99 库存", value: (8600).toLocaleString(), slackLabel: "紧", level: 3 },
  { key: "跨基地运距", value: "280", slackLabel: "松", level: 1 },
  { key: "外协配额", value: (1200).toLocaleString(), slackLabel: "紧", level: 3 },
  { key: "班组工时", value: (1680).toLocaleString(), slackLabel: "松", level: 2 },
  { key: "良率下限", value: "96.5", slackLabel: "紧", level: 4 },
  { key: "在制上限", value: (14000).toLocaleString(), slackLabel: "松", level: 2 },
  { key: "交付窗口", value: "22", slackLabel: "紧", level: 3 },
];

/** 规格 `.kv` 十行（第 300–309 行）。 */
const PLACEHOLDER_DETAIL: readonly OptDetailRow[] = [ // hardcoded-data-allow —— 规格占位
  { label: "方案编号", value: "S-0042", tone: "" },
  { label: "求解器", value: "optimize_whatif", tone: "" },
  { label: "参数版本", value: "v3.2.1", tone: "" },
  { label: "可行性", value: "可行", tone: "g" },
  { label: "全链非增值", value: "19.1 D", tone: "g" },
  { label: "外协兜底成本", value: "¥ 620 万", tone: "" },
  { label: "交付准时率", value: "92.4 %", tone: "g" },
  { label: "产线稼动率", value: "84.6 %", tone: "" },
  { label: "迭代步数", value: (1284).toLocaleString(), tone: "" },
  { label: "收敛残差", value: "0.0031", tone: "" },
];

/** 规格 `#rad`（第 288–296 行）。 */
const PLACEHOLDER_RADAR: OptRadar = {
  axes: ["非增值", "外协成本", "准时率", "稼动率", "库存", "缺口"],
  baseLabel: "基线",
  base: [0.42, 0.88, 0.55, 0.6, 0.5, 0.35],
  selLabel: "S-0042",
  sel: [0.82, 0.66, 0.9, 0.86, 0.74, 0.8],
};

/**
 * 规格 `DOM[]`（第 275–277 行）那 16 个**被支配散点**。
 *
 * ⚠ **诚实边界（不许读成"这 16 个点各自都被某个前沿解支配"）**：规格给的是**屏幕坐标**，
 * 且逐点做过 `y = min(yRaw, frontY(x) − 9)` 的上推 —— 它保证的只有一件事：
 * **每个点都落在前沿折线之上**。这正是派单硬约束 ① 与验收 ② 要的那条不变量，
 * 但它比"被某个前沿解逐目标支配"**弱**（折线两段之间的凹口里存在既在折线之上、
 * 又不被任何前沿点支配的位置）。占位数的全部主张就是这条不变量，不多。
 * 真数据模式下 `dominated[]` 由端点判定（契约明写"已做逐对支配剔除"），前端一律照画。
 *
 * 这里把规格的屏幕坐标**反解回数值**（`unscaleX/unscaleY`），让占位与真数据走**同一条**
 * 「数值 → 坐标」的路 —— 若占位直接存屏幕坐标，映射函数就有一条路径从未被占位数走过，
 * 变异反证也就咬不到它（本仓「生产实参与测试实参交集为空」那类假绿的同族）。
 */
const PLACEHOLDER_DOMINATED_SCREEN: readonly (readonly [number, number])[] = [ // hardcoded-data-allow —— 规格占位
  [150, 60], [185, 44], [215, 92], [248, 70], [286, 120], [318, 96], [352, 150], [386, 118],
  [420, 176], [455, 140], [492, 196], [520, 164], [556, 208], [584, 182], [268, 40], [470, 84],
];

/** 规格：被支配点相对前沿折线的最小上推量（`frontY(x)-9`）。 */
const DOMINATED_MIN_LIFT = 9;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 格式化（规格里两套不同的写法，**照抄，不统一**）
// ══════════════════════════════════════════════════════════════════════════

/** 卡片 `.r2` 的紧凑写法：`18.4D` / `¥2,180万` / `94.1%`。 */
export function fmtCompact(v: number, unit: string): string {
  if (unit === "¥万") return `¥${Math.round(v).toLocaleString()}万`;
  if (unit === "") return v.toLocaleString();
  return `${v.toFixed(1)}${unit}`;
}

/** 详情 `.kv` 的宽松写法：`19.1 D` / `¥ 620 万` / `92.4 %`。 */
export function fmtSpaced(v: number, unit: string): string {
  if (unit === "¥万") return `¥ ${Math.round(v).toLocaleString()} 万`;
  if (unit === "") return v.toLocaleString();
  return `${v.toFixed(1)} ${unit}`;
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 占位模型（由上面那几张规格表拼出来）
// ══════════════════════════════════════════════════════════════════════════

function placeholderCandidate(row: (typeof PLACEHOLDER_CARDS)[number], onFrontier: boolean): OptCandidate {
  const [id, label, nonvalue, outsource, ontime, util, bars] = row;
  return {
    id,
    label,
    metrics: { nonvalue, outsource, ontime, utilization: util },
    bindings: [],
    feasible: true,
    onFrontier,
    // 规格 `.r2` 的三条着色判据（第 236–239 行）逐条照抄。
    cells: [
      { caption: PLACEHOLDER_CELL_CAPTIONS[0], text: fmtCompact(nonvalue, "D"), tone: nonvalue < 20 ? "g" : "" },
      { caption: PLACEHOLDER_CELL_CAPTIONS[1], text: fmtCompact(outsource, "¥万"), tone: outsource > 1000 ? "r" : "" },
      { caption: PLACEHOLDER_CELL_CAPTIONS[2], text: fmtCompact(ontime, "%"), tone: ontime > 91 ? "g" : "" },
      { caption: PLACEHOLDER_CELL_CAPTIONS[3], text: fmtCompact(util, "%"), tone: "" },
    ],
    barsK: bars,
    rankLabel: `P${bars * 8}`,
  };
}

const PLACEHOLDER_FRONTIER: readonly OptCandidate[] = PLACEHOLDER_CARDS.map((r) => placeholderCandidate(r, true));

/** 规格的被支配散点：屏幕坐标 → 数值（含 `frontY(x)-9` 上推），见 `PLACEHOLDER_DOMINATED_SCREEN` 注释。 */
const PLACEHOLDER_DOMINATED: readonly OptCandidate[] = (() => {
  const [ax, ay] = PLACEHOLDER_AXES;
  const front = PLACEHOLDER_FRONTIER.map((c) => ({
    x: scaleX(c.metrics.nonvalue as number, ax),
    y: scaleY(c.metrics.outsource as number, ay),
  }));
  return PLACEHOLDER_DOMINATED_SCREEN.map(([sx, syRaw], i) => {
    const sy = Math.min(syRaw, frontierYAt(sx, front) - DOMINATED_MIN_LIFT);
    const nonvalue = unscaleX(sx, ax);
    const outsource = unscaleY(sy, ay);
    return {
      id: `D-${String(i + 1).padStart(2, "0")}`,
      label: "被支配解",
      metrics: { nonvalue, outsource },
      bindings: [],
      feasible: true,
      onFrontier: false,
      cells: [
        { caption: PLACEHOLDER_CELL_CAPTIONS[0], text: fmtCompact(nonvalue, "D"), tone: "" as const },
        { caption: PLACEHOLDER_CELL_CAPTIONS[1], text: fmtCompact(outsource, "¥万"), tone: "" as const },
        { caption: PLACEHOLDER_CELL_CAPTIONS[2], text: "—", tone: "" as const },
        { caption: PLACEHOLDER_CELL_CAPTIONS[3], text: "—", tone: "" as const },
      ],
      barsK: 0,
      rankLabel: "P0",
    };
  });
})();

export const PLACEHOLDER_OPT_MODEL: OptModel = {
  objectives: PLACEHOLDER_OBJECTIVES,
  axes: PLACEHOLDER_AXES,
  frontier: PLACEHOLDER_FRONTIER,
  dominated: PLACEHOLDER_DOMINATED,
  iterations: 1284,
  residual: 0,
  defaultSelectedId: "S-0042",
  family: "optimize_whatif",
  paramVersion: "v3.2.1",
  radar: PLACEHOLDER_RADAR,
  execTabIds: ["S-0042", "S-0038", "S-0051"], // hardcoded-data-allow —— 规格第 318 行原样
  source: "placeholder",
};

/** 详情面板：占位模式直接给规格那十行；真数据模式见 `detailRowsOf()`。 */
export const PLACEHOLDER_DETAIL_ROWS = PLACEHOLDER_DETAIL;
export const PLACEHOLDER_CONSTRAINT_ROWS = PLACEHOLDER_CONSTRAINTS;

// ══════════════════════════════════════════════════════════════════════════
// § 6 · 端点回包 → 视图模型
// ══════════════════════════════════════════════════════════════════════════

/** 轴取值域：把**全体候选**（前沿 + 被支配）都框进去，否则被支配点会画到画布外。 */
function axisOf(obj: ParetoObjective, all: readonly ParetoSolution[]): OptAxis {
  const vs = all.map((s) => s.metrics[obj.key]).filter((v): v is number => typeof v === "number");
  const lo = vs.length > 0 ? Math.min(...vs) : 0;
  const hi = vs.length > 0 ? Math.max(...vs) : 1;
  // 退化域（全体读数相同）⇒ 撑开 1 个单位，免得所有点叠在轴的原点上。
  const [min, max] = hi > lo ? [lo, hi] : [lo, lo + 1];
  return { key: obj.key, label: obj.label ?? obj.key, unit: obj.unit ?? "", dir: obj.dir, min, max };
}

/**
 * 一个解在各目标上的**综合好坏**（0 = 最差 · 1 = 最好），用于 `.bars` 亮格数与雷达。
 * 这是一个**声明出来的投影**，不是端点的原生字段 —— 故调用处一律标 `derived`。
 */
function goodnessOf(sol: ParetoSolution, axes: readonly OptAxis[]): number {
  const ts = axes
    .map((ax) => sol.metrics[ax.key])
    .filter((v): v is number => typeof v === "number")
    .map((v, i) => 1 - normalize(v, axes[i] as OptAxis));
  if (ts.length === 0) return 0;
  return ts.reduce((a, b) => a + b, 0) / ts.length;
}

/** 端点解 → 候选卡。`cells` 取前 4 个目标（规格 `.r2` 就是四格）。 */
function candidateOf(
  sol: ParetoSolution,
  axes: readonly OptAxis[],
  onFrontier: boolean,
  peers: readonly ParetoSolution[],
): OptCandidate {
  const cells = axes.slice(0, 4).map((ax) => {
    const v = sol.metrics[ax.key];
    if (typeof v !== "number") return { caption: ax.label, text: "—", tone: "" as const };
    // 着色是**同侪相对**判据（同一批候选里排在最好 / 最差的三分之一），不是绝对阈值——
    // 绝对阈值等于在前端另立一套口径，换个租户就全错。
    const peerVals = peers.map((p) => p.metrics[ax.key]).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    const rank = peerVals.filter((x) => x < v).length / Math.max(1, peerVals.length - 1);
    const t = ax.dir === "min" ? rank : 1 - rank;
    return { caption: ax.label, text: fmtCompact(v, ax.unit), tone: (t <= 1 / 3 ? "g" : t >= 2 / 3 ? "r" : "") as "g" | "r" | "" };
  });
  const k = Math.max(0, Math.min(12, Math.round(goodnessOf(sol, axes) * 12)));
  return {
    id: sol.id,
    label: sol.label,
    metrics: sol.metrics,
    bindings: sol.bindings,
    feasible: sol.feasible,
    onFrontier,
    cells,
    barsK: k,
    rankLabel: `P${k * 8}`,
  };
}

/**
 * `ParetoResult` → 视图模型。
 *
 * **前端不排序、不过滤、不重判支配**（派单硬约束 ①）：`frontier[]` / `dominated[]` 直接照画。
 * 契约注释原话：`frontier` 是「互不支配的解（**已做逐对支配剔除**）」，`dominated` 与它交集恒空。
 * 在前端"再排一遍"只会造出第二套判据，两套一漂就是屏上看不出来的错。
 */
export function projectPareto(res: ParetoResult, family: string): OptModel {
  const all = [...res.frontier, ...res.dominated];
  const axes = res.objectives.map((o) => axisOf(o, all));
  const [ax0, ax1] = axes;
  const pair: readonly [OptAxis, OptAxis] = [
    ax0 ?? (PLACEHOLDER_AXES[0] as OptAxis),
    ax1 ?? (PLACEHOLDER_AXES[1] as OptAxis),
  ];
  const frontier = res.frontier.map((s) => candidateOf(s, axes, true, all));
  const dominated = res.dominated.map((s) => candidateOf(s, axes, false, all));
  // 默认选中：前沿里综合最好的那一个（**声明出来的**默认值，用户点一下就换）。
  const best = [...res.frontier].sort((a, b) => goodnessOf(b, axes) - goodnessOf(a, axes))[0];
  const selId = best?.id ?? frontier[0]?.id ?? "";
  return {
    objectives: res.objectives,
    axes: pair,
    frontier,
    dominated,
    iterations: res.iterations,
    // ⚠ `residual` 是**守恒残差计数**（契约：因不可行被剔出竞争的候选数，整数），
    //   **不是**规格 `.kv` 里那个 `0.0031` 的"收敛精度"。端点没有收敛精度这一格，不编。
    residual: res.residual,
    defaultSelectedId: selId,
    family,
    // 端点没有「参数版本」这一格 ⇒ 诚实缺席（视图显 `—`），不拿 family 或别的字段冒充。
    paramVersion: null,
    radar: radarOf(frontier, selId, axes),
    execTabIds: [selId, ...frontier.map((c) => c.id).filter((id) => id !== selId)].slice(0, 3),
    source: "endpoint",
  };
}

/** 雷达：轴 = 前 6 个目标；两条多边形 = 选中解 与 候选均值。 */
function radarOf(cands: readonly OptCandidate[], selId: string, axes: readonly OptAxis[]): OptRadar {
  const use = axes.slice(0, 6);
  const good = (c: OptCandidate | undefined, ax: OptAxis): number => {
    const v = c?.metrics[ax.key];
    return typeof v === "number" ? 1 - normalize(v, ax) : 0;
  };
  const sel = cands.find((c) => c.id === selId);
  return {
    axes: use.map((a) => a.label),
    // ⚠ 端点回包里**没有基线解**（`ParetoResult` 只有 frontier/dominated）。
    //   故这条参照线是「全体候选均值」，并**如实改名** —— 沿用"基线"两个字就是撒谎。
    baseLabel: "候选均值",
    base: use.map((ax) => (cands.length === 0 ? 0 : cands.reduce((s, c) => s + good(c, ax), 0) / cands.length)),
    selLabel: sel?.id ?? "",
    sel: use.map((ax) => good(sel, ax)),
  };
}

/** 详情面板十行：真数据模式按「编号 / 求解器 / 参数版本 / 可行性 / 各目标 / 迭代 / 残差」拼。 */
export function detailRowsOf(model: OptModel, sel: OptCandidate | undefined): readonly OptDetailRow[] {
  if (model.source === "placeholder") return PLACEHOLDER_DETAIL_ROWS;
  const rows: OptDetailRow[] = [
    { label: "方案编号", value: sel?.id ?? "—", tone: "" },
    { label: "求解器", value: model.family, tone: "" },
    { label: "参数版本", value: model.paramVersion ?? "—", tone: "" },
    { label: "可行性", value: sel === undefined ? "—" : sel.feasible ? "可行" : "不可行", tone: sel?.feasible === false ? "r" : "g" },
  ];
  for (const obj of model.objectives) {
    const v = sel?.metrics[obj.key];
    rows.push({
      label: obj.label ?? obj.key,
      value: typeof v === "number" ? fmtSpaced(v, obj.unit ?? "") : "—",
      tone: "",
    });
  }
  rows.push({ label: "迭代步数", value: model.iterations.toLocaleString(), tone: "" });
  // 契约口径：`iterations === frontier + dominated + residual`。屏上写清是**守恒残差**，
  // 不写「收敛残差」——那是规格占位文案，端点答不出。
  rows.push({ label: "守恒残差", value: model.residual.toLocaleString(), tone: model.residual > 0 ? "r" : "" });
  return rows;
}

/** 绑定约束表：真数据模式从 `Solution.bindings[]` 现算色阶。 */
export function constraintRowsOf(model: OptModel, sel: OptCandidate | undefined): readonly OptConstraintRow[] {
  if (model.source === "placeholder") return PLACEHOLDER_CONSTRAINT_ROWS;
  return (sel?.bindings ?? []).map((b) => ({
    key: b.key,
    value: b.value.toLocaleString(),
    slackLabel: b.tight ? "紧" : "松",
    // 色阶是**声明出来的四档**（契约只给 `tight` 这一个布尔位 + 数值裕度）：
    // 越界 4 红 · 顶到边 3 琥珀 · 裕度不足一成 2 蓝 · 其余 1 绿。
    level: b.slack < 0 ? 4 : b.tight ? 3 : Math.abs(b.slack) < Math.abs(b.limit) * 0.1 ? 2 : 1,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// § 7 · 取数 hook
// ══════════════════════════════════════════════════════════════════════════

export const PARETO_ENDPOINT = "/a/v1/sim/optimize-pareto" as const;

/**
 * 接 `POST /a/v1/sim/optimize-pareto`。
 *
 * `req` 缺省（宿主还没选定优化族 / 杠杆网格）⇒ **不发请求**，用规格占位值；
 * 请求失败 ⇒ 同样落回占位，`source` 报 `"placeholder"`，调用方与测试读得出「这不是真数据」。
 */
export function useParetoFrontier(req?: ParetoRequest): { model: OptModel; isLoading: boolean } {
  const enabled = req !== undefined;
  const q = useQuery({
    queryKey: ["a", "sim-optimize-pareto", req === undefined ? "" : JSON.stringify(req)],
    enabled,
    retry: false,
    queryFn: () => api.a<ParetoResult>(PARETO_ENDPOINT, { body: req }),
  });
  if (!enabled || q.data === undefined) {
    return { model: PLACEHOLDER_OPT_MODEL, isLoading: enabled && q.isLoading };
  }
  return { model: projectPareto(q.data, req.family), isLoading: false };
}

// ── 执行对比甘特 ────────────────────────────────────────────────────────────

/** 规格 `.lh`：`for(i=0;i<=14;i++) String(i*2).padStart(2,"0")+":00"`。 */
export const EXEC_TICKS: readonly string[] = Array.from({ length: 15 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`);

/** 规格 `.play{left:46%}`。 */
const EXEC_PLAYHEAD_PCT = 46;

/**
 * 规格 `R[]`（第 341–350 行）。
 *
 * 四行的 `name` 是**链路环节**，四个都与 `CHAIN_NODE_REGISTRY` 的 label **逐字相同**
 * ⇒ 整列改查注册表：零像素变化，只把出处从「手写」换成「冻结册」。
 * 段名里凡是环节的（`请购`）同样查表；`拣配 / 发料 / 上炉 / 静置` 这类是**环节内部的动作**、
 * 不在注册表里，硬套 nodeId 等于在视图里新造一套命名，比写死更坏 —— 留在原地。
 * 基地名（原规格的「盐城」）见文件头 `baseName` 注释：那是个**不在册的幻影基地**，已换在册基地。
 */
const PLACEHOLDER_EXEC_ROWS: readonly OptExecRow[] = [ // hardcoded-data-allow —— 规格占位
  { group: "基线执行", name: nodeLabel("material.kitting"), baseline: "4.54 D", actual: "2.10 D", direction: "dn", segments: [
    { startPct: 2, widthPct: 12, tone: "o", label: nodeLabel("material.purchase_req") }, { startPct: 16, widthPct: 22, tone: "r", label: "正极粉断供" },
    { startPct: 40, widthPct: 18, tone: "b", label: "拣配" }, { startPct: 60, widthPct: 14, tone: "g", label: "发料" },
    { startPct: 78, widthPct: 10, tone: "o", label: "结转" }] },
  { name: nodeLabel("capacity.aging"), baseline: "7.34 D", actual: "5.02 D", direction: "dn", segments: [
    { startPct: 3, widthPct: 10, tone: "o", label: "上炉" }, { startPct: 15, widthPct: 26, tone: "r", label: "炉位排队" },
    { startPct: 43, widthPct: 16, tone: "b", label: "静置" }, { startPct: 61, widthPct: 13, tone: "g", label: "下炉" },
    { startPct: 77, widthPct: 11, tone: "o", label: "结转" }] },
  { name: nodeLabel("capacity.qc_batch"), baseline: "2.81 D", actual: "2.20 D", direction: "dn", segments: [
    { startPct: 2, widthPct: 11, tone: "o", label: "抽检" }, { startPct: 15, widthPct: 20, tone: "a", label: "攒批" },
    { startPct: 37, widthPct: 18, tone: "b", label: "复判" }, { startPct: 57, widthPct: 15, tone: "g", label: "放行" },
    { startPct: 75, widthPct: 12, tone: "o", label: "结转" }] },
  { name: nodeLabel("delivery.transit"), baseline: "0.43 D", actual: "0.43 D", direction: "", segments: [
    { startPct: 4, widthPct: 9, tone: "o", label: "装车" }, { startPct: 15, widthPct: 18, tone: "b", label: "干线" },
    { startPct: 35, widthPct: 16, tone: "b", label: "分拨" }, { startPct: 54, widthPct: 14, tone: "g", label: "签收" },
    { startPct: 71, widthPct: 12, tone: "o", label: "结转" }] },
  { group: "S-0042 执行", name: nodeLabel("material.kitting"), baseline: "4.54 D", actual: "2.10 D", direction: "dn", segments: [
    { startPct: 2, widthPct: 12, tone: "o", label: nodeLabel("material.purchase_req") }, { startPct: 16, widthPct: 14, tone: "c", label: `${baseName(PEER_BASE_A)}调拨` },
    { startPct: 32, widthPct: 20, tone: "c", label: "跨基地在途" }, { startPct: 54, widthPct: 18, tone: "g", label: "发料" },
    { startPct: 75, widthPct: 12, tone: "o", label: "结转" }] },
  { name: nodeLabel("capacity.aging"), baseline: "7.34 D", actual: "5.02 D", direction: "dn", segments: [
    { startPct: 3, widthPct: 10, tone: "o", label: "上炉" }, { startPct: 15, widthPct: 18, tone: "c", label: `${baseName(PEER_BASE_A)}炉位` },
    { startPct: 35, widthPct: 20, tone: "c", label: "并行静置" }, { startPct: 57, widthPct: 16, tone: "g", label: "下炉" },
    { startPct: 75, widthPct: 12, tone: "o", label: "结转" }] },
  { name: nodeLabel("capacity.qc_batch"), baseline: "2.81 D", actual: "2.20 D", direction: "dn", segments: [
    { startPct: 2, widthPct: 11, tone: "o", label: "抽检" }, { startPct: 15, widthPct: 16, tone: "c", label: "阈值下调" },
    { startPct: 33, widthPct: 18, tone: "c", label: "并行复判" }, { startPct: 53, widthPct: 17, tone: "g", label: "放行" },
    { startPct: 73, widthPct: 14, tone: "o", label: "结转" }] },
  { name: nodeLabel("delivery.transit"), baseline: "0.43 D", actual: "0.56 D", direction: "up", segments: [
    { startPct: 4, widthPct: 9, tone: "o", label: "装车" }, { startPct: 15, widthPct: 22, tone: "c", label: `${baseName(PEER_BASE_A)}→${baseName(HOME_BASE)}` },
    { startPct: 39, widthPct: 16, tone: "b", label: "分拨" }, { startPct: 57, widthPct: 14, tone: "g", label: "签收" },
    { startPct: 73, widthPct: 13, tone: "o", label: "结转" }] },
];

export const PLACEHOLDER_EXEC_MODEL: OptExecModel = {
  rows: PLACEHOLDER_EXEC_ROWS,
  ticks: EXEC_TICKS,
  playheadPct: EXEC_PLAYHEAD_PCT,
  source: "placeholder",
  laneProvenance: "placeholder",
};

const lastNumber = (xs: readonly (number | null)[]): number | null => {
  for (let i = xs.length - 1; i >= 0; i--) {
    const v = xs[i];
    if (typeof v === "number") return v;
  }
  return null;
};

/**
 * `GET …/metric-series` → 执行对比甘特。
 *
 * 分组：**基线执行**（画 `baseline[]` 的读数）与 **{方案} 执行**（画 `actual[]` 的读数），
 * 各取前 4 个指标（规格就是 4+4 行）。
 *
 * ⚠ 两组的泳道分段是**同一份**（`laneProvenance:"shared"`）：契约每个指标只下发一份
 * `segments[]`（从真跑过的 trace 反查的环节归属），并没有"基线那条线的分段"。
 * 给基线组另编一套 = README 警告的"换一半，屏上就自相矛盾"。
 * 段色只编码契约的**诚实位** `source`：`cadence`（建模方显式绑定的节拍点）⇒ 青片 `c`；
 * `domain`（按落域推的回落档）⇒ 蓝片 `b`。两者不许合并成一个裸色。
 */
export function projectExecCompare(res: SimMetricSeriesResponse, solutionLabel: string): OptExecModel {
  const items = res.metrics.slice(0, 4);
  const t0 = res.ticks[0] ?? 0;
  const tN = res.ticks[res.ticks.length - 1] ?? t0;
  const span = tN - t0 === 0 ? 1 : tN - t0;
  const segsOf = (m: (typeof items)[number]): OptSeg[] =>
    m.segments.map((s) => ({
      startPct: ((s.fromTick - t0) / span) * 100,
      widthPct: Math.max(0, ((s.toTick - s.fromTick + 1) / span) * 100),
      tone: s.source === "cadence" ? ("c" as const) : ("b" as const),
      label: s.label,
    }));
  const fmt = (v: number | null, unit: string | null): string =>
    v === null ? "—" : `${v.toFixed(2)}${unit === null ? "" : ` ${unit}`}`;
  // 规格的两组共用同一对「基线 / 方案」读数列（`R[]` 里 1–4 行与 5–8 行的 b/a 逐字相同），
  // 两组的差别只在**泳道**。真数据同构：读数来自 `baseline[]`/`actual[]` 的末格。
  const rowOf = (m: (typeof items)[number]): Omit<OptExecRow, "group"> => {
    const b = lastNumber(m.baseline);
    const a = lastNumber(m.actual);
    return {
      name: m.label,
      baseline: fmt(b, m.unit),
      actual: fmt(a, m.unit),
      // ⚠ 这里的 up/dn 是**变大 / 变小**，不是"变好 / 变坏"：契约明写 `unit` 恒 `null`、
      //   全仓没有"状态变量 → 极性"的登记册（见 `SimMetricSeriesItemSchema.unit` 注释），
      //   编一个极性出来就是新造口径。屏上红绿只表示方向，不表示好坏。
      direction: (b === null || a === null || a === b ? "" : a > b ? "up" : "dn") as "up" | "dn" | "",
      segments: segsOf(m),
    };
  };
  const rows: OptExecRow[] = [];
  items.forEach((m, i) => rows.push(i === 0 ? { group: "基线执行", ...rowOf(m) } : rowOf(m)));
  items.forEach((m, i) => rows.push(i === 0 ? { group: `${solutionLabel} 执行`, ...rowOf(m) } : rowOf(m)));
  return {
    rows,
    // 回包的 tick 序号 → **按天**的轴标签（`WO-SIM-CONSOLE-DAYS`）。口径 `tickDays` 随回包下发
    // （契约选的方案 A，理由见 `tickAxis.ts` 头注），换算与措辞的唯一实现在同目录 `tickAxis.ts`
    // （它再往下转调契约的 `daysForTicks`）——**别在这里 map 一份出来**。
    ticks: tickAxisLabels(res.ticks, res.tickDays),
    tickDays: tickDaysOf(res.tickDays),
    // 播放头 = 世界线当前格（窗口右端）。占位模式那 46% 是规格的美术值，真数据模式不沿用。
    playheadPct: 100,
    source: "endpoint",
    laneProvenance: "shared",
  };
}

export const metricSeriesPath = (sessionId: string): string =>
  `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/metric-series`;

/** 接 `GET …/metric-series`。无 `sessionId` ⇒ 不发请求，落规格占位。 */
export function useExecutionCompare(sessionId?: string, solutionLabel = ""): OptExecModel {
  const enabled = sessionId !== undefined && sessionId !== "";
  const q = useQuery({
    queryKey: ["a", "sim-metric-series", sessionId ?? ""],
    enabled,
    retry: false,
    queryFn: () => api.a<SimMetricSeriesResponse>(metricSeriesPath(sessionId as string)),
  });
  if (!enabled || q.data === undefined || q.data.metrics.length === 0) return PLACEHOLDER_EXEC_MODEL;
  return projectExecCompare(q.data, solutionLabel);
}
