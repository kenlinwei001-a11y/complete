import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Feature } from "@/workspace/featureGate";
import { api } from "@/api/apiClient";
import {
  ParetoAssembleResultSchema,
  declaredObjectiveKeys,
  deriveParetoMetrics,
  normalizeParetoWeights,
  type ParetoObjective,
  type ParetoObjectiveGap,
  type ParetoRequest,
  type ParetoResult,
  type ParetoSolution,
} from "@platform/contracts";
import { fmtCompact, withCostCaliber } from "./console/useParetoFrontier";
import { useLiveSolver } from "./useLiveSolver";
import styles from "./SimViews.module.css";

/**
 * WO-MULTIOBJ-CONVERGE · 多目标 + 跨对象占用 what-if 面板 —— 与「方案寻优」**同轴同粒度**。
 *
 * ══ 今天的行为是 X，应该是 Y（开工实测，本机 4711 内存态 demo 租户，SEED_DEMO=1）══════
 *
 * **X**：本面板与 `/v/sim-optimize`（方案寻优）是同一租户、同一批订单的两个多目标界面，
 *   而它们**各算各的**，屏上给出两个对不上的数：
 *   | | 方案寻优 | 本面板（改前） |
 *   |---|---|---|
 *   | 粒度 | `OrderLine` 873 行 | `Order` —— 且**只取分页第一页 50/500 单** |
 *   | 营收池 | 480.62 亿 | 65.56 亿（另外 450 单从未参与求解） |
 *   | 最优解营收 | **244.59 亿** | **39.49 亿** |
 *   | 轴 | 毛利 · 获排率 · 营收 · 成本(料+占线) | 营收 · 违约金 · 换型成本 |
 *   | 成本口径 | `Base.serveCost` + `OrderLine.unitCost × qty`（本体字段） | `qty × 800 元/套`（前端自定系数） |
 *   两个数差 **6.19 倍**，而屏上没有任何一处说得清为什么。拆开是两笔：
 *   **① 覆盖子集 7.331×**（50/500 单 —— 这是真 bug，屏上却写着「本租户真实 Order」）；
 *   **② 获排比例 0.845×**（截断后的小订单簿产能相对宽裕，服务比例反而更高）。
 *   7.331 × 0.845 = 6.19 ✓。粒度本身**不贡献倍数**（`Σ OrderLine.qty ≡ Order.qty`，均 2,436,095），
 *   它只改获排率的分母；口径差 1.057× 已含在 ① 的池子比里。**没有重复计数。**
 *
 * **Y（本文件）**：两个界面读**同一个装配器**（`POST /a/v1/sim/optimize-pareto/assemble`）——
 *   同一份 `args`（`OrderLine` 粒度 · 全量订单簿 · 本体字段派生的营收/成本）、
 *   同一份 `objectives`、同一份 `unavailableObjectives`；
 *   轴读数由契约包里**唯一那份** `deriveParetoMetrics` 折出来，与方案寻优逐字节同源。
 *   于是「同一根轴在两个界面上是不是同一个数」变成结构上成立的事。
 *
 * ⛔ **删掉的那两根轴不是"少了一维"，是退成显式缺席位**（与本页「现金」同一形态）：
 *   违约金 / 换型成本此前的读数出自前端自定系数（优先级 → 元/套、800 元/套），
 *   本体上**没有**这两格 —— 装配器现扫全本体后把它们点名报缺（`unavailableObjectives`），
 *   两个界面读同一份缺席声明。本仓明令：**连不上就诚实不连**，
 *   一根按写死系数算出来的违约金在屏上是一条完全正常的曲线，没人看得出它不是本体事实。
 *
 * ⛔ **装配不出 ⇒ 不兜底、不回退到自造订单簿**：屏上如实说装不出、缺哪格。
 *   `opt.multiobj` 关 → 整块不存在（R3）。
 */

/** 装配出口 —— 与方案寻优页同一个常量语义（两页读同一个后端出口，这是本单的落点）。 */
export const MULTIOBJ_ASSEMBLE_ENDPOINT = "/a/v1/sim/optimize-pareto/assemble" as const;

/** 解集出口 —— 与方案寻优页同一条（`useParetoFrontier.PARETO_ENDPOINT` 的同一个值）。 */
export const MULTIOBJ_PARETO_ENDPOINT = "/a/v1/sim/optimize-pareto" as const;

/**
 * 杠杆档位 → 施加到 `args` 上（与后端 `applyPerturbationSet` 的 `data_override` 同一套
 * 「`<集合>.<id>.<字段>`」接地语法）。本面板只需要**重放**方案寻优已经选出的那一组档位，
 * 好让占用明细表与那个方案对得上。
 *
 * ⛔ 权重**不进 args**（契约 `ParetoWeightsSchema` 那条红线的原文）：权重进 args 会把多目标
 * 退化成「换个加权再算一遍」的单目标最优点轨迹，而屏上看起来一模一样。
 * 本面板的滑杆与方案寻优的滑杆走**同一条路**：只排名次，不改解集。
 */
function applyLevers(
  args: Readonly<Record<string, unknown>>,
  levers: readonly { key: string; value: number }[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  for (const l of levers) {
    const m = /^(.+)\.(.+)\.(.+)$/.exec(l.key);
    if (!m) continue;
    const [, coll, id, field] = m;
    const rows = next[coll!];
    if (!Array.isArray(rows)) continue;
    next[coll!] = rows.map((r) =>
      r !== null && typeof r === "object" && (r as { id?: unknown }).id === id ? { ...(r as object), [field!]: l.value } : r,
    );
  }
  return next;
}

interface OccResult {
  occupancy: { order: string; line: string }[];
  displaced: string[];
  objectiveValues: Record<string, number>;
  servedCount: number;
  orderCount: number;
  optimal: boolean;
}

/** 装配结果 → 可用的请求；装不出回 `undefined` + 一句诚实的原因。 */
function useAssembledModel(): { req?: ParetoRequest; note?: string; loading: boolean } {
  const q = useQuery({
    queryKey: ["a", "multiobj-pareto-assemble"],
    retry: false,
    queryFn: () => api.a<unknown>(MULTIOBJ_ASSEMBLE_ENDPOINT, { body: {} }),
  });
  if (q.isLoading) return { loading: true };
  if (q.error) return { loading: false, note: q.error.message };
  const parsed = ParetoAssembleResultSchema.safeParse(q.data);
  if (!parsed.success) return { loading: false, note: "装配结果不符合契约（本面板不猜一份出来）" };
  if (!parsed.data.applicable) {
    return { loading: false, note: `${parsed.data.note}（缺：${parsed.data.missingRoles.join("、")}）` };
  }
  return { loading: false, req: parsed.data.request };
}

function MultiObjWhatifInner() {
  const { req, note, loading } = useAssembledModel();
  const objectives: readonly ParetoObjective[] = req?.objectives ?? [];
  const gaps: readonly ParetoObjectiveGap[] = req?.unavailableObjectives ?? [];
  const [raw, setRaw] = useState<Record<string, number>>({});

  // 权重归一走契约包里**唯一那份** `normalizeParetoWeights`（方案寻优的滑杆用的是同一段）。
  const weights = useMemo(() => normalizeParetoWeights(objectives, raw), [objectives, raw]);

  /**
   * ── 解集 + 名次：与方案寻优**同一条端点、同一份权重语义**（本单的落点）──────────
   * 权重只排名次、不改解集（契约红线）；故这里发的请求与方案寻优页发的**逐字节同构**，
   * 只是本面板拿到 `recommendedId` 之后还要再往下走一步 —— 把那个方案的占用明细摊开。
   */
  const paretoQ = useQuery({
    queryKey: ["a", "multiobj-pareto", req === undefined ? "" : JSON.stringify({ req, weights })],
    enabled: req !== undefined,
    retry: false,
    queryFn: () => api.a<ParetoResult>(MULTIOBJ_PARETO_ENDPOINT, { body: { ...req!, weights } }),
  });
  const picked: ParetoSolution | undefined = useMemo(() => {
    const r = paretoQ.data;
    if (r === undefined) return undefined;
    return [...r.frontier, ...r.dominated].find((s) => s.id === r.recommendedId);
  }, [paretoQ.data]);

  /** 占用明细：在**被推荐的那个方案**的杠杆档位上重放一次求解（不是另一个方案的明细）。 */
  const occArgs = useMemo(
    () => (req === undefined || picked === undefined ? null : applyLevers(req.args as Record<string, unknown>, picked.levers)),
    [req, picked],
  );
  const occ = useLiveSolver<OccResult>("cross_object_occupancy", occArgs, (r) => r as OccResult);

  // ── 轴读数：契约包里**唯一那份**折算（方案寻优的 metrics 出自同一段代码）──────────
  // ⚠ 这里**不直接印 `picked.metrics`**：那样两边同数是因为抄了同一个回包，证不了别的。
  //   本面板从自己这次求解的回包折读数 ⇒ 两条独立的路走到同一个数，才是"同轴同数"这件事。
  const declared = useMemo(() => declaredObjectiveKeys(objectives), [objectives]);
  const metrics = useMemo(
    () => (occ.data ? deriveParetoMetrics(occ.data as unknown as Record<string, unknown>, declared) : undefined),
    [occ.data, declared],
  );
  const solverErr = occ.error ?? (paretoQ.error as Error | null);
  const orderRows = (req?.args as { orders?: { id: string; revenue: number; qty: number }[] } | undefined)?.orders ?? [];
  const occByOrder = useMemo(
    () => new Map((occ.data?.occupancy ?? []).map((o) => [o.order, o.line])),
    [occ.data],
  );
  const displacedSet = useMemo(() => new Set(occ.data?.displaced ?? []), [occ.data]);

  return (
    <div className={styles.audCard} data-testid="multiobj-whatif">
      <div className={styles.audHead}>
        <strong>多目标 + 跨对象占用推演</strong>
        <span
          className={styles.chip}
          title={
            occ.data?.optimal
              ? "决策变量在 CP-SAT 上求到可证最优，非数据库既有事实"
              : "求解器给出满足约束的可行解、但未证明它是最优（内存态为确定性贪心），非数据库既有事实"
          }
          data-testid="multiobj-badge"
        >
          {occ.data
            ? occ.data.optimal
              ? "CP-SAT 可证最优 · 推演结果（非数据库事实）"
              : "优选解（可行 · 未证最优） · 推演结果（非数据库事实）"
            : "推演结果（非数据库事实）"}
        </span>
      </div>

      {/* 口径披露：只写「标签 + 值」，不写解释性散文；轴名与口径全部来自装配器回包，前端零猜测。 */}
      <div className={styles.noteInfo} data-testid="multiobj-input-disclosure" style={{ fontSize: 12, margin: "2px 0 6px" }}>
        订单簿 {orderRows.length} 行 · 产线 {((req?.args as { lines?: unknown[] } | undefined)?.lines ?? []).length} 条 ·
        轴与口径同「方案寻优」（同一装配出口 · 同一份读数折算）
      </div>

      {note && !req ? (
        <div data-testid="multiobj-not-assembled" className={styles.noteRed} style={{ fontSize: 12, margin: "4px 0 8px" }}>
          装配不出：{note}
        </div>
      ) : null}
      {loading ? (
        <div style={{ fontSize: 12, opacity: 0.7, padding: "8px 0" }} data-testid="multiobj-loading">
          装配中…
        </div>
      ) : null}
      {solverErr ? (
        <div data-testid="multiobj-solver-error" className={styles.noteRed} style={{ fontSize: 12, margin: "4px 0 8px" }}>
          求解失败：{solverErr.message}
        </div>
      ) : null}

      {/* ① 六轴读数（在册轴 + 缺席位）—— 与方案寻优**同一套轴**，缺的那几根必须印出来。 */}
      {req ? (
        <>
          <div style={{ fontSize: 12, opacity: 0.7, margin: "6px 0 2px" }} data-testid="multiobj-objvalues-caption">
            当前权重下优选方案的各轴读数（推演结果 · 随权重变）
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 8px" }} data-testid="multiobj-objvalues">
            {objectives.map((o) => {
              const v = metrics?.[o.key];
              return (
                <div key={o.key} className={styles.kpi} style={{ minWidth: 150 }} data-testid={`multiobj-axis-${o.key}`}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {withCostCaliber(o.label ?? o.key)}（{o.dir === "max" ? "越高越好" : "越低越好"}）
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600 }} data-testid={`multiobj-axis-value-${o.key}`}>
                    {typeof v === "number" ? fmtCompact(v, o.unit ?? "") : "—"}
                  </div>
                </div>
              );
            })}
            {gaps.map((g) => (
              <div
                key={g.key}
                className={styles.kpi}
                style={{ minWidth: 150, opacity: 0.75 }}
                data-testid={`multiobj-gap-${g.key}`}
                title={g.reason}
              >
                <div style={{ fontSize: 12, opacity: 0.7 }}>{g.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>本系统今天算不出</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{g.reason}</div>
              </div>
            ))}
          </div>

          {/* ② 权重滑杆 —— 只给引擎真吃的那几根 */}
          <div className={styles.miniForm} style={{ display: "grid", gap: 8, margin: "8px 0" }}>
            {objectives.map((o) => {
              const k = o.key;
              return (
                <label key={k} className={styles.formRow} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ minWidth: 80 }}>{k} 权重</span>
                  <input
                    type="range"
                    min={0}
                    max={32}
                    step={1}
                    value={raw[k] ?? 1}
                    data-testid={`multiobj-weight-${k}`}
                    aria-label={`${o.label ?? k} 权重`}
                    onChange={(e) => setRaw((p) => ({ ...p, [k]: Number(e.target.value) }))}
                  />
                  <span style={{ width: 44, textAlign: "right" }}>{(raw[k] ?? 1).toFixed(0)}×</span>
                </label>
              );
            })}
          </div>

          {/* ③ 跨对象占用表（装配器给的那批行，逐行显真读数） */}
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            <table className={styles.abCompare} data-testid="multiobj-occupancy" style={{ width: "100%", marginTop: 8 }}>
              <thead>
                <tr><th>需求行</th><th>数量</th><th>营收</th><th>获排产线</th></tr>
              </thead>
              <tbody>
                {orderRows.slice(0, 200).map((r) => {
                  const line = occByOrder.get(r.id);
                  return (
                    <tr key={r.id} data-testid={`multiobj-row-${r.id}`} style={displacedSet.has(r.id) ? { opacity: 0.55 } : undefined}>
                      <td className="mono">{r.id}</td>
                      <td className="num">{r.qty.toLocaleString()}</td>
                      <td className="num">{fmtCompact(r.revenue, "元")}</td>
                      <td>
                        {!occ.data ? "…" : line ?? (
                          <span style={{ color: "var(--danger-txt)" }} data-testid={`multiobj-displaced-${r.id}`}>被挤（未排）</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {occ.data ? (
            <div className={styles.noteAmber} data-testid="multiobj-displaced-note" style={{ marginTop: 6 }}>
              获排 {occ.data.servedCount} / {orderRows.length} 行 · 被挤 {occ.data.displaced.length} 行
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** opt.multiobj 关 → 整块不存在（R3）。 */
export function MultiObjWhatifPanel() {
  return (
    <Feature flag="opt.multiobj">
      <MultiObjWhatifInner />
    </Feature>
  );
}
