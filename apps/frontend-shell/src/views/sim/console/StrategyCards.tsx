import { useQuery } from "@tanstack/react-query";
import { invokeSolver } from "@/api/endpoints";
import styles from "./SandboxDetail.module.css";

/**
 * WO-SIM-FE-DETAIL · 「应对策略」三档卡片（规格 `docs/ux-spec/sandbox/sandbox-detail.html` 的 `.stk` 段）。
 *
 * ── 版面 ────────────────────────────────────────────────────────────────────
 * 逐值移植，一个 px 都不许自己定：`.stk` / `.sc` / `.sc .r1|.r2|.r3` / `.bars s` / `.pct` / `.abtn`
 * 全在 `SandboxDetail.module.css` 里，与规格 `<style>` 段逐条对账（见 `sandbox-detail-pixel.test.tsx`）。
 *
 * ── 数据 ────────────────────────────────────────────────────────────────────
 * 真出处 = 求解器 `mitigation_select`（**今天就有**：`apps/datacore/src/solvers/extended.ts`
 * 的 `MITIGATION_LIB`，经 `POST /a/v1/solvers/mitigation_select/invoke`）。
 * 它下发 `plans[]{key,name,eff,tn,cost,risk?,score}` 与 `recommended`。
 *
 * **照实说这一格接了多少**（本仓纪律：不许拿"接了线"盖住"只接了一半"）：
 *   · **策略类型（卡面主名）** ← `plans[].name`，真数据；
 *   · **推荐是哪一档** ← `recommended`，真数据；
 *   · **排序** ← `score` 降序，真数据；
 *   · **达成度 %** ← `round(100 × score / maxScore)`，即"该案综合评分相对最优案"。
 *     这是一个**声明出来的投影**，不是求解器的原生字段 —— 故 `provenance.attainment = "derived"`。
 *   · **残差比 %** ← 求解器**没有这个字段**。
 *
 * ══ WO-SIM-HONEST-FALLBACK-A · 今天的行为是 X，应该是 Y ═══════════════════════
 *
 * **X（改造前）**：没给基地/因素、求解器没答、或答了零方案时，一律回一套**编出来的三档**
 * （缓冲释放 80%/60% · 跨基地借调 15%/85% · 外协兜底 40%/60%，逐值抄自规格 HTML），
 * 还带着「推荐」徽标和一个可点的「应用策略」按钮 —— 屏上**推荐了一个从未被求解过的方案**。
 * 残差比那一格更糟：求解器根本没有这个字段，屏上却印着 `80 %`（provenance 标了 placeholder，
 * 但那是 `data-*` 属性，**用户看不见**）。
 *
 * **Y（现在）**：
 *   · 没有出处的数一律 `null` ⇒ 屏上印 `—`（残差比从此**永远**是 `—`：求解器就是没这一格）；
 *   · 三张空卡还在（`.stk` 的高度由三张卡定，塌了整块传导识别页会跳），但卡面主名换成
 *     **说人话的原因**，达成度条 0 格；
 *   · 「推荐」徽标与可点的按钮**只在真有求解结果时才出现**。空态下 `.abtn` 仍在（它是版面锚点，
 *     `sandbox-detail-pixel.test.tsx` 用例 ③ 拿它当色值抽查点），但**不可点**、无 `onApply`，
 *     并带 `data-enabled="0"` —— 「有一个可以应用的推荐」这句话没有出处时不许说。
 *
 * provenance 走 `data-*` 属性而不是屏上文字：本页的验收线是**像素级 1:1**，
 * 往版面里塞一行"占位"会当场破坏它。属性对测试可见、对像素不可见，两头都不骗 ——
 * 但**它不能替代屏上的诚实**（上面 X 那一段就是反例：属性说了实话，屏上照样在撒谎）。
 */
export type CardProvenance = "solver" | "derived" | "placeholder";

export interface StrategyCard {
  key: string;
  /** 策略类型（卡面主名）。 */
  name: string;
  /**
   * 残差比（%·`.r2 em`）。**`null` = 没有这个数**（屏上印 `—`），不是 0 ——
   * 求解器 `mitigation_select` 就是没有这一格，所以真数据模式下它也恒 `null`。
   */
  residualPct: number | null;
  /** 达成度（%·`.r3 .pct`）。`null` = 没有这个数（屏上印 `—`）。 */
  attainmentPct: number | null;
  /** 达成度条：n 格中亮 k 格（`.bars s` / `.bars s.off`）。 */
  bars: { n: number; k: number };
  /** 口径来源标签（`.r3` 里那行 9px 小字）。 */
  basis: string;
  /** 推荐档：加 `.sc.on` + `推荐` 徽标 + 可点的 `应用策略` 按钮。**空态一律 false**。 */
  recommended: boolean;
  provenance: { name: CardProvenance; attainmentPct: CardProvenance; residualPct: CardProvenance };
  /** 空卡才有：整卡 `title` 挂的完整原因（卡面主名放的是它的短句版，卡宽只有 250px）。 */
  emptyReason?: string;
}

/** 达成度条的格数 —— **版面常量**（规格 `.bars` 就是 12 格），不是业务量。 */
const CARD_BARS_N = 12;

/** 空卡的键前缀。屏上不出现，只当 React key / `data-testid` 后缀。 */
const EMPTY_CARD_KEY = "__empty";

/** 没有数时格子里印的东西（与 `useLossAttribution.ts` 的 `EMPTY_CELL`、`HeatMatrix.tsx` 的空格同字符）。 */
const EMPTY_CELL = "—";

/**
 * 四条空态原因。**短句**：卡宽 250px、`.r2 b` 11px ⇒ 约 20 个汉字封顶，
 * 长句会把「残差比」那一格挤出卡外。完整原因挂在整卡 `title` 上，悬停读得到。
 *
 * 判据同 `useLossAttribution.ts` 的 `EMPTY_REASON`：说人话（零内部符号名）、四条互不相同
 * —— 「没在问」（还没选基地/因素）与「问了但没有」（求解器答了零方案）是两件事。
 */
export const CARD_EMPTY_REASON = {
  notAsked: { short: "还没选定基地与风险因素", full: "还没选定要给哪个基地、防哪类风险，所以没去求解" },
  loading: { short: "正在求解", full: "正在求解，还没算完" },
  noAnswer: { short: "求解没答上来", full: "没取到数：求解这一跳没答上来" },
  empty: { short: "求解器没给出方案", full: "求解器算过了，这一格没有可选的应对方案" },
} as const;

export type CardEmptyReason = (typeof CARD_EMPTY_REASON)[keyof typeof CARD_EMPTY_REASON];

/**
 * 空卡骨架：**三张卡还在，一个数都没有**。
 *
 * 为什么仍是三张：`.stk` 那一列的高度按三张卡定（规格 `.bb` 第一列），少一张整块传导识别页
 * 的右半会往上跳。三元组类型让"少一张/多一张"在编译期就红。
 * 卡面主名只在第一张给原因，其余两张印 `—` —— 三张都写同一句话是噪声，而 `title` 三张都挂。
 */
export function emptyStrategyCards(reason: CardEmptyReason): [StrategyCard, StrategyCard, StrategyCard] {
  const one = (i: number): StrategyCard => ({
    key: `${EMPTY_CARD_KEY}${i}`,
    name: i === 0 ? reason.short : EMPTY_CELL,
    residualPct: null,
    attainmentPct: null,
    bars: { n: CARD_BARS_N, k: 0 },
    basis: EMPTY_CELL,
    recommended: false,
    provenance: { name: "placeholder", attainmentPct: "placeholder", residualPct: "placeholder" },
    emptyReason: reason.full,
  });
  return [one(0), one(1), one(2)];
}

/**
 * 名字是**历史包袱**（`sandbox-detail-pixel.test.tsx` 按这个名字 import，那份测试本单不许改），
 * 今天它的内容已经不是"规格那三档编出来的数"，而是**空卡骨架**：全 `null` + `—`。
 */
export const PLACEHOLDER_STRATEGY_CARDS: readonly [StrategyCard, StrategyCard, StrategyCard] =
  emptyStrategyCards(CARD_EMPTY_REASON.notAsked);

interface MitigationPlan {
  key: string;
  name: string;
  eff: number;
  tn: number;
  cost: string;
  risk?: string;
  score: number;
}

export interface MitigationArgs {
  baseName: string;
  factor: string;
  tightness?: number;
}

/** 求解器给的那三档。**求解器没有的格子一律 `null`（屏上 `—`），不拿占位数顶上去**。 */
const SOLVER_BASIS = "来自求解器";

/** `mitigation_select` 的解 → 三档卡片。 */
export function projectMitigationCards(
  plans: readonly MitigationPlan[],
  recommended: string | undefined,
): StrategyCard[] {
  const ranked = [...plans].sort((a, b) => b.score - a.score).slice(0, PLACEHOLDER_STRATEGY_CARDS.length);
  // 一个方案都没排出来 ⇒ 这是「求解器算过了、没有可选方案」，与「还没去问」是两件事。
  if (ranked.length === 0) return [...emptyStrategyCards(CARD_EMPTY_REASON.empty)];
  const maxScore = Math.max(...ranked.map((p) => p.score), 0);
  return ranked.map((p, i) => {
    // 全体并列 0 分 ⇒ 「相对最优案的达成度」这个投影本身没有定义 ⇒ 诚实缺席，不回落到某个占位数。
    const attainmentPct = maxScore > 0 ? Math.round((100 * p.score) / maxScore) : null;
    const n = CARD_BARS_N;
    return {
      key: p.key,
      name: p.name,
      // 求解器没有残差比这一格 —— **印 `—`**。改造前这里回落到规格占位的 `80 %`，
      // provenance 虽标了 placeholder，但那是属性，用户看不见（见文件头 X 那段）。
      residualPct: null,
      attainmentPct,
      bars: { n, k: attainmentPct === null ? 0 : Math.max(0, Math.min(n, Math.round((attainmentPct / 100) * n))) },
      basis: SOLVER_BASIS,
      recommended: recommended !== undefined ? p.key === recommended : i === 0,
      provenance: { name: "solver", attainmentPct: attainmentPct === null ? "placeholder" : "derived", residualPct: "placeholder" },
    };
  });
}

/**
 * 接 `mitigation_select`。**四态各回各的**（本单的标的）：
 *   · `args` 缺省（宿主还没选定基地/因素）⇒ **不发请求** ⇒ `notAsked`；
 *   · 请求在飞 ⇒ `loading`；· 请求失败 ⇒ `noAnswer`；· 答了但零方案 ⇒ `empty`。
 * 四态从前塌成同一句「回规格那三档编出来的数」，用户无从分辨（见文件头 X 那段）。
 */
export function useMitigationCards(args?: MitigationArgs): {
  cards: StrategyCard[];
  source: "solver" | "placeholder";
  isLoading: boolean;
} {
  const enabled = args !== undefined && args.baseName !== "" && args.factor !== "";
  const q = useQuery({
    queryKey: ["a", "mitigation_select", args?.baseName ?? "", args?.factor ?? "", args?.tightness ?? null],
    enabled,
    retry: false,
    queryFn: async () => {
      const res = await invokeSolver("mitigation_select", {
        baseName: args?.baseName,
        factor: args?.factor,
        ...(args?.tightness === undefined ? {} : { tightness: args.tightness }),
      });
      return res.data as { plans?: MitigationPlan[]; recommended?: string };
    },
  });
  const empty = (reason: CardEmptyReason, isLoading = false) => ({
    cards: [...emptyStrategyCards(reason)],
    source: "placeholder" as const,
    isLoading,
  });
  if (!enabled) return empty(CARD_EMPTY_REASON.notAsked);
  if (q.isError) return empty(CARD_EMPTY_REASON.noAnswer);
  if (q.data === undefined) return empty(CARD_EMPTY_REASON.loading, true);
  const plans = q.data.plans ?? [];
  if (plans.length === 0) return empty(CARD_EMPTY_REASON.empty);
  return { cards: projectMitigationCards(plans, q.data.recommended), source: "solver", isLoading: false };
}

function Bars({ n, k }: { n: number; k: number }) {
  return (
    <span className={styles.bars}>
      {Array.from({ length: n }, (_, i) => (
        <s key={i} className={i < k ? undefined : styles.off} />
      ))}
    </span>
  );
}

/** 有出处就印数，没出处就印 `—`。**不许在这里补 0** —— 「没有」和「是 0」是两个相反的结论。 */
const pctText = (v: number | null): string => (v === null ? EMPTY_CELL : `${v} %`);

/**
 * 规格 `.stk`：三张卡竖排。
 *
 * `应用策略` 按钮（`.abtn`）**恒在**：它是版面锚点（三张卡的高度、以及 `.bb` 第一列的高度
 * 都按"带按钮"算；`sandbox-detail-pixel.test.tsx` 用例 ③ 还拿它当色值抽查点）。
 * 但**可点与否分两态**：只有真有求解结果的那张推荐卡可点；空态下按钮挂在第一张卡上、
 * `aria-disabled` + 无 `onClick` + `data-enabled="0"` —— 版面在，承诺不在。
 */
export function StrategyCards({
  cards,
  source,
  onApply,
}: {
  cards: readonly StrategyCard[];
  source: "solver" | "placeholder";
  onApply?: (card: StrategyCard) => void;
}) {
  // 按钮挂在哪张卡上：有推荐就挂推荐那张（可点）；一张都没推荐（空态）就挂第一张（不可点）。
  const recommendedAt = cards.findIndex((c) => c.recommended);
  const actionAt = recommendedAt >= 0 ? recommendedAt : 0;
  return (
    <div className={styles.stk} data-testid="sandbox-detail-strategies" data-source={source}>
      {cards.map((c, i) => {
        const actionable = c.recommended && onApply !== undefined;
        return (
          <div
            key={c.key}
            className={c.recommended ? `${styles.sc} ${styles.on}` : styles.sc}
            data-testid={`sandbox-detail-strategy-${c.key}`}
            data-recommended={c.recommended ? "1" : "0"}
            data-prov-name={c.provenance.name}
            data-prov-attainment={c.provenance.attainmentPct}
            data-prov-residual={c.provenance.residualPct}
            {...(c.emptyReason === undefined ? {} : { title: c.emptyReason })}
          >
            {c.recommended ? <span className={styles.tag}>推荐</span> : null}
            <div className={styles.r1}>
              <span>策略类型</span>
              <span>残差比</span>
              <u>达成度</u>
            </div>
            <div className={styles.r2}>
              <b>{c.name}</b>
              <em style={{ marginLeft: "auto" }}>{pctText(c.residualPct)}</em>
            </div>
            <div className={styles.r3}>
              <span style={{ fontSize: 9, color: "var(--txt)" }}>{c.basis}</span>
              <Bars n={c.bars.n} k={c.bars.k} />
              <span className={styles.pct}>{pctText(c.attainmentPct)}</span>
            </div>
            {i === actionAt ? (
              <div
                className={styles.abtn}
                data-testid="sandbox-detail-apply"
                data-enabled={actionable ? "1" : "0"}
                aria-disabled={actionable ? undefined : true}
                onClick={actionable ? () => (onApply as (card: StrategyCard) => void)(c) : undefined}
              >
                应用策略
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
