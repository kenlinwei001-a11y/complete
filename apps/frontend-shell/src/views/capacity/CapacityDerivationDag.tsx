import { useState, type CSSProperties } from "react";
import { useLiveSolver } from "../sim/useLiveSolver";
import { InfoPopover } from "@/components/InfoPopover";
import rk from "../RiskBoardView.module.css";
import styles from "./CapacityDerivationDag.module.css";
import zh from "@/locales/zh";
import { Provenance } from "@/components/Provenance";
import { ONTO_FACTORS, layerOf, type OntoFactor } from "./factorOntology";
// WO-UNIT-MEANING：张力 0–100 量程单源（原裸 Math.round(v) 无量程·用户无从判断满分与方向）。
import { formatTightness } from "@platform/contracts";

/**
 * WO-CAPACITY-DEEPEN-ADDITIVE 块A · 派生诊断（插在 ③BaseOutlookPanel 之上·不替代四线图）。
 *
 * 把"前瞻那个可用产能数（available）自下而上怎么算出来的" 6 层派生显式画出来：
 *   设备 → 工序 → 产线 → 可投 → 预测 → 缺口
 * 数据全接真求解器（R13 每值可溯）：
 *   base_capacity_outlook（available/gap·锚定"可投/预测/缺口"层真值）+ bottleneck_matrix（各工序 tightness/OEE·锚定设备/工序/产线层瓶颈）。
 *
 * ── WO-CAPACITY-CARD-LAYOUT（2026-08-10）：行式 → 卡片式 ──────────────────────
 * 判据 = `docs/CONVENTION-ui-information-layering.md` §5。原来 6 个占满宽度（~2000px）的横条
 * 同时踩了三条硬伤，逐条对应本次改法：
 *
 *   R-UI-1 视线距离  层名在最左、数值在最右、中间 1800px 是公式与空白
 *                    → 6 张卡，层名 / 数值 / 状态挤在同一张卡内（视线距离 ≤ 一张卡宽）。
 *   R-UI-2 字号层级  `18,819 套`（结论）与 `节拍×OEE×通道×班次`（口径）视觉权重相同
 *                    → 三级字号 `CAP_TYPE_SCALE`，**最大一级只给第 6 层 产能缺口**（本页要回答的那个数）。
 *   R-UI-3 公式常驻  → 全部进 `?` 浮层（`InfoPopover`，**不是**原生 `title`／SVG `<title>`）。
 *
 * §3「结构本身也要表达」：这 6 层是一条**推导链**，只把六行变六格而不体现递进 = 没改。
 * 递进用**三个互不依赖的承载物**同时表达（任缺其一，另两个仍成立、测试仍咬得住）：
 *   ① `cap-dag-link-{n}-{n+1}` 连接箭头（卡与卡之间的真 DOM 元素）
 *   ② `cap-dag-rungs-{n}` 梯级条（6 格递增高度、前 n 格点亮 —— 换行后也带着"第几级"）
 *   ③ `data-step` / `data-derives-from` / `data-derives-to` + 卡面 aria-label 写明"由第几层推出"
 *
 * 三层分工（规范 §0）：**卡面回答「怎么样」· 明细回答「具体是什么」· `?` 浮层回答「凭什么」**。
 * 诚实位那句话（口径与溯源）**降到面板头的 `?` 浮层，一字未删**，第一层留 `cap-dag-honesty-mark`
 * 这个可见记号 —— 静默降层等于删除（规范 §1）。
 *
 * 只用现有 CSS 变量（--c-capacity/--c-forecast/--c-solver/--ok/--accent/--danger/--muted/--muted2/--panel/--line2）·禁新色值
 * ⇒ 暗色 / 冷蓝(light) / 亮橙(warm) 三套主题自动跟随。
 */

interface Prov { kind: string; drillType: string; drillField: string; drillValue: number }
interface OutlookLine { key: string; value: number; provenance: Prov }
/**
 * ⚠ `demand` 原先**不在这个接口里** —— 引擎 `solvers/base-outlook.ts` 的 `HorizonOutlook`
 * 一直在下发它（`gap = available − demand`），是前端漏读了。
 * 少了它，第 6 层的缺口**没有分母**：屏上「可用 12,960 / 缺口 88,434」，
 * 缺口是可用的 6.8 倍，用户第一反应是"这数对吗"，而系统没给他核对的依据。
 * optional 是为了向后兼容老引擎回包 —— 缺了就**如实报缺**，不推算、不留空。
 */
interface Horizon { available: number; gap: number; demand?: number; status: string; lines: OutlookLine[] }
interface Outlook { baseName: string; horizons: Horizon[] }
interface BnRow { base: string; tightness: Record<string, number>; primary: string; provenanceSynthetic?: boolean }
interface Bn { factors: string[]; rows: BnRow[]; dataMode?: string }

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * R-UI-2 · **一屏之内只有三级字号**，且最大一级只给「这一页要回答的那个数」。
 * 导出是刻意的：测试直接拿这份常量断言"第 6 层的数值元素字号 > 其余"，
 * 不在测试里抄一份魔数（抄了就会与实现漂开，改实现测试照绿）。
 */
export const CAP_TYPE_SCALE = {
  /** 一级 · 结论：第 6 层 产能缺口 —— 全页最大，且**只有它**这么大。 */
  hero: 28,
  /** 二级 · 其余五层的主数值。 */
  value: 19,
  /** 三级 · 标题 / 标签 / 辅助说明（走 CSS module，不在此处逐个内联）。 */
  label: 12,
} as const;

/** 链上最后一层 = 本页要回答的那个数（缺口/富余）。字号一级只给它。 */
const ANSWER_LAYER = 6;

/**
 * 梯级条第 i 格的高度（px）—— 递进承载物②「阶梯」的级差。
 * 真浏览器实拍复核后从 `2 + i×1.6` 改成 `2 + i×2.6`：原级差在 1600px 视口下
 * 六格几乎一样高，阶梯信号形同没有（jsdom 不做布局，这条只有实拍才看得见）。
 * 与 CSS 里 `.rungs { height }` 同源：改这里须同步那里（最高一级 = RUNG(6) ≈ 18）。
 */
const rungHeight = (i: number) => 2 + i * 2.6;

/**
 * WO-GSIM-3 灰数据修（G-DATAMODE-PROV 残口·产线派生 DAG 恒灰）：张力值 → 冷暖热力色。
 * 灰(v==null·无 LIVE 真源) vs 有真值即按幅度冷蓝→暖红上色 → 改 Equipment.oee_current 使 bottleneck_matrix
 * 张力真变 → 本层锚点格**真变色**（非恒灰·SEAM §5.4）。张力口径 0–100（越高越紧）。
 */
function tightColor(v: number | null): string {
  if (v == null) return "var(--muted2)"; // 无 LIVE 真源 → 诚实灰（不伪造热度）
  const u = Math.max(0, Math.min(100, v)) / 100;
  if (u >= 0.9) return "var(--danger)";
  if (u >= 0.75) return "var(--c-forecast)";
  if (u >= 0.55) return "var(--accent)";
  return "var(--ok)";
}

type StatusKey = "ok" | "warn" | "crit" | "derived" | "na";
/**
 * 状态的**形状**通道 —— 与颜色并行，不靠颜色单通道（色觉障碍 / 灰度打印仍可辨）。
 * 再叠一条文字通道（`zh.capDag.status.*`）⇒ 颜色 · 形状 · 文字三通道同时说同一件事。
 */
const STATUS_GLYPH: Record<StatusKey, string> = { ok: "●", warn: "▲", crit: "◆", derived: "○", na: "○" };

/** 张力(0–100) → 状态键。分档与 `tightColor` **同序**（颜色与形状不会互相打架）。 */
function tightStatus(v: number | null): StatusKey {
  if (v == null) return "na";
  if (v >= 90) return "crit";
  if (v >= 55) return "warn";
  return "ok";
}

/** 每层驱动因素圈号（沿产能金字塔·factorOntology 单源）+ 该层锚点数据来源。 */
const LAYER_SPEC: { layer: number; marks: string[]; anchor: "bnOEE" | "bnYield" | "bnPrimary" | "bnMaterial" | "available" | "gap" }[] = [
  { layer: 1, marks: ["①", "②", "③", "④", "⑧", "⑯"], anchor: "bnOEE" },
  { layer: 2, marks: ["⑥", "⑦", "⑨", "⑰"], anchor: "bnYield" },
  { layer: 3, marks: ["⑩", "⑪", "⑫"], anchor: "bnPrimary" },
  { layer: 4, marks: ["⑬", "⑭", "⑮"], anchor: "bnMaterial" },
  { layer: 5, marks: ["⑳", "⑤", "⑱"], anchor: "available" },
  { layer: 6, marks: ["⑲"], anchor: "gap" },
];

export function CapacityDerivationDag({ baseId }: { baseId: string }) {
  // 规范 §1：第一层不许放逐项明细 ⇒ **默认不展开任何一层**（原来默认展开第 5 层，
  // 等于不点也看得见"驱动因素 / 溯源字段"这些第二层内容）。
  const [open, setOpen] = useState<number | null>(null);
  const outlook = useLiveSolver<Outlook>("base_capacity_outlook", { baseId, horizon: 90 }, (r) => r as Outlook);
  // WO-GSIM-3 灰数据修：显式请求 LIVE 口径 → bottleneck_matrix 读真 Equipment.oee_current/Line.utilization/
  // Process.yield_baseline 派生张力（否则后端回落 MOCK 恒定 seed 值·产线派生 DAG 恒灰·改设备 OEE 不动）。
  const bn = useLiveSolver<Bn>("bottleneck_matrix", { baseIds: [baseId], dataMode: "LIVE" }, (r) => r as Bn);
  const hz = outlook.data?.horizons?.[0];
  const bnRow = bn.data?.rows?.find((r) => r.base === baseId) ?? bn.data?.rows?.[0];

  if (!hz) {
    return (
      <div className={rk.rkDet} style={{ marginTop: 12 }} data-testid={`cap-dag-${baseId}`}>
        <div className={rk.rkDetH}><b>{zh.capDag.title}</b></div>
        <div className="empty-state" data-testid="cap-dag-loading" style={{ fontSize: 12 }}>
          {outlook.error ? zh.capDag.unavailable : zh.capDag.loading}
        </div>
      </div>
    );
  }

  // tOf 兜底口径：优先本基地行，缺则退回矩阵首行（单基地请求 rows 恒有一行）→ 产线派生 DAG 接真值非恒 null。
  const tOf = (f: string): number | null => {
    const t = bnRow?.tightness?.[f];
    if (typeof t === "number" && Number.isFinite(t)) return t;
    const fb = bn.data?.rows?.[0]?.tightness?.[f];
    return typeof fb === "number" && Number.isFinite(fb) ? fb : null;
  };
  // #13 灰数据接缝修：dataMode=LIVE 且矩阵真回 LIVE → 读真 Equipment/Line/Process 张力；但底层对象合成物化
  // （demo 世界）→ 诚实"合成·未接实测"（不谎报"实测"·守 KILL-MOCK-RED/铁律0.4）；无真源 → "估算(无实测)"。
  const bnLive = bn.data?.dataMode === "LIVE";
  const bnSynthetic = bnRow?.provenanceSynthetic === true;
  const bnKind = bnSynthetic ? "合成·未接实测" : bnLive ? "实测" : "估算(无实测)";

  interface Anchor { label: string; value: string; field: string; kind: string; tight: number | null; status: StatusKey; color: string;
    /** 第一层的分母/量纲提示（缺口 → 「= 可用 X − 需求 Y」；张力 → 「0–100 指数·越高越紧」）。 */
    denom?: string }
  const anchorVal = (a: (typeof LAYER_SPEC)[number]["anchor"]): Anchor => {
    switch (a) {
      case "available":
        // 可用产能是**派生量、无阈值** —— 诚实报"派生值·无阈值"，不给它编一个好/警/危。
        return { label: "可用产能数", value: `${fmt(hz.available)} 套`, field: "base_capacity_outlook.available", kind: "派生", tight: null, status: "derived", color: "var(--txt)" };
      case "gap": {
        // 缺口(gap<0) → 危；富余/平衡 → 好。状态词直接用求解器给的 `status`（缺口/富余/平衡·非前端臆造）。
        const short = hz.gap < 0;
        return { label: hz.status, value: `${fmt(Math.abs(hz.gap))} 套`, field: "base_capacity_outlook.gap", kind: "派生", tight: null, status: short ? "crit" : "ok", color: short ? "var(--danger)" : "var(--ok)",
          // 缺口必须带分母，否则无法核对（仓主原话：缺口是可用的 6.8 倍，"这数对吗"没处查）。
          denom: typeof hz.demand === "number" && Number.isFinite(hz.demand) ? zh.capDag.gapDenom(fmt(hz.demand), fmt(hz.available)) : zh.capDag.gapDenomMissing };
      }
      // 说明：这四个 label **不带"张力"二字** —— 量纲由 `formatTightness` 放进 value（「张力59/100」，
      // WO-UNIT-MEANING 的单一来源）。卡片布局把 label 与 value 上下叠放后，原来的
      // `"设备OEE 张力" + "张力59/100"` 会连读成「设备OEE 张力 张力59/100」，同一个词在
      // 眼睛落点上重复两次。去掉 label 这一份（不是去掉 value 那一份 —— 那份才是单源）。
      case "bnOEE": { const v = tOf("设备OEE"); return { label: "设备OEE", value: formatTightness(v), field: "bottleneck_matrix.设备OEE", kind: bnKind, tight: v, status: tightStatus(v), color: tightColor(v), denom: zh.capDag.tightUnit }; }
      case "bnYield": { const v = tOf("良率波动"); return { label: "良率波动", value: formatTightness(v), field: "bottleneck_matrix.良率波动", kind: bnKind, tight: v, status: tightStatus(v), color: tightColor(v), denom: zh.capDag.tightUnit }; }
      case "bnPrimary": { const v = bnRow ? tOf(bnRow.primary) : null; return { label: `主瓶颈 ${bnRow?.primary ?? "—"}`, value: formatTightness(v), field: "bottleneck_matrix.primary", kind: bnKind, tight: v, status: tightStatus(v), color: tightColor(v), denom: zh.capDag.tightUnit }; }
      case "bnMaterial": { const v = tOf("物料齐套"); return { label: "物料齐套", value: formatTightness(v), field: "bottleneck_matrix.物料齐套", kind: bnKind, tight: v, status: tightStatus(v), color: tightColor(v), denom: zh.capDag.tightUnit }; }
    }
  };

  const openSpec = open != null ? LAYER_SPEC.find((s) => s.layer === open) : undefined;

  return (
    <div className={rk.rkDet} style={{ marginTop: 12 }} data-testid={`cap-dag-${baseId}`}>
      <div className={rk.rkDetH}>
        <b>{zh.capDag.title}</b>
        <span>{zh.capDag.sub(outlook.data?.baseName ?? baseId, fmt(hz.available))}</span>
      </div>

      {/* 诚实位：正文降到 `?` 浮层（一字未删），第一层留下面这个**可见记号** ——
          静默降层等于删除（规范 §1）。放在 `.rkDetH` 之外是刻意的：
          `RiskBoardView.module.css` 里 `.rkDetH span` 是**后代选择器**，会一路盖进浮层正文里去。 */}
      <div className={styles.honesty}>
        <span className={styles.honestyMark} data-testid="cap-dag-honesty-mark">
          <span aria-hidden>⚑</span>
          {zh.capDag.honestyMark}
        </span>
        <InfoPopover topic={zh.capDag.honestyTopic} testId="cap-dag-honesty">
          {zh.capDag.honesty}
        </InfoPopover>

        {/*
         * 诚实位**升层**（注意方向：这一条不是降层，是原先埋得太低）。
         * 「合成·未接实测」此前只出现在第 4 层展开明细里 —— 而第 4 层正是主瓶颈那一层，
         * 意味着**整条链的结论都建立在合成数据上**。这种话必须第一屏就说，
         * 不能等用户点开明细才发现。D4 守恒管的是"不许降到看不见"，这里是反向修正。
         */}
        {/*
         * **恒显**，不是"只在合成时才显"：用户任何时候都该知道这条链踩在什么数据上。
         * 只在坏的时候才出标注，等于把"没标注"变成一个需要用户自己推断的信号 —— 那不是诚实位。
         * 三种取值同源 `bnKind`（实测 / 合成·未接实测 / 估算(无实测)），与第 4 层明细里那份**同一个变量**，
         * 所以不可能出现"第一层说一套、明细说另一套"。
         */}
        <span
          className={bnSynthetic ? "badge amber" : "badge"}
          data-testid="cap-dag-provenance-mark"
          data-kind={bnKind}
          data-synthetic={bnSynthetic ? "1" : "0"}
          style={{ fontSize: CAP_TYPE_SCALE.label, color: bnSynthetic ? "var(--amber-txt)" : "var(--muted)" }}
        >
          {bnKind}
        </span>

        {/*
         * 据实报缺：层1–4 今天**没有绝对产能数**（实测契约 BottleneckMatrixOutputSchema.tightness
         * 是 0–100 的 record）。不许拿张力冒充产能数 —— 那是"一个数冒充另一个数"。
         * 第一层留短记号 + `?`，全文在浮层。
         */}
        <span
          className="badge"
          data-testid="cap-dag-noabs-mark"
          style={{ fontSize: CAP_TYPE_SCALE.label, color: "var(--muted)" }}
        >
          {zh.capDag.noAbsMark}
        </span>
        <InfoPopover topic={zh.capDag.noAbsTopic} testId="cap-dag-noabs">
          {zh.capDag.noAbsBody}
        </InfoPopover>

        {/* 张力量纲（契约原文：0–100 指数，不是百分比） */}
        <InfoPopover topic={zh.capDag.tightTopic} testId="cap-dag-tight-unit">
          {zh.capDag.tightBody}
        </InfoPopover>
      </div>

      {/* ── 第一层：6 张卡 + 递进承载物 ── 只放 主数值 / 状态 / 层名，公式与明细一律不在这里。 */}
      <ol data-testid="cap-dag-nodes" className={styles.chain} aria-label={zh.capDag.chainAria}>
        {LAYER_SPEC.flatMap((spec, i) => {
          const n = spec.layer;
          const L = layerOf(n);
          const prev = i > 0 ? layerOf(LAYER_SPEC[i - 1]!.layer) : null;
          const next = i < LAYER_SPEC.length - 1 ? layerOf(LAYER_SPEC[i + 1]!.layer) : null;
          const anchor = anchorVal(spec.anchor);
          const isOpen = open === n;
          const isAnswer = n === ANSWER_LAYER;
          const statusText = zh.capDag.status[anchor.status];
          const card = (
            <li
              key={n}
              className={styles.card}
              data-testid={`cap-dag-node-${n}`}
              /* 递进承载物③：序号 + 上下游。不看文字（读屏 / 机器）也读得出方向。 */
              data-step={n}
              data-derives-from={prev ? String(n - 1) : ""}
              data-derives-to={next ? String(n + 1) : ""}
            >
              <button
                type="button"
                data-testid={`cap-dag-node-toggle-${n}`}
                className={styles.face}
                aria-pressed={isOpen}
                aria-label={zh.capDag.cardAria(
                  n,
                  L.name,
                  anchor.label,
                  anchor.value,
                  statusText,
                  prev ? zh.capDag.fromStep(n - 1, prev.name) : zh.capDag.fromNone,
                )}
                style={{ borderTopColor: L.colorVar }}
                onClick={() => setOpen(isOpen ? null : n)}
              >
                <span className={styles.head}>
                  <span className={styles.step} data-testid={`cap-dag-step-${n}`}>{n}</span>
                  <span className={styles.name} style={{ fontSize: CAP_TYPE_SCALE.label }}>{L.name}</span>
                </span>

                {/* 主数值：卡上最重的那一样。字号一级（hero）**只给第 6 层**（R-UI-2）。 */}
                <span
                  className={`mono ${styles.value}`}
                  data-testid={`cap-dag-anchor-${n}`}
                  data-tight={anchor.tight != null ? Math.round(anchor.tight) : ""}
                  data-live={anchor.tight != null ? String(bnLive) : ""}
                  data-size={isAnswer ? "hero" : "std"}
                  style={{
                    // 张力锚点按幅度上色（改 Equipment.oee → 张力变 → 真变色·非恒灰）；缺口按 gap 正负；可用产能保原口径。
                    color: anchor.color,
                    fontSize: isAnswer ? CAP_TYPE_SCALE.hero : CAP_TYPE_SCALE.value,
                  }}
                >
                  {anchor.value === "—" ? (
                    // 无 LIVE 真源 → 诚实"—"（不套 provenance·不伪造可溯）。
                    <span>—</span>
                  ) : (
                    <Provenance
                      testId={`cap-dag-anchorval-${n}`}
                      src={anchor.field.startsWith("base_capacity_outlook") ? "base_capacity_outlook 求解器" : "bottleneck_matrix 求解器"}
                      formula={`溯源字段 ${anchor.field}`}
                      inputs={anchor.tight != null ? [`张力 ${Math.round(anchor.tight)}`] : [anchor.value]}
                      note={anchor.kind}
                    >
                      {anchor.value}
                    </Provenance>
                  )}
                </span>

                {/* 这个数是什么（R-UI-1：标签与数值同处一卡，视线不必跨屏） */}
                <span className={styles.caption}>{anchor.label}</span>

                {/*
                 * 分母 / 量纲 —— 缺口层给「= 可用 X − 需求 Y」，张力层给「0–100 指数·越高越紧」。
                 * 两者都是**核对这个数所必需的**：没有分母的缺口没法核对，没有量程的张力会被读成百分比。
                 */}
                {anchor.denom ? (
                  <span
                    className={styles.caption}
                    data-testid={`cap-dag-denom-${n}`}
                    style={{ fontSize: CAP_TYPE_SCALE.label, color: "var(--muted2)" }}
                  >
                    {anchor.denom}
                  </span>
                ) : null}

                {/*
                 * **这一层在算什么** —— 单源 `factorOntology.ts` 的 `ONTO_LAYERS[].role`，前端不重写一份。
                 *
                 * ⚠ 为什么它必须在第一层（而 R-UI-3 说公式该进浮层）：
                 * 它是这一层的**身份**，不是对某个结论的解释。去掉它，第 3 层与第 4 层在屏上
                 * **完全无法分辨**（今天两层都是「张力95/100 · ◆危」，肉眼一模一样），
                 * 而它们在模型里差得很清楚：`min(瓶颈工序)` vs `∩ 物料齐套·到货约束`。
                 * 规范 §1 第一层准入清单第 ③ 条原文是「**它是什么的一个名字**」——
                 * 这一串就是这一层的名字。规范 §4 已按此判例补「结构性口径」豁免。
                 */}
                <span
                  className={styles.caption}
                  data-testid={`cap-dag-role-${n}`}
                  style={{ fontSize: CAP_TYPE_SCALE.label, color: "var(--muted)" }}
                >
                  {zh.capDag.roleLabel} {L.role}
                </span>

                {/* 状态：颜色 + 形状 + 文字三通道。
                    颜色只上在**形状**上、状态词走 `--muted` —— 语义域色（`--ok` / `--c-forecast`）
                    是按暗底调的，逐主题不变，对浅色主题的白面只有约 2:1，当 10.5px 正文色必然看不清；
                    而作为一块实心色斑（形状）它们完全够辨。三通道一个不少，可读性不赔。
                    （本文件与其 CSS module 一个字面色值都没有 —— 测试⑦ 用同一把尺子扫，
                     连注释里写个十六进制都会红。这是故意的：规则越笨越难被绕过。） */}
                <span
                  className={styles.status}
                  data-testid={`cap-dag-status-${n}`}
                  data-status={anchor.status}
                >
                  <span className={styles.glyph} style={{ color: anchor.color }} aria-hidden>{STATUS_GLYPH[anchor.status]}</span>
                  {statusText}
                </span>

                {/* 递进承载物②：梯级条（阶梯递增 + 前 n 格点亮）。换行后仍带着"第几级"。 */}
                <span
                  className={styles.rungs}
                  data-testid={`cap-dag-rungs-${n}`}
                  data-filled={n}
                  role="img"
                  aria-label={zh.capDag.rungAria(n)}
                >
                  {LAYER_SPEC.map((s) => (
                    <i
                      key={s.layer}
                      className={styles.rung}
                      data-on={s.layer <= n ? "1" : "0"}
                      data-cur={s.layer === n ? "1" : "0"}
                      style={{ height: rungHeight(s.layer), "--cap-rung-on": L.colorVar } as CSSProperties}
                    />
                  ))}
                </span>
              </button>

              {/* 第三层：`?` 浮层 —— 公式 / 口径 / 上下游。**在 button 之外**（button 不能套 button）。 */}
              <span className={styles.info}>
                <InfoPopover topic={zh.capDag.formulaTopic(n, L.name)} testId={`cap-dag-formula-${n}`} align="right">
                  <p>{zh.capDag.formula(L.role)}</p>
                  <p>{zh.capDag.anchorOf(anchor.label, anchor.field, anchor.kind)}</p>
                  <p>{prev ? zh.capDag.upstream(n - 1, prev.name) : zh.capDag.upstreamNone}</p>
                  <p>{next ? zh.capDag.downstream(n + 1, next.name) : zh.capDag.downstreamNone}</p>
                </InfoPopover>
              </span>
            </li>
          );
          // 递进承载物①：卡与卡之间的连接箭头（**真 DOM 元素**·随 flex 换行仍贴在两卡之间）。
          // 第 1 张卡前面没有箭头 —— 它是链起点，前面无物可指。
          if (i === 0) return [card];
          return [
            <li key={`link-${n}`} className={styles.link} role="presentation" aria-hidden data-testid={`cap-dag-link-${n - 1}-${n}`}>
              →
            </li>,
            card,
          ];
        })}
      </ol>

      {/* ── 第二层：明细（一次点击）。不点不出，第一层不背这份重量。 ── */}
      {openSpec ? (
        (() => {
          const L = layerOf(openSpec.layer);
          const anchor = anchorVal(openSpec.anchor);
          const marks: OntoFactor[] = openSpec.marks.map((m) => ONTO_FACTORS.find((f) => f.mark === m)!).filter(Boolean);
          return (
            <div className={styles.detail} data-testid={`cap-dag-detail-${openSpec.layer}`}>
              <div className={styles.detailH}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: L.colorVar }} aria-hidden />
                {zh.capDag.detailTitle(openSpec.layer, L.name)}
                <button type="button" className={styles.detailClose} data-testid="cap-dag-detail-close" onClick={() => setOpen(null)}>
                  {zh.capDag.detailClose}
                </button>
              </div>
              <div><span className={styles.detailK}>{zh.capDag.judge}</span>{L.role}</div>
              <div className={styles.drivers}>
                <span className={styles.detailK}>{zh.capDag.drivers}</span>
                {marks.map((f) => (
                  <span
                    key={f.mark}
                    className="badge"
                    /* R-UI-3：**不用原生 `title`** —— 那是 OS 绘制的 tooltip，不受控、恒在最上层、移开滞留
                       （2026-08-10 环形图实测事故）。信息改挂 aria-label，读屏拿得到、浏览器不弹框。 */
                    aria-label={zh.capDag.factorAria(f.mark, f.name, f.layer)}
                    style={{ background: "var(--panel)", border: `1px solid ${L.colorVar}`, color: "var(--muted)", fontSize: 12 }}
                  >
                    {f.mark} {f.name}
                  </span>
                ))}
              </div>
              <div className={styles.detailAux}>
                {zh.capDag.derive}{anchor.label} = {anchor.value}（{anchor.kind}） · 溯源字段 <span className="mono">{anchor.field}</span>
              </div>
            </div>
          );
        })()
      ) : (
        <div className={styles.detailHint} data-testid="cap-dag-detail-hint">{zh.capDag.detailHint}</div>
      )}
    </div>
  );
}
