import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Feature } from "@/workspace/featureGate";
import { searchObjects } from "@/api/endpoints";
import { useLiveSolver } from "./useLiveSolver";
import { fmt } from "./shared";
import { buildOccupancyScenario, type RealOrderInput } from "./multiObjScenario";
import styles from "./SimViews.module.css";

/**
 * WO-GUI4-MULTIOBJ-REAL 多目标 + 跨对象占用 what-if 面板（接**真实订单簿** · R3/R14）。
 *
 * 病根修复：此前喂求解器的是写死的 toy 三单 SO-A/B/C（营收/违约金 = 300/10…示意常数）。现改**接真 Order**——
 * 与全局推演同源（GET /a/v1/objects?type=Order），营收/违约金/换型成本三口径全部从真 Order 字段派生
 * （营收=qty×unitPrice 真值 · 违约金=qty×优先级违约单价 · 换型=qty×换型单价，见 multiObjScenario.ts），
 * 按化学体系（NCM/LFP）建产线占用池 + 按客户建合同额度 → 喂**真** cross_object_occupancy 求解器。
 * 改权重滑杆 → optimize_whatif / cross_object_occupancy **后端真重算** → 占用矩阵 / 被挤订单 / 各目标 Δ **真变**
 * （前端只组装真输入，不做假过滤）。徽标诚实标「CP-SAT 可证最优（推演结果）」——绝不标「数据库事实」。
 * `opt.multiobj` 关 → 整块不存在（R3）。
 */

interface ObjMeta {
  name: string;
  goodWhenNeg: boolean;
  /** 展示换算：元 → 显示值。 */
  toDisplay: (yuan: number) => string;
  unit: string;
}
const yi = (yuan: number): string => fmt(yuan / 1e8, 2); // 亿元
const wan = (yuan: number): string => fmt(yuan / 1e4, 0); // 万元
const OBJ_META: Record<string, ObjMeta> = {
  revenue: { name: "营收", goodWhenNeg: false, toDisplay: yi, unit: "亿元" },
  penalty: { name: "违约金", goodWhenNeg: true, toDisplay: yi, unit: "亿元" },
  cost: { name: "换型成本", goodWhenNeg: true, toDisplay: wan, unit: "万元" },
};
const OBJ_KEYS = ["revenue", "penalty", "cost"] as const;

interface OccResult {
  occupancy: { order: string; line: string }[];
  displaced: string[];
  objectiveValues: Record<string, number>;
  servedCount: number;
  optimal: boolean;
}
interface WhatifResult {
  deltaByObjective?: Record<string, number>;
  feasible: boolean;
  explanation?: string;
}

function MultiObjWhatifInner() {
  const [w, setW] = useState<Record<string, number>>({ revenue: 1, penalty: 1, cost: 1 });

  // 真实订单簿（与全局推演同源 · 真 so/qty/unitPrice/pri/cust）。
  const ordersQ = useQuery({
    queryKey: ["a", "objects", { type: "Order", view: "multiobj-whatif" }],
    queryFn: () => searchObjects("Order", ""),
  });
  const realOrders = useMemo<RealOrderInput[]>(
    () =>
      (ordersQ.data?.items ?? []).map((o) => ({
        so: String(o.props.so ?? o.id),
        cust: String(o.props.cust ?? "—"),
        model: String(o.props.model ?? ""),
        qty: Number(o.props.qty ?? 0),
        unitPrice: Number(o.props.unitPrice ?? 0),
        pri: String(o.props.pri ?? "中"),
      })),
    [ordersQ.data],
  );
  const scenario = useMemo(() => buildOccupancyScenario(realOrders), [realOrders]);
  const hasBook = scenario.orders.length > 0;

  const crossArgs = useMemo(
    () =>
      (weights: Record<string, number>): Record<string, unknown> => ({
        scale: 1,
        seed: 42,
        orders: scenario.orders,
        lines: scenario.lines,
        contracts: scenario.contracts,
        eligibility: scenario.eligibility,
        method: "weighted",
        objectives: OBJ_KEYS.map((k) => ({ key: k, weight: weights[k] })),
      }),
    [scenario],
  );

  // ③ 当前占用（真 cross_object_occupancy）：改权重即重算（useLiveSolver debounce）。无订单簿 → 暂停（null）。
  const occ = useLiveSolver<OccResult>(
    "cross_object_occupancy",
    hasBook ? crossArgs(w) : null,
    (raw) => raw as OccResult,
  );

  // ② 多目标 Δ 分解（真 optimize_whatif）：基线权重(1,1,1) → 当前权重的各目标 Δ。
  const perturbations = useMemo(
    () => OBJ_KEYS.map((k) => ({ kind: "change_objective_weight" as const, target: `objectives.${k}.weight`, value: w[k]! })),
    [w],
  );
  const whatif = useLiveSolver<WhatifResult>(
    "optimize_whatif",
    hasBook ? { family: "cross_object_occupancy", args: crossArgs({ revenue: 1, penalty: 1, cost: 1 }), perturbations } : null,
    (raw) => raw as WhatifResult,
  );

  const rowById = useMemo(() => new Map(scenario.rows.map((r) => [r.id, r])), [scenario]);
  const ov = occ.data?.objectiveValues ?? {};
  const delta = whatif.data?.deltaByObjective;
  // KILL-MOCK-RED：优化器 CP-SAT sidecar 未接入时后端**显式抛「未接入」错**（service.ts）——面板须诚实披露，
  // 不能静默把空/0 当结果显示（0 会被误读为「真求解出来是 0」）。有任何求解错就披露。
  const solverErr = occ.error ?? whatif.error;
  const notWired = !!solverErr && /未接入|OPTIMIZER_BASE_URL|sidecar/i.test(solverErr.message);
  const displacedCount = occ.data?.displaced.length ?? 0;

  return (
    <div className={styles.audCard} data-testid="multiobj-whatif">
      <div className={styles.audHead}>
        <strong>多目标 + 跨对象占用推演（真实订单簿）</strong>
        <span className={styles.chip} title="决策变量在 CP-SAT 上求可证最优，非数据库既有事实" data-testid="multiobj-badge">
          CP-SAT 可证最优 · 推演结果（非数据库事实）
        </span>
      </div>

      {/* 真实订单簿口径披露（KILL-MOCK-RED·接真后去掉「示意·toy fixture」假披露）：订单 id/数量/单价为真 Order 真值；
          违约金/换型为按优先级/体量派生的**推演口径系数**（真实订单簿无此字段），面板据此诚实标注、不冒充数据库金额。 */}
      <div className={styles.noteInfo} data-testid="multiobj-input-disclosure" style={{ fontSize: 11, margin: "2px 0 6px" }}>
        ⓘ 订单簿为<b>本租户真实 Order</b>（真 so/数量/单价，与全局推演同源）；<b>营收 = 数量 × 单价</b>（真值）·
        <b>违约金 = 数量 × 优先级违约单价</b>·<b>换型成本 = 数量 × 换型单价</b>（后二者为推演口径系数，真实订单簿无此字段）。
        产线按化学体系（NCM/LFP）建占用池、合同按客户建额度；下方由<b>真 cross_object_occupancy 求解器</b>计算，改权重→最优真漂移。
      </div>

      {/* KILL-MOCK-RED：优化器未接入/求解失败 → 显式披露，绝不让空/0 冒充真实结果 */}
      {solverErr && (
        <div
          data-testid="multiobj-not-wired"
          style={{ fontSize: 12, margin: "4px 0 8px", padding: "6px 10px", borderRadius: 6, background: "rgba(192,57,43,.08)", border: "1px solid rgba(192,57,43,.35)", color: "var(--c-danger, #c0392b)" }}
        >
          {notWired ? (
            <>⚠ <b>优化器引擎（CP-SAT sidecar）未接入</b>——需设 <code>OPTIMIZER_BASE_URL</code> 并启动 <code>services/optimizer</code>。下方数值为空/0 表示<b>「尚未求解」</b>，<b>不是</b>真实推演结果。</>
          ) : (
            <>⚠ 求解失败：{solverErr.message}。下方数值非有效结果。</>
          )}
        </div>
      )}

      {!hasBook && !solverErr ? (
        <div style={{ fontSize: 12, opacity: 0.7, padding: "8px 0" }} data-testid="multiobj-loading">
          {ordersQ.isFetching ? "加载真实订单簿中…" : "无在手订单（订单簿为空）"}
        </div>
      ) : null}

      {/* ① 各目标当前值 —— 真值口径（KILL-MOCK·带单位）：当前权重下「最优方案」的各目标值（营收 Σ获排 / 违约金 Σ被挤 /
          换型成本 Σ获排换型），随权重此消彼长。营收/违约金亿元、换型成本万元。 */}
      <div style={{ fontSize: 11, opacity: 0.7, margin: "6px 0 2px" }} data-testid="multiobj-objvalues-caption">
        当前权重下<b>最优方案</b>的各目标值（<b>推演结果</b> · 带真实单位 · 随权重变）
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 8px" }} data-testid="multiobj-objvalues">
        {OBJ_KEYS.map((k) => (
          <div key={k} className={styles.kpi} style={{ minWidth: 130 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{OBJ_META[k]!.name}{OBJ_META[k]!.goodWhenNeg ? "（越低越好）" : "（越高越好）"}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {typeof ov[k] === "number" ? OBJ_META[k]!.toDisplay(ov[k]!) : "—"}
              {typeof ov[k] === "number" ? <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 400, marginLeft: 3 }}>{OBJ_META[k]!.unit}</span> : null}
            </div>
          </div>
        ))}
      </div>

      {/* ② 权重滑杆 → 各目标 Δ 分解卡 */}
      <div className={styles.miniForm} style={{ display: "grid", gap: 8, margin: "8px 0" }}>
        {OBJ_KEYS.map((k) => (
          <label key={k} className={styles.formRow} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 80 }}>{OBJ_META[k]!.name}权重</span>
            <input
              type="range" min={0} max={2} step={0.1} value={w[k]}
              data-testid={`multiobj-weight-${k}`}
              onChange={(e) => setW((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
            />
            <span style={{ width: 40, textAlign: "right" }}>{w[k]!.toFixed(1)}×</span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0" }} data-testid="multiobj-delta-cards">
        {delta
          ? OBJ_KEYS.map((k) => {
              const d = delta[k] ?? 0;
              const good = OBJ_META[k]!.goodWhenNeg ? d < 0 : d > 0;
              const color = d === 0 ? "#888" : good ? "#2e9e5b" : "#c0392b";
              return (
                <div key={k} className={styles.kpi} style={{ minWidth: 140, borderLeft: `3px solid ${color}` }} data-testid={`multiobj-delta-${k}`}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{OBJ_META[k]!.name} Δ（相对权重 1×）</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color }}>{d > 0 ? "+" : ""}{OBJ_META[k]!.toDisplay(d)}<span style={{ fontSize: 10, opacity: 0.5, fontWeight: 400, marginLeft: 3 }}>{OBJ_META[k]!.unit}</span></div>
                </div>
              );
            })
          : <span style={{ opacity: 0.6 }}>调整权重滑杆查看各目标 Δ 分解…</span>}
      </div>

      {/* ③ 跨对象占用表 + 被挤订单（真实订单逐行 · 化学线归属 · 真营收/违约金） */}
      <div style={{ maxHeight: 300, overflow: "auto" }}>
        <table className={styles.abCompare} data-testid="multiobj-occupancy" style={{ width: "100%", marginTop: 8 }}>
          <thead>
            <tr><th>订单</th><th>客户</th><th>型号/体系</th><th>优先级</th><th>获排产线</th><th>营收(亿元)</th><th>违约金(未排即计·亿元)</th></tr>
          </thead>
          <tbody>
            {scenario.rows.map((r) => {
              const loaded = !!occ.data;
              const on = occ.data?.occupancy.find((a) => a.order === r.id);
              const displaced = occ.data?.displaced.includes(r.id) ?? false;
              return (
                <tr key={r.id} data-testid={`multiobj-row-${r.id}`} style={displaced ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{r.id}</td>
                  <td>{r.cust}</td>
                  <td>{r.model}<span style={{ opacity: 0.5, marginLeft: 4 }}>{r.chem}</span></td>
                  <td>{r.pri}</td>
                  {/* 未加载完不得渲染「被挤」占位（否则 loading 态伪装成 displaced）；仅数据到手且真未排才标被挤。 */}
                  <td>{!loaded ? "…" : on ? on.line : <span style={{ color: "#c0392b" }} data-testid={`multiobj-displaced-${r.id}`}>被挤（未排）</span>}</td>
                  <td className="num">{yi(r.revenue)}</td>
                  <td className="num">{displaced ? yi(r.penalty) : "0.00"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {occ.data ? (
        <div className={styles.noteAmber} data-testid="multiobj-displaced-note" style={{ marginTop: 6 }}>
          在手 {scenario.orders.length} 单 · 化学体系产线容量覆盖率 60% → 被挤 {displacedCount} 单
          {displacedCount ? `：${occ.data!.displaced.map((id) => rowById.get(id)?.id ?? id).join("、")}（产线容量/合同额度约束下的最优取舍，改权重可换人）` : "（当前权重下全部获排）"}
        </div>
      ) : null}
      {whatif.error || occ.error ? <div className={styles.noteRed}>求解失败：{String((whatif.error || occ.error)?.message ?? "")}</div> : null}
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
