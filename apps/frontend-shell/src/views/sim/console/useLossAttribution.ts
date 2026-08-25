/**
 * WO-SIM-FE-ATTR · 「损失归因」台的**唯一取数口**。
 *
 * ── 三条线各接到哪（照实说，不许拿「接了线」盖住「只接了一半」）────────────
 * | 屏上的东西 | 真出处 | 今天 |
 * |---|---|---|
 * | 环节 × 基地 热力矩阵 | `POST /a/v1/sim/chain-loss-matrix` | **已接**（`useChainLossMatrix`） |
 * | 根因树 / 归因明细 / 瀑布 | `POST /a/v1/sim/chain-loss-drill` + 矩阵 `rowTotals` | **已接**（`useChainLossDrill`） |
 * | 底部贡献度时序 | `GET /a/v1/sim/sessions/:id/metric-series` | **已接**（`useContributionSeries`） |
 *
 * 每个 hook 的返回都带 `source`（`"endpoint"` / `"placeholder"`）——**这不是可以省略的元数据**：
 * 没选世界 / 请求未回 / 请求失败时回落规格占位数，屏上要读得出「这几个数不是真算出来的」。
 * 诚实位走 `data-source` 属性而不是屏上文字：本页验收线是**像素级 1:1**，
 * 往版面里塞一行「占位」会当场破坏它；属性对测试可见、对像素不可见，两头都不骗。
 *
 * ── 占位数的出处 ────────────────────────────────────────────────────────────
 * 逐条取自规格 `docs/ux-spec/sandbox/sandbox-attr.html` 的 `D[]` / `V[]` / `R[]` 三张表。
 * README §「已知的取舍」明写：四页的数字是**内部自洽的一套**，接真数据时整套换掉，
 * 不许只换一半 —— 换一半屏上就自相矛盾。故占位数**全部**集中在本文件，一个都不许散进 JSX。
 *
 * ── 环节名为什么绕一道「键位锚定」───────────────────────────────────────────
 * 契约 §2.5 明写「`label` 人读名，前端**不另维护中文映射表**，一律取这里」，
 * 门 `scripts/check-chain-node-singlesource.mjs` 判据 L（≥3 个在册 label 字面量即红）
 * 与判据 C（≥3 个在册 nodeId 出现在**值位**即红）双面守着。故本文件：
 *   · 站名一律 `chainNodeDef(nodeId).label` 现取，**零 label 字面量**；
 *   · nodeId **只出现在 `Partial<Record<Rid, …>>` 的键位**（`Rid` 由契约的
 *     `ChainNodeDef["nodeId"]` 派生 ⇒ 编译期绑死，改册即 TS2353），判据 C 明文按机制放行。
 */
import { useQuery } from "@tanstack/react-query";
import {
  BASE_REGISTRY,
  CHAIN_NODE_REGISTRY,
  chainNodeDef,
  type ChainLossDrill,
  type ChainLossMatrixResult,
  type ChainNodeDef,
  type SimMetricSeriesResponse,
} from "@platform/contracts";
import { api } from "@/api/apiClient";
// tick → 天 的换算与措辞：**同目录唯一一份**（它再往下转调契约的 `daysForTicks`）。
import { tickAxisLabels, tickDaysOf } from "./tickAxis";

/** 在册节点 id 的字面量联合（派生自契约本尊，不是本地起个同名别名白嫖）。 */
type Rid = ChainNodeDef["nodeId"];

/**
 * 求解器键的**本文件单源**。既当请求路径的一段、又当屏上「求解器」那一列的显示值 ——
 * 两处各写一遍就会漂（屏上说 A、实际请求 B，而没有任何东西会报错）。
 */
export const CHAIN_LOSS_SOLVER_KEY = "chain_loss_attribution";
export const CHAIN_LOSS_MATRIX_PATH = "/a/v1/sim/chain-loss-matrix";
export const CHAIN_LOSS_DRILL_PATH = "/a/v1/sim/chain-loss-drill";

export type DataSource = "endpoint" | "placeholder";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 环节 × 基地 热力矩阵
// ══════════════════════════════════════════════════════════════════════════

export interface HeatCellValue {
  /** 占**本列**（该基地全链非增值总量）的百分比 0–100。 */
  pct: number;
  /** 该环节在该基地链上的非增值天数。 */
  days: number;
}

export interface HeatMatrixModel {
  nodes: readonly { nodeId: string; label: string }[];
  bases: readonly { baseId: string; name: string }[];
  /**
   * `${nodeId}|${baseId}` → 有数据的格。**键不在 = 没数据**（渲染「—」），
   * 而不是「值是 0」—— 后端口径③明写空列返 `null` + `reason`，屏上这两件事必须分得开。
   */
  cells: ReadonlyMap<string, HeatCellValue>;
  /** `baseId` → 该列/该格没数据的原因（挂到 `title` 上，用户悬停读得到）。 */
  reasons: ReadonlyMap<string, string>;
  source: DataSource;
}

export const heatCellKey = (nodeId: string, baseId: string): string => `${nodeId}|${baseId}`;

/** 规格 `V[]`（8 环节 × 5 列）。**键位锚在契约上**，值只是占位百分比。 */
const PLACEHOLDER_HEAT = {
  "capacity.aging": [34, 18, 11, 9, 22],
  "material.kitting": [21, 26, 14, 7, 19],
  "capacity.qc_batch": [13, 9, 17, 6, 12],
  "capacity.quality": [6, 11, 8, 4, 7],
  "capacity.schedule": [5, 7, 6, 12, 7],
  "material.replenish": [4, 5, 9, 3, 5],
  "material.inbound_transit": [3, 4, 3, 8, 4],
  "delivery.transit": [2, 3, 2, 3, 3],
} satisfies Partial<Record<Rid, readonly number[]>>;

/**
 * 占位列 = 基地册前 4 条 + 「全网」汇总列。
 * ⚠ 规格写的是「常州/盐城/合肥/宜宾」，而 `BASE_REGISTRY` 里**没有盐城、没有宜宾**
 * （2026-08-21 实测 13 条：常州/厦门/成都/眉山/武汉/江门/合肥/信阳/枣庄/邯郸/自贡/金华/扬州）。
 * 规格那四个是占位文案，不是册里的基地 —— 照册取，不照规格抄一个不存在的基地名。
 *
 * **2026-08-23 现算复核仍是这 13 条、仍无盐城/宜宾。** 复验一条命令
 * （先 `pnpm --filter @platform/contracts build`；它读构建产物，不是抄这里的名单）：
 *   `node -e "const {BASE_REGISTRY:B}=require('./packages/contracts/dist/index.js');console.log(B.length, B.map(b=>b.name).join('/'))"`
 *   —— 现算打印 `13 常州/厦门/成都/眉山/武汉/江门/合肥/信阳/枣庄/邯郸/自贡/金华/扬州`。
 *   ⚠ 字段名是 `name` 不是 `label`（写错字段会打出一串空的 `/`，看着像"册里没名字"——那是命令写错了，不是册坏了）。
 * 规格那半边：`grep -n '盐城\|宜宾' docs/ux-spec/sandbox/sandbox-attr.html`
 *   —— 现算命中第 206 行 `var B=["常州","盐城","合肥","宜宾","全网"]`，即那四个名字的出处。
 */
const PLACEHOLDER_BASE_COUNT = 4;
const ALL_BASES_ID = "__all__";
const PLACEHOLDER_BASES: readonly { baseId: string; name: string }[] = [
  ...BASE_REGISTRY.slice(0, PLACEHOLDER_BASE_COUNT).map((b) => ({ baseId: b.baseId, name: b.name })),
  { baseId: ALL_BASES_ID, name: "全网" },
];

function placeholderHeat(): HeatMatrixModel {
  const cells = new Map<string, HeatCellValue>();
  const nodes: { nodeId: string; label: string }[] = [];
  for (const [nodeId, row] of Object.entries(PLACEHOLDER_HEAT)) {
    const def = chainNodeDef(nodeId);
    if (def === undefined) continue; // 册里没了这一条 ⇒ 不画一行编出来的（键位已被 TS 绑死，实际到不了这里）
    nodes.push({ nodeId, label: def.label });
    (row as readonly number[]).forEach((pct, i) => {
      const base = PLACEHOLDER_BASES[i];
      if (base === undefined) return;
      // 占位天数按规格瀑布图的换算（21.6 D 全链 ⇒ 1% ≈ 0.216 D）——与 §3 明细列同一口径。
      cells.set(heatCellKey(nodeId, base.baseId), { pct, days: pct * PLACEHOLDER_DAYS_PER_PCT });
    });
  }
  return { nodes, bases: PLACEHOLDER_BASES, cells, reasons: new Map(), source: "placeholder" };
}

/** 规格：全链非增值 21.6 D 对应 100% ⇒ 每 1% = 0.216 D。占位口径的**唯一**换算常数。 */
const PLACEHOLDER_DAYS_PER_PCT = 0.216;

/** 把端点回包投影成视图模型。空列的 `reason` 逐列登记，缺格**不补 0**。 */
export function projectHeatMatrix(res: ChainLossMatrixResult): HeatMatrixModel {
  const cells = new Map<string, HeatCellValue>();
  for (const c of res.cells) cells.set(heatCellKey(c.nodeId, c.baseId), { pct: c.pct, days: c.days });
  const reasons = new Map<string, string>();
  for (const t of res.colTotals) if (t.reason !== null) reasons.set(t.baseId, t.reason);
  return {
    // 站名仍走注册表：回包的 `label` 与册同源，但动态工序节点（`capacity.op.*`）不在册 ⇒ 用回包的。
    nodes: res.nodes.map((n) => ({ nodeId: n.nodeId, label: chainNodeDef(n.nodeId)?.label ?? n.label })),
    bases: res.bases.map((b) => ({ baseId: b.baseId, name: b.name })),
    cells,
    reasons,
    source: "endpoint",
  };
}

/**
 * 接 `POST /a/v1/sim/chain-loss-matrix`。
 * 失败 / 未回 ⇒ 落回规格占位，`source` 报 `"placeholder"`（调用方与测试都读得出）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WO-SIM-PARAM-WIRE ② · 实测结论：**`so` 的缺省不该由前端定，今天这样就是对的**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 派单给的线索是「宿主从不给 `so` ⇒ 缺口在谁来定那个 `so`」。逐条实测后**两半都要更正**：
 *
 * **(a) 「不给 `so` ⇒ 不发请求」不成立** —— 本 hook 的 `useQuery` **没有 `enabled` 判据**
 * （与本文件 `useChainLossDrill` / `useContributionSeries` 刻意不同）。`so` 缺席时照发，
 * body 走 `{}`。**2026-08-22 实测**（内存态真服务 `POST /a/v1/sim/chain-loss-matrix` body `{}`）：
 * `http=200 · nodes=18 · bases=13 · cells=234 · 有数据列 13/13 · 空列 0`。
 * 复验这一行（SEED_DEMO=1 起 datacore 之后，一条命令把这几个数一起打出来；
 * 回包顶层字段是 `nodes / bases / cells / colTotals / summary`，见 `solvers/chain-loss-matrix.ts` 的 `return`）：
 *   `curl -s -X POST -H 'Content-Type: application/json' -H 'X-Debug-User: demo:admin:admin|planner|catalog_admin' -d '{}' http://127.0.0.1:4001/a/v1/sim/chain-loss-matrix | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('nodes',m.nodes.length,'bases',m.bases.length,'cells',m.cells.length,'有数据列',m.colTotals.filter(c=>c.days!==null).length);console.log(m.summary)})"`
 *   —— 回包自带的 `summary` 里也写着同一组数（「N 个环节 × M 个基地，K 列有数据」），两处对得上才算复验到。
 * 所以热矩阵 / 根因树 / 明细 / 瀑布这四格今天**已经是真数据**，不是占位。
 *
 * **(b) 前端补一个缺省 `so` 会把这一页打坏，不是修好** —— 端点对 `so` 的语义是**收窄**
 * （`solvers/chain-loss-matrix.ts` 文件头原话：「给了 ⇒ 每列都只用**这一张单**……
 * 不给 ⇒ 每列各自取该基地 `so` 字典序第一张单」）。同一台服务上逐格对拍：
 *
 * | body | cells | 有数据列 | 每列锚点 |
 * |---|---|---|---|
 * | `{}`（今天） | **234** | **13 / 13** | 各列各自的字典序首张（changzhou→SO-3402 · hefei→SO-3391 · …） |
 * | `{"so":"SO-3391"}`（"取字典序首张 Order" 这条前端规则的产物） | **36** | **2 / 13** | 全 13 列共用 SO-3391，其余 11 列 `null`+`reason` |
 *
 * 即：那条看起来最"有出处"的前端缺省规则，实测会把矩阵从 234 格砍到 36 格、13 列砍到 2 列。
 *
 * **(c) 缺省口径已经在后端，且在对的一侧** —— 「按 `so` 字典序取第一张」这条规则
 * 后端**逐列**各跑一次（R6 全序，见该文件头「每列的锚点订单按 `so` 字典序取第一张」）。
 * 前端再写一份，就是同一条规则的**第二个实现**：两份一漂，屏上的数与后端算的对不上，
 * 而没有任何东西会报错。故本 hook **维持原样**：`so` 只从宿主取（`SandboxAttrRoute` 的
 * `view.options.so`），宿主没给就让后端按它自己那份口径挑。
 *
 * ⇒ **本单对 ② 的处置是「改文档不改代码」**：上面这张对拍表就是那份文档。
 */
export function useChainLossMatrix(so?: string): HeatMatrixModel {
  const q = useQuery({
    queryKey: ["a", "sim-chain-loss-matrix", so ?? ""],
    retry: false,
    queryFn: () => api.a<ChainLossMatrixResult>(CHAIN_LOSS_MATRIX_PATH, { body: so === undefined ? {} : { so } }),
  });
  return q.data === undefined ? placeholderHeat() : projectHeatMatrix(q.data);
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 根因树（下钻）
// ══════════════════════════════════════════════════════════════════════════

export interface RootCauseRow {
  /** 缩进层级：1 = 全链合计 · 2 = 环节 · 3 = 子因。 */
  level: 1 | 2 | 3;
  key: string;
  label: string;
  pct: number;
  /** 屏上右列的天数文案（`21.6 D`）。 */
  days: number;
  /** 规格 `.tn.hot`：吃掉损失最多的两个环节标红。 */
  hot: boolean;
}

export interface RootCauseModel {
  rows: readonly RootCauseRow[];
  /** 被展开下钻的那个环节（子因挂在它下面）。 */
  drilledNodeId: string | null;
  source: DataSource;
}

/** 规格 `D[]` 里 l2 行的顺序与占比（键位锚在契约上；`label` 现取注册表）。 */
const PLACEHOLDER_TREE_NODES = {
  "capacity.aging": 34,
  "material.kitting": 21,
  "capacity.qc_batch": 13,
  "capacity.quality": 6,
  "material.replenish": 4,
  "capacity.rccp": 4,
  "material.inbound_transit": 3,
  "demand.consensus": 3,
  "delivery.transit": 2,
} satisfies Partial<Record<Rid, number>>;

/**
 * 规格 `D[]` 里的 l3 子因（前三个环节各展开一层）。
 * 子因名**不是**在册 label（它们是执行单元级的因，端点回包里由 `ChainSubCause.label`
 * 从真实对象派生），故这里可以是字面量 —— 判据 L 只咬在册 label。
 */
const PLACEHOLDER_SUB_CAUSES = {
  "capacity.aging": [
    { label: "炉位不足", pct: 19 },
    { label: "批次拆分", pct: 11 },
    { label: "温控复检", pct: 4 },
  ],
  "material.kitting": [
    { label: "正极粉断供", pct: 12 },
    { label: "隔膜到货延迟", pct: 6 },
    { label: "拣配等待", pct: 3 },
  ],
  "capacity.qc_batch": [
    { label: "攒批阈值", pct: 8 },
    { label: "抽检返工", pct: 5 },
  ],
} satisfies Partial<Record<Rid, readonly { label: string; pct: number }[]>>;

/** 规格 l1 行：全链非增值 100% / 21.6 D。 */
const PLACEHOLDER_CHAIN_TOTAL_PCT = 100;
/** 规格 `D[]` 末行「其余 16 环节」。 */
const PLACEHOLDER_REST = { label: "其余 16 环节", pct: 10 };
/** 规格：吃掉损失最多的前 N 个环节标红（`.tn.hot`）。 */
const HOT_TOP_N = 2;

const daysOf = (pct: number): number => pct * PLACEHOLDER_DAYS_PER_PCT;

function placeholderTree(): RootCauseModel {
  const entries = Object.entries(PLACEHOLDER_TREE_NODES);
  const rows: RootCauseRow[] = [
    { level: 1, key: "chain", label: CHAIN_TOTAL_LABEL, pct: PLACEHOLDER_CHAIN_TOTAL_PCT, days: daysOf(PLACEHOLDER_CHAIN_TOTAL_PCT), hot: false },
  ];
  const subs: Record<string, readonly { label: string; pct: number }[]> = PLACEHOLDER_SUB_CAUSES;
  entries.forEach(([nodeId, pct], i) => {
    rows.push({ level: 2, key: nodeId, label: chainNodeDef(nodeId)?.label ?? nodeId, pct, days: daysOf(pct), hot: i < HOT_TOP_N });
    for (const s of subs[nodeId] ?? []) {
      rows.push({ level: 3, key: `${nodeId}::${s.label}`, label: s.label, pct: s.pct, days: daysOf(s.pct), hot: false });
    }
  });
  rows.push({ level: 2, key: "rest", label: PLACEHOLDER_REST.label, pct: PLACEHOLDER_REST.pct, days: daysOf(PLACEHOLDER_REST.pct), hot: false });
  return { rows, drilledNodeId: entries[0]?.[0] ?? null, source: "placeholder" };
}

/** 根节点行的名字。**不是在册 label**（"全链"不是一个环节），故可字面量。 */
const CHAIN_TOTAL_LABEL = "全链非增值";

/**
 * 接 `POST /a/v1/sim/chain-loss-drill`：矩阵的 `rowTotals` 给二级（环节），
 * drill 给三级（子因）。两者拼成一棵树 —— **两个端点各读各的会漂**，故收在同一个 hook 里。
 */
export function useChainLossDrill(heat: HeatMatrixModel, drilledNodeId: string | null, so?: string): RootCauseModel {
  const enabled = heat.source === "endpoint" && drilledNodeId !== null;
  const q = useQuery({
    queryKey: ["a", "sim-chain-loss-drill", drilledNodeId ?? "", so ?? ""],
    enabled,
    retry: false,
    queryFn: () =>
      api.a<ChainLossDrill>(CHAIN_LOSS_DRILL_PATH, {
        body: { nodeId: drilledNodeId as string, ...(so === undefined ? {} : { so }) },
      }),
  });
  if (heat.source !== "endpoint") return placeholderTree();

  // 二级 = 矩阵行合计（按占比降序）。天数取矩阵格子之和，占比取「占全矩阵」口径。
  const totals = heat.nodes
    .map((n) => {
      let pct = 0;
      let days = 0;
      for (const b of heat.bases) {
        const c = heat.cells.get(heatCellKey(n.nodeId, b.baseId));
        if (c === undefined) continue;
        pct += c.pct;
        days += c.days;
      }
      return { nodeId: n.nodeId, label: n.label, pct, days };
    })
    .sort((a, b) => b.pct - a.pct);
  const grand = totals.reduce((s, t) => s + t.pct, 0);
  const grandDays = totals.reduce((s, t) => s + t.days, 0);

  const rows: RootCauseRow[] = [
    { level: 1, key: "chain", label: CHAIN_TOTAL_LABEL, pct: PLACEHOLDER_CHAIN_TOTAL_PCT, days: grandDays, hot: false },
  ];
  totals.forEach((t, i) => {
    const pct = grand > 0 ? (100 * t.pct) / grand : 0;
    rows.push({ level: 2, key: t.nodeId, label: t.label, pct, days: t.days, hot: i < HOT_TOP_N });
    if (t.nodeId !== drilledNodeId || q.data === undefined) return;
    for (const s of q.data.subCauses) {
      rows.push({ level: 3, key: s.key, label: s.label, pct: s.pct, days: s.days, hot: false });
    }
  });
  return { rows, drilledNodeId, source: "endpoint" };
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 归因明细（右栏）
// ══════════════════════════════════════════════════════════════════════════

export interface AttrDetailRow {
  key: string;
  label: string;
  solverKey: string;
  pct: number;
  days: number;
  /** 影响级 1..4（绿 / 蓝 / 琥珀 / 红）。**由占比现分档**，不是端点字段。 */
  level: 1 | 2 | 3 | 4;
  /**
   * 迷你趋势条（8 格高度）。端点没有这一维 ⇒ 由 `key` 现算的确定性形状（R6：同键同形）。
   *
   * ⚠ **它不是数据，是形状** —— 端点回包里没有任何一维对应它，别把它读成趋势。
   * 「现算 + 同键同形」这两句 **2026-08-23 复核成立**，复验两条（都能亲手跑）：
   *  · 实现就一行，无状态、无随机、只吃下标：
   *    `grep -n 'export const sparkOf' apps/frontend-shell/src/views/sim/console/useLossAttribution.ts`
   *    （现算 `Array.from({ length: SPARK_BARS }, (_, k) => 2 + ((i * 7 + k * 5) % 9))`）；
   *  · R6 同输入同输出，跑两遍逐字节比：
   *    `node -e "const f=i=>Array.from({length:8},(_,k)=>2+((i*7+k*5)%9));console.log(JSON.stringify(f(3))===JSON.stringify(f(3)), JSON.stringify(f(3)))"`
   */
  spark: readonly number[];
  selected: boolean;
}

/** 影响级分档阈值（占全链损失的百分比）。**声明出来让人可以直接反对**，不藏在三元表达式里。 */
const LEVEL_CUTS: readonly [number, 1 | 2 | 3 | 4][] = [
  [20, 4],
  [10, 3],
  [5, 2],
];
export function levelOfPct(pct: number): 1 | 2 | 3 | 4 {
  for (const [cut, lv] of LEVEL_CUTS) if (pct >= cut) return lv;
  return 1;
}

/** 规格 `spk`：8 格、高度 `2 + ((i*7 + k*5) % 9)` px。行序由 `i` 决定 ⇒ 同输入同形状。 */
const SPARK_BARS = 8;
export const sparkOf = (i: number): number[] => Array.from({ length: SPARK_BARS }, (_, k) => 2 + ((i * 7 + k * 5) % 9));

/** 规格右栏 16 行（键位锚在契约上；值 = 占比）。 */
const PLACEHOLDER_DETAIL = {
  "capacity.aging": 34,
  "material.kitting": 21,
  "capacity.qc_batch": 13,
  "capacity.quality": 6,
  "capacity.schedule": 5,
  "material.replenish": 4,
  "material.inbound_transit": 3,
  "delivery.transit": 2,
  "delivery.acceptance": 2,
  "material.purchase_req": 2,
  "material.purchase_order": 1,
  "material.iqc": 1,
  "delivery.fg_stock": 1,
  "material.mrp": 1,
  "capacity.wo_release": 2,
  "capacity.maint": 2,
} satisfies Partial<Record<Rid, number>>;

export interface AttrDetailModel {
  rows: readonly AttrDetailRow[];
  source: DataSource;
}

/** 明细行由**矩阵行合计**投影而来（占比 = 占全矩阵，天数 = 该环节全基地合计）。 */
export function useAttrDetail(heat: HeatMatrixModel, selectedNodeId: string | null): AttrDetailModel {
  if (heat.source !== "endpoint") {
    return {
      rows: Object.entries(PLACEHOLDER_DETAIL).map(([nodeId, pct], i) => ({
        key: nodeId,
        label: chainNodeDef(nodeId)?.label ?? nodeId,
        solverKey: CHAIN_LOSS_SOLVER_KEY,
        pct,
        days: daysOf(pct),
        level: levelOfPct(pct),
        spark: sparkOf(i),
        selected: i === 0,
      })),
      source: "placeholder",
    };
  }
  const totals = heat.nodes
    .map((n) => {
      let pct = 0;
      let days = 0;
      for (const b of heat.bases) {
        const c = heat.cells.get(heatCellKey(n.nodeId, b.baseId));
        if (c === undefined) continue;
        pct += c.pct;
        days += c.days;
      }
      return { nodeId: n.nodeId, label: n.label, pct, days };
    })
    .sort((a, b) => b.pct - a.pct);
  const grand = totals.reduce((s, t) => s + t.pct, 0);
  return {
    rows: totals.map((t, i) => {
      const pct = grand > 0 ? (100 * t.pct) / grand : 0;
      return {
        key: t.nodeId,
        label: t.label,
        solverKey: CHAIN_LOSS_SOLVER_KEY,
        pct,
        days: t.days,
        level: levelOfPct(pct),
        spark: sparkOf(i),
        selected: selectedNodeId === null ? i === 0 : t.nodeId === selectedNodeId,
      };
    }),
    source: "endpoint",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 瀑布图
// ══════════════════════════════════════════════════════════════════════════

export type WaterfallKind = "anchor" | "high" | "mid" | "low";

export interface WaterfallBar {
  key: string;
  label: string;
  /** 天数（`anchor` 档是绝对值，其余是增量）。 */
  value: number;
  kind: WaterfallKind;
}

export interface WaterfallModel {
  bars: readonly WaterfallBar[];
  /** 起点（基线）与终点（合计）的天数 —— 两根 `anchor` 柱的高度。 */
  baseDays: number;
  totalDays: number;
  source: DataSource;
}

/** 规格瀑布：基线 18.4 D → 6 段增量 → 合计 21.6 D（`D[]` 的 1/10 即天）。 */
const PLACEHOLDER_WF_BASE_DAYS = 18.4;
const PLACEHOLDER_WF_TOTAL_DAYS = 21.6;
/** 规格瀑布的中间 6 段（前 5 段是环节 ⇒ 键位锚契约；末段「其余」是原创文案）。 */
const PLACEHOLDER_WF_STEPS = {
  "capacity.aging": 3.4,
  "material.kitting": 2.1,
  "capacity.qc_batch": 1.3,
  "capacity.quality": 0.6,
  "material.replenish": 0.4,
} satisfies Partial<Record<Rid, number>>;
const PLACEHOLDER_WF_REST = { label: "其余", days: 1.0 };

/**
 * 瀑布分档 = **按名次**，不按绝对天数。
 * 规格的着色规则是位置式的（前 2 段红 · 中间 3 段琥珀 · 末段「其余」青），
 * 而「其余」是一个**聚合桶**不是单个原因 —— 拿它的天数去和单个环节比档次，
 * 桶一大就会被染成红色，把「一堆小因加起来」读成「一个大因」。故：
 *   · 名次 < `WF_HIGH_RANK` ⇒ high（红）· 其余单环节 ⇒ mid（琥珀）· 聚合桶 ⇒ low（青）。
 */
const WF_HIGH_RANK = 2;
const wfKind = (rank: number): WaterfallKind => (rank < WF_HIGH_RANK ? "high" : "mid");
const WF_REST_KIND: WaterfallKind = "low";

/** 瀑布图取的是**同一份**热力矩阵（不另发请求）：屏上三块必须是同一个世界的三个视角。 */
export function useWaterfall(heat: HeatMatrixModel, tree: RootCauseModel): WaterfallModel {
  if (heat.source !== "endpoint") {
    return {
      bars: [
        ...Object.entries(PLACEHOLDER_WF_STEPS).map(([nodeId, days], i) => ({
          key: nodeId,
          label: chainNodeDef(nodeId)?.label ?? nodeId,
          value: days,
          kind: wfKind(i),
        })),
        { key: "rest", label: PLACEHOLDER_WF_REST.label, value: PLACEHOLDER_WF_REST.days, kind: WF_REST_KIND },
      ],
      baseDays: PLACEHOLDER_WF_BASE_DAYS,
      totalDays: PLACEHOLDER_WF_TOTAL_DAYS,
      source: "placeholder",
    };
  }
  const nodes = tree.rows.filter((r) => r.level === 2);
  const top = nodes.slice(0, PLACEHOLDER_WF_TOP_N);
  const restDays = nodes.slice(PLACEHOLDER_WF_TOP_N).reduce((s, r) => s + r.days, 0);
  const totalDays = nodes.reduce((s, r) => s + r.days, 0);
  const bars: WaterfallBar[] = top.map((r, i) => ({ key: r.key, label: r.label, value: r.days, kind: wfKind(i) }));
  if (restDays > 0) bars.push({ key: "rest", label: PLACEHOLDER_WF_REST.label, value: restDays, kind: WF_REST_KIND });
  return { bars, baseDays: Math.max(0, totalDays - bars.reduce((s, b) => s + b.value, 0)), totalDays, source: "endpoint" };
}

/** 规格中间段数（5 个环节 + 1 个「其余」）。 */
const PLACEHOLDER_WF_TOP_N = 5;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 底部贡献度时序
// ══════════════════════════════════════════════════════════════════════════

export type SeriesTone = "b" | "a" | "r" | "g" | "o";

export interface SeriesSegment {
  startPct: number;
  widthPct: number;
  tone: SeriesTone;
  label: string;
}

export interface SeriesRow {
  /** 竖排组名。**只在该组第一行给**，续行省略 = 与上一行同组。 */
  group?: string;
  key: string;
  name: string;
  /** 基线值（含单位；端点 `unit` 恒 `null` 是**已知诚实位**，故不追加单位，见文件头）。 */
  baseline: string;
  /** 扰动后值。 */
  after: string;
  /** `up` = 数变差（红）· `dn` = 数变好（绿）。 */
  direction: "up" | "dn";
  segments: readonly SeriesSegment[];
}

export interface SeriesModel {
  rows: readonly SeriesRow[];
  /**
   * 轨道刻度文本。**两种数据模式口径不同，别合成一句**（`WO-SIM-CONSOLE-DAYS`）：
   *  · **占位模式** ⇒ 规格那套墙钟时刻 `SERIES_TICKS`（`00:00`…`28:00`），像素 1:1 咬着它；
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
  /**
   * 诚实位：端点回包的 `metrics[].unit` **恒 `null`** —— 全仓没有「状态变量 → 单位」的登记册
   * （契约 `sim.ts` §指标时序 已实测记过这笔账）。屏上因此不带单位，**不许自己补一个**。
   */
  unitsKnown: boolean;
  source: DataSource;
}

/** 规格 `R[]` 里那 11 个环节行（键位锚契约）+ 末行「其余 13 环节」。值 = `[基线, 扰动后, 方向]`。 */
const PLACEHOLDER_SERIES_NODES = {
  "capacity.aging": ["5.1%", "34.0%", "up"],
  "material.kitting": ["7.2%", "21.0%", "up"],
  "capacity.qc_batch": ["9.4%", "13.0%", "up"],
  "capacity.quality": ["5.8%", "6.0%", "up"],
  "capacity.schedule": ["6.1%", "5.0%", "dn"],
  "material.replenish": ["4.4%", "4.0%", "dn"],
  "capacity.rccp": ["3.9%", "4.0%", "up"],
  "material.inbound_transit": ["3.2%", "3.0%", "dn"],
  "demand.consensus": ["3.4%", "3.0%", "dn"],
  "delivery.transit": ["2.6%", "2.0%", "dn"],
  "delivery.acceptance": ["2.1%", "2.0%", "dn"],
} satisfies Partial<Record<Rid, readonly [string, string, "up" | "dn"]>>;

const PLACEHOLDER_SERIES_REST: readonly [string, string, string, "up" | "dn"] = ["其余 13 环节", "46.8%", "10.0%", "dn"];

/** 规格 `R[].s[]` 的段模板（`[startPct, widthPct, tone, 文字]`）。逐行只差几个百分点，故按行序取模。 */
const PLACEHOLDER_SEGMENTS: readonly (readonly [number, number, SeriesTone, string])[][] = [
  [[2, 10, "o", "炉位排队"], [14, 18, "r", "批次拆分"], [34, 16, "r", "温控复检"], [54, 13, "g", "缓冲释放"], [72, 10, "o", "结转"]],
  [[3, 11, "o", "拣配等待"], [16, 17, "r", "正极粉断供"], [36, 14, "r", "隔膜延迟"], [54, 12, "g", "缓冲释放"], [71, 11, "o", "结转"]],
  [[2, 12, "o", "攒批阈值"], [16, 16, "a", "抽检返工"], [35, 15, "a", "复检"], [53, 13, "g", "缓冲释放"], [71, 10, "o", "结转"]],
  [[4, 9, "o", "首检"], [15, 17, "b", "返修排队"], [34, 16, "b", "复判"], [53, 12, "g", "缓冲释放"], [70, 11, "o", "结转"]],
  [[3, 10, "o", "算料"], [15, 15, "b", "下达"], [33, 17, "b", "执行"], [54, 11, "g", "缓冲释放"], [70, 12, "o", "结转"]],
  [[2, 11, "o", "请购"], [15, 16, "b", "采购下单"], [34, 15, "b", "入厂在途"], [53, 13, "g", "缓冲释放"], [71, 10, "o", "结转"]],
  [[3, 10, "o", "粗排"], [15, 16, "b", "瓶颈识别"], [34, 15, "b", "复核"], [53, 13, "g", "缓冲释放"], [71, 10, "o", "结转"]],
  [[3, 10, "o", "报关"], [15, 17, "b", "清关"], [35, 14, "b", "转运"], [52, 14, "g", "缓冲释放"], [71, 11, "o", "结转"]],
  [[2, 12, "o", "预告汇总"], [16, 14, "b", "共识"], [33, 17, "b", "锁量"], [53, 12, "g", "缓冲释放"], [70, 12, "o", "结转"]],
  [[2, 12, "o", "装车"], [16, 15, "b", "干线"], [34, 16, "b", "分拨"], [53, 12, "g", "缓冲释放"], [70, 12, "o", "结转"]],
  [[4, 9, "o", "到货"], [15, 16, "b", "验收"], [34, 16, "b", "签署"], [53, 13, "g", "缓冲释放"], [71, 10, "o", "结转"]],
  [[2, 11, "o", "混合"], [15, 17, "b", "混合"], [35, 15, "b", "混合"], [53, 13, "g", "缓冲释放"], [71, 11, "o", "结转"]],
];

/** 规格 `.vgrp`：两个竖排组名，第 1 组 6 行、第 2 组 6 行。 */
const PLACEHOLDER_GROUPS: readonly { title: string; count: number }[] = [
  { title: "贡献组1", count: 6 },
  { title: "贡献组2", count: 6 },
];

/** 规格 `.lh`：`for(i=0;i<=14;i++) String(i*2).padStart(2,"0")+":00"`。 */
export const SERIES_TICKS: readonly string[] = Array.from({ length: 15 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`);
/** 规格 `.play` 的 `left:43%`。 */
const PLAYHEAD_PCT = 43;

const segsAt = (i: number): readonly SeriesSegment[] =>
  (PLACEHOLDER_SEGMENTS[i % PLACEHOLDER_SEGMENTS.length] ?? []).map(([startPct, widthPct, tone, label]) => ({
    startPct,
    widthPct,
    tone,
    label,
  }));

function groupTitleAt(i: number): string | undefined {
  let at = 0;
  for (const g of PLACEHOLDER_GROUPS) {
    if (i === at) return g.title;
    at += g.count;
  }
  return undefined;
}

function placeholderSeries(): SeriesModel {
  const nodeRows = Object.entries(PLACEHOLDER_SERIES_NODES);
  const rows: SeriesRow[] = nodeRows.map(([nodeId, v], i) => {
    const title = groupTitleAt(i);
    return {
      ...(title === undefined ? {} : { group: title }),
      key: nodeId,
      name: chainNodeDef(nodeId)?.label ?? nodeId,
      baseline: v[0],
      after: v[1],
      direction: v[2],
      segments: segsAt(i),
    };
  });
  const title = groupTitleAt(nodeRows.length);
  rows.push({
    ...(title === undefined ? {} : { group: title }),
    key: "rest",
    name: PLACEHOLDER_SERIES_REST[0],
    baseline: PLACEHOLDER_SERIES_REST[1],
    after: PLACEHOLDER_SERIES_REST[2],
    direction: PLACEHOLDER_SERIES_REST[3],
    segments: segsAt(nodeRows.length),
  });
  return { rows, ticks: SERIES_TICKS, playheadPct: PLAYHEAD_PCT, unitsKnown: false, source: "placeholder" };
}

/** 端点 `segments[].source` → 屏上色调。`cadence`（建模方显式绑定）比 `domain`（按落域回落）强一档。 */
const SOURCE_TONE: Record<"cadence" | "domain", SeriesTone> = { cadence: "b", domain: "o" };

/** 数值格式化：端点给的是裸数，`unit` 恒 `null` ⇒ **不追加任何单位**（诚实位，见 `SeriesModel.unitsKnown`）。 */
const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : String(Math.round(v * 100) / 100));

/**
 * 接 `GET /a/v1/sim/sessions/:id/metric-series`。
 * 没有 sessionId ⇒ **不发请求**（不是发一个必然 404 的请求），落回规格占位。
 */
export function useContributionSeries(sessionId?: string): SeriesModel {
  const enabled = sessionId !== undefined && sessionId !== "";
  const q = useQuery({
    queryKey: ["a", "sim-metric-series", sessionId ?? ""],
    enabled,
    retry: false,
    queryFn: () =>
      api.a<SimMetricSeriesResponse>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId as string)}/metric-series`),
  });
  if (!enabled || q.data === undefined || q.data.metrics.length === 0) return placeholderSeries();

  const ticks = q.data.ticks;
  const span = Math.max(1, ticks.length - 1);
  const pctOf = (tick: number): number => {
    const i = ticks.indexOf(tick);
    return i < 0 ? 0 : (100 * i) / span;
  };
  const rows: SeriesRow[] = q.data.metrics.map((m, i) => {
    const title = groupTitleAt(i);
    const first = m.baseline.find((v) => v !== null);
    const last = [...m.actual].reverse().find((v) => v !== null);
    const worse = (last ?? 0) >= (first ?? 0);
    return {
      ...(title === undefined ? {} : { group: title }),
      key: m.key,
      name: m.label,
      baseline: fmt(first),
      after: fmt(last),
      direction: worse ? "up" : "dn",
      segments: m.segments.map((s) => ({
        startPct: pctOf(s.fromTick),
        widthPct: Math.max(0, pctOf(s.toTick) - pctOf(s.fromTick)),
        tone: SOURCE_TONE[s.source],
        label: s.label,
      })),
    };
  });
  return {
    rows,
    // 回包的 tick 序号 → **按天**的轴标签（`WO-SIM-CONSOLE-DAYS`）。口径 `tickDays` 随回包下发
    // （契约选的方案 A，理由见 `tickAxis.ts` 头注），换算与措辞的唯一实现在同目录 `tickAxis.ts`
    // （它再往下转调契约的 `daysForTicks`）——**别在这里 map 一份出来**。
    ticks: tickAxisLabels(ticks, q.data.tickDays),
    tickDays: tickDaysOf(q.data.tickDays),
    playheadPct: PLAYHEAD_PCT,
    // 契约明写 `unit` 恒 `null`；真有一天登记了单位，这一位自己会翻。
    unitsKnown: q.data.metrics.some((m) => m.unit !== null),
    source: "endpoint",
  };
}

/** 竖排组名的**逐字**拆分（派单硬约束②：不许 `writing-mode`，容器字体无竖排度量会叠成黑块）。 */
export const verticalChars = (s: string): string[] => [...s];

/** 页面上「环节」一列的表头等固定文案在组件里；本文件只出数据。册长导出给测试当金丝雀用。 */
export const CHAIN_NODE_COUNT = CHAIN_NODE_REGISTRY.length;
