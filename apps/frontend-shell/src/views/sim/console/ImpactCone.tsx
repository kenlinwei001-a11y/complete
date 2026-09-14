import { useQuery } from "@tanstack/react-query";
import {
  chainNodeDef,
  type ChainNodeDef,
  type ImpactAnalysisResponse,
  type ImpactChange,
} from "@platform/contracts";
import { runImpactAnalysis } from "@/api/endpoints";
import styles from "./SandboxDetail.module.css";

/**
 * WO-SIM-FE-DETAIL · 「影响半径」扇区图（规格 `docs/ux-spec/sandbox/sandbox-detail.html` 的 `#cone` 段）。
 *
 * ── 版面 ────────────────────────────────────────────────────────────────────
 * viewBox `0 0 236 240`，逐个图元的坐标、半径、字号全部照抄规格里的那段 `E(...)` 调用，
 * 一个数都没重算。容器 `.dr` 的 `1fr 236px` 网格列宽同样来自规格（见 `.dt`）。
 *
 * ── 数据 ────────────────────────────────────────────────────────────────────
 * 真出处 = `POST /a/v1/simulation/impact-analysis`（**今天就有**：`apps/datacore/src/sim/impact-analysis.ts`，
 * 前端薄封装 `runImpactAnalysis`）。它按四维返回，每维是 `available` 上的判别联合。
 *
 * **逐格照实说接了多少**：
 *   · **三条冲击条目（`齐套冲击 P2` 这一列）** ← `affectedProcesses.items[].name`，真数据；
 *     该维 `available:false` ⇒ **不渲染成 0 条**，落回占位并标 `provenance="placeholder"`
 *     （契约注释原话：`available:false` 与 `count:0` 是两件不同的事）。
 *   · **半径读数 / 张角 / 纵轴刻度 / 四个传导标记** ← 端点**没有**这些量。
 *
 * ══ WO-SIM-HONEST-FALLBACK-B · 今天的行为是 X，应该是 Y ═══════════════════════
 *
 * **X（改造前）**：上面第二条写着"不编：保留规格占位并标记"，而**那个"标记"是
 * `data-prov` 属性 —— 用户看不见**。屏上因此印着 `18:12`（半径）、`39°`（张角）、
 * `400/300/200/100`（纵轴刻度）、`P4211…P4214`（四个传导标记）——
 * 一整套**从设计稿抄来、且本系统压根算不出**的数字，长得跟真读数一模一样。
 * 这正是本仓点名的「静默错答」：界面照画、值是编的、用户无从分辨。
 *
 * **Y（现在）**：照第一批 `WO-SIM-HONEST-FALLBACK-A` 立的范式
 * （`useLossAttribution.ts` 的 `EMPTY_REASON` / `EMPTY_CELL`）——
 * **骨架还在（版面不塌），每一格印 `—`，原因写在用户读得到的地方**。
 * 三条冲击那一列**不动**：它有真出处（`affectedProcesses`），端点答了就是真值。
 *
 * ⚠ 三态定性（**2026-08-26 实测**，逐条给复验方式，不许混为一谈）：
 *   · 半径 / 张角 / 刻度 / 传导标记 ⇒ **压根没有数据源**（`ImpactAnalysisResponse`
 *     四个维里一个都不含这些量）。复验（2026-08-26 亲手跑过，命中数就是下面这两个）：
 *     `grep -c "radius\|angle" packages/contracts/src/impact-analysis.ts` ⇒ **0**；
 *     金丝雀 `grep -c "affectedProcesses" packages/contracts/src/impact-analysis.ts` ⇒ **1**
 *     （同一把尺在已知必中的串上中了 ⇒ 是「真没有」，不是「尺子坏了」）。
 *   · **不是**「该接没接」——没有端点可接，所以本条与禁令 2 无关，不需要仓主批准。
 *
 * 画布坐标（星标 x/y、冲击条 y）留在原地并标 `hardcoded-data-allow`：
 * 它们是**呈现常量**，真/占位两态共用同一份，判据是「它不描述这个租户的任何事实」
 * （同 `useParetoFrontier.PARETO_GEOM`）。
 */

export interface ConeImpact {
  label: string;
  /** 规格里三条冲击的 y（84 / 100 / 116）。 */
  y: number;
}

export interface ImpactConeModel {
  /** `.rd` 半径读数。 */
  radiusLabel: string;
  /** 扇区张角读数（SVG 内 `39°`）。 */
  angleLabel: string;
  /** 纵轴刻度（左右各一列）。 */
  ticks: readonly string[];
  /** 传导链上的节点标记（第 2 个为热点）。 */
  markers: readonly { label: string; x: number; y: number }[];
  hotMarkerIndex: number;
  impacts: readonly ConeImpact[];
  /**
   * 屏上那句「这几格为什么没有数」。`null` = 这几格有真值，不必解释。
   * **必须是屏上文字**，不是 `data-*`：`data-*` 用户看不见，而本单要消灭的正是
   * 「屏上看不出这是编的」这个态（第一批 A 的接缝测试原话：断言落在用户读得到的地方）。
   */
  emptyNote: string | null;
  provenance: { impacts: "impact-analysis" | "placeholder"; radius: "placeholder"; angle: "placeholder" };
}

/** 空格里印的东西。与 `useLossAttribution.EMPTY_CELL` / `HeatMatrix.HEAT_EMPTY_GLYPH` 同一个字符、同一条纪律。 */
export const CONE_EMPTY_CELL = "—";

/**
 * 「半径 / 张角 / 刻度 / 传导标记为什么是 `—`」的**唯一一句话**。
 *
 * 判据照第一批 A 的 `EMPTY_REASON`：① 说人话（一个内部符号名都不许出现）；
 * ② 与「问了但没有」区分得开 —— 这里是**本系统根本没有这个量**，
 * 不是「这一次推演算出来是空的」，两句话不许混。
 */
export const CONE_EMPTY_REASON = "半径、张角与传导标记：本系统还没有这几个读数，所以留空";

/**
 * 屏上的**环节名**取自契约冻结表 `CHAIN_NODE_REGISTRY`，一个字都不在视图里手写（R14）。
 *
 * 与本目录 `SandboxDetail.laneNodeLabel` 同一条纪律，只是那里管地铁图 21 个站、
 * 这里管三条冲击的槽位名。判据是「**换注册表 = 换租户**」：改 `chain-sim.ts` 的 label，
 * 这三条冲击的名字跟着变，视图零改动。写死在这里则换个行业就是三句错话。
 *
 * ⚠ 不在册即**抛**，不回退到手写串 —— 静默回退会让「注册表少了一条」表现成屏上一切正常。
 */
function nodeLabel(nodeId: string): string {
  const def = chainNodeDef(nodeId);
  if (def === undefined) throw new Error(`不在 CHAIN_NODE_REGISTRY 里的环节：${nodeId}`);
  return def.label;
}

/** 在册节点 id 的**字面量联合**（派生自契约，不是本地起个同名别名白嫖）。 */
type RegisteredChainNodeId = ChainNodeDef["nodeId"];

/**
 * 规格三条冲击的槽位。**`y` 是版面坐标（规格 84/100/116），键是内容的出处**：
 * 前者是本文件里真正该写死的那一类（画布几何），后者一律查注册表。
 * 规格原文把两者写在同一个字面量里（`{ label: "老化冲击 Y1", y: 116 }`），
 * 于是「坐标」与「业务事实」混成一格、一起被当成硬编码 —— 这里拆开。
 *
 * ⚠ **`nodeId` 从值位挪到了键位**（WO-SIM-HONEST-FALLBACK-B）：原写法把 3 个在册
 * nodeId 写成**值位字面量**，`scripts/check-chain-node-singlesource.mjs` 判据 C 判为
 * 「第二份注册表」（改册时这里不会跟着变）。改成 `Partial<Record<Rid, …>>` 之后
 * 键绑在编译期 —— 注册表删一条这里当场 `tsc` 红，门也按机制放行。
 * 不许改成 `as` 断言或 `Rid | string` —— 这两条会让 `tsc` 不再咬（**门自己的 2026-08-21 实测**，
 * 不是我这次测的；出处 `scripts/check-chain-node-singlesource.mjs` 头注「反伪造」段
 * 与它的 `keyTypeAnchored()`，复验：`node scripts/check-chain-node-singlesource.mjs`）。
 */
const CONE_SLOTS: Partial<Record<RegisteredChainNodeId, { code: string; y: number }>> = { // hardcoded-data-allow —— y 是画布坐标（呈现）、code 是规格槽位名，两者都不描述任何租户事实
  "material.kitting": { code: "P2", y: 84 },
  "capacity.schedule": { code: "P1", y: 100 },
  "capacity.aging": { code: "Y1", y: 116 },
};

/** 三条冲击的槽位（键序即规格里的上下序）。标签查注册表，`y` 取版面坐标。 */
const CONE_IMPACT_SLOTS: readonly ConeImpact[] = Object.entries(CONE_SLOTS).flatMap(([nodeId, slot]) =>
  slot === undefined ? [] : [{ label: `${nodeLabel(nodeId)} ${slot.code}`, y: slot.y }],
);

/**
 * 星标的**画布坐标**（规格 `#cone` 那四个 `M(...)`）。呈现常量：真/占位两态共用同一份，
 * 删掉它连真数据也画不出来。判据一句话：**它不描述这个租户的任何事实**。
 * ⚠ 标记上的**文字**（原规格的 `P4211…P4214`）不在这里 —— 那是业务量，见 `PLACEHOLDER_CONE`。
 */
const CONE_MARKER_XY: readonly (readonly [number, number])[] = [ // hardcoded-data-allow —— 画布坐标（呈现），非业务量
  [38, 66],
  [92, 58],
  [150, 60],
  [204, 72],
];

/** 纵轴刻度的**槽位数**（规格：4 条网格线各配一个读数）。版面量，与刻度的**值**无关。 */
const CONE_TICK_SLOTS = 4;

/**
 * 非端点态的模型 —— **骨架 + `—` + 一句人话**，一个编出来的数都没有。
 *
 * 逐格账（每一格都写清「为什么是 `—`」，不许一句"占位"盖过去）：
 *   · `radiusLabel` / `angleLabel`：`ImpactAnalysisResponse` 没有这两个量 ⇒ 恒 `—`；
 *   · `ticks`：纵轴刻度同样无源。**槽位保留 4 格**（版面不塌），每格印 `—`；
 *   · `markers`：坐标是版面（`CONE_MARKER_XY`），**文字**无源 ⇒ 每个印 `—`；
 *     `hotMarkerIndex: -1` = 没有任何一个是"热点"——不知道就别指一个出来；
 *   · `impacts`：**有真出处**，端点答了就整列换真（见 `projectImpactCone`）。
 */
export const PLACEHOLDER_CONE: ImpactConeModel = {
  radiusLabel: CONE_EMPTY_CELL,
  angleLabel: CONE_EMPTY_CELL,
  ticks: Array.from({ length: CONE_TICK_SLOTS }, () => CONE_EMPTY_CELL),
  markers: CONE_MARKER_XY.map(([x, y]) => ({ label: CONE_EMPTY_CELL, x, y })),
  hotMarkerIndex: -1,
  impacts: CONE_IMPACT_SLOTS,
  emptyNote: CONE_EMPTY_REASON,
  provenance: { impacts: "placeholder", radius: "placeholder", angle: "placeholder" },
};

/** 响应 → 扇区图模型。只换端点真的答得出的那一格（三条冲击），其余保持占位并标记。 */
export function projectImpactCone(res: ImpactAnalysisResponse | undefined): ImpactConeModel {
  const dim = res?.affectedProcesses;
  if (dim === undefined || dim.available !== true) return PLACEHOLDER_CONE;
  const items = dim.items;
  if (items.length === 0) return PLACEHOLDER_CONE;
  // 槽位（三条冲击的 y）来自规格，条目文案来自端点：**位置照抄、内容换真**。
  // ⚠ `emptyNote` **照旧留着**：换真的只有冲击这一列，半径/张角/刻度/标记仍是 `—`，
  //   这时候把那句解释撤掉，屏上就又变回"看不出为什么是空的"——正是本单要消灭的态。
  return {
    ...PLACEHOLDER_CONE,
    impacts: PLACEHOLDER_CONE.impacts
      .slice(0, items.length)
      .map((slot, i) => ({ label: items[i]?.name ?? slot.label, y: slot.y })),
    provenance: { ...PLACEHOLDER_CONE.provenance, impacts: "impact-analysis" },
  };
}

/** 接 `impact-analysis`。世界或变更缺一 ⇒ 不发请求（发了也只会 400/404），用规格占位。 */
export function useImpactCone(input?: { worldId: string; change: ImpactChange }): {
  model: ImpactConeModel;
  source: "impact-analysis" | "placeholder";
} {
  const worldId = input?.worldId ?? "";
  const change = input?.change;
  const enabled = worldId !== "" && change !== undefined;
  const key = change === undefined ? "" : `${change.objectType}|${change.objectId}|${change.prop}`;
  const q = useQuery({
    queryKey: ["a", "sim-impact-cone", worldId, key],
    enabled,
    retry: false,
    queryFn: () =>
      change === undefined
        ? Promise.reject(new Error("no change"))
        : runImpactAnalysis({ worldId, change, limit: 200 }),
  });
  const model = projectImpactCone(enabled ? q.data : undefined);
  return { model, source: model.provenance.impacts === "impact-analysis" ? "impact-analysis" : "placeholder" };
}

const HAIR = "color-mix(in srgb, var(--line) 62.5%, transparent)";
const HAIR2 = "var(--line2)";
const STAR = "M0 -6 L2 -1 L8 0 L2 1 L0 6 L-2 1 L-8 0 L-2 -1 Z";

/**
 * 扇区图本体。SVG 的着色一律走 `style`（而非 `fill=` 属性）——
 * 两者在 Chromium 里都吃 `var()`，但 `style` 是**所有**浏览器都保证支持的那一条，
 * 而本页的色值必须跟着主题令牌走，赌浏览器差异不值当。
 */
export function ImpactCone({ model, source }: { model: ImpactConeModel; source: "impact-analysis" | "placeholder" }) {
  return (
    <div className={styles.dr} data-testid="sandbox-detail-cone" data-source={source}>
      <svg viewBox="0 0 236 240" data-testid="sandbox-detail-cone-svg">
        {[1, 2, 3, 4].map((i) => (
          <line key={`g${i}`} x1={14} y1={i * 48} x2={222} y2={i * 48} style={{ stroke: HAIR }} />
        ))}
        {model.ticks.map((v, i) => (
          // 同上：空态四个刻度都是 `—`，key 必须用下标。
          <g key={`t${i}`}>
            <text x={4} y={i * 48 + 52} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
              {v}
            </text>
            <text x={212} y={i * 48 + 52} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
              {v}
            </text>
          </g>
        ))}
        <path d="M118 208 L64 96 A 60 60 0 0 1 172 96 Z" style={{ fill: HAIR, stroke: HAIR2 }} />
        <ellipse cx={118} cy={196} rx={44} ry={16} style={{ fill: "none", stroke: HAIR2 }} />
        <path
          d="M40 108 C 90 66, 150 62, 208 92"
          strokeWidth={1.5}
          style={{ fill: "none", stroke: "var(--c-capacity)" }}
        />
        <path
          d="M44 128 C 96 92, 152 88, 206 112"
          strokeDasharray="5 4"
          style={{ fill: "none", stroke: "color-mix(in srgb, var(--accent) 60%, transparent)" }}
        />
        {model.markers.map((m, i) => {
          const hot = i === model.hotMarkerIndex;
          // key 用下标：空态四个标记的文案**都是** `—`，拿文案当 key 会撞成一个。
          return (
            <g key={`mk${i}`} transform={`translate(${m.x},${m.y})`}>
              <path d={STAR} style={{ fill: hot ? "var(--warn-txt)" : "var(--accent-txt)" }} />
              <text
                x={-14}
                y={-9}
                fontSize={7}
                fontFamily="var(--font-mono)"
                style={{ fill: hot ? "var(--warn-txt)" : "var(--muted)" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
        <rect x={78} y={44} width={56} height={14} style={{ fill: "none", stroke: "var(--warn)" }} />
        {model.impacts.map((c) => (
          <g key={c.label}>
            <rect x={112} y={c.y - 8} width={7} height={7} style={{ fill: "var(--danger)" }} />
            <text x={123} y={c.y} fontSize={7} style={{ fill: "var(--danger-txt)" }}>
              {c.label}
            </text>
          </g>
        ))}
        <path d="M118 208 L104 186 L132 186 Z" style={{ fill: "var(--danger)" }} />
        <text x={150} y={200} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
          {model.angleLabel}
        </text>
      </svg>
      <span className={styles.rd} data-prov={model.provenance.radius}>
        {model.radiusLabel}
      </span>
      {/* 屏上那句人话。**不是 `title` 悬浮、不是 `data-*`** —— 两者用户都看不见，
          而本单要消灭的正是"屏上看不出这是编的"。空态时才渲染：有真值就不该占版面。 */}
      {model.emptyNote === null ? null : (
        <span className={styles.coneNote} data-testid="sandbox-detail-cone-note">
          {model.emptyNote}
        </span>
      )}
      <span className={styles.cp}>
        <b>↑</b>下游
      </span>
    </div>
  );
}
