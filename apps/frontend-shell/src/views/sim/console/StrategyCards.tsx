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
 *   · **残差比 %** ← 求解器**没有这个字段**。不编，保留规格占位值并标 `"placeholder"`。
 *     等 `WO-SIM-BE-DRILL` 的节点详情端点把残差口径带出来再换掉整套（README 的告诫：
 *     "接真数据时整套换掉，别只换一半 —— 换一半屏上就自相矛盾"）。
 *
 * provenance 走 `data-*` 属性而不是屏上文字：本页的验收线是**像素级 1:1**，
 * 往版面里塞一行"占位"会当场破坏它。属性对测试可见、对像素不可见，两头都不骗。
 */

export type CardProvenance = "solver" | "derived" | "placeholder";

export interface StrategyCard {
  key: string;
  /** 策略类型（卡面主名）。 */
  name: string;
  /** 残差比（%·`.r2 em`）。 */
  residualPct: number;
  /** 达成度（%·`.r3 .pct`）。 */
  attainmentPct: number;
  /** 达成度条：n 格中亮 k 格（`.bars s` / `.bars s.off`）。 */
  bars: { n: number; k: number };
  /** 口径来源标签（`.r3` 里那行 9px 小字）。 */
  basis: string;
  /** 推荐档：加 `.sc.on` + `推荐` 徽标 + `应用策略` 按钮。 */
  recommended: boolean;
  provenance: { name: CardProvenance; attainmentPct: CardProvenance; residualPct: CardProvenance };
}

/**
 * 规格里那三档（`sandbox-detail.html` 的 `.stk` 段逐值抄下来，占位数集中在这一处）。
 * 写成**三元组**而非数组：规格的 `.bb` 第一列高度就是按三张卡定的，
 * 元组类型让"少一张/多一张"在编译期就红，而不是等到像素比对时才看出来。
 */
export const PLACEHOLDER_STRATEGY_CARDS: readonly [StrategyCard, StrategyCard, StrategyCard] = [
  {
    key: "buffer_release",
    name: "缓冲释放",
    residualPct: 80,
    attainmentPct: 60,
    bars: { n: 12, k: 7 },
    basis: "DATA·SOP",
    recommended: false,
    provenance: { name: "placeholder", attainmentPct: "placeholder", residualPct: "placeholder" },
  },
  {
    key: "cross_train",
    name: "跨基地借调",
    residualPct: 15,
    attainmentPct: 85,
    bars: { n: 12, k: 10 },
    basis: "DATA·PR",
    recommended: true,
    provenance: { name: "placeholder", attainmentPct: "placeholder", residualPct: "placeholder" },
  },
  {
    key: "outsource_step",
    name: "外协兜底",
    residualPct: 40,
    attainmentPct: 60,
    bars: { n: 12, k: 7 },
    basis: "DATA·PR",
    recommended: false,
    provenance: { name: "placeholder", attainmentPct: "placeholder", residualPct: "placeholder" },
  },
];

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

/** `mitigation_select` 的解 → 三档卡片。缺的格保留规格占位值并逐格标记出处。 */
export function projectMitigationCards(
  plans: readonly MitigationPlan[],
  recommended: string | undefined,
): StrategyCard[] {
  const ranked = [...plans].sort((a, b) => b.score - a.score).slice(0, PLACEHOLDER_STRATEGY_CARDS.length);
  if (ranked.length === 0) return [...PLACEHOLDER_STRATEGY_CARDS];
  const maxScore = Math.max(...ranked.map((p) => p.score), 0);
  return ranked.map((p, i) => {
    const fallback = PLACEHOLDER_STRATEGY_CARDS[i] ?? PLACEHOLDER_STRATEGY_CARDS[0];
    const attainmentPct = maxScore > 0 ? Math.round((100 * p.score) / maxScore) : fallback.attainmentPct;
    const n = fallback.bars.n;
    return {
      key: p.key,
      name: p.name,
      // 求解器没有残差比这一格 —— 保留占位并标记，见文件头。
      residualPct: fallback.residualPct,
      attainmentPct,
      bars: { n, k: Math.max(0, Math.min(n, Math.round((attainmentPct / 100) * n))) },
      basis: fallback.basis,
      recommended: recommended !== undefined ? p.key === recommended : i === 0,
      provenance: { name: "solver", attainmentPct: "derived", residualPct: "placeholder" },
    };
  });
}

/**
 * 接 `mitigation_select`。`args` 缺省（宿主还没选定基地/因素）⇒ **不发请求**，用规格占位值。
 * 请求失败 ⇒ 同样落回占位，但 `source` 报 `"placeholder"`，调用方/测试读得出「这不是真数据」。
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
  const plans = q.data?.plans ?? [];
  if (!enabled || plans.length === 0) {
    return { cards: [...PLACEHOLDER_STRATEGY_CARDS], source: "placeholder", isLoading: enabled && q.isLoading };
  }
  return { cards: projectMitigationCards(plans, q.data?.recommended), source: "solver", isLoading: false };
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

/** 规格 `.stk`：三张卡竖排（含推荐档的 `推荐` 徽标与 `应用策略` 按钮）。 */
export function StrategyCards({
  cards,
  source,
  onApply,
}: {
  cards: readonly StrategyCard[];
  source: "solver" | "placeholder";
  onApply?: (card: StrategyCard) => void;
}) {
  return (
    <div className={styles.stk} data-testid="sandbox-detail-strategies" data-source={source}>
      {cards.map((c) => (
        <div
          key={c.key}
          className={c.recommended ? `${styles.sc} ${styles.on}` : styles.sc}
          data-testid={`sandbox-detail-strategy-${c.key}`}
          data-recommended={c.recommended ? "1" : "0"}
          data-prov-name={c.provenance.name}
          data-prov-attainment={c.provenance.attainmentPct}
          data-prov-residual={c.provenance.residualPct}
        >
          {c.recommended ? <span className={styles.tag}>推荐</span> : null}
          <div className={styles.r1}>
            <span>策略类型</span>
            <span>残差比</span>
            <u>达成度</u>
          </div>
          <div className={styles.r2}>
            <b>{c.name}</b>
            <em style={{ marginLeft: "auto" }}>{c.residualPct} %</em>
          </div>
          <div className={styles.r3}>
            <span style={{ fontSize: 9, color: "var(--txt)" }}>{c.basis}</span>
            <Bars n={c.bars.n} k={c.bars.k} />
            <span className={styles.pct}>{c.attainmentPct} %</span>
          </div>
          {c.recommended ? (
            <div className={styles.abtn} onClick={onApply === undefined ? undefined : () => onApply(c)}>
              应用策略
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
